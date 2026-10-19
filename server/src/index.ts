import { createApp, TransportMode } from './app.js';
import { bedrockConfig } from './aws/bedrock.js';

export { authContextStorage } from './middleware/auth.js';
export { createApp, createMcpServer } from './app.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const mode: TransportMode = process.env.MCP_STATELESS === 'true' ? 'stateless' : 'stateful';
const allowedHosts = (process.env.ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);

const { app } = createApp({ mode, allowedHosts });

app.listen(port, host, () => {
  console.log(`CareThread MCP server on http://${host}:${port}/mcp (Streamable HTTP, ${mode})`);
  console.log(`Amazon Bedrock for ask_care_log: ${bedrockConfig.enabled ? `on (${bedrockConfig.modelId}, ${bedrockConfig.region})` : 'off (deterministic answers)'}`);
});
