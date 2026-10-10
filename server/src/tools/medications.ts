import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { checkDoseGuard, MedicationInfo, MedEvent } from '../core/doseGuard.js';
import { DateTime } from 'luxon';

// --- recipient_profile ---
registry.registerTool({
  name: 'recipient_profile',
  description: 'Set or read the care recipient\'s basics',
  schema: z.object({
    action: z.enum(['get', 'set']),
    recipientName: z.string().max(80).optional(),
    timezone: z.string().optional(),
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
  description: 'Add or update a medication as entered by the caregiver',
  schema: z.object({
    name: z.string().max(80),
    aliases: z.array(z.string().max(80)).optional(),
    doseText: z.string().max(100).optional(),
    times: z.array(z.string().max(5)).optional(), // HH:mm
    asNeeded: z.boolean().optional().default(false),
    minIntervalMinutes: z.number().min(15).max(1440).optional().nullable(),
    maxPerDay: z.number().min(1).max(24).optional().nullable(),
    note: z.string().max(500).optional()
  }),
  roles: ['primary'],
  handler: async (input, ctx) => {
    const medId = 'med_' + randomUUID();
    
    // Check if it already exists to update or insert
    const existing = db.prepare(`SELECT id FROM medications WHERE circle_id = ? AND name = ? AND active = 1`).get(ctx.circleId, input.name) as { id: string } | undefined;
    
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

// Helper for fuzzy match (simplified)
function findMedication(circleId: string, nameSearch: string): MedicationInfo[] {
  const meds = db.prepare(`SELECT id, name, aliases_json, min_interval_minutes, max_per_day, as_needed, active FROM medications WHERE circle_id = ?`).all(circleId) as any[];
  const searchLower = nameSearch.toLowerCase();
  
  const matches = meds.filter(m => {
    if (m.name.toLowerCase().includes(searchLower)) return true;
    const aliases = JSON.parse(m.aliases_json || '[]');
    if (aliases.some((a: string) => a.toLowerCase().includes(searchLower))) return true;
    return false;
  });

  return matches.map(m => ({
    id: m.id,
    name: m.name,
    active: m.active === 1,
    minIntervalMinutes: m.min_interval_minutes,
    maxPerDay: m.max_per_day,
    asNeeded: m.as_needed === 1
  }));
}

function getMemberName(memberId: string): string {
  const m = db.prepare(`SELECT display_name FROM members WHERE id = ?`).get(memberId) as { display_name: string } | undefined;
  return m ? m.display_name : 'Someone';
}

function formatRelativeTime(isoString: string, nowIso: string): string {
  const dt = DateTime.fromISO(isoString);
  const diff = Math.floor(Math.abs(DateTime.fromISO(nowIso).diff(dt, 'minutes').minutes));
  if (diff < 60) return `${diff} minutes ago`;
  const hours = Math.round(diff / 60);
  return `about ${hours} hour${hours > 1 ? 's' : ''} ago`;
}

// --- med_log_given ---
registry.registerTool({
  name: 'med_log_given',
  description: 'Record a dose as given, skipped or refused, attributed to the speaker',
  schema: z.object({
    medication: z.string().max(80),
    status: z.enum(['given', 'skipped', 'refused']).default('given'),
    at: z.string().optional(),
    minutesAgo: z.number().min(0).max(1440).optional(),
    note: z.string().max(500).optional(),
    confirmRepeat: z.boolean().default(false),
    idempotencyKey: z.string().max(100).optional()
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
      return { safetyLevel: 'error', safetyCode: 'MEDICATION_NOT_FOUND', spokenText: `I don't have a medication called ${input.medication}. Want me to add it?`, data: null };
    }
    if (medsFound.length > 1) {
      return { safetyLevel: 'error', safetyCode: 'AMBIGUOUS_MEDICATION', spokenText: `Do you mean ${medsFound[0].name} or ${medsFound[1].name}?`, data: null };
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
      
      if (guard.level === 'caution' && !input.confirmRepeat) {
        const who = guard.lastMember ? getMemberName(guard.lastMember) : 'someone';
        const when = guard.lastEventAt ? formatRelativeTime(guard.lastEventAt, ctx.now) : 'recently';
        return {
          safetyLevel: 'caution',
          safetyCode: guard.code,
          spokenText: `Careful, ${who} logged ${med.name} ${when}. Do you want to log another dose anyway?`,
          data: { guard }
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

    // Audit log
    db.prepare(`INSERT INTO audit_log (id, circle_id, member_id, tool, summary, at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aud_' + randomUUID(), ctx.circleId, ctx.memberId, 'med_log_given', `med_log_given: dose ${override ? 'override' : 'logged'}`, ctx.now
    );

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
  description: 'Answer "was it already given, by whom and when?" or summarize today\'s whole medication checklist',
  annotations: {
    readOnlyHint: true
  },
  schema: z.object({
    medication: z.string().max(80).optional()
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const circle = db.prepare(`SELECT timezone FROM care_circles WHERE id = ?`).get(ctx.circleId) as { timezone?: string } | undefined;
    const tz = circle?.timezone || 'UTC';
    const todayStart = DateTime.fromISO(ctx.now).setZone(tz).startOf('day').toUTC().toISO()!;

    if (input.medication) {
      const medsFound = findMedication(ctx.circleId, input.medication);
      if (medsFound.length === 0) return { safetyLevel: 'none', safetyCode: null, spokenText: `I don't have a medication called ${input.medication}. Want me to add it?`, data: null };
      if (medsFound.length > 1) return { safetyLevel: 'none', safetyCode: null, spokenText: `Do you mean ${medsFound[0].name} or ${medsFound[1].name}?`, data: null };
      
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
