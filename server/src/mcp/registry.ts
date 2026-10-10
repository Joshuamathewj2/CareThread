import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  Tool 
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AuthContext, authContextStorage } from '../middleware/auth.js';
import { filterSpokenOutput } from '../core/outputGuard.js';

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
  public tools = new Map<string, ToolDefinition<any>>();

  registerTool<T>(def: ToolDefinition<T>) {
    this.tools.set(def.name, def);
  }

  attachToServer(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolList: Tool[] = Array.from(this.tools.values()).map(t => {
        // Use Zod 4's native toJSONSchema
        const jsonSchema = (z as any).toJSONSchema 
          ? (z as any).toJSONSchema(t.schema) 
          : { type: 'object', properties: {} };

        const tool: Tool = {
          name: t.name,
          description: t.description,
          inputSchema: jsonSchema as any
        };

        if (t.annotations) {
          (tool as any).annotations = t.annotations;
        }

        return tool;
      });
      return { tools: toolList };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
        const input = def.schema.parse(request.params.arguments || {});
        const result = await def.handler(input, ctx);
        
        // Pass spoken output through Output Guard
        const guardResult = filterSpokenOutput(result.spokenText);
        const finalSpokenText = guardResult.text;

        return {
          content: [{ type: 'text', text: finalSpokenText }],
          structuredContent: {
            ok: true,
            tool: def.name,
            safety: { 
              level: guardResult.blocked && guardResult.category !== 'absence_certainty' ? 'caution' : result.safetyLevel, 
              code: guardResult.blocked && guardResult.category !== 'absence_certainty' ? 'OUTPUT_GUARD_BLOCKED' : result.safetyCode 
            },
            data: result.data,
            attribution: { memberId: ctx.memberId },
            at: ctx.now
          }
        } as any;
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          const firstIssue = err.issues[0];
          let spoken = "That input looks off. Say it again?";
          let code = "INVALID_VALUE";

          if (firstIssue) {
            const pathStr = firstIssue.path.join('.');
            if (pathStr.includes('time') || pathStr.includes('at') || pathStr.includes('minutes')) {
              spoken = "I couldn't use that time. Tell me how long ago it was.";
              code = "INVALID_TIME";
            } else if (firstIssue.code === 'too_small' || firstIssue.code === 'too_big') {
              spoken = "That number looks off. Say it again?";
              code = "INVALID_VALUE";
            }
          }

          return {
            content: [{ type: 'text', text: spoken }],
            isError: true,
            structuredContent: {
              ok: false,
              tool: def.name,
              error: { code, message: spoken, details: err.issues }
            }
          } as any;
        }

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
