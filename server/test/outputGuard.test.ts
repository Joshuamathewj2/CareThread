import { describe, it, expect } from 'vitest';
import { safeLogPayload } from '../src/core/outputGuard.js';

describe('Output Guard (S-03)', () => {
  it('OG-01: Redacts forbidden keys', () => {
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
});
