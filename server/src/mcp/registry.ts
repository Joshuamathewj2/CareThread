import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  Tool 
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AuthContext } from '../middleware/auth.js';
import { authContextStorage } from '../index.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type ToolHandler<T> = (input: T, ctx: AuthContext) => Promise<{
  safetyLevel: 'none' | 'caution' | 'error' | 'redflag';
  safetyCode: string | null;
  spokenText: string;
  data: any;
}>;

export interface ToolDefinition<T> {
  name: string;
  description: string;
  schema: z.ZodSchema<T>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
  roles: Array<'primary' | 'family' | 'aide' | 'viewer'>;
  handler: ToolHandler<T>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any>>();

  registerTool<T>(def: ToolDefinition<T>) {
    this.tools.set(def.name, def);
  }

  attachToServer(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolList: Tool[] = Array.from(this.tools.values()).map(t => {
        return {
          name: t.name,
          description: t.description,
          inputSchema: zodToJsonSchema(t.schema as any) as any
        };
      });
      return { tools: toolList };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const ctx = authContextStorage.getStore();
      
      if (!ctx) {
         return {
           content: [{ type: 'text', text: "I can't find your care circle. Please set it up in the app first." }],
           isError: true,
           structuredContent: {
             ok: false,
             tool: request.params.name,
             error: { code: 'NO_CIRCLE' }
           }
         } as any;
      }

      const def = this.tools.get(request.params.name);
      if (!def) {
        throw new Error(`Tool not found: ${request.params.name}`);
      }

      if (!def.roles.includes(ctx.role)) {
        return {
          content: [{ type: 'text', text: "You can view the log but not change it. Ask the primary caregiver to add you." }],
          isError: true,
          structuredContent: {
            ok: false,
            tool: def.name,
            error: { code: 'FORBIDDEN_ROLE' }
          }
        } as any;
      }

      try {
        const input = def.schema.parse(request.params.arguments);
        const result = await def.handler(input, ctx);
        
        return {
          content: [{ type: 'text', text: result.spokenText }],
          structuredContent: {
            ok: true,
            tool: def.name,
            safety: { level: result.safetyLevel, code: result.safetyCode },
            data: result.data,
            attribution: { memberId: ctx.memberId },
            at: ctx.now
          }
        } as any;
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: "Something went wrong and I did not save that. Please try again." }],
          isError: true,
          structuredContent: {
            ok: false,
            tool: def.name,
            error: { code: 'INTERNAL', message: err.message }
          }
        } as any;
      }
    });
  }
}

export const registry = new ToolRegistry();
