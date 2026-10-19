import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

// Amazon Bedrock is opt-in: health data only leaves the server when the operator turns it on.
export const bedrockConfig = {
  enabled: process.env.CARETHREAD_BEDROCK === 'on',
  region: process.env.AWS_REGION || 'us-east-1',
  modelId: process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0',
  // A voice turn can't wait long; past this we answer from the deterministic path instead
  timeoutMs: Number(process.env.BEDROCK_TIMEOUT_MS || 6000)
};

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  // Credentials come from the standard AWS chain (env vars, profile, or the App Runner/ECS task role)
  client ??= new BedrockRuntimeClient({ region: bedrockConfig.region });
  return client;
}

export type ConverseResult = {
  text: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
};

export async function converseText(system: string, userText: string, maxTokens = 200): Promise<ConverseResult> {
  const response = await getClient().send(
    new ConverseCommand({
      modelId: bedrockConfig.modelId,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: userText }] }],
      inferenceConfig: { maxTokens, temperature: 0 }
    }),
    { abortSignal: AbortSignal.timeout(bedrockConfig.timeoutMs) }
  );

  const text = (response.output?.message?.content ?? [])
    .map(block => block.text ?? '')
    .join('')
    .trim();

  return {
    text,
    modelId: bedrockConfig.modelId,
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
    latencyMs: response.metrics?.latencyMs
  };
}
