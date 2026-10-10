import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { DateTime } from 'luxon';

// --- question_for_doctor ---
registry.registerTool({
  name: 'question_for_doctor',
  description: 'Add, list, or mark done questions to ask the doctor at the next clinical visit',
  schema: z.object({
    action: z.enum(['add', 'list', 'mark_done']).default('add'),
    text: z.string().max(300).optional(),
    questionId: z.string().optional()
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    if (input.action === 'add') {
      if (!input.text) {
        return {
          safetyLevel: 'error',
          safetyCode: 'MISSING_TEXT',
          spokenText: 'Please tell me the question you would like to save for the doctor.',
          data: { error: 'Text required for add action' }
        };
      }
      const qId = 'q_' + randomUUID();
      db.prepare(`
        INSERT INTO doctor_questions (id, circle_id, member_id, text, status, created_at)
        VALUES (?, ?, ?, ?, 'open', ?)
      `).run(qId, ctx.circleId, ctx.memberId, input.text, ctx.now);

      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `Saved for the next appointment: ${input.text}.`,
        data: { questionId: qId, text: input.text, status: 'open' }
      };
    }

    if (input.action === 'list') {
      const rows = db.prepare(`
        SELECT id, text, status, created_at 
        FROM doctor_questions 
        WHERE circle_id = ? AND status = 'open' 
        ORDER BY created_at ASC
      `).all(ctx.circleId) as Array<{ id: string; text: string; status: string; created_at: string }>;

      if (rows.length === 0) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: 'No questions saved for the doctor.',
          data: { questions: [] }
        };
      }

      const count = rows.length;
      const countText = count === 1 ? '1 question' : `${count} questions`;
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `${countText} saved. First: ${rows[0].text}.`,
        data: { questions: rows }
      };
    }

    if (input.action === 'mark_done') {
      if (!input.questionId) {
        return {
          safetyLevel: 'error',
          safetyCode: 'MISSING_ID',
          spokenText: 'Which question would you like to mark as done?',
          data: { error: 'questionId required' }
        };
      }

      db.prepare(`
        UPDATE doctor_questions 
        SET status = 'done' 
        WHERE id = ? AND circle_id = ?
      `).run(input.questionId, ctx.circleId);

      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: 'Marked question as done.',
        data: { questionId: input.questionId, status: 'done' }
      };
    }

    return {
      safetyLevel: 'error',
      safetyCode: 'INVALID_ACTION',
      spokenText: 'Unknown question action.',
      data: {}
    };
  }
});

