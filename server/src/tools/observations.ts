import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { evaluateRedFlags } from '../core/redFlagEngine.js';

// --- log_observation ---
registry.registerTool({
  name: 'log_observation',
  description: 'Log a categorized caregiver observation, evaluated against red-flag rules',
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
      `).run('rf_' + randomUUID(), ctx.circleId, ctx.memberId, match.ruleId, match.level, 'log_observation', ctx.now);
    }

    // 2. Insert Observation
    const obsId = 'obs_' + randomUUID();
    db.prepare(`
      INSERT INTO observations (id, circle_id, member_id, category, text, severity, redflag_rule_id, recorded_at, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(obsId, ctx.circleId, ctx.memberId, input.category, input.text, input.severity || null, ruleId, ctx.now, ctx.now);

    // 3. Audit log
    db.prepare(`INSERT INTO audit_log (id, circle_id, member_id, tool, summary, at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aud_' + randomUUID(), ctx.circleId, ctx.memberId, 'log_observation', `log_observation: category ${input.category}`, ctx.now
    );

    let spokenText = `Logged a ${input.category} note.`;
    if (match) {
      // Get circle emergency number
      const circle = db.prepare(`SELECT emergency_number FROM care_circles WHERE id = ?`).get(ctx.circleId) as any;
      const emNum = circle?.emergency_number || '112';
      const instruction = match.instruction.replace('{emergencyNumber}', emNum);

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
  description: 'Log a measured vital sign reading with range plausibility checking',
  schema: z.object({
    kind: z.enum(['bp', 'glucose', 'temperature', 'weight', 'pulse', 'spo2']),
    value: z.number(),
    value2: z.number().optional(),
    unit: z.string()
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    // Plausibility bounds check
    let isPlausible = true;
    if (input.kind === 'temperature') {
      const isCelsius = input.unit.toLowerCase().includes('c');
      if (isCelsius && (input.value < 30 || input.value > 45)) isPlausible = false;
      if (!isCelsius && (input.value < 86 || input.value > 113)) isPlausible = false;
    } else if (input.kind === 'spo2') {
      if (input.value < 50 || input.value > 100) isPlausible = false;
    } else if (input.kind === 'pulse') {
      if (input.value < 30 || input.value > 260) isPlausible = false;
    } else if (input.kind === 'bp') {
      if (input.value < 40 || input.value > 300) isPlausible = false;
      if (input.value2 !== undefined && (input.value2 < 20 || input.value2 > 200)) isPlausible = false;
    }

    if (!isPlausible) {
      return {
        safetyLevel: 'error',
        safetyCode: 'INVALID_VALUE',
        spokenText: `That ${input.kind} reading of ${input.value} seems implausible. Please double-check the measurement.`,
        data: { error: 'INVALID_VALUE', kind: input.kind, value: input.value }
      };
    }

    // Range check against care circle profile
    const circle = db.prepare(`SELECT vital_ranges_json FROM care_circles WHERE id = ?`).get(ctx.circleId) as any;
    let inRange = 1;
    let spokenText = `Logged ${input.kind} reading of ${input.value} ${input.unit}.`;

    if (circle && circle.vital_ranges_json) {
      const ranges = JSON.parse(circle.vital_ranges_json || '{}');
      if (ranges[input.kind]) {
        const { min, max } = ranges[input.kind];
        if (input.value < min || input.value > max) {
          inRange = 0;
          spokenText = `Logged. Note: ${input.value} is outside the typical range for ${input.kind}.`;
        }
      }
    }

    const vId = 'v_' + randomUUID();
    db.prepare(`
      INSERT INTO vitals (id, circle_id, member_id, kind, value, value2, unit, in_range, recorded_at, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(vId, ctx.circleId, ctx.memberId, input.kind, input.value, input.value2 || null, input.unit, inRange, ctx.now, ctx.now);

    // Audit log
    db.prepare(`INSERT INTO audit_log (id, circle_id, member_id, tool, summary, at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aud_' + randomUUID(), ctx.circleId, ctx.memberId, 'log_vital', `log_vital: ${input.kind}`, ctx.now
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
  description: 'Evaluate a described symptom against red-flag clinical escalation rules without storing data',
  annotations: {
    readOnlyHint: true
  },
  schema: z.object({
    description: z.string().max(500),
    symptoms: z.array(z.string()).optional()
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const combinedText = [input.description, ...(input.symptoms || [])].join(' ').trim();
    const match = evaluateRedFlags(combinedText);

    const circle = db.prepare(`SELECT emergency_number FROM care_circles WHERE id = ?`).get(ctx.circleId) as any;
    const emergencyNumber = circle?.emergency_number || '112';

    if (match) {
      const instruction = match.instruction.replace('{emergencyNumber}', emergencyNumber);
      const prefix = `Call ${emergencyNumber} now.`;
      const spokenText = match.level === 'emergency'
        ? (instruction.toLowerCase().startsWith('call') ? instruction : `${prefix} ${instruction}`)
        : `Contact the clinician or your family doctor today about this.`;

      return {
        safetyLevel: match.level,
        safetyCode: match.ruleId,
        spokenText,
        data: {
          level: match.level,
          ruleId: match.ruleId,
          instruction,
          emergencyNumber,
          matched: match.matched || [],
          negated: match.negated || []
        }
      };
    }

    // No match: never reassure, route to doctor or emergency
    const spokenText = `I can't judge symptoms. If you are worried, contact the doctor or call ${emergencyNumber}.`;
    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText,
      data: {
        level: 'none',
        ruleId: null,
        instruction: `Contact the doctor or call ${emergencyNumber} if concerned.`,
        emergencyNumber,
        matched: [],
        negated: []
      }
    };
  }
});
