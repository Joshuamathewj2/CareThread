import { describe, it, expect } from 'vitest';
import { checkDoseGuard, MedicationInfo, MedEvent } from '../src/core/doseGuard.js';

const MOCK_NOW = '2026-10-10T12:00:00.000Z'; // 12:00 PM UTC

const metformin: MedicationInfo = {
  id: 'med_1',
  name: 'Metformin',
  active: true,
  minIntervalMinutes: 480, // 8 hours
  maxPerDay: 2,
  asNeeded: false
};

const amlodipine: MedicationInfo = {
  id: 'med_2',
  name: 'Amlodipine',
  active: true,
  minIntervalMinutes: 1200,
  maxPerDay: 1,
  asNeeded: false
};

const createEvent = (id: string, memberId: string, status: 'given' | 'skipped' | 'refused', eventAt: string, medicationId = 'med_1'): MedEvent => ({
  id,
  medicationId,
  memberId,
  status,
  eventAt,
  loggedAt: MOCK_NOW
});

describe('Dose Guard (DG-01 to DG-20)', () => {
  it('DG-01: Given 2 h ago by Priya -> WITHIN_INTERVAL', () => {
    // 10:00 AM UTC (2 hrs ago)
    const history = [createEvent('e1', 'Priya', 'given', '2026-10-10T10:00:00.000Z')];
    const res = checkDoseGuard([metformin], history, MOCK_NOW, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('WITHIN_INTERVAL');
    expect(res.level).toBe('caution');
    expect(res.lastMember).toBe('Priya');
  });

  it('DG-02: Given 9 h ago -> OUTSIDE_INTERVAL', () => {
    // 03:00 AM UTC (9 hrs ago)
    const history = [createEvent('e1', 'Priya', 'given', '2026-10-10T03:00:00.000Z')];
    const res = checkDoseGuard([metformin], history, MOCK_NOW, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('OUTSIDE_INTERVAL');
    expect(res.level).toBe('none');
  });

  it('DG-03: Nothing logged today -> no error, OUTSIDE_INTERVAL', () => {
    const res = checkDoseGuard([metformin], [], MOCK_NOW, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('OUTSIDE_INTERVAL');
    expect(res.level).toBe('none');
  });

  it('DG-04: No interval set -> NO_INTERVAL', () => {
    const medNoInterval = { ...metformin, minIntervalMinutes: null };
    const history = [createEvent('e1', 'Priya', 'given', '2026-10-10T11:00:00.000Z')];
    const res = checkDoseGuard([medNoInterval], history, MOCK_NOW, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('NO_INTERVAL');
    expect(res.level).toBe('none');
  });

  it('DG-05: Two members log within 30s -> DUPLICATE_SUSPECT', () => {
    // Event at 12:00:00 by Priya, Arjun logs at 12:00:20
    const history = [createEvent('e1', 'Priya', 'given', '2026-10-10T12:00:00.000Z')];
    const res = checkDoseGuard([metformin], history, '2026-10-10T12:00:20.000Z', 'Arjun', '2026-10-10T12:00:20.000Z');
    expect(res.code).toBe('DUPLICATE_SUSPECT');
    expect(res.level).toBe('caution');
  });

  it('DG-06: Given 23:50, check at 00:20 -> WITHIN_INTERVAL (midnight does not reset)', () => {
    const midnightNow = '2026-10-11T00:20:00.000Z';
    const history = [createEvent('e1', 'Priya', 'given', '2026-10-10T23:50:00.000Z')];
    const res = checkDoseGuard([metformin], history, midnightNow, 'Arjun', midnightNow);
    expect(res.code).toBe('WITHIN_INTERVAL');
  });

  it('DG-07: Interval spans a DST change -> correct by elapsed minutes', () => {
    // ISO UTC strings handle this natively as elapsed real time
    // Fall back: 1:30 AM -> 1:00 AM. 
    // Say we log at '2026-11-01T05:00:00Z' and next log is '2026-11-01T07:00:00Z' (2 hours elapsed)
    const history = [createEvent('e1', 'Priya', 'given', '2026-11-01T05:00:00.000Z')];
    const res = checkDoseGuard([metformin], history, '2026-11-01T07:00:00.000Z', 'Arjun', '2026-11-01T07:00:00.000Z');
    expect(res.code).toBe('WITHIN_INTERVAL');
  });

  it('DG-08: Skipped at 08:00 -> OUTSIDE_INTERVAL (skipped does not count)', () => {
    const history = [createEvent('e1', 'Priya', 'skipped', '2026-10-10T08:00:00.000Z')];
    const res = checkDoseGuard([metformin], history, '2026-10-10T09:00:00.000Z', 'Arjun', '2026-10-10T09:00:00.000Z');
    expect(res.code).toBe('OUTSIDE_INTERVAL');
  });

  it('DG-09: Refused at 08:05 -> handled similarly (refused does not count for interval)', () => {
    const history = [createEvent('e1', 'Priya', 'refused', '2026-10-10T08:05:00.000Z')];
    const res = checkDoseGuard([metformin], history, '2026-10-10T09:00:00.000Z', 'Arjun', '2026-10-10T09:00:00.000Z');
    expect(res.code).toBe('OUTSIDE_INTERVAL');
  });

  it('DG-10: Max per day reached -> MAX_PER_DAY caution', () => {
    // 2 events in last 24h
    const history = [
      createEvent('e1', 'Priya', 'given', '2026-10-10T02:00:00.000Z'),
      createEvent('e2', 'Arjun', 'given', '2026-10-10T11:00:00.000Z')
    ];
    // Next log at 20:00 (which is 9 hrs after 11:00, OUTSIDE_INTERVAL, but hits MAX_PER_DAY)
    const proposed = '2026-10-10T20:00:00.000Z';
    const res = checkDoseGuard([metformin], history, proposed, 'Meera', proposed);
    expect(res.code).toBe('MAX_PER_DAY');
  });

  it('DG-11: As-needed medication, no interval -> NO_INTERVAL', () => {
    const med = { ...metformin, asNeeded: true, minIntervalMinutes: null };
    const history = [createEvent('e1', 'Priya', 'given', '2026-10-10T11:00:00.000Z')];
    const res = checkDoseGuard([med], history, MOCK_NOW, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('NO_INTERVAL');
  });

  it('DG-12: Backdated inside interval of later event -> WITHIN_INTERVAL', () => {
    // Later event is at 12:00 PM. We try to backdate a dose at 11:00 AM.
    const history = [createEvent('e1', 'Priya', 'given', '2026-10-10T12:00:00.000Z')];
    const proposed = '2026-10-10T11:00:00.000Z';
    const now = '2026-10-10T13:00:00.000Z';
    const res = checkDoseGuard([metformin], history, proposed, 'Arjun', now);
    expect(res.code).toBe('WITHIN_INTERVAL');
  });

  it('DG-13: Viewer role -> FORBIDDEN_ROLE handled in tool layer, not core logic', () => {
    // This is tested in the tool wrapper.
  });

  it('DG-14: Ambiguous medication -> AMBIGUOUS_MEDICATION', () => {
    const res = checkDoseGuard([metformin, amlodipine], [], MOCK_NOW, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('AMBIGUOUS_MEDICATION');
  });

  it('DG-15: Future time -> INVALID_TIME', () => {
    const proposed = '2026-10-10T12:30:00.000Z'; // 30 mins in future
    const res = checkDoseGuard([metformin], [], proposed, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('INVALID_TIME');
  });

  it('DG-18: Medication marked inactive -> MEDICATION_NOT_FOUND', () => {
    const inactiveMed = { ...metformin, active: false };
    const res = checkDoseGuard([inactiveMed], [], MOCK_NOW, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('MEDICATION_NOT_FOUND');
  });

  it('DG-19: Another circles medication -> Not passed in array -> MEDICATION_NOT_FOUND', () => {
    const res = checkDoseGuard([], [], MOCK_NOW, 'Arjun', MOCK_NOW);
    expect(res.code).toBe('MEDICATION_NOT_FOUND');
  });

  it('DG-20: Clock service unavailable or invalid time -> INTERNAL', () => {
    const res = checkDoseGuard([metformin], [], 'invalid-time', 'Arjun', MOCK_NOW);
    expect(res.code).toBe('INTERNAL');
  });
});
