import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stand-in for the AWS SDK so the Bedrock path runs without credentials or network.
// Everything above the SDK (prompt assembly, timeout, fallback, output guard) is the real code.
const send = vi.fn();
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class { send = send; },
  ConverseCommand: class { constructor(public input: any) {} }
}));

const { registry } = await import('../src/mcp/registry.js');
await import('../src/tools/observations.js');
await import('../src/tools/askCareLog.js');
const { bedrockConfig } = await import('../src/aws/bedrock.js');
const { db } = await import('../src/db/index.js');

const ctx = { circleId: 'c_1', memberId: 'm_priya', role: 'primary' as const, now: new Date().toISOString() };
const ask = async (question: string) => {
  const res = await registry.callTool('ask_care_log', { question }, ctx);
  return { text: (res.content[0] as any).text as string, sc: res.structuredContent as any };
};

describe('ask_care_log', () => {
  beforeEach(() => {
    send.mockReset();
    bedrockConfig.enabled = false;
    db.prepare(`UPDATE care_circles SET privacy_mode = 0 WHERE id = 'c_1'`).run();
  });

  it('answers deterministically from the log when Bedrock is off', async () => {
    const { text, sc } = await ask('When was he dizzy?');
    expect(sc.data.engine).toBe('deterministic');
    expect(text).toContain('dizzy after standing');
    expect(send).not.toHaveBeenCalled();
  });

  it('calls Amazon Bedrock Converse with the log as grounded context', async () => {
    bedrockConfig.enabled = true;
    send.mockResolvedValue({
      output: { message: { content: [{ text: 'Meera noted lunch was half eaten yesterday at 1 PM.' }] } },
      usage: { inputTokens: 420, outputTokens: 14 },
      metrics: { latencyMs: 380 }
    });

    const { text, sc } = await ask('How did lunch go yesterday?');
    expect(text).toBe('Meera noted lunch was half eaten yesterday at 1 PM.');
    expect(sc.data).toMatchObject({ engine: 'bedrock', modelId: bedrockConfig.modelId, usage: { inputTokens: 420 } });

    const command = send.mock.calls[0][0];
    expect(command.input.modelId).toBe(bedrockConfig.modelId);
    expect(command.input.inferenceConfig.temperature).toBe(0);
    expect(command.input.system[0].text).toContain('ONLY the care log');
    expect(command.input.messages[0].content[0].text).toContain('lunch half eaten');
    expect(send.mock.calls[0][1].abortSignal).toBeDefined();
  });

  it('falls back to the deterministic answer when Bedrock fails', async () => {
    bedrockConfig.enabled = true;
    send.mockRejectedValue(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }));
    const { text, sc } = await ask('When was he dizzy?');
    expect(sc.data).toMatchObject({ engine: 'deterministic', reason: 'bedrock_error', error: 'ThrottlingException' });
    expect(text).toContain('dizzy after standing');
  });

  it('never sends the log to Bedrock in privacy mode', async () => {
    bedrockConfig.enabled = true;
    db.prepare(`UPDATE care_circles SET privacy_mode = 1 WHERE id = 'c_1'`).run();
    const { sc } = await ask('How did lunch go yesterday?');
    expect(sc.data.engine).toBe('deterministic');
    expect(send).not.toHaveBeenCalled();
  });

  it('routes an emergency description to the red-flag rules, not the model', async () => {
    bedrockConfig.enabled = true;
    const { text, sc } = await ask('is chest pain after dinner something to log?');
    expect(sc.safety.level).toBe('emergency');
    expect(text).toMatch(/^Call 112 now/);
    expect(send).not.toHaveBeenCalled();
  });

  it('still screens model output with the output guard', async () => {
    bedrockConfig.enabled = true;
    send.mockResolvedValue({ output: { message: { content: [{ text: "Don't worry, that's normal at his age." }] } } });
    const { text, sc } = await ask('Is the dizziness a problem?');
    expect(sc.safety.code).toBe('OUTPUT_GUARD_BLOCKED');
    expect(text).toContain("I can't answer that safely");
  });
});
