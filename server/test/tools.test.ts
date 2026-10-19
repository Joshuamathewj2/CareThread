import { describe, it, expect, beforeEach } from 'vitest';
import { registry } from '../src/mcp/registry.js';
import '../src/tools/medications.js';
import '../src/tools/observations.js';
import '../src/tools/reports.js';
import '../src/tools/additional.js';
import '../src/tools/context.js';
import '../src/tools/askCareLog.js';
import type { AuthContext } from '../src/middleware/auth.js';

describe('Tool Registry and Handlers Conformance', () => {
  let ctx: AuthContext;

  beforeEach(() => {
    // Setup test auth context with seeded circle & member
    ctx = {
      circleId: 'c_1',
      memberId: 'm_priya',
      role: 'primary',
      now: new Date().toISOString()
    };
  });

  it('All canonical tools are registered with schemas', () => {
    const expectedTools = [
      'recipient_profile',
      'med_schedule_set',
      'med_log_given',
      'med_check_status',
      'log_observation',
      'log_vital',
      'redflag_check',
      'handoff_summary',
      'trend_insights',
      'visit_export',
      'question_for_doctor',
      'care_timer',
      'caregiver_checkin',
      'care_next_actions',
      'undo_last_entry',
      'ask_care_log'
    ];

    for (const toolName of expectedTools) {
      const def = registry.tools.get(toolName);
      expect(def, `Tool ${toolName} must be registered`).toBeDefined();
      expect(def?.description.length).toBeLessThanOrEqual(200);
      expect(def?.schema).toBeDefined();
    }
  });

  it('redflag_check: evaluates symptoms statelessly', async () => {
    const rfTool = registry.tools.get('redflag_check')!;
    
    // Emergency stroke
    const resEmergency = await rfTool.handler({ description: 'Her speech is slurred and arm feels weak' }, ctx);
    expect(resEmergency.safetyLevel).toBe('emergency');
    expect(resEmergency.safetyCode).toBe('RF-01');
    expect(resEmergency.spokenText).toContain('stroke');
    expect(resEmergency.data.emergencyNumber).toBeDefined();

    // Benign note -> never reassures
    const resBenign = await rfTool.handler({ description: 'Ate lunch peacefully and took a nap' }, ctx);
    expect(resBenign.safetyLevel).toBe('none');
    expect(resBenign.spokenText).toContain("I can't judge symptoms");
  });

  it('question_for_doctor: add, list, mark_done workflow', async () => {
    const qTool = registry.tools.get('question_for_doctor')!;

    // 1. Add
    const addRes = await qTool.handler({ action: 'add', text: 'Should we increase dosage?' }, ctx);
    expect(addRes.safetyLevel).toBe('none');
    expect(addRes.spokenText).toContain('Saved for the next appointment');
    const qId = addRes.data.questionId;
    expect(qId).toBeDefined();

    // 2. List
    const listRes = await qTool.handler({ action: 'list' }, ctx);
    expect(listRes.spokenText).toContain('saved');
    expect(listRes.data.questions.some((q: any) => q.id === qId)).toBe(true);

    // 3. Mark done
    const doneRes = await qTool.handler({ action: 'mark_done', questionId: qId }, ctx);
    expect(doneRes.spokenText).toContain('Marked question as done');
  });

  it('care_timer: start, check, cancel workflow', async () => {
    const timerTool = registry.tools.get('care_timer')!;

    // 1. Start
    const startRes = await timerTool.handler({ action: 'start', name: 'Check blood sugar', minutes: 30 }, ctx);
    expect(startRes.spokenText).toContain('Timer set: Check blood sugar, 30 minutes.');
    expect(startRes.data.timerId).toBeDefined();

    // 2. Check
    const checkRes = await timerTool.handler({ action: 'check', name: 'Check blood sugar' }, ctx);
    expect(checkRes.spokenText).toContain('minutes left');
    expect(checkRes.data.active).toBe(true);

    // 3. Cancel
    const cancelRes = await timerTool.handler({ action: 'cancel', name: 'Check blood sugar' }, ctx);
    expect(cancelRes.spokenText).toContain('Timer cancelled: Check blood sugar.');
  });

  it('med_check_status: handles full checklist when medication is omitted', async () => {
    const statusTool = registry.tools.get('med_check_status')!;

    const checklistRes = await statusTool.handler({}, ctx);
    expect(checklistRes.spokenText).toContain('Today:');
    expect(checklistRes.data.checklist).toBeDefined();
    expect(Array.isArray(checklistRes.data.checklist)).toBe(true);
  });

  it('handoff_summary: builds multi-domain handoff report', async () => {
    const handoffTool = registry.tools.get('handoff_summary')!;

    const res = await handoffTool.handler({ window: 'today' }, ctx);
    expect(res.spokenText).toBeDefined();
    expect(res.data.window).toBe('today');
    expect(res.data.doses).toBeDefined();
    expect(res.data.observations).toBeDefined();
  });

  it('visit_export: generates markdown export including questions for doctor', async () => {
    const exportTool = registry.tools.get('visit_export')!;

    const res = await exportTool.handler({ daysBack: 14 }, ctx);
    expect(res.spokenText).toContain('Your visit report is ready');
    expect(res.data.markdown).toContain('# CareThread Clinical Visit Export');
    expect(res.data.markdown).toContain('## 6. Questions for the Doctor');
  });
});
