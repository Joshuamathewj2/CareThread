import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Tool,
  ToolAnnotations
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AuthContext, resolveAuthContext } from '../middleware/auth.js';
import { filterSpokenOutput } from '../core/outputGuard.js';
import { getCircle } from '../tools/shared.js';

export type SafetyLevel = 'none' | 'caution' | 'error' | 'redflag' | 'emergency' | 'contact_clinician';

/**
 * Multi-turn hint for the voice agent. When a tool needs the caregiver to confirm or choose, it says so
 * here with the exact call to make next, so the agent never has to reconstruct arguments from speech.
 */
export const FollowUpSchema = z.object({
  kind: z.enum(['confirm', 'choose', 'clarify']),
  prompt: z.string().describe('What the agent should ask the caregiver'),
  tool: z.string().optional().describe('Tool to call if the caregiver confirms or chooses'),
  arguments: z.record(z.string(), z.unknown()).optional().describe('Exact arguments for that call'),
  choices: z.array(z.string()).optional().describe('Options for a "choose" follow-up; substitute the chosen one')
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export type ToolResult = {
  safetyLevel: SafetyLevel;
  safetyCode: string | null;
  spokenText: string;
  data: any;
  followUp?: FollowUp;
  // Caregiver words read back verbatim; exempt from the output guard's advice checks
  quotedUserText?: string[];
};

export type ToolHandler<T> = (input: T, ctx: AuthContext) => Promise<ToolResult>;

export interface ToolDefinition<T> {
  name: string;
  title: string;
  description: string;
  schema: z.ZodType<T, any>;
  annotations?: Omit<ToolAnnotations, 'title'>;
  roles: Array<'primary' | 'family' | 'aide' | 'viewer'>;
  handler: ToolHandler<T>;
}

// Every tool returns this envelope as structuredContent, so one outputSchema describes them all.
export const ToolEnvelopeSchema = z.object({
  ok: z.boolean(),
  tool: z.string(),
  safety: z.object({
    level: z.enum(['none', 'caution', 'error', 'redflag', 'emergency', 'contact_clinician']),
    code: z.string().nullable()
  }).optional(),
  data: z.unknown().optional(),
  followUp: FollowUpSchema.optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    details: z.unknown().optional()
  }).optional(),
  attribution: z.object({ memberId: z.string() }).optional(),
  at: z.string().optional()
});
type ToolEnvelope = z.infer<typeof ToolEnvelopeSchema>;

const TIME_FIELDS = new Set(['at', 'minutesAgo', 'fromDate', 'toDate', 'appointmentDate']);

/**
 * JSON Schema for the wire. `io: 'input'` keeps fields with defaults optional (the model may omit them),
 * and $schema is dropped because MCP 2025-11-25 already defaults to 2020-12 and some client validators
 * reject an explicit 2020-12 meta-schema reference.
 */
export function toWireSchema(schema: z.ZodType): Tool['inputSchema'] {
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return jsonSchema as Tool['inputSchema'];
}

function toolError(def: { name: string }, code: string, spoken: string, details?: unknown): CallToolResult {
  const structuredContent: ToolEnvelope = { ok: false, tool: def.name, error: { code, message: spoken, details } };
  return { content: [{ type: 'text', text: spoken }], isError: true, structuredContent };
}

function spokenForValidationError(err: z.ZodError): { code: string; spoken: string } {
  const issue = err.issues[0];
  const field = String(issue?.path[0] ?? '');
  if (TIME_FIELDS.has(field)) {
    return { code: 'INVALID_TIME', spoken: "I couldn't use that time. Tell me how long ago it was." };
  }
  if (issue?.code === 'too_small' || issue?.code === 'too_big') {
    return { code: 'INVALID_VALUE', spoken: 'That number looks off. Say it again?' };
  }
  if (issue?.code === 'invalid_value') {
    return { code: 'INVALID_VALUE', spoken: `I didn't catch the ${field || 'option'}. Say it again?` };
  }
  return { code: 'INVALID_VALUE', spoken: 'That input looks off. Say it again?' };
}

export class ToolRegistry {
  public tools = new Map<string, ToolDefinition<any>>();

  registerTool<T>(def: ToolDefinition<T>) {
    this.tools.set(def.name, def);
  }

  listTools(): Tool[] {
    const outputSchema = toWireSchema(ToolEnvelopeSchema) as Tool['outputSchema'];
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: toWireSchema(t.schema),
      outputSchema,
      annotations: { title: t.title, openWorldHint: false, ...t.annotations }
    }));
  }

  async callTool(name: string, args: Record<string, unknown> | undefined, ctx: AuthContext | undefined): Promise<CallToolResult> {
    const def = this.tools.get(name);
    if (!def) {
      // Unknown tool is a protocol error, not a tool execution error (spec: tools/call error handling)
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }

    if (!ctx) {
      return toolError(def, 'NO_CIRCLE', "I can't find your care circle. Please set it up in the app first.");
    }

    if (!def.roles.includes(ctx.role)) {
      return toolError(def, 'FORBIDDEN_ROLE', 'You can view the log but not change it. Ask the primary caregiver to add you.');
    }

    const parsed = def.schema.safeParse(args ?? {});
    if (!parsed.success) {
      const { code, spoken } = spokenForValidationError(parsed.error);
      return toolError(def, code, spoken, parsed.error.issues);
    }

    try {
      const result = await def.handler(parsed.data, ctx);

      // Deterministic emergency instructions come from the reviewed rule file and are never rewritten.
      const circle = getCircle(ctx.circleId);
      const guard = result.safetyLevel === 'emergency'
        ? { blocked: false, text: result.spokenText, category: undefined }
        : filterSpokenOutput(result.spokenText, circle?.emergency_number, result.quotedUserText);
      const guardBlocked = guard.blocked && guard.category !== 'absence_certainty';

      const structuredContent: ToolEnvelope = {
        ok: true,
        tool: def.name,
        safety: {
          level: guardBlocked ? 'caution' : result.safetyLevel,
          code: guardBlocked ? 'OUTPUT_GUARD_BLOCKED' : result.safetyCode
        },
        data: result.data,
        // A blocked response must not carry a follow-up that acts on the text the guard suppressed
        followUp: guardBlocked ? undefined : result.followUp,
        attribution: { memberId: ctx.memberId },
        at: ctx.now
      };

      return { content: [{ type: 'text', text: guard.text }], structuredContent };
    } catch (err: any) {
      console.error(`Tool ${def.name} failed:`, err?.message);
      return toolError(def, 'INTERNAL', 'Something went wrong and I did not save that. Please try again.');
    }
  }

  attachToServer(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.listTools() }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      this.callTool(request.params.name, request.params.arguments, resolveAuthContext(extra))
    );
  }
}

export const registry = new ToolRegistry();
