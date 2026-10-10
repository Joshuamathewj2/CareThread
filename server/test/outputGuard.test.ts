import { describe, it, expect } from 'vitest';
import { safeLogPayload, filterSpokenOutput } from '../src/core/outputGuard.js';

describe('Output Guard (S-03 and Spoken Safety Guard)', () => {
  it('OG-01: Redacts forbidden keys in logs', () => {
    const raw = {
      tool: 'log_observation',
      category: 'meals',
      text: 'Ate half a sandwich, feeling dizzy',
      metadata: {
        note: 'Some free text'
      }
    };
    
    const safe = safeLogPayload(raw);
    expect(safe.text).toBe('[REDACTED]');
    expect(safe.metadata.note).toBe('[REDACTED]');
    expect(safe.category).toBe('meals'); // Safe enums kept
  });

  it('OG-02: Intercepts and blocks false medical reassurance', () => {
    const result = filterSpokenOutput("Don't worry, that's normal for his age.", '112');
    expect(result.blocked).toBe(true);
    expect(result.category).toBe('reassurance');
    expect(result.text).toContain("I can't answer that safely");
    expect(result.text).toContain('112');
  });

  it('OG-03: Blocks medical diagnosis assertions', () => {
    const result = filterSpokenOutput("Sounds like you have pneumonia.", '999');
    expect(result.blocked).toBe(true);
    expect(result.category).toBe('diagnosis');
    expect(result.text).toContain("I can't answer that safely");
  });

  it('OG-04: Blocks unauthorized dosing advice', () => {
    const result = filterSpokenOutput("You can take another tablet if the pain persists.", '112');
    expect(result.blocked).toBe(true);
    expect(result.category).toBe('dosing_advice');
    expect(result.text).toContain("I can't answer that safely");
  });

  it('OG-05: Replaces dangerous absence certainty ("not taken" -> "not logged")', () => {
    const result = filterSpokenOutput("Amlodipine was not taken today.", '112');
    expect(result.blocked).toBe(true);
    expect(result.category).toBe('absence_certainty');
    expect(result.text).toBe("Amlodipine was not logged today.");
  });

  it('OG-06: Passes through benign caregiving confirmation', () => {
    const result = filterSpokenOutput("Logged: Metformin, 10 minutes ago, by Priya.", '112');
    expect(result.blocked).toBe(false);
    expect(result.text).toBe("Logged: Metformin, 10 minutes ago, by Priya.");
  });
});
