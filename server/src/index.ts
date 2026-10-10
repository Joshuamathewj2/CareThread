import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AuthContext, authMiddleware, authContextStorage } from './middleware/auth.js';
import { registry } from './mcp/registry.js';
import { attachResourcesAndPrompts } from './mcp/resources.js';
import './tools/medications.js';
import './tools/observations.js';
import './tools/reports.js';
import './tools/additional.js';
import './db/index.js'; // Ensures database is initialized and auto-seeded

export { authContextStorage };

const app = express();
const port = process.env.PORT || 3001;

// CORS headers for simulator, MCP Inspector, and remote agents
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-id');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'carethread', mcpSpec: '2025-11-25' });
});

// Factory to create a clean, fully-wired MCP Server instance per connection/session
export function createMcpServer() {
  const mcpServer = new Server({
    name: 'carethread',
    version: '1.0.0'
  }, {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    }
  });

  registry.attachToServer(mcpServer);
  attachResourcesAndPrompts(mcpServer);
  return mcpServer;
}

// Session map for multi-client SSE support
const sseSessions = new Map<string, { server: Server; transport: SSEServerTransport }>();
let latestSseTransport: SSEServerTransport | null = null;

// Streamable HTTP instance for direct POST /mcp calls
let streamableTransport: StreamableHTTPServerTransport | null = null;
let streamableServer: Server | null = null;

async function getStreamableTransport() {
  if (!streamableTransport) {
    streamableTransport = new StreamableHTTPServerTransport();
    streamableServer = createMcpServer();
    await streamableServer.connect(streamableTransport);
  }
  return { transport: streamableTransport, server: streamableServer };
}

// 1. SSE Connection Handshake: GET /mcp
app.get('/mcp', async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new SSEServerTransport('/mcp/message', res);
    await server.connect(transport);

    sseSessions.set(transport.sessionId, { server, transport });
    latestSseTransport = transport;

    req.on('close', () => {
      sseSessions.delete(transport.sessionId);
      if (latestSseTransport === transport) {
        latestSseTransport = null;
      }
    });
  } catch (err: any) {
    console.error('Error establishing SSE connection:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to establish SSE transport', details: err.message });
    }
  }
});

// 2. SSE Message Handler: POST /mcp/message
app.post('/mcp/message', authMiddleware, async (req, res) => {
  const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string);
  const session = (sessionId && sseSessions.get(sessionId)) || (latestSseTransport ? { transport: latestSseTransport } : null);

  if (!session) {
    res.status(503).json({ error: 'Transport not initialized. Connect via GET /mcp first.' });
    return;
  }

  authContextStorage.run(req.authCtx as AuthContext, async () => {
    try {
      await session.transport.handlePostMessage(req as any, res as any);
    } catch (err: any) {
      console.error('Error handling SSE post message:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process message', details: err.message });
      }
    }
  });
});

// 3. Streamable HTTP Direct Post Handler: POST /mcp
app.post('/mcp', authMiddleware, async (req, res) => {
  const { transport } = await getStreamableTransport();
  authContextStorage.run(req.authCtx as AuthContext, async () => {
    try {
      await transport.handleRequest(req as any, res as any);
    } catch (err: any) {
      console.error('Error handling Streamable HTTP request:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process Streamable HTTP request', details: err.message });
      }
    }
  });
});

app.listen(port, () => {
  console.log(`CareThread MCP server running on port ${port} (SSE & Streamable HTTP)`);
});
