import { z } from 'zod';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { evaluateRedFlags } from '../core/redFlagEngine.js';

// --- log_observation ---
registry.registerTool({
  name: 'log_observation',
  description: 'Log a free-text observation and classify it',
  schema: z.object({
    category: z.enum(['meals', 'mood', 'mobility', 'pain', 'sleep', 'bathroom', 'other']),
    text: z.string().max(1000),
    severity: z.number().min(1).max(3).optional()
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    // 1. Evaluate Red Flags
    const match = evaluateRedFlags(input.text);
    let ruleId = null;

    if (match) {
      ruleId = match.ruleId;
      // Record red flag event
      db.prepare(`
        INSERT INTO redflag_events (id, circle_id, member_id, rule_id, level, source_tool, at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('rf_' + Date.now(), ctx.circleId, ctx.memberId, match.ruleId, match.level, 'log_observation', ctx.now);
    }

    // 2. Insert Observation
    const obsId = 'obs_' + Date.now();
    db.prepare(`
      INSERT INTO observations (id, circle_id, member_id, category, text, severity, redflag_rule_id, recorded_at, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(obsId, ctx.circleId, ctx.memberId, input.category, input.text, input.severity || null, ruleId, ctx.now, ctx.now);

    // 3. Audit log
    db.prepare(`INSERT INTO audit_log (id, circle_id, member_id, tool, summary, at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aud_'+Date.now(), ctx.circleId, ctx.memberId, 'log_observation', `log_observation: category ${input.category}`, ctx.now
    );

    let spokenText = `Logged a ${input.category} note.`;
    if (match) {
      // Get circle emergency number
      const circle = db.prepare(`SELECT emergency_number FROM care_circles WHERE id = ?`).get(ctx.circleId) as any;
      const emNum = circle?.emergency_number || '112';
      const instruction = match.instruction.replace('{emergencyNumber}', emNum);

      // Localized time format can be tricky, using a simple HH:mm
      const hhmm = new Date(ctx.now).toISOString().substring(11, 16);
      spokenText = `${instruction} I have noted the time as ${hhmm} UTC.`;
    }

    return {
      safetyLevel: match ? match.level : 'none',
      safetyCode: match ? match.ruleId : null,
      spokenText,
      data: { observationId: obsId, redFlag: match }
    };
  }
});

// --- log_vital ---
registry.registerTool({
  name: 'log_vital',
  description: 'Log a measured vital sign',
  schema: z.object({
    kind: z.enum(['bp', 'glucose', 'temperature', 'weight', 'pulse', 'spo2']),
    value: z.number(),
    value2: z.number().optional(),
    unit: z.string()
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    // Range check
    const circle = db.prepare(`SELECT vital_ranges_json FROM care_circles WHERE id = ?`).get(ctx.circleId) as any;
    let inRange = 1;
    let spokenText = `Logged ${input.kind} reading of ${input.value} ${input.unit}.`;

    if (circle && circle.vital_ranges_json) {
      const ranges = JSON.parse(circle.vital_ranges_json);
      if (ranges[input.kind]) {
        const { min, max } = ranges[input.kind];
        if (input.value < min || input.value > max) {
          inRange = 0;
          spokenText = `Logged. Note: ${input.value} is outside the typical range for ${input.kind}.`;
        }
      }
    }

    const vId = 'v_' + Date.now();
    db.prepare(`
      INSERT INTO vitals (id, circle_id, member_id, kind, value, value2, unit, in_range, recorded_at, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(vId, ctx.circleId, ctx.memberId, input.kind, input.value, input.value2 || null, input.unit, inRange, ctx.now, ctx.now);

    // Audit log
    db.prepare(`INSERT INTO audit_log (id, circle_id, member_id, tool, summary, at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aud_'+Date.now(), ctx.circleId, ctx.memberId, 'log_vital', `log_vital: ${input.kind}`, ctx.now
    );

    return {
      safetyLevel: inRange ? 'none' : 'caution',
      safetyCode: inRange ? null : 'OUT_OF_RANGE',
      spokenText,
      data: { vitalId: vId, inRange: !!inRange }
    };
  }
});

// --- redflag_check ---
registry.registerTool({
  name: 'redflag_check',
  description: 'Check for recent red flag events',
  schema: z.object({
    hoursBack: z.number().default(24)
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const since = new Date(new Date(ctx.now).getTime() - input.hoursBack * 3600000).toISOString();
    
    const events = db.prepare(`
      SELECT r.id, r.rule_id, r.level, r.at, m.display_name 
      FROM redflag_events r
      JOIN members m ON r.member_id = m.id
      WHERE r.circle_id = ? AND r.at >= ?
      ORDER BY r.at DESC
    `).all(ctx.circleId, since) as any[];

    if (events.length === 0) {
      return { safetyLevel: 'none', safetyCode: null, spokenText: `No red flags in the last ${input.hoursBack} hours.`, data: [] };
    }

    return {
      safetyLevel: 'none', // just reporting, not a new red flag
      safetyCode: null,
      spokenText: `Found ${events.length} red flags in the last ${input.hoursBack} hours.`,
      data: events
    };
  }
});
