import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION, McpError } from '@modelcontextprotocol/sdk/types.js';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';

// End-to-end over real HTTP with the official SDK client: the same path Alexa+ or the MCP Inspector takes.

async function listen(app: ReturnType<typeof createApp>['app']): Promise<{ server: HttpServer; url: URL }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: new URL(`http://127.0.0.1:${port}/mcp`) });
    });
  });
}

async function connect(url: URL, memberId: string) {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${memberId}` } }
  });
  await client.connect(transport);
  return { client, transport };
}

const initializeBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'raw', version: '0' } }
};

describe('Streamable HTTP transport (stateful sessions)', () => {
  let http: HttpServer;
  let url: URL;
  let closeApp: () => Promise<void>;

  beforeAll(async () => {
    const created = createApp({ mode: 'stateful' });
    closeApp = created.close;
    ({ server: http, url } = await listen(created.app));

    // A second, unrelated care circle to prove isolation
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO users (id, created_at) VALUES ('u_other', ?)`).run(now);
    db.prepare(`INSERT OR IGNORE INTO care_circles (id, recipient_name, created_at) VALUES ('c_2', 'Other family', ?)`).run(now);
    db.prepare(`INSERT OR IGNORE INTO members (id, circle_id, user_id, display_name, role, color, created_at) VALUES ('m_other', 'c_2', 'u_other', 'Other', 'primary', '#000', ?)`).run(now);
  });

  afterAll(async () => {
    await closeApp();
    http.close();
  });

  it('negotiates the 2025-11-25 protocol and returns server instructions', async () => {
    const { client, transport } = await connect(url, 'm_priya');
    expect(LATEST_PROTOCOL_VERSION).toBe('2025-11-25');
    expect(transport.protocolVersion).toBe('2025-11-25');
    expect(transport.sessionId).toBeTruthy();
    expect(client.getServerVersion()?.name).toBe('carethread');
    expect(client.getInstructions()).toContain('followUp');
    await client.close();
  });

  it('serves many requests on one session (the original single-transport bug)', async () => {
    const { client } = await connect(url, 'm_priya');
    for (let i = 0; i < 5; i++) {
      const res = await client.callTool({ name: 'med_check_status', arguments: {} });
      expect(res.isError).toBeFalsy();
    }
    await client.close();
  });

  it('keeps concurrent sessions for different caregivers separate', async () => {
    const priya = await connect(url, 'm_priya');
    const arjun = await connect(url, 'm_arjun');
    expect(priya.transport.sessionId).not.toBe(arjun.transport.sessionId);

    const [a, b] = await Promise.all([
      priya.client.callTool({ name: 'recipient_profile', arguments: { action: 'get' } }),
      arjun.client.callTool({ name: 'recipient_profile', arguments: { action: 'get' } })
    ]);
    expect((a.structuredContent as any).attribution.memberId).toBe('m_priya');
    expect((b.structuredContent as any).attribution.memberId).toBe('m_arjun');
    await priya.client.close();
    await arjun.client.close();
  });

  it('publishes explicit tool contracts: title, annotations, input and output schemas', async () => {
    const { client } = await connect(url, 'm_priya');
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(16);

    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf('boolean');
      expect(JSON.stringify(tool.inputSchema)).not.toContain('$schema');
    }

    // Fields with defaults stay optional for the model
    const logDose = tools.find(t => t.name === 'med_log_given')!;
    expect(logDose.inputSchema.required).toEqual(['medication']);
    expect(tools.find(t => t.name === 'undo_last_entry')!.annotations?.destructiveHint).toBe(true);
    await client.close();
  });

  it('returns structuredContent that the SDK client validates against outputSchema', async () => {
    const { client } = await connect(url, 'm_priya');
    await client.listTools(); // client caches output schemas and validates every callTool result
    const res = await client.callTool({ name: 'care_next_actions', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as any).ok).toBe(true);
    expect((res.content as any)[0].text.length).toBeGreaterThan(0);
    await client.close();
  });

  it('reports bad input as a tool execution error the agent can speak', async () => {
    const { client } = await connect(url, 'm_priya');
    const res = await client.callTool({ name: 'log_vital', arguments: { kind: 'bp', value: 140 } });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as any).error.code).toBe('INVALID_VALUE');
    await client.close();
  });

  it('rejects an unknown tool with a JSON-RPC protocol error', async () => {
    const { client } = await connect(url, 'm_priya');
    await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toMatchObject({ code: -32602 });
    await client.close();
  });

  it('enforces roles: a viewer cannot write', async () => {
    const { client } = await connect(url, 'm_guest');
    const res = await client.callTool({ name: 'log_observation', arguments: { category: 'meals', text: 'ate well' } });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as any).error.code).toBe('FORBIDDEN_ROLE');
    await client.close();
  });

  it("scopes resources to the caller's circle", async () => {
    const other = await connect(url, 'm_other');
    const { resources } = await other.client.listResources();
    expect(resources.map(r => r.uri)).toContain('carethread://circle/c_2/log/today');

    await expect(other.client.readResource({ uri: 'carethread://circle/c_1/log/today' })).rejects.toBeInstanceOf(McpError);
    const meds = await other.client.readResource({ uri: 'carethread://current-medications' });
    expect(JSON.parse((meds.contents[0] as any).text)).toEqual([]); // c_1's medications are not visible
    await other.client.close();
  });

  it('requires a bearer token', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initializeBody)
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('returns 404 for an unknown session and 403 for another member\'s session', async () => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': LATEST_PROTOCOL_VERSION };
    const listBody = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    const unknown = await fetch(url, { method: 'POST', headers: { ...headers, Authorization: 'Bearer m_priya', 'Mcp-Session-Id': 'nope' }, body: listBody });
    expect(unknown.status).toBe(404);

    const priya = await connect(url, 'm_priya');
    const hijack = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer m_arjun', 'Mcp-Session-Id': priya.transport.sessionId! },
      body: listBody
    });
    expect(hijack.status).toBe(403);
    await priya.client.close();
  });

  it('terminates a session on DELETE', async () => {
    const { client, transport } = await connect(url, 'm_priya');
    const sessionId = transport.sessionId!;
    await transport.terminateSession();
    const after = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer m_priya', 'Mcp-Session-Id': sessionId, 'Mcp-Protocol-Version': LATEST_PROTOCOL_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    });
    expect(after.status).toBe(404);
    await client.close();
  });
});

describe('Streamable HTTP transport (stateless mode)', () => {
  let http: HttpServer;
  let url: URL;

  beforeAll(async () => {
    ({ server: http, url } = await listen(createApp({ mode: 'stateless' }).app));
  });

  afterAll(() => {
    http.close();
  });

  it('handles repeated requests with a fresh transport each time', async () => {
    const { client, transport } = await connect(url, 'm_priya');
    expect(transport.sessionId).toBeUndefined();
    for (let i = 0; i < 3; i++) {
      const res = await client.callTool({ name: 'med_check_status', arguments: {} });
      expect(res.isError).toBeFalsy();
    }
    await client.close();
  });
});
