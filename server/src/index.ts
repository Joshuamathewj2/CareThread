import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AuthContext, authMiddleware } from './middleware/auth.js';
import { registry } from './mcp/registry.js';
import { attachResourcesAndPrompts } from './mcp/resources.js';
import './tools/medications.js'; // This will register the tools
import './tools/observations.js';
import './tools/reports.js';
import './tools/additional.js';

export const authContextStorage = new AsyncLocalStorage<AuthContext>();

const app = express();
const port = process.env.PORT || 3001;

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Setup MCP server
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

// Attach tools to MCP Server
registry.attachToServer(mcpServer);
attachResourcesAndPrompts(mcpServer);

// Map to hold transports per session (if needed, though SSE usually has one transport per connection)
// In a simple setup, we can just instantiate a new transport on GET /mcp
let transport: SSEServerTransport | null = null;

app.get('/mcp', (req, res) => {
  transport = new SSEServerTransport('/mcp/message', res);
  mcpServer.connect(transport);
});

app.post('/mcp/message', authMiddleware, async (req, res) => {
  if (!transport) {
    res.status(503).json({ error: 'Transport not initialized. Connect via GET /mcp first.' });
    return;
  }
  
  // Wrap the handlePostMessage in the async local storage context
  authContextStorage.run(req.authCtx as AuthContext, async () => {
    await transport!.handlePostMessage(req as any, res as any);
  });
});

app.listen(port, () => {
  console.log(`CareThread MCP server running on port ${port}`);
});
