import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { registry } from '../src/mcp/registry.js';
import '../src/tools/medications.js';
import '../src/tools/observations.js';
import '../src/tools/reports.js';
import '../src/tools/additional.js';
import '../src/tools/context.js';
import '../src/tools/askCareLog.js';
import { db } from '../src/db/index.js';
import type { AuthContext } from '../src/middleware/auth.js';

// Multi-turn flows through the full registry pipeline (validation, roles, output guard, envelope),
// exactly as a voice agent experiences them. The clock is pinned to 9 PM in the circle's timezone.
const evening = DateTime.now().setZone('Asia/Kolkata').set({ hour: 21, minute: 0, second: 0, millisecond: 0 });
let tick = 0;

function ctxFor(memberId: string, role: AuthContext['role']): AuthContext {
  tick += 1; // each turn happens a few seconds after the last, so "most recent" is well defined
  return { circleId: 'c_1', memberId, role, now: evening.plus({ seconds: tick * 5 }).toUTC().toISO()! };
}

const call = async (name: string, args: Record<string, unknown>, ctx: AuthContext) => {
  const res = await registry.callTool(name, args, ctx);
  return { ...res, sc: res.structuredContent as any, text: (res.content[0] as any).text as string };
};

describe('Double-dose catch with a confirm follow-up', () => {
  it('warns the second caregiver, then logs only after the follow-up is confirmed', async () => {
    const first = await call('med_log_given', { medication: 'metformin' }, ctxFor('m_priya', 'primary'));
    expect(first.text).toMatch(/^Logged: Metformin/);

    const second = await call('med_log_given', { medication: 'metformin' }, ctxFor('m_arjun', 'family'));
    expect(second.sc.safety.level).toBe('caution');
    expect(second.text).toContain('Careful, Priya logged Metformin');
    expect(second.sc.followUp).toMatchObject({ kind: 'confirm', tool: 'med_log_given', arguments: { confirmRepeat: true } });

    const countBefore = (db.prepare(`SELECT count(*) as n FROM med_events WHERE medication_id = 'med_metformin'`).get() as any).n;
    const confirmed = await call(second.sc.followUp.tool, second.sc.followUp.arguments, ctxFor('m_arjun', 'family'));
    expect(confirmed.text).toContain('extra dose');
    const countAfter = (db.prepare(`SELECT count(*) as n FROM med_events WHERE medication_id = 'med_metformin'`).get() as any).n;
    expect(countAfter).toBe(countBefore + 1);
  });

  it('refuses a future dose time instead of silently logging it', async () => {
    const ctx = ctxFor('m_priya', 'primary');
    const future = DateTime.fromISO(ctx.now).plus({ hours: 2 }).toISO();
    const res = await call('med_log_given', { medication: 'Vitamin D', at: future }, ctx);
    expect(res.sc.safety.code).toBe('INVALID_TIME');
    const logged = db.prepare(`SELECT count(*) as n FROM med_events WHERE medication_id = 'med_vitamind' AND event_at = ?`).get(future) as any;
    expect(logged.n).toBe(0);
  });

  it('offers to add an unknown medication (primary only)', async () => {
    const res = await call('med_log_given', { medication: 'Atorvastatin' }, ctxFor('m_priya', 'primary'));
    expect(res.sc.followUp).toMatchObject({ kind: 'confirm', tool: 'med_schedule_set', arguments: { name: 'Atorvastatin' } });
    const aide = await call('med_log_given', { medication: 'Atorvastatin' }, ctxFor('m_meera', 'aide'));
    expect(aide.sc.followUp.kind).toBe('clarify');
  });
});

describe('Input validation speaks the right correction', () => {
  it('maps a bad category to a value error, not a time error', async () => {
    const res = await call('log_observation', { category: 'chatting', text: 'hello' }, ctxFor('m_priya', 'primary'));
    expect(res.isError).toBe(true);
    expect(res.sc.error.code).toBe('INVALID_VALUE');
  });

  it('maps a malformed time to INVALID_TIME', async () => {
    const res = await call('med_log_given', { medication: 'Metformin', at: 'after lunch' }, ctxFor('m_priya', 'primary'));
    expect(res.sc.error.code).toBe('INVALID_TIME');
  });

  it('fills in default units and reads blood pressure naturally', async () => {
    const res = await call('log_vital', { kind: 'bp', value: 128, value2: 82 }, ctxFor('m_priya', 'primary'));
    expect(res.text).toBe('Logged bp reading of 128 over 82 mmHg.');
  });
});

