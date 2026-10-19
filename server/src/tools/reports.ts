import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { registry } from '../mcp/registry.js';
import { db } from '../db/index.js';
import { DateTime } from 'luxon';
import { writeAudit } from './shared.js';

const isoDate = z.string().refine(v => DateTime.fromISO(v).isValid, 'Expected an ISO 8601 date');

// --- handoff_summary ---
registry.registerTool({
  name: 'handoff_summary',
  title: 'Shift handoff',
  description: 'Spoken handoff for the next caregiver: red flags first, then doses and anything not logged, then notes',
  annotations: { readOnlyHint: true, idempotentHint: true },
  schema: z.object({
    window: z.enum(['last_shift', 'today', 'last_24h']).default('last_shift').optional().describe('last_shift is the past 8 hours'),
    hours: z.number().int().min(1).max(72).optional().describe('Custom window; overrides window')
  }),
  roles: ['primary', 'family', 'aide', 'viewer'],
  handler: async (input, ctx) => {
    const circle = db.prepare(`SELECT recipient_name, timezone, privacy_mode FROM care_circles WHERE id = ?`).get(ctx.circleId) as any;
    const tz = circle?.timezone || 'UTC';
    const recipientName = circle?.recipient_name || 'the recipient';

    let sinceIso: string;
    const win = input.window || 'last_shift';

    if (input.hours) {
      sinceIso = DateTime.fromISO(ctx.now).minus({ hours: input.hours }).toUTC().toISO()!;
    } else if (win === 'today') {
      sinceIso = DateTime.fromISO(ctx.now).setZone(tz).startOf('day').toUTC().toISO()!;
    } else if (win === 'last_24h') {
      sinceIso = DateTime.fromISO(ctx.now).minus({ hours: 24 }).toUTC().toISO()!;
    } else {
      // last_shift: last 8 hours
      sinceIso = DateTime.fromISO(ctx.now).minus({ hours: 8 }).toUTC().toISO()!;
    }

    // 1. Red flags
    const redflags = db.prepare(`
      SELECT r.rule_id, r.level, r.at, m.display_name
      FROM redflag_events r
      JOIN members m ON r.member_id = m.id
      WHERE r.circle_id = ? AND r.at >= ?
      ORDER BY r.at DESC
    `).all(ctx.circleId, sinceIso) as any[];

    // 2. Doses given
    const doses = db.prepare(`
      SELECT m.name, e.status, e.event_at, mem.display_name
      FROM med_events e 
      JOIN medications m ON e.medication_id = m.id
      JOIN members mem ON e.member_id = mem.id
      WHERE m.circle_id = ? AND e.event_at >= ?
      ORDER BY e.event_at DESC
    `).all(ctx.circleId, sinceIso) as any[];

    // 3. Unlogged active medications
    const activeMeds = db.prepare(`
      SELECT id, name FROM medications WHERE circle_id = ? AND active = 1 AND as_needed = 0
    `).all(ctx.circleId) as Array<{ id: string; name: string }>;

    const unloggedMeds: string[] = [];
    for (const med of activeMeds) {
      const hasDose = doses.some(d => d.name.toLowerCase() === med.name.toLowerCase());
      if (!hasDose) {
        unloggedMeds.push(med.name);
      }
    }

    // 4. Observations
    const obs = db.prepare(`
      SELECT category, text, recorded_at, severity
      FROM observations
      WHERE circle_id = ? AND recorded_at >= ?
      ORDER BY recorded_at DESC
    `).all(ctx.circleId, sinceIso) as any[];

    // 5. Open questions for doctor
    const openQuestions = db.prepare(`
      SELECT count(*) as count FROM doctor_questions WHERE circle_id = ? AND status = 'open'
    `).get(ctx.circleId) as { count: number };

    // Build spoken text (max 3 sentences: red flags -> doses/unlogged -> observations/questions)
    let spokenText: string;
    if (circle?.privacy_mode) {
      spokenText = `Your handoff for ${recipientName} is on the screen.`;
    } else {
      const parts: string[] = [];
      if (redflags.length > 0) {
        parts.push(`Caution: ${redflags.length} red-flag alert${redflags.length > 1 ? 's' : ''} noted recently.`);
      }

      const dosesGiven = doses.filter(d => d.status === 'given');
      if (dosesGiven.length > 0) {
        parts.push(`${dosesGiven.length} dose${dosesGiven.length > 1 ? 's' : ''} logged as given${unloggedMeds.length > 0 ? `; ${unloggedMeds.slice(0, 2).join(' and ')} not logged yet` : ''}.`);
      } else if (unloggedMeds.length > 0) {
        parts.push(`${unloggedMeds.slice(0, 2).join(' and ')} not logged yet.`);
      }

      if (obs.length > 0) {
        parts.push(`${obs.length} observation note${obs.length > 1 ? 's' : ''} recorded.`);
      } else if (openQuestions?.count > 0) {
        parts.push(`${openQuestions.count} question${openQuestions.count > 1 ? 's' : ''} saved for the doctor.`);
      }

      spokenText = parts.length > 0 ? parts.join(' ') : `Handoff summary: all quiet in the last window.`;
    }

    return {
      safetyLevel: redflags.length > 0 ? 'caution' : 'none',
      safetyCode: redflags.length > 0 ? 'RECENT_REDFLAG' : null,
      spokenText,
      data: {
        window: win,
        doses,
        missedOrNotLogged: unloggedMeds,
        observations: obs,
        redflags,
        openQuestions: openQuestions?.count || 0
      }
    };
  }
});

