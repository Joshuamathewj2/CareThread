import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

class CareThreadClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private currentMemberId: string | null = null;
  public onTrace?: (trace: any) => void;

  async connect(memberId: string) {
    if (this.client && this.currentMemberId === memberId) return;

    if (this.client) {
      try {
        // End the old caregiver's MCP session on the server, then drop the connection
        await this.transport?.terminateSession();
        await this.client.close();
      } catch (e) {
        // ignore close error
      }
      this.client = null;
      this.transport = null;
    }

    this.currentMemberId = memberId;
    // Streamable HTTP (MCP 2025-11-25): one endpoint, session tracked by the Mcp-Session-Id header
    this.transport = new StreamableHTTPClientTransport(new URL('/mcp', window.location.origin), {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${memberId}`
        }
      }
    });

    this.client = new Client({
      name: 'carethread-simulator',
      version: '1.1.0'
    });

    await this.client.connect(this.transport);
    // Caches output schemas so every callTool result is validated against the server's contract
    await this.client.listTools();
  }

  get sessionId() {
    return this.transport?.sessionId;
  }

  async callTool(name: string, args: any) {
    if (!this.client) throw new Error('Not connected');

    const callRecord = {
      tool: name,
      args,
      sessionId: this.transport?.sessionId,
      time: new Date().toISOString()
    };

    try {
      const result = await this.client.callTool({ name, arguments: args });
      if (this.onTrace) this.onTrace({ ...callRecord, result });
      return result;
    } catch (err: any) {
      if (this.onTrace) this.onTrace({ ...callRecord, error: err });
      throw err;
    }
  }

  async readResource(uri: string) {
    if (!this.client) throw new Error('Not connected');
    return this.client.readResource({ uri });
  }
}

export const mcpClient = new CareThreadClient();