describe('Output guard and caregiver words', () => {
  it("reads back a saved question even when it contains dosing words", async () => {
    const res = await call('question_for_doctor', { action: 'add', text: 'Should we skip the dose on fasting days?' }, ctxFor('m_priya', 'primary'));
    expect(res.text).toContain('Saved for the next appointment: Should we skip the dose');
    expect(res.sc.safety.code).not.toBe('OUTPUT_GUARD_BLOCKED');
  });

  it('marks a question done by a few spoken words', async () => {
    const res = await call('question_for_doctor', { action: 'mark_done', text: 'fasting days' }, ctxFor('m_priya', 'primary'));
    expect(res.text).toBe('Marked question as done.');
  });

  it('never speaks an unfilled {clinician} placeholder', async () => {
    const res = await call('redflag_check', { description: 'he is suddenly confused and agitated' }, ctxFor('m_priya', 'primary'));
    expect(res.sc.safety.level).toBe('contact_clinician');
    expect(res.text).toContain('Dr. Rao');
    expect(res.text).not.toContain('{');
  });

  it('speaks emergency time in the local timezone', async () => {
    const ctx = ctxFor('m_priya', 'primary');
    const res = await call('log_observation', { category: 'other', text: 'his face is drooping and speech is slurred' }, ctx);
    expect(res.sc.safety.level).toBe('emergency');
    expect(res.text).toContain(DateTime.fromISO(ctx.now).setZone('Asia/Kolkata').toFormat('h:mm a'));
    expect(res.text).not.toContain('UTC');
  });
});

describe('care_next_actions', () => {
  it('puts a recent red flag first and lists scheduled doses not logged yet', async () => {
    const res = await call('care_next_actions', {}, ctxFor('m_meera', 'aide'));
    expect(res.text).toMatch(/^An urgent alert was logged/);
    expect(res.sc.data.notLogged.map((n: any) => n.medication)).toEqual(expect.arrayContaining(['Amlodipine', 'Vitamin D']));
    // Metformin has 2 slots and 2 logged events this evening, so both are covered
    expect(res.sc.data.notLogged.map((n: any) => n.medication)).not.toContain('Metformin');
    expect(res.text).not.toMatch(/missed|not taken/i);
  });
});

describe('undo_last_entry', () => {
  it('previews, then removes exactly the previewed entry', async () => {
    await call('log_observation', { category: 'meals', text: 'ate all of dinner' }, ctxFor('m_meera', 'aide'));
    await call('log_vital', { kind: 'pulse', value: 72 }, ctxFor('m_meera', 'aide'));

    const preview = await call('undo_last_entry', {}, ctxFor('m_meera', 'aide'));
    expect(preview.text).toContain('pulse reading of 72');
    expect(preview.sc.followUp).toMatchObject({ kind: 'confirm', tool: 'undo_last_entry', arguments: { confirm: true } });

    const vitalId = preview.sc.data.candidate.id;
    const done = await call('undo_last_entry', preview.sc.followUp.arguments, ctxFor('m_meera', 'aide'));
    expect(done.text).toBe('Removed the pulse reading of 72.');
    expect(db.prepare(`SELECT id FROM vitals WHERE id = ?`).get(vitalId)).toBeUndefined();
    // The earlier observation is untouched
    expect(db.prepare(`SELECT id FROM observations WHERE text = 'ate all of dinner'`).get()).toBeDefined();
  });

  it("cannot remove someone else's entry", async () => {
    const preview = await call('undo_last_entry', {}, ctxFor('m_meera', 'aide'));
    const res = await call('undo_last_entry', { confirm: true, entryId: preview.sc.data.candidate.id }, ctxFor('m_arjun', 'family'));
    expect(res.sc.safety.code).toBe('UNDO_NOT_AVAILABLE');
  });
});
