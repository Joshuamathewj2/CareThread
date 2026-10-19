import { z } from 'zod';
import { DateTime } from 'luxon';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { formatLocalTime, formatRelativeTime, getCircle, writeAudit } from './shared.js';

// --- care_next_actions ---
// "Alexa, what does Dad need right now?" One prioritized answer drawn from schedule, timers and red flags.
registry.registerTool({
  name: 'care_next_actions',
  title: 'What needs doing next',
  description: 'Prioritized "what needs doing now": recent red flags, scheduled doses not logged yet, timers due, next dose',
  annotations: { readOnlyHint: true, idempotentHint: true },
  schema: z.object({
    lookaheadMinutes: z.number().int().min(15).max(720).default(120).describe('How far ahead counts as "coming up"')
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const circle = getCircle(ctx.circleId);
    const tz = circle?.timezone || 'UTC';
    const now = DateTime.fromISO(ctx.now).setZone(tz);
    const dayStartUtc = now.startOf('day').toUTC().toISO()!;

    // 1. Red flags in the last 12 hours always come first
    const redflags = db.prepare(`
      SELECT rule_id, level, at FROM redflag_events
      WHERE circle_id = ? AND at >= ?
      ORDER BY at DESC
    `).all(ctx.circleId, now.minus({ hours: 12 }).toUTC().toISO()) as Array<{ rule_id: string; level: string; at: string }>;

    // 2. Scheduled slots today vs. doses logged today. The Nth logged event covers the Nth slot, so a dose
    //    given late still counts and we never guess which slot a dose "belonged" to.
    const meds = db.prepare(`
      SELECT id, name, times_json FROM medications
      WHERE circle_id = ? AND active = 1 AND as_needed = 0
      ORDER BY name ASC
    `).all(ctx.circleId) as Array<{ id: string; name: string; times_json: string }>;

    const notLogged: Array<{ medication: string; scheduledFor: string }> = [];
    const comingUp: Array<{ medication: string; scheduledFor: string; inMinutes: number }> = [];

    for (const med of meds) {
      const slots = (JSON.parse(med.times_json || '[]') as string[])
        .map(t => {
          const [hour, minute] = t.split(':').map(Number);
          return now.set({ hour, minute, second: 0, millisecond: 0 });
        })
        .filter(dt => dt.isValid)
        .sort((a, b) => a.toMillis() - b.toMillis());

      const loggedToday = (db.prepare(`
        SELECT count(*) as count FROM med_events WHERE medication_id = ? AND event_at >= ?
      `).get(med.id, dayStartUtc) as { count: number }).count;

      slots.forEach((slot, i) => {
        if (i < loggedToday) return;
        const minutesUntil = Math.round(slot.diff(now, 'minutes').minutes);
        if (minutesUntil <= 0) {
          notLogged.push({ medication: med.name, scheduledFor: slot.toFormat('h:mm a') });
        } else if (minutesUntil <= input.lookaheadMinutes) {
          comingUp.push({ medication: med.name, scheduledFor: slot.toFormat('h:mm a'), inMinutes: minutesUntil });
        }
      });
    }
    comingUp.sort((a, b) => a.inMinutes - b.inMinutes);

    // 3. Timers that are running or finished in the last 15 minutes
    const timers = db.prepare(`
      SELECT name, ends_at FROM timers
      WHERE circle_id = ? AND cancelled_at IS NULL AND ends_at >= ?
      ORDER BY ends_at ASC
    `).all(ctx.circleId, now.minus({ minutes: 15 }).toUTC().toISO()) as Array<{ name: string; ends_at: string }>;
    const timerItems = timers.map(t => ({
      name: t.name,
      remainingMinutes: Math.max(0, Math.round(DateTime.fromISO(t.ends_at).diff(now, 'minutes').minutes))
    }));

    // Speak at most three items, highest priority first. "Not logged" never claims a dose was missed.
    const phrases: string[] = [];
    if (redflags.length > 0) {
      phrases.push(`An urgent alert was logged ${formatRelativeTime(redflags[0].at, ctx.now)}. Make sure it was followed up`);
    }
    for (const item of notLogged) {
      phrases.push(`${item.medication} for ${item.scheduledFor} is not logged yet`);
    }
    for (const t of timerItems) {
      phrases.push(t.remainingMinutes === 0 ? `the ${t.name} timer has finished` : `the ${t.name} timer has ${t.remainingMinutes} minutes left`);
    }
    if (comingUp.length > 0) {
      phrases.push(`next up, ${comingUp[0].medication} at ${comingUp[0].scheduledFor}`);
    }

    const spoken = phrases.slice(0, 3);
    const spokenText = spoken.length === 0
      ? `Nothing is due right now. All scheduled doses so far today are logged.`
      : `${spoken.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('. ')}.${phrases.length > 3 ? ` Plus ${phrases.length - 3} more on screen.` : ''}`;

    return {
      safetyLevel: redflags.length > 0 ? 'caution' : 'none',
      safetyCode: redflags.length > 0 ? 'RECENT_REDFLAG' : null,
      spokenText,
      data: {
        asOf: now.toFormat('h:mm a'),
        redflags,
        notLogged,
        comingUp,
        timers: timerItems
      }
    };
  }
});

// --- undo_last_entry ---
// Voice input gets misheard. Two turns: preview what would be removed, then remove that exact entry.
const UNDO_WINDOW_MINUTES = 15;

type UndoCandidate = { kind: 'dose' | 'observation' | 'vital' | 'question'; id: string; loggedAt: string; label: string };

function findUndoCandidates(memberId: string, circleId: string, sinceIso: string): UndoCandidate[] {
  const doses = db.prepare(`
    SELECT e.id, e.logged_at, m.name, e.status FROM med_events e
    JOIN medications m ON e.medication_id = m.id
    WHERE e.member_id = ? AND m.circle_id = ? AND e.logged_at >= ?
  `).all(memberId, circleId, sinceIso) as any[];
  const obs = db.prepare(`
    SELECT id, logged_at, category FROM observations WHERE member_id = ? AND circle_id = ? AND logged_at >= ?
  `).all(memberId, circleId, sinceIso) as any[];
  const vitals = db.prepare(`
    SELECT id, logged_at, kind, value, value2 FROM vitals WHERE member_id = ? AND circle_id = ? AND logged_at >= ?
  `).all(memberId, circleId, sinceIso) as any[];
  const questions = db.prepare(`
    SELECT id, created_at FROM doctor_questions WHERE member_id = ? AND circle_id = ? AND created_at >= ? AND status = 'open'
  `).all(memberId, circleId, sinceIso) as any[];

  return [
    ...doses.map(d => ({ kind: 'dose' as const, id: d.id, loggedAt: d.logged_at, label: `${d.name} marked ${d.status}` })),
    ...obs.map(o => ({ kind: 'observation' as const, id: o.id, loggedAt: o.logged_at, label: `the ${o.category} note` })),
    ...vitals.map(v => ({ kind: 'vital' as const, id: v.id, loggedAt: v.logged_at, label: `the ${v.kind} reading of ${v.value2 != null ? `${v.value} over ${v.value2}` : v.value}` })),
    ...questions.map(q => ({ kind: 'question' as const, id: q.id, loggedAt: q.created_at, label: 'the question for the doctor' }))
  ].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

const DELETE_SQL: Record<UndoCandidate['kind'], string> = {
  dose: `DELETE FROM med_events WHERE id = ?`,
  observation: `DELETE FROM observations WHERE id = ?`,
  vital: `DELETE FROM vitals WHERE id = ?`,
  question: `DELETE FROM doctor_questions WHERE id = ?`
};

registry.registerTool({
  name: 'undo_last_entry',
  title: 'Undo my last entry',
  description: `Remove the speaker's own most recent entry from the last ${UNDO_WINDOW_MINUTES} minutes. Call once to preview, then again with confirm`,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  schema: z.object({
    confirm: z.boolean().default(false).describe('Only true after the caregiver said yes to the preview'),
    entryId: z.string().max(100).optional().describe('The entryId from the preview; required with confirm')
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    const since = DateTime.fromISO(ctx.now).minus({ minutes: UNDO_WINDOW_MINUTES }).toUTC().toISO()!;
    const candidates = findUndoCandidates(ctx.memberId, ctx.circleId, since);
    const tz = getCircle(ctx.circleId)?.timezone || 'UTC';

    if (!input.confirm) {
      const latest = candidates[0];
      if (!latest) {
        return {
          safetyLevel: 'none',
          safetyCode: 'NOTHING_TO_UNDO',
          spokenText: `I don't see anything you logged in the last ${UNDO_WINDOW_MINUTES} minutes.`,
          data: { candidate: null }
        };
      }
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `Your last entry was ${latest.label}, at ${formatLocalTime(latest.loggedAt, tz)}. Remove it?`,
        data: { candidate: latest },
        followUp: { kind: 'confirm', prompt: 'Remove it?', tool: 'undo_last_entry', arguments: { confirm: true, entryId: latest.id } }
      };
    }

    // Confirm only removes the exact entry that was previewed, and only while it is still the speaker's own and recent
    const target = candidates.find(c => c.id === input.entryId);
    if (!target) {
      return {
        safetyLevel: 'error',
        safetyCode: 'UNDO_NOT_AVAILABLE',
        spokenText: `I can only remove your own entries from the last ${UNDO_WINDOW_MINUTES} minutes, so I left the log as it is.`,
        data: { entryId: input.entryId ?? null }
      };
    }

    db.prepare(DELETE_SQL[target.kind]).run(target.id);
    // Red-flag events are kept on purpose: an escalation stays on record even if the note is withdrawn.
    writeAudit(ctx.circleId, ctx.memberId, 'undo_last_entry', `undo_last_entry: removed ${target.kind} ${target.id}`, ctx.now);

    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText: `Removed ${target.label}.`,
      data: { removed: target }
    };
  }
});
