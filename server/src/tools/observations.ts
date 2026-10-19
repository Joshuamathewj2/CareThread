import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { evaluateRedFlags } from '../core/redFlagEngine.js';
import { formatLocalTime, getCircle, renderInstruction, writeAudit } from './shared.js';

const DEFAULT_UNITS: Record<string, string> = { bp: 'mmHg', glucose: 'mg/dL', temperature: 'C', weight: 'kg', pulse: 'bpm', spo2: '%' };

// --- log_observation ---
registry.registerTool({
  name: 'log_observation',
  title: 'Log an observation',
  description: 'Log what the caregiver noticed (meals, mood, pain...). Urgent symptoms trigger a deterministic escalation',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  schema: z.object({
    category: z.enum(['meals', 'mood', 'mobility', 'pain', 'sleep', 'bathroom', 'other']),
    text: z.string().min(1).max(1000).describe("The caregiver's words, close to verbatim. Do not summarize away symptoms"),
    severity: z.number().int().min(1).max(3).optional().describe('1 mild, 2 moderate, 3 severe, only if the caregiver said so')
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
    writeAudit(ctx.circleId, ctx.memberId, 'log_observation', `log_observation: category ${input.category}`, ctx.now);

    let spokenText = input.category === 'other' ? 'Logged a note.' : `Logged a ${input.category} note.`;
    if (match) {
      const circle = getCircle(ctx.circleId);
      const instruction = renderInstruction(match.instruction, circle);
      spokenText = `${instruction} I have noted the time as ${formatLocalTime(ctx.now, circle?.timezone || 'UTC')}.`;
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
  title: 'Log a vital sign',
  description: 'Log a measured reading (blood pressure, glucose, temperature, weight, pulse, SpO2) with plausibility and range checks',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  schema: z.object({
    kind: z.enum(['bp', 'glucose', 'temperature', 'weight', 'pulse', 'spo2']),
    value: z.number().finite().describe('The reading; systolic for blood pressure'),
    value2: z.number().finite().optional().describe('Diastolic, required for blood pressure'),
    unit: z.string().max(10).optional().describe('Defaults: mmHg, mg/dL, C, kg, bpm, %')
  }).refine(v => v.kind !== 'bp' || v.value2 !== undefined, { message: 'Blood pressure needs both numbers', path: ['value2'] }),
  roles: ['primary', 'family', 'aide'],
  handler: async (rawInput, ctx) => {
    const input = { ...rawInput, unit: rawInput.unit || DEFAULT_UNITS[rawInput.kind] };
    const reading = input.value2 !== undefined ? `${input.value} over ${input.value2}` : `${input.value}`;
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
    let spokenText = `Logged ${input.kind} reading of ${reading} ${input.unit}.`;

    if (circle && circle.vital_ranges_json) {
      const ranges = JSON.parse(circle.vital_ranges_json || '{}');
      if (ranges[input.kind]) {
        const { min, max } = ranges[input.kind];
        if (input.value < min || input.value > max) {
          inRange = 0;
          spokenText = `Logged. Note: ${reading} is outside the range set for ${input.kind}.`;
        }
      }
    }

    const vId = 'v_' + randomUUID();
    db.prepare(`
      INSERT INTO vitals (id, circle_id, member_id, kind, value, value2, unit, in_range, recorded_at, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(vId, ctx.circleId, ctx.memberId, input.kind, input.value, input.value2 || null, input.unit, inRange, ctx.now, ctx.now);

    writeAudit(ctx.circleId, ctx.memberId, 'log_vital', `log_vital: ${input.kind}`, ctx.now);

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
  title: 'Check a symptom for urgency',
  description: 'Check a described symptom against deterministic red-flag rules without storing it. Never reassures',
  annotations: { readOnlyHint: true, idempotentHint: true },
  schema: z.object({
    description: z.string().min(1).max(500).describe("The caregiver's description, close to verbatim"),
    symptoms: z.array(z.string().max(100)).max(10).optional()
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const combinedText = [input.description, ...(input.symptoms || [])].join(' ').trim();
    const match = evaluateRedFlags(combinedText);

    const circle = getCircle(ctx.circleId);
    const emergencyNumber = circle?.emergency_number || '112';

    if (match) {
      const instruction = renderInstruction(match.instruction, circle);
      const prefix = `Call ${emergencyNumber} now.`;
      const spokenText = match.level === 'emergency'
        ? (instruction.toLowerCase().startsWith('call') ? instruction : `${prefix} ${instruction}`)
        : instruction;

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
