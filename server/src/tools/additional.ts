import { z } from 'zod';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { DateTime } from 'luxon';

// --- question_for_doctor ---
registry.registerTool({
  name: 'question_for_doctor',
  description: 'Add a question to the list to ask the doctor at the next visit',
  schema: z.object({
    text: z.string().max(500)
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    const qId = 'q_' + Date.now();
    db.prepare(`
      INSERT INTO doctor_questions (id, circle_id, member_id, text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(qId, ctx.circleId, ctx.memberId, input.text, ctx.now);

    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText: `Got it. I've added that to the doctor's list.`,
      data: { questionId: qId }
    };
  }
});

// --- care_timer ---
registry.registerTool({
  name: 'care_timer',
  description: 'Set a timer for a care task',
  schema: z.object({
    name: z.string().max(80),
    minutes: z.number().min(1).max(1440)
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    const tId = 't_' + Date.now();
    const endsAt = DateTime.fromISO(ctx.now).plus({ minutes: input.minutes }).toUTC().toISO()!;

    db.prepare(`
      INSERT INTO timers (id, circle_id, member_id, name, ends_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tId, ctx.circleId, ctx.memberId, input.name, endsAt);

    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText: `Timer set: ${input.name}, ${input.minutes} minutes.`,
      data: { timerId: tId, endsAt }
    };
  }
});

// --- caregiver_checkin ---
registry.registerTool({
  name: 'caregiver_checkin',
  description: 'Log caregiver wellness check-in',
  schema: z.object({
    stressLevel: z.number().min(1).max(5),
    restedLevel: z.number().min(1).max(5),
    notes: z.string().optional()
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    const cId = 'chk_' + Date.now();
    
    db.prepare(`
      INSERT INTO checkins (id, member_id, answers_json, recorded_at)
      VALUES (?, ?, ?, ?)
    `).run(cId, ctx.memberId, JSON.stringify(input), ctx.now);

    // Crisis path check
    let spokenText = 'Thank you for checking in. Your well-being matters.';
    let safetyLevel: 'none' | 'caution' | 'redflag' | 'error' = 'none';

    if (input.stressLevel >= 4 && input.restedLevel <= 2) {
      safetyLevel = 'caution';
      spokenText = 'You seem highly stressed and exhausted. Please consider asking your circle for a break soon, or call the caregiver support line if you need immediate advice.';
    }

    return {
      safetyLevel,
      safetyCode: safetyLevel === 'caution' ? 'CAREGIVER_BURNOUT' : null,
      spokenText,
      data: { checkinId: cId }
    };
  }
});

// --- trend_insights ---
registry.registerTool({
  name: 'trend_insights',
  description: 'Fetch vital trends (e.g., BP average) over the last week',
  schema: z.object({
    kind: z.enum(['bp', 'glucose', 'temperature', 'weight', 'pulse', 'spo2'])
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const since = DateTime.fromISO(ctx.now).minus({ days: 7 }).toUTC().toISO();
    
    const readings = db.prepare(`
      SELECT value, value2, recorded_at
      FROM vitals
      WHERE circle_id = ? AND kind = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `).all(ctx.circleId, input.kind, since) as any[];

    if (readings.length === 0) {
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `There are no ${input.kind} readings logged in the last 7 days.`,
        data: { trend: 'none' }
      };
    }

    // Naive average
    let sum = 0;
    readings.forEach(r => sum += r.value);
    const avg = sum / readings.length;

    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText: `Over the last week, the average ${input.kind} reading was ${avg.toFixed(1)}.`,
      data: { 
        average: avg, 
        count: readings.length,
        readings
      }
    };
  }
});
