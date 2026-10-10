import { describe, it, expect } from 'vitest';
import { evaluateRedFlags } from '../src/core/redFlagEngine.js';

describe('Red-flag Engine (Canonical Rules RF-01 to RF-15)', () => {
  it('RF-01: Stroke signs ("His speech is a bit slurred") -> emergency RF-01', () => {
    const res = evaluateRedFlags('His speech is a bit slurred');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-01');
    expect(res?.instruction).toContain('stroke');
  });

  it('RF-02: Chest pain ("Complaining of chest pain after lunch") -> emergency RF-02', () => {
    const res = evaluateRedFlags('Complaining of chest pain after lunch');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-02');
    expect(res?.instruction).toContain('heart attack');
  });

  it('RF-02 Negation: "He has no chest pain today" -> negated, no match', () => {
    const res = evaluateRedFlags('He has no chest pain today');
    expect(res).toBeNull();
  });

  it('Ambiguous negation: "Not sure if his face is drooping" -> does not suppress, matches RF-01', () => {
    const res = evaluateRedFlags('Not sure if his face is drooping today');
    expect(res).not.toBeNull();
    expect(res?.ruleId).toBe('RF-01');
    expect(res?.level).toBe('emergency');
  });

  it('Severity prioritization: Multiple triggers (Fever + Chest Pain) -> emergency wins', () => {
    const res = evaluateRedFlags('He has a fever and chest pain');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-02');
  });

  it('Punctuation robustness: "Pain in his chest, also coughing." -> matches RF-02', () => {
    const res = evaluateRedFlags('Pain in his chest, also coughing.');
    expect(res).not.toBeNull();
    expect(res?.ruleId).toBe('RF-02');
  });

  it('RF-03: Breathing difficulty -> emergency RF-03', () => {
    const res = evaluateRedFlags('She cannot breathe and has blue lips');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-03');
  });

  it('RF-04: Unresponsive -> emergency RF-04', () => {
    const res = evaluateRedFlags('He collapsed and won\'t wake up');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-04');
  });

  it('RF-05: Severe bleeding -> emergency RF-05', () => {
    const res = evaluateRedFlags('The bleeding won\'t stop from the cut');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-05');
  });

  it('RF-06: Choking -> emergency RF-06', () => {
    const res = evaluateRedFlags('He is choking on his food');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-06');
  });

  it('RF-08: Seizure -> emergency RF-08', () => {
    const res = evaluateRedFlags('He is having a seizure right now');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-08');
  });

  it('RF-09: Serious fall -> emergency RF-09', () => {
    const res = evaluateRedFlags('He fell and hit head against the table');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-09');
  });

  it('RF-10: Anaphylaxis -> emergency RF-10', () => {
    const res = evaluateRedFlags('She has hives and trouble breathing after medication');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('emergency');
    expect(res?.ruleId).toBe('RF-10');
  });

  it('RF-12: Sudden new confusion -> contact_clinician RF-12', () => {
    const res = evaluateRedFlags('Dad is suddenly confused this morning');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('contact_clinician');
    expect(res?.ruleId).toBe('RF-12');
  });

  it('RF-15: Fever -> contact_clinician RF-15', () => {
    const res = evaluateRedFlags('Grandma has a high fever and is shivering');
    expect(res).not.toBeNull();
    expect(res?.level).toBe('contact_clinician');
    expect(res?.ruleId).toBe('RF-15');
  });
});
