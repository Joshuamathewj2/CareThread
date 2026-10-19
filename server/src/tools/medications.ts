import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { checkDoseGuard, MedEvent } from '../core/doseGuard.js';
import { DateTime, IANAZone } from 'luxon';
import { findMedication, formatRelativeTime, getMemberName, writeAudit } from './shared.js';

const isoDateTime = z.string().refine(v => DateTime.fromISO(v, { setZone: true }).isValid, 'Expected an ISO 8601 date-time');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm (24-hour)');

// --- recipient_profile ---
registry.registerTool({
  name: 'recipient_profile',
  title: 'Care recipient profile',
  description: 'Read the care recipient\'s basics (name, allergies, emergency number), or update them (primary caregiver only)',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: z.object({
    action: z.enum(['get', 'set']),
    recipientName: z.string().max(80).optional(),
    timezone: z.string().refine(tz => IANAZone.isValidZone(tz), 'Expected an IANA timezone like Asia/Kolkata').optional(),
    allergies: z.array(z.string().max(80)).max(20).optional(),
    clinicians: z.array(z.object({
      name: z.string().max(80),
      role: z.string().max(80),
      phone: z.string().max(40)
    })).max(5).optional(),
    emergencyNumber: z.string().max(20).optional(),
    vitalRanges: z.record(z.string(), z.object({
      min: z.number(),
      max: z.number(),
      unit: z.string()
    })).optional(),
    privacyMode: z.boolean().optional()
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    if (input.action === 'set' && ctx.role !== 'primary') {
      return { safetyLevel: 'none', safetyCode: 'FORBIDDEN_ROLE', spokenText: "You can view the log but not change it. Ask the primary caregiver to add you.", data: null };
    }

    if (input.action === 'set') {
      const { recipientName, timezone, allergies, clinicians, emergencyNumber, vitalRanges, privacyMode } = input;
      const updates = [];
      const values = [];
      if (recipientName !== undefined) { updates.push('recipient_name = ?'); values.push(recipientName); }
      if (timezone !== undefined) { updates.push('timezone = ?'); values.push(timezone); }
      if (allergies !== undefined) { updates.push('allergies_json = ?'); values.push(JSON.stringify(allergies)); }
      if (clinicians !== undefined) { updates.push('clinicians_json = ?'); values.push(JSON.stringify(clinicians)); }
      if (emergencyNumber !== undefined) { updates.push('emergency_number = ?'); values.push(emergencyNumber); }
      if (vitalRanges !== undefined) { updates.push('vital_ranges_json = ?'); values.push(JSON.stringify(vitalRanges)); }
      if (privacyMode !== undefined) { updates.push('privacy_mode = ?'); values.push(privacyMode ? 1 : 0); }
      
      if (updates.length > 0) {
        values.push(ctx.circleId);
        db.prepare(`UPDATE care_circles SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `Saved the profile for ${recipientName || 'the recipient'}.`,
        data: null
      };
    } else {
      const circle = db.prepare(`SELECT * FROM care_circles WHERE id = ?`).get(ctx.circleId) as any;
      if (!circle) throw new Error('Circle not found');
      const allergiesList = JSON.parse(circle.allergies_json || '[]');
      const allergiesText = allergiesList.length > 0 ? allergiesList.join(', ') : 'none';
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText: `${circle.recipient_name}. Allergies on file: ${allergiesText}. Emergency number ${circle.emergency_number}.`,
        data: circle
      };
    }
  }
});

// --- med_schedule_set ---
registry.registerTool({
  name: 'med_schedule_set',
  title: 'Add or update a medication',
  description: 'Add or update a medication exactly as the caregiver states it. Never suggest doses or intervals',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: z.object({
    name: z.string().min(1).max(80),
    aliases: z.array(z.string().max(80)).optional().describe('Other names the family uses, e.g. "sugar tablet"'),
    doseText: z.string().max(100).optional().describe('Dose as said by the caregiver, e.g. "500 mg tablet"'),
    times: z.array(hhmm).max(12).optional().describe('Scheduled local times, 24-hour HH:mm'),
    asNeeded: z.boolean().optional().default(false),
    minIntervalMinutes: z.number().int().min(15).max(1440).optional().nullable().describe('Minimum gap between doses; powers the double-dose warning'),
    maxPerDay: z.number().int().min(1).max(24).optional().nullable(),
    note: z.string().max(500).optional()
  }),
  roles: ['primary'],
  handler: async (input, ctx) => {
    const medId = 'med_' + randomUUID();
    
    // Check if it already exists to update or insert
    const existing = db.prepare(`SELECT id FROM medications WHERE circle_id = ? AND lower(name) = lower(?) AND active = 1`).get(ctx.circleId, input.name) as { id: string } | undefined;
    
    if (existing) {
      db.prepare(`
        UPDATE medications SET 
          aliases_json = ?, dose_text = ?, times_json = ?, min_interval_minutes = ?, max_per_day = ?, as_needed = ?, note = ?
        WHERE id = ?
      `).run(
        JSON.stringify(input.aliases || []), input.doseText || null, JSON.stringify(input.times || []), 
        input.minIntervalMinutes ?? null, input.maxPerDay ?? null, input.asNeeded ? 1 : 0, input.note || null, existing.id
      );
    } else {
      db.prepare(`
        INSERT INTO medications (id, circle_id, name, aliases_json, dose_text, times_json, min_interval_minutes, max_per_day, as_needed, note, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        medId, ctx.circleId, input.name, JSON.stringify(input.aliases || []), input.doseText || null, JSON.stringify(input.times || []),
        input.minIntervalMinutes ?? null, input.maxPerDay ?? null, input.asNeeded ? 1 : 0, input.note || null, ctx.memberId, ctx.now
      );
    }
    
    let intervalSentence = "No minimum gap set, so I can't warn about repeats.";
    if (input.minIntervalMinutes) {
      intervalSentence = `Minimum gap ${input.minIntervalMinutes / 60} hours.`;
    }

    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText: `Added ${input.name}. ${intervalSentence}`,
      data: { id: existing ? existing.id : medId }
    };
  }
});

// --- med_log_given ---
registry.registerTool({
  name: 'med_log_given',
  title: 'Log a medication dose',
  description: 'Record a dose as given, skipped or refused, attributed to the speaker. Warns before a possible double dose',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  schema: z.object({
    medication: z.string().min(1).max(80).describe('Medication name or family alias as spoken'),
    status: z.enum(['given', 'skipped', 'refused']).default('given'),
    at: isoDateTime.optional().describe('When it happened, ISO 8601 with offset. Prefer minutesAgo for spoken times'),
    minutesAgo: z.number().int().min(0).max(1440).optional().describe('How long ago it happened, e.g. 30 for "half an hour ago"'),
    note: z.string().max(500).optional(),
    confirmRepeat: z.boolean().default(false).describe('Only true after the caregiver explicitly confirmed a repeat-dose warning'),
    idempotencyKey: z.string().max(100).optional().describe('Stable key per utterance so retries never double-log')
  }),
  roles: ['primary', 'family', 'aide'],
  handler: async (input, ctx) => {
    if (input.idempotencyKey) {
      const existing = db.prepare(`SELECT id FROM med_events WHERE idempotency_key = ?`).get(input.idempotencyKey);
      if (existing) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `Already logged.`,
          data: { eventId: (existing as any).id }
        };
      }
    }

    let eventTimeIso = ctx.now;
    if (input.at) {
      eventTimeIso = input.at;
    } else if (input.minutesAgo !== undefined) {
      eventTimeIso = DateTime.fromISO(ctx.now).minus({ minutes: input.minutesAgo }).toUTC().toISO()!;
    }

    const medsFound = findMedication(ctx.circleId, input.medication);
    if (medsFound.length === 0) {
      return {
        safetyLevel: 'error',
        safetyCode: 'MEDICATION_NOT_FOUND',
        spokenText: `I don't have a medication called ${input.medication}. Want me to add it?`,
        data: null,
        followUp: ctx.role === 'primary'
          ? { kind: 'confirm', prompt: `Add ${input.medication} to the medication list?`, tool: 'med_schedule_set', arguments: { name: input.medication } }
          : { kind: 'clarify', prompt: 'Only the primary caregiver can add medications. Which medication did you mean?' }
      };
    }
    if (medsFound.length > 1) {
      return {
        safetyLevel: 'error',
        safetyCode: 'AMBIGUOUS_MEDICATION',
        spokenText: `Do you mean ${medsFound[0].name} or ${medsFound[1].name}?`,
        data: null,
        followUp: { kind: 'choose', prompt: 'Which medication?', tool: 'med_log_given', arguments: { ...input, medication: '{choice}' }, choices: medsFound.map(m => m.name) }
      };
    }

    const med = medsFound[0];
    const historyDb = db.prepare(`SELECT id, medication_id, member_id, status, event_at, logged_at FROM med_events WHERE medication_id = ? ORDER BY event_at DESC LIMIT 50`).all(med.id) as any[];
    const history: MedEvent[] = historyDb.map(h => ({
      id: h.id,
      medicationId: h.medication_id,
      memberId: h.member_id,
      status: h.status,
      eventAt: h.event_at,
      loggedAt: h.logged_at
    }));

    if (input.status === 'given') {
      const guard = checkDoseGuard([med], history, eventTimeIso, ctx.memberId, ctx.now);

      if (guard.code === 'INVALID_TIME') {
        return {
          safetyLevel: 'error',
          safetyCode: 'INVALID_TIME',
          spokenText: "That time is in the future, so I didn't log it. Tell me how long ago it was.",
          data: { guard }
        };
      }
      
      if (guard.level === 'caution' && !input.confirmRepeat) {
        const who = guard.lastMember ? getMemberName(guard.lastMember) : 'someone';
        const when = guard.lastEventAt ? formatRelativeTime(guard.lastEventAt, ctx.now) : 'recently';
        return {
          safetyLevel: 'caution',
          safetyCode: guard.code,
          spokenText: `Careful, ${who} logged ${med.name} ${when}. Do you want to log another dose anyway?`,
          data: { guard },
          followUp: {
            kind: 'confirm',
            prompt: 'Log another dose anyway?',
            tool: 'med_log_given',
            // Pin the time so a confirmation a minute later records the dose the caregiver described
            arguments: { medication: med.name, status: input.status, at: eventTimeIso, note: input.note, confirmRepeat: true, idempotencyKey: input.idempotencyKey }
          }
        };
      }
    }

    // Write it
    const eventId = 'evt_' + randomUUID();
    const override = input.confirmRepeat ? 1 : 0;
    db.prepare(`
      INSERT INTO med_events (id, medication_id, member_id, status, event_at, logged_at, note, override_repeat, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(eventId, med.id, ctx.memberId, input.status, eventTimeIso, ctx.now, input.note || null, override, input.idempotencyKey || null);

    writeAudit(ctx.circleId, ctx.memberId, 'med_log_given', `med_log_given: dose ${override ? 'override' : 'logged'}`, ctx.now);

    const memberName = getMemberName(ctx.memberId);
    let spokenText = `Logged: ${med.name}, ${formatRelativeTime(eventTimeIso, ctx.now)}, by ${memberName}.`;
    if (override) {
      spokenText = `Logged as an extra dose. I have noted that it was confirmed.`;
    } else if (input.status === 'skipped' || input.status === 'refused') {
      const CapitalizedStatus = input.status.charAt(0).toUpperCase() + input.status.slice(1);
      spokenText = `${CapitalizedStatus} at ${formatRelativeTime(eventTimeIso, ctx.now)}, logged by ${memberName}.`;
    }

    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText,
      data: { eventId, status: input.status, eventAt: eventTimeIso }
    };
  }
});

// --- med_check_status ---
registry.registerTool({
  name: 'med_check_status',
  title: 'Check medication status',
  description: 'Answer "was it already given, by whom and when?" or, with no medication, read today\'s whole checklist',
  annotations: { readOnlyHint: true, idempotentHint: true },
  schema: z.object({
    medication: z.string().max(80).optional().describe('Omit to get the full checklist for today')
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const circle = db.prepare(`SELECT timezone FROM care_circles WHERE id = ?`).get(ctx.circleId) as { timezone?: string } | undefined;
    const tz = circle?.timezone || 'UTC';
    const todayStart = DateTime.fromISO(ctx.now).setZone(tz).startOf('day').toUTC().toISO()!;

    if (input.medication) {
      const medsFound = findMedication(ctx.circleId, input.medication);
      if (medsFound.length === 0) return { safetyLevel: 'none', safetyCode: null, spokenText: `I don't have a medication called ${input.medication}. Want me to add it?`, data: null };
      if (medsFound.length > 1) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `Do you mean ${medsFound[0].name} or ${medsFound[1].name}?`,
          data: null,
          followUp: { kind: 'choose', prompt: 'Which medication?', tool: 'med_check_status', arguments: { medication: '{choice}' }, choices: medsFound.map(m => m.name) }
        };
      }
      
      const med = medsFound[0];
      const lastEvent = db.prepare(`
        SELECT id, status, event_at, member_id FROM med_events 
        WHERE medication_id = ? AND event_at >= ?
        ORDER BY event_at DESC LIMIT 1
      `).get(med.id, todayStart) as any;

      if (!lastEvent) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `Nothing is logged for ${med.name} today.`,
          data: { medication: med.name, state: 'nothing_logged', lastEvent: null }
        };
      }

      const who = getMemberName(lastEvent.member_id);
      const when = formatRelativeTime(lastEvent.event_at, ctx.now);

      if (lastEvent.status === 'given') {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `Yes. ${who} gave it ${when}.`,
          data: { medication: med.name, state: 'given', lastEvent: { status: 'given', at: lastEvent.event_at, member: who } }
        };
      } else {
        const capStatus = lastEvent.status.charAt(0).toUpperCase() + lastEvent.status.slice(1);
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: `${capStatus} ${when}, logged by ${who}.`,
          data: { medication: med.name, state: lastEvent.status, lastEvent: { status: lastEvent.status, at: lastEvent.event_at, member: who } }
        };
      }
    } else {
      // Whole checklist
      const meds = db.prepare(`
        SELECT id, name, times_json, as_needed 
        FROM medications 
        WHERE circle_id = ? AND active = 1 
        ORDER BY name ASC
      `).all(ctx.circleId) as Array<{ id: string; name: string; times_json: string; as_needed: number }>;

      if (meds.length === 0) {
        return {
          safetyLevel: 'none',
          safetyCode: null,
          spokenText: 'No medications are currently configured for this care circle.',
          data: { checklist: [] }
        };
      }

      const checklistItems: Array<{ medication: string; state: string; time?: string }> = [];
      const phrases: string[] = [];

      for (const m of meds) {
        const lastEvt = db.prepare(`
          SELECT status, event_at, member_id 
          FROM med_events 
          WHERE medication_id = ? AND event_at >= ?
          ORDER BY event_at DESC LIMIT 1
        `).get(m.id, todayStart) as { status: string; event_at: string; member_id: string } | undefined;

        if (lastEvt) {
          const timeStr = DateTime.fromISO(lastEvt.event_at).setZone(tz).toFormat('h:mm a');
          checklistItems.push({ medication: m.name, state: lastEvt.status, time: timeStr });
          phrases.push(`${m.name} ${lastEvt.status} at ${timeStr}`);
        } else {
          checklistItems.push({ medication: m.name, state: 'nothing_logged' });
          phrases.push(`${m.name} not logged yet`);
        }
      }

      const spokenText = `Today: ${phrases.join(', ')}.`;
      return {
        safetyLevel: 'none',
        safetyCode: null,
        spokenText,
        data: { checklist: checklistItems }
      };
    }
  }
});
