import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { db } from '../db/index.js';
import { MedicationInfo } from '../core/doseGuard.js';

export type CircleRow = {
  id: string;
  recipient_name: string;
  timezone: string;
  emergency_number: string;
  privacy_mode: number;
  allergies_json: string;
  clinicians_json: string;
  vital_ranges_json: string;
};

export function getCircle(circleId: string): CircleRow | undefined {
  return db.prepare(`SELECT * FROM care_circles WHERE id = ?`).get(circleId) as CircleRow | undefined;
}

export function getMemberName(memberId: string): string {
  const m = db.prepare(`SELECT display_name FROM members WHERE id = ?`).get(memberId) as { display_name: string } | undefined;
  return m ? m.display_name : 'Someone';
}

export function writeAudit(circleId: string, memberId: string, tool: string, summary: string, at: string) {
  db.prepare(`INSERT INTO audit_log (id, circle_id, member_id, tool, summary, at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'aud_' + randomUUID(), circleId, memberId, tool, summary, at
  );
}

export function formatRelativeTime(isoString: string, nowIso: string): string {
  const dt = DateTime.fromISO(isoString);
  const diff = Math.floor(Math.abs(DateTime.fromISO(nowIso).diff(dt, 'minutes').minutes));
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} minute${diff > 1 ? 's' : ''} ago`;
  const hours = Math.round(diff / 60);
  return `about ${hours} hour${hours > 1 ? 's' : ''} ago`;
}

// Speakable local clock time in the circle's timezone, e.g. "3:42 PM"
export function formatLocalTime(isoString: string, tz: string): string {
  return DateTime.fromISO(isoString).setZone(tz).toFormat('h:mm a');
}

/**
 * Fill the placeholders red-flag rules use. Rules are authored with {emergencyNumber} and {clinician};
 * an unfilled placeholder must never be spoken aloud.
 */
export function renderInstruction(instruction: string, circle: CircleRow | undefined): string {
  const emergencyNumber = circle?.emergency_number || '112';
  const clinicians = JSON.parse(circle?.clinicians_json || '[]') as Array<{ name?: string }>;
  const clinician = clinicians[0]?.name || 'your doctor';
  return instruction.replaceAll('{emergencyNumber}', emergencyNumber).replaceAll('{clinician}', clinician);
}

// Active medications whose name or alias contains the search; an exact name/alias match wins outright.
export function findMedication(circleId: string, nameSearch: string): MedicationInfo[] {
  const meds = db.prepare(`
    SELECT id, name, aliases_json, min_interval_minutes, max_per_day, as_needed, active
    FROM medications WHERE circle_id = ? AND active = 1
  `).all(circleId) as any[];
  const searchLower = nameSearch.trim().toLowerCase();
  const namesOf = (m: any): string[] => [m.name, ...JSON.parse(m.aliases_json || '[]')].map((n: string) => n.toLowerCase());

  const exact = meds.filter(m => namesOf(m).includes(searchLower));
  const matches = exact.length > 0 ? exact : meds.filter(m => namesOf(m).some(n => n.includes(searchLower)));

  return matches.map(m => ({
    id: m.id,
    name: m.name,
    active: m.active === 1,
    minIntervalMinutes: m.min_interval_minutes,
    maxPerDay: m.max_per_day,
    asNeeded: m.as_needed === 1
  }));
}
