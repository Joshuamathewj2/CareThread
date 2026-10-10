import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

class CareThreadClient {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  public onTrace?: (trace: any) => void;

  async connect(memberId: string) {
    if (this.client) return;

    this.transport = new SSEClientTransport(new URL('/mcp', window.location.origin), {
       eventSourceInit: {
         // Some EventSource polyfills support headers, but standard browser EventSource does NOT support custom headers.
         // Wait, the SDK's SSEClientTransport uses the standard EventSource. 
         // If we need Auth, we typically pass it in the URL or cookies for browser SSE.
         // For this MVP, we will pass memberId in a query param ?member=m_priya to the SSE URL,
         // and we also need to pass it in the POST requests.
         // Actually, SSEClientTransport accepts `requestInit` for the POST requests.
       },
       requestInit: {
         headers: {
           'Authorization': `Bearer ${memberId}`
         }
       }
    });

    // We must fix the EventSource URL to include the member token if our server expects auth on GET /mcp
    // However, our Express server `app.get('/mcp')` doesn't enforce auth, only `app.post('/mcp/message')` does!
    // So standard SSE without headers is fine for the GET request.

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
    
    // For trace panel
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
    } catch (err) {
      if (this.onTrace) this.onTrace({ ...callRecord, error: err });
      throw err;
    }
  }
}

export const mcpClient = new CareThreadClient();