// --- care_timer ---
registry.registerTool({
  name: 'care_timer',
  description: 'Start, check, or cancel an informational timer for caregiving tasks (not for medication administration)',
  schema: z.object({
    action: z.enum(['start', 'check', 'cancel']).default('start'),
    name: z.string().max(60),
    minutes: z.number().int().min(1).max(720).optional()
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    if (input.action === 'start') {
      const mins = input.minutes || 15;
      const tId = 't_' + randomUUID();
      const endsAt = DateTime.fromISO(ctx.now).plus({ minutes: mins }).toUTC().toISO()!;

      db.prepare(`
        INSERT INTO timers (id, circle_id, member_id, name, ends_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(tId, ctx.circleId, ctx.memberId, input.name, endsAt);

      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `Timer set: ${input.name}, ${mins} minutes.`,
        data: { timerId: tId, endsAt, minutes: mins }
      };
    }

    if (input.action === 'check') {
      const timer = db.prepare(`
        SELECT id, name, ends_at 
        FROM timers 
        WHERE circle_id = ? AND name LIKE ? AND cancelled_at IS NULL
        ORDER BY ends_at DESC 
        LIMIT 1
      `).get(ctx.circleId, `%${input.name}%`) as { id: string; name: string; ends_at: string } | undefined;

      if (!timer) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `No active timer found for ${input.name}.`,
          data: { active: false }
        };
      }

      const diffMins = Math.round(DateTime.fromISO(timer.ends_at).diff(DateTime.fromISO(ctx.now), 'minutes').minutes);
      if (diffMins <= 0) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `${timer.name} has finished.`,
          data: { active: false, timerId: timer.id, remainingMinutes: 0 }
        };
      }

      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `${timer.name} has ${diffMins} minutes left.`,
        data: { active: true, timerId: timer.id, remainingMinutes: diffMins }
      };
    }

    if (input.action === 'cancel') {
      db.prepare(`
        UPDATE timers 
        SET cancelled_at = ? 
        WHERE circle_id = ? AND name LIKE ? AND cancelled_at IS NULL
      `).run(ctx.now, ctx.circleId, `%${input.name}%`);

      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `Timer cancelled: ${input.name}.`,
        data: { cancelled: true, name: input.name }
      };
    }

    return {
      safetyLevel: 'error',
      safetyCode: 'INVALID_ACTION',
      spokenText: 'Unknown timer action.',
      data: {}
    };
  }
});

// --- caregiver_checkin ---
registry.registerTool({
  name: 'caregiver_checkin',
  description: 'Caregiver wellness self-check (not clinical screening; routes crisis indications to emergency resources)',
  schema: z.object({
    action: z.enum(['start', 'answer', 'summary']).optional(),
    stressLevel: z.number().min(1).max(5).optional(),
    restedLevel: z.number().min(1).max(5).optional(),
    notes: z.string().optional(),
    answer: z.union([z.number(), z.string()]).optional(),
    questionId: z.string().optional()
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    // Check for crisis / self-harm language across all inputs
    const allText = [input.notes, typeof input.answer === 'string' ? input.answer : ''].join(' ').toLowerCase();
    const crisisPatterns = ['harm myself', 'hurt myself', 'suicide', 'kill myself', 'end my life', 'want to die'];
    if (crisisPatterns.some(p => allText.includes(p))) {
      return {
        safetyLevel: 'redflag',
        safetyCode: 'CRISIS_SUPPORT',
        spokenText: 'If you are thinking of harming yourself or need immediate help, please call or text 988 (or 112) right now to speak with someone. You are not alone.',
        data: { crisis: true, hotline: '988' }
      };
    }

    const cId = 'chk_' + randomUUID();
    db.prepare(`
      INSERT INTO checkins (id, member_id, answers_json, recorded_at)
      VALUES (?, ?, ?, ?)
    `).run(cId, ctx.memberId, JSON.stringify(input), ctx.now);

    let spokenText = 'Thank you for checking in. Your well-being matters.';
    let safetyLevel: 'none' | 'caution' | 'redflag' | 'error' = 'none';

    if ((input.stressLevel && input.stressLevel >= 4) || (input.restedLevel && input.restedLevel <= 2)) {
      safetyLevel = 'caution';
      spokenText = 'You seem highly stressed and exhausted. Please consider asking your circle for a break soon, or contact caregiver support.';
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
  description: 'Objective counts and pattern facts over a configurable period (no medical causes or predictions)',
  annotations: {
    readOnlyHint: true
  },
  schema: z.object({
    metric: z.enum(['meals_eaten', 'confusion_episodes', 'sleep_issues', 'falls', 'vitals_out_of_range', 'doses_not_logged']).optional(),
    kind: z.enum(['bp', 'glucose', 'temperature', 'weight', 'pulse', 'spo2']).optional(),
    days: z.number().int().min(3).max(30).default(7)
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const days = input.days || 7;
    const since = DateTime.fromISO(ctx.now).minus({ days }).toUTC().toISO()!;

    // 1. Metric: confusion_episodes or specific observation category
    if (input.metric === 'confusion_episodes' || input.metric === 'sleep_issues' || input.metric === 'falls' || input.metric === 'meals_eaten') {
      const keywordMap: Record<string, string> = {
        confusion_episodes: 'confusion',
        sleep_issues: 'sleep',
        falls: 'fall',
        meals_eaten: 'meal'
      };
      const term = keywordMap[input.metric];
      const obs = db.prepare(`
        SELECT text, recorded_at 
        FROM observations 
        WHERE circle_id = ? AND recorded_at >= ? AND (category = ? OR text LIKE ?)
        ORDER BY recorded_at ASC
      `).all(ctx.circleId, since, input.metric.split('_')[0], `%${term}%`) as Array<{ text: string; recorded_at: string }>;

      if (obs.length < 3) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: "There isn't enough logged to see a pattern yet.",
          data: { metric: input.metric, count: obs.length, days }
        };
      }

      const label = input.metric.replace('_', ' ');
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `In the last ${days} days, ${label} was noted ${obs.length} times.`,
        data: { metric: input.metric, count: obs.length, days, entries: obs }
      };
    }

    // 2. Metric: vitals_out_of_range
    if (input.metric === 'vitals_out_of_range') {
      const outVitals = db.prepare(`
        SELECT kind, value, recorded_at 
        FROM vitals 
        WHERE circle_id = ? AND in_range = 0 AND recorded_at >= ?
      `).all(ctx.circleId, since) as Array<{ kind: string; value: number; recorded_at: string }>;

      if (outVitals.length === 0) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `In the last ${days} days, all vital readings were within the typical range.`,
          data: { metric: input.metric, count: 0, days }
        };
      }

      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `In the last ${days} days, ${outVitals.length} vital readings were out of range.`,
        data: { metric: input.metric, count: outVitals.length, days, readings: outVitals }
      };
    }

    // 3. Vital kind average (e.g. kind: 'bp', 'temperature')
    const vitalKind = input.kind || 'bp';
    const readings = db.prepare(`
      SELECT value, value2, recorded_at
      FROM vitals
      WHERE circle_id = ? AND kind = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `).all(ctx.circleId, vitalKind, since) as Array<{ value: number; value2?: number | null; recorded_at: string }>;

    if (readings.length === 0) {
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `There are no ${vitalKind} readings logged in the last ${days} days.`,
        data: { trend: 'none', count: 0, days }
      };
    }

    if (readings.length < 3) {
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: "There isn't enough logged to see a pattern yet.",
        data: { trend: 'insufficient_data', count: readings.length, days }
      };
    }

    let sum = 0;
    readings.forEach(r => sum += r.value);
    const avg = sum / readings.length;

    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText: `In the last ${days} days, the average ${vitalKind} reading was ${avg.toFixed(1)}.`,
      data: {
        average: avg,
        count: readings.length,
        days,
        readings
      }
    };
  }
});
