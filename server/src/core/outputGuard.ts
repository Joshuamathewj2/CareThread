// Output Guard specification:
// 1. Prevents sensitive health text from leaking into system logs (safeLogPayload)
// 2. Intercepts forbidden medical reassurance, diagnosis, and unauthorized dosing advice (filterSpokenOutput)

export const FORBIDDEN_REASSURANCE_PATTERNS = [
  /\bthat'?s normal\b/i,
  /\bnothing to worry about\b/i,
  /\bshould be fine\b/i,
  /\bnot serious\b/i,
  /\bno need to call\b/i,
  /\bdon'?t worry\b/i,
  /\bit'?s probably nothing\b/i
];

export const FORBIDDEN_DIAGNOSIS_PATTERNS = [
  /\bsounds like you have\b/i,
  /\byou probably have\b/i,
  /\bthis is a sign of(?!\s*(a stroke|a heart attack|strokes))\b/i
];

export const FORBIDDEN_DOSING_ADVICE_PATTERNS = [
  /\byou can take\b/i,
  /\bgive him\b/i,
  /\bgive her\b/i,
  /\bsafe to take\b/i,
  /\bincrease the dose\b/i,
  /\bskip the dose\b/i,
  /\bhalf a tablet\b/i,
  /\btake another tablet\b/i
];

export const FORBIDDEN_ABSENCE_PATTERNS = [
  /\bnot taken\b/i,
  /\bnever given\b/i,
  /\bno one gave\b/i
];

export interface SpokenGuardResult {
  blocked: boolean;
  text: string;
  category?: 'reassurance' | 'diagnosis' | 'dosing_advice' | 'absence_certainty';
}

export function filterSpokenOutput(text: string, emergencyNumber: string = '112'): SpokenGuardResult {
  for (const pattern of FORBIDDEN_REASSURANCE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked: true,
        category: 'reassurance',
        text: `I can't answer that safely. If you are worried, contact the doctor, or call ${emergencyNumber} if it is urgent.`
      };
    }
  }

  for (const pattern of FORBIDDEN_DIAGNOSIS_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked: true,
        category: 'diagnosis',
        text: `I can't answer that safely. If you are worried, contact the doctor, or call ${emergencyNumber} if it is urgent.`
      };
    }
  }

  for (const pattern of FORBIDDEN_DOSING_ADVICE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked: true,
        category: 'dosing_advice',
        text: `I can't answer that safely. If you are worried, contact the doctor, or call ${emergencyNumber} if it is urgent.`
      };
    }
  }

  for (const pattern of FORBIDDEN_ABSENCE_PATTERNS) {
    if (pattern.test(text)) {
      // Substitute safe "not logged" phrasing
      return {
        blocked: true,
        category: 'absence_certainty',
        text: text.replace(/\bnot taken\b/gi, 'not logged').replace(/\bnever given\b/gi, 'never logged')
      };
    }
  }

  return { blocked: false, text };
}

// Output Guard prevents sensitive health text from leaking into system logs
export function safeLogPayload(payload: any): any {
  if (typeof payload !== 'object' || payload === null) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(safeLogPayload);
  }

  const safe: any = {};
  for (const key of Object.keys(payload)) {
    // Forbidden fields that contain free-text PHI
    if (['text', 'note', 'answers', 'answers_json', 'symptoms'].includes(key)) {
      safe[key] = '[REDACTED]';
    } else {
      safe[key] = safeLogPayload(payload[key]);
    }
  }
  return safe;
}
