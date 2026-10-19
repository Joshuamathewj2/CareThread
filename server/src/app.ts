import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { authMiddleware } from './middleware/auth.js';
import { registry } from './mcp/registry.js';
import { attachResourcesAndPrompts } from './mcp/resources.js';
import { bedrockConfig } from './aws/bedrock.js';
import './tools/medications.js';
import './tools/observations.js';
import './tools/reports.js';
import './tools/additional.js';
import './tools/context.js';
import './tools/askCareLog.js';
import './db/index.js'; // Ensures database is initialized and auto-seeded

export const SERVER_VERSION = '1.1.0';

// Sent to every client in the initialize result; this is how Alexa+ (or any agent) learns the conversation contract.
const SERVER_INSTRUCTIONS = `CareThread is a shared family care log for one care recipient.
- Speak each tool's text content to the caregiver as written. It is already short and voice-safe.
- If structuredContent.safety.level is "emergency", speak it immediately and do not add anything.
- If structuredContent.followUp is present, ask its prompt. When the caregiver confirms (or picks a choice), call followUp.tool with followUp.arguments, replacing "{choice}" with the chosen option.
- Never diagnose, reassure, or suggest doses. Use "not logged", never "not taken".
- Pass minutesAgo for spoken times like "an hour ago". Use care_next_actions for "what needs doing?", ask_care_log for questions about past entries, and undo_last_entry when the caregiver says "undo that".`;

export type TransportMode = 'stateful' | 'stateless';

export interface AppOptions {
  /** stateless = fresh server per POST (for horizontally scaled or serverless hosts); stateful = MCP sessions */
  mode?: TransportMode;
  /** Host header allow-list for DNS-rebinding protection; empty disables the check */
  allowedHosts?: string[];
  /** Idle sessions are closed after this long */
  sessionTtlMs?: number;
}

// Factory to create a clean, fully-wired MCP Server instance per session (or per request when stateless)
export function createMcpServer() {
  const mcpServer = new Server({
    name: 'carethread',
    title: 'CareThread',
    version: SERVER_VERSION
  }, {
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
      prompts: { listChanged: false }
    },
    instructions: SERVER_INSTRUCTIONS
  });

  registry.attachToServer(mcpServer);
  attachResourcesAndPrompts(mcpServer);
  return mcpServer;
}

type Session = { transport: StreamableHTTPServerTransport; server: Server; memberId: string; lastSeen: number };

function jsonRpcError(res: Response, status: number, code: number, message: string) {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

export function createApp(options: AppOptions = {}) {
  const mode = options.mode ?? 'stateful';
  const allowedHosts = options.allowedHosts ?? [];
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 60 * 1000;
  const transportSecurity = allowedHosts.length > 0 ? { enableDnsRebindingProtection: true, allowedHosts } : {};

  const app = express();
  const sessions = new Map<string, Session>();

  // CORS headers for simulator, MCP Inspector, and remote agents. Mcp-Session-Id must be exposed to browsers.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
    res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      server: 'carethread',
      version: SERVER_VERSION,
      mcpSpec: LATEST_PROTOCOL_VERSION,
      transport: `streamable-http (${mode})`,
      tools: registry.tools.size,
      activeSessions: sessions.size,
      bedrock: bedrockConfig.enabled ? { enabled: true, modelId: bedrockConfig.modelId, region: bedrockConfig.region } : { enabled: false }
    });
  });

  app.use('/mcp', express.json({ limit: '1mb' }));

  if (mode === 'stateless') {
    // Each POST gets its own server + transport; nothing is shared between requests.
    app.post('/mcp', authMiddleware, async (req: Request, res: Response) => {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, ...transportSecurity });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err: any) {
        console.error('Error handling stateless MCP request:', err?.message);
        if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
      }
    });
    const notAllowed = (_req: Request, res: Response) => jsonRpcError(res, 405, -32000, 'Method not allowed in stateless mode');
    app.get('/mcp', notAllowed);
    app.delete('/mcp', notAllowed);
    return { app, sessions, close: async () => {} };
  }

  // Stateful: one MCP session per initialize, addressed by the Mcp-Session-Id header.
  // POST carries client messages, GET opens the server-to-client SSE stream, DELETE ends the session.
  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.header('mcp-session-id');
    const memberId = req.authCtx!.memberId;

    try {
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          // Spec: unknown or expired session -> 404, and the client starts a new session
          jsonRpcError(res, 404, -32001, 'Session not found');
          return;
        }
        if (session.memberId !== memberId) {
          // A session belongs to the caregiver who opened it
          jsonRpcError(res, 403, -32000, 'Session belongs to a different member');
          return;
        }
        session.lastSeen = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        jsonRpcError(res, 400, -32000, 'Bad Request: missing Mcp-Session-Id (send initialize first)');
        return;
      }

      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, memberId, lastSeen: Date.now() });
        },
        ...transportSecurity
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      console.error('Error handling MCP request:', err?.message);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  };

  app.post('/mcp', authMiddleware, handleSessionRequest);
  app.get('/mcp', authMiddleware, handleSessionRequest);
  app.delete('/mcp', authMiddleware, handleSessionRequest);

  // Sessions abandoned without a DELETE (a closed browser tab, a dropped device) are reaped.
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - sessionTtlMs;
    for (const [id, session] of sessions) {
      if (session.lastSeen < cutoff) {
        sessions.delete(id);
        session.transport.close();
        session.server.close();
      }
    }
  }, Math.min(sessionTtlMs, 60_000));
  sweeper.unref();

  const close = async () => {
    clearInterval(sweeper);
    for (const session of sessions.values()) {
      await session.transport.close();
      await session.server.close();
    }
    sessions.clear();
  };

  return { app, sessions, close };
}