// --- visit_export ---
registry.registerTool({
  name: 'visit_export',
  title: 'Doctor visit report',
  description: 'Generate a Markdown visit report (medications, doses, vitals, notes, red flags, questions) for the clinician',
  annotations: { readOnlyHint: true, idempotentHint: true },
  schema: z.object({
    fromDate: isoDate.optional(),
    toDate: isoDate.optional(),
    daysBack: z.number().int().min(1).max(30).default(14).optional(),
    appointmentDate: isoDate.optional()
  }),
  roles: ['primary', 'family'],
  handler: async (input, ctx) => {
    const daysBack = input.daysBack || 14;
    const since = input.fromDate || DateTime.fromISO(ctx.now).minus({ days: daysBack }).toUTC().toISO()!;
    const until = input.toDate || ctx.now;

    const circle = db.prepare(`SELECT recipient_name FROM care_circles WHERE id = ?`).get(ctx.circleId) as any;
    const name = circle ? circle.recipient_name : 'Care Recipient';

    let md = `# CareThread Clinical Visit Export: ${name}\n\n`;
    md += `*Period:* ${since.substring(0, 10)} to ${until.substring(0, 10)}\n`;
    if (input.appointmentDate) {
      md += `*Appointment Date:* ${input.appointmentDate}\n`;
    }
    md += `*Generated:* ${new Date(ctx.now).toISOString().substring(0, 16)} UTC\n\n`;
    md += `> **Notice:** Prepared from a family caregiver's voice log. Not clinical advice or an official EHR record.\n\n`;

    // 1. Current Medications
    md += `## 1. Active Medication Schedule\n\n`;
    const medsList = db.prepare(`
      SELECT name, dose_text, times_json, min_interval_minutes, as_needed, note
      FROM medications 
      WHERE circle_id = ? AND active = 1
      ORDER BY name ASC
    `).all(ctx.circleId) as any[];

    if (medsList.length === 0) {
      md += `*No active medications configured.*\n\n`;
    } else {
      md += `| Medication | Dose / Form | Scheduled Times | Min Gap | Type |\n`;
      md += `| --- | --- | --- | --- | --- |\n`;
      for (const m of medsList) {
        const times = JSON.parse(m.times_json || '[]').join(', ') || 'None';
        const gap = m.min_interval_minutes ? `${m.min_interval_minutes / 60}h` : 'None';
        const type = m.as_needed ? 'PRN (As Needed)' : 'Scheduled';
        md += `| ${m.name} | ${m.dose_text || 'Standard'} | ${times} | ${gap} | ${type} |\n`;
      }
      md += `\n`;
    }

    // 2. Doses Logged
    md += `## 2. Medication Logged Events\n\n`;
    const doses = db.prepare(`
      SELECT e.event_at, med.name, e.status, m.display_name, e.note
      FROM med_events e 
      JOIN medications med ON e.medication_id = med.id
      JOIN members m ON e.member_id = m.id
      WHERE e.event_at >= ? AND e.event_at <= ? AND med.circle_id = ?
      ORDER BY e.event_at DESC
    `).all(since, until, ctx.circleId) as any[];

    if (doses.length === 0) {
      md += `*No dose events logged during this period.*\n\n`;
    } else {
      for (const d of doses) {
        md += `- **${d.event_at.substring(0, 16)}** - ${d.name} (${d.status}) by ${d.display_name}${d.note ? `: ${d.note}` : ''}\n`;
      }
      md += `\n`;
    }

    // 3. Vitals
    md += `## 3. Vital Sign Measurements\n\n`;
    const vitals = db.prepare(`
      SELECT v.recorded_at, v.kind, v.value, v.value2, v.unit, v.in_range, m.display_name
      FROM vitals v 
      JOIN members m ON v.member_id = m.id
      WHERE v.recorded_at >= ? AND v.recorded_at <= ? AND v.circle_id = ?
      ORDER BY v.recorded_at DESC
    `).all(since, until, ctx.circleId) as any[];

    if (vitals.length === 0) {
      md += `*No vitals logged during this period.*\n\n`;
    } else {
      for (const v of vitals) {
        const flag = v.in_range === 0 ? ' ⚠️ [OUT OF RANGE]' : '';
        const valStr = v.value2 !== null && v.value2 !== undefined ? `${v.value}/${v.value2}` : `${v.value}`;
        md += `- **${v.recorded_at.substring(0, 16)}** - ${v.kind}: ${valStr} ${v.unit}${flag} *(by ${v.display_name})*\n`;
      }
      md += `\n`;
    }

    // 4. Observations
    md += `## 4. Caregiver Observations\n\n`;
    const obs = db.prepare(`
      SELECT o.recorded_at, o.category, o.text, o.severity, m.display_name
      FROM observations o 
      JOIN members m ON o.member_id = m.id
      WHERE o.recorded_at >= ? AND o.recorded_at <= ? AND o.circle_id = ?
      ORDER BY o.recorded_at DESC
    `).all(since, until, ctx.circleId) as any[];

    if (obs.length === 0) {
      md += `*No observations logged during this period.*\n\n`;
    } else {
      for (const o of obs) {
        const sev = o.severity ? ` (Severity: ${o.severity})` : '';
        md += `- **${o.recorded_at.substring(0, 16)}** [${o.category}]${sev}: ${o.text} *(by ${o.display_name})*\n`;
      }
      md += `\n`;
    }

    // 5. Red-Flag Incidents
    md += `## 5. Red-Flag Escalation Incidents\n\n`;
    const redflags = db.prepare(`
      SELECT r.at, r.rule_id, r.level, m.display_name
      FROM redflag_events r
      JOIN members m ON r.member_id = m.id
      WHERE r.circle_id = ? AND r.at >= ? AND r.at <= ?
      ORDER BY r.at DESC
    `).all(ctx.circleId, since, until) as any[];

    if (redflags.length === 0) {
      md += `*No red-flag events occurred during this period.*\n\n`;
    } else {
      for (const rf of redflags) {
        md += `- **${rf.at.substring(0, 16)}** - ${rf.rule_id} (${rf.level}) logged by ${rf.display_name}\n`;
      }
      md += `\n`;
    }

    // 6. Questions for the Doctor
    md += `## 6. Questions for the Doctor\n\n`;
    const questions = db.prepare(`
      SELECT q.text, q.status, q.created_at, m.display_name
      FROM doctor_questions q
      JOIN members m ON q.member_id = m.id
      WHERE q.circle_id = ? AND q.status = 'open'
      ORDER BY q.created_at ASC
    `).all(ctx.circleId) as any[];

    if (questions.length === 0) {
      md += `*No open questions saved.*\n\n`;
    } else {
      for (const q of questions) {
        md += `- [ ] **${q.text}** *(added by ${q.display_name})*\n`;
      }
      md += `\n`;
    }

    writeAudit(ctx.circleId, ctx.memberId, 'visit_export', 'visit_export: generated markdown report', ctx.now);

    return {
      safetyLevel: 'none',
      safetyCode: null,
      spokenText: `Your visit report is ready: ${daysBack} days, ${obs.length} observations, ${questions.length} questions for the doctor.`,
      data: {
        markdown: md,
        counts: {
          observations: obs.length,
          vitals: vitals.length,
          doses: doses.length,
          questions: questions.length
        }
      }
    };
  }
});
