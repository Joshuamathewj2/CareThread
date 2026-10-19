import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { DateTime } from 'luxon';
import { getCircle } from './shared.js';

// --- question_for_doctor ---
registry.registerTool({
  name: 'question_for_doctor',
  title: 'Questions for the doctor',
  description: 'Save, list, or mark done questions to ask at the next doctor visit',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  schema: z.object({
    action: z.enum(['add', 'list', 'mark_done']).default('add'),
    text: z.string().max(300).optional().describe('The question for add; for mark_done, words from the question to match'),
    questionId: z.string().optional().describe('Exact id for mark_done, from a previous list')
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    if (input.action !== 'list' && ctx.role === 'viewer') {
      return {
        safetyLevel: 'error',
        safetyCode: 'FORBIDDEN_ROLE',
        spokenText: 'You can view the log but not change it. Ask the primary caregiver to add you.',
        data: null
      };
    }

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
        data: { questionId: qId, text: input.text, status: 'open' },
        quotedUserText: [input.text]
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
        data: { questions: rows },
        quotedUserText: [rows[0].text]
      };
    }

    if (input.action === 'mark_done') {
      // Voice users can't say an id, so a few words from the question are enough to find it
      let questionId = input.questionId;
      if (!questionId && input.text) {
        const matches = db.prepare(`
          SELECT id, text FROM doctor_questions
          WHERE circle_id = ? AND status = 'open' AND text LIKE ?
          ORDER BY created_at ASC
        `).all(ctx.circleId, `%${input.text}%`) as Array<{ id: string; text: string }>;
        if (matches.length > 1) {
          return {
            safetyLevel: 'none',
            safetyCode: 'AMBIGUOUS_QUESTION',
            spokenText: `${matches.length} questions match. Which one: ${matches[0].text}, or ${matches[1].text}?`,
            data: { candidates: matches },
            quotedUserText: [matches[0].text, matches[1].text],
            followUp: { kind: 'choose', prompt: 'Which question is done?', tool: 'question_for_doctor', arguments: { action: 'mark_done', text: '{choice}' }, choices: matches.map(m => m.text) }
          };
        }
        questionId = matches[0]?.id;
      }

      if (!questionId) {
        return {
          safetyLevel: 'error',
          safetyCode: 'MISSING_ID',
          spokenText: 'Which question would you like to mark as done?',
          data: { error: 'questionId or matching text required' }
        };
      }

      const result = db.prepare(`
        UPDATE doctor_questions
        SET status = 'done'
        WHERE id = ? AND circle_id = ? AND status = 'open'
      `).run(questionId, ctx.circleId);

      if (result.changes === 0) {
        return {
          safetyLevel: 'error',
          safetyCode: 'QUESTION_NOT_FOUND',
          spokenText: "I couldn't find that open question.",
          data: { questionId }
        };
      }

      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: 'Marked question as done.',
        data: { questionId, status: 'done' }
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
  title: 'Care timer',
  description: 'Start, check, or cancel a reminder timer for a care task (not a medication schedule)',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  schema: z.object({
    action: z.enum(['start', 'check', 'cancel']).default('start'),
    name: z.string().max(60).default('Care task').describe('What the timer is for; check/cancel match on these words'),
    minutes: z.number().int().min(1).max(720).optional().describe('Duration for start; defaults to 15')
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
      const result = db.prepare(`
        UPDATE timers
        SET cancelled_at = ?
        WHERE circle_id = ? AND name LIKE ? AND cancelled_at IS NULL AND ends_at > ?
      `).run(ctx.now, ctx.circleId, `%${input.name}%`, ctx.now);

      if (result.changes === 0) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `No running timer found for ${input.name}.`,
          data: { cancelled: false, name: input.name }
        };
      }

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
  title: 'Caregiver wellbeing check-in',
  description: "The caregiver's own wellbeing check-in (not clinical screening). Crisis language routes to emergency help",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  schema: z.object({
    action: z.enum(['start', 'answer', 'summary']).optional(),
    stressLevel: z.number().int().min(1).max(5).optional().describe('1 calm to 5 overwhelmed'),
    restedLevel: z.number().int().min(1).max(5).optional().describe('1 exhausted to 5 well rested'),
    notes: z.string().max(1000).optional(),
    answer: z.union([z.number(), z.string()]).optional(),
    questionId: z.string().optional()
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    // Check for crisis / self-harm language across all inputs
    const allText = [input.notes, typeof input.answer === 'string' ? input.answer : ''].join(' ').toLowerCase();
    const crisisPatterns = ['harm myself', 'hurt myself', 'suicide', 'kill myself', 'end my life', 'want to die'];
    if (crisisPatterns.some(p => allText.includes(p))) {
      const emergencyNumber = getCircle(ctx.circleId)?.emergency_number || '112';
      return {
        safetyLevel: 'redflag',
        safetyCode: 'CRISIS_SUPPORT',
        spokenText: `If you are thinking of harming yourself or need immediate help, please call ${emergencyNumber} or your local crisis line right now. You are not alone.`,
        data: { crisis: true, emergencyNumber }
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
  title: 'Trends from the log',
  description: 'Objective counts and averages over recent days (no medical causes or predictions)',
  annotations: { readOnlyHint: true, idempotentHint: true },
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
