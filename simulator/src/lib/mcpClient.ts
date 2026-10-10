import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CallToolResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js';

class CareThreadClient {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private currentMemberId: string | null = null;
  public onTrace?: (trace: any) => void;

  async connect(memberId: string) {
    if (this.client && this.currentMemberId === memberId) return;

    if (this.client) {
      try {
        await this.client.close();
      } catch (e) {
        // ignore close error
      }
      this.client = null;
      this.transport = null;
    }

    this.currentMemberId = memberId;
    this.transport = new SSEClientTransport(new URL('/mcp', window.location.origin), {
       requestInit: {
         headers: {
           'Authorization': `Bearer ${memberId}`
         }
       }
    });

    this.client = new Client({
      name: 'simulator',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await this.client.connect(this.transport);
  }

  async callTool(name: string, args: any) {
    if (!this.client) throw new Error('Not connected');
    
    const callRecord = {
      tool: name,
      args,
      time: new Date().toISOString()
    };

    try {
      const result = await this.client.request(
        {
          method: 'tools/call',
          params: { name, arguments: args }
        },
        CallToolResultSchema
      );
      if (this.onTrace) this.onTrace({ ...callRecord, result });
      return result;
    } catch (err: any) {
      if (this.onTrace) this.onTrace({ ...callRecord, error: err });
      throw err;
    }
  }

  async readResource(uri: string) {
    if (!this.client) throw new Error('Not connected');
    const res = await this.client.request(
      {
        method: 'resources/read',
        params: { uri }
      },
      ReadResourceResultSchema
    );
    return res;
  }
}

export const mcpClient = new CareThreadClient();
