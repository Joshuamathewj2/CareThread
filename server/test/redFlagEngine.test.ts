import { describe, it, expect } from 'vitest';
import { evaluateRedFlags } from '../src/core/redFlagEngine.js';

describe('Red-flag Engine (RF-01 to RF-05)', () => {
  it('RF-01: "Complaining of chest pain" -> emergency', () => {
    const res = evaluateRedFlags('Complaining of chest pain after lunch');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-01');
  });

  it('RF-02: "No chest pain today" -> negated, no match', () => {
    const res = evaluateRedFlags('He has no chest pain today');
    expect(res).toBeNull();
  });

  it('RF-03: "His speech is a bit slurred" -> stroke rule', () => {
    const res = evaluateRedFlags('His speech is a bit slurred');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-02');
  });

  it('RF-04: Multiple triggers -> highest severity wins', () => {
    // Both fever (contact_clinician) and chest (emergency)
    const res = evaluateRedFlags('He has a fever and chest pain');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-01');
  });

  it('RF-05: Punctuation does not break match', () => {
    const res = evaluateRedFlags('Pain in his chest, also coughing.');
    expect(res).not.toBeNull();
    expect(res?.ruleId).toBe('RF-01');
  });
});
