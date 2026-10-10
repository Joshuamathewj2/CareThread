import { DateTime } from 'luxon';

export type MedicationInfo = {
  id: string;
  name: string;
  active: boolean;
  minIntervalMinutes: number | null;
  maxPerDay: number | null;
  asNeeded: boolean;
};

export type MedEvent = {
  id: string;
  medicationId: string;
  memberId: string;
  status: 'given' | 'skipped' | 'refused';
  eventAt: string; // ISO 8601 UTC
  loggedAt: string; // ISO 8601 UTC
};

export type DoseGuardResult = {
  code: string;
  level: 'none' | 'caution' | 'error';
  lastEventAt?: string;
  lastMember?: string;
};

export function checkDoseGuard(
  medicationsFound: MedicationInfo[],
  history: MedEvent[],
  proposedEventAt: string, // ISO 8601 UTC
  proposingMemberId: string,
  nowUtc: string // ISO 8601 UTC
): DoseGuardResult {
  // 1. Medication not found or inactive
  if (medicationsFound.length === 0) {
    return { code: 'MEDICATION_NOT_FOUND', level: 'error' };
  }
  const activeMeds = medicationsFound.filter(m => m.active);
  if (activeMeds.length === 0) {
    return { code: 'MEDICATION_NOT_FOUND', level: 'error' };
  }

  // 2. More than one fuzzy match
  if (activeMeds.length > 1) {
    return { code: 'AMBIGUOUS_MEDICATION', level: 'error' };
  }

  const med = activeMeds[0];

  const proposedDt = DateTime.fromISO(proposedEventAt, { zone: 'utc' });
  const nowDt = DateTime.fromISO(nowUtc, { zone: 'utc' });

  if (!proposedDt.isValid || !nowDt.isValid) {
    return { code: 'INTERNAL', level: 'error' };
  }
  
  // Future time check (if > 5 minutes in future)
  if (proposedDt.diff(nowDt, 'minutes').minutes > 5) {
     return { code: 'INVALID_TIME', level: 'error' };
  }

  // Only consider 'given' events
  const givenEvents = history.filter(e => e.status === 'given');

  // Sort events by eventAt descending
  givenEvents.sort((a, b) => 
    DateTime.fromISO(b.eventAt).toMillis() - DateTime.fromISO(a.eventAt).toMillis()
  );

  // 3. Another "given" event within 60 seconds by a different member
  for (const event of givenEvents) {
    if (event.memberId !== proposingMemberId) {
      const eventDt = DateTime.fromISO(event.eventAt, { zone: 'utc' });
      const diffSecs = Math.abs(proposedDt.diff(eventDt, 'seconds').seconds);
      if (diffSecs <= 60) {
        return { code: 'DUPLICATE_SUSPECT', level: 'caution', lastEventAt: event.eventAt, lastMember: event.memberId };
      }
    }
  }

  // 4. Count of "given" events in the last 24 hours (rolling) is at or above max per day
  if (med.maxPerDay !== null) {
    const twentyFourHoursAgo = proposedDt.minus({ hours: 24 });
    const eventsInLast24h = givenEvents.filter(e => {
      const eventDt = DateTime.fromISO(e.eventAt, { zone: 'utc' });
      return eventDt >= twentyFourHoursAgo && eventDt <= proposedDt;
    });
    if (eventsInLast24h.length >= med.maxPerDay) {
      return { code: 'MAX_PER_DAY', level: 'caution' };
    }
  }

  // 5. No minimum interval set
  if (med.minIntervalMinutes === null) {
    return { code: 'NO_INTERVAL', level: 'none' };
  }

  // 6. Last "given" event is closer than the minimum interval
  // Because it can be backdated, we need to check both before and after the proposed time
  for (const event of givenEvents) {
    const eventDt = DateTime.fromISO(event.eventAt, { zone: 'utc' });
    const diffMins = Math.abs(proposedDt.diff(eventDt, 'minutes').minutes);
    if (diffMins < med.minIntervalMinutes) {
      return { code: 'WITHIN_INTERVAL', level: 'caution', lastEventAt: event.eventAt, lastMember: event.memberId };
    }
  }

  // 7. Otherwise
  return { code: 'OUTSIDE_INTERVAL', level: 'none' };
}
