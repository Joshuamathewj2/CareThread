import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type RedFlagLevel = 'emergency' | 'contact_clinician';

export type RedFlagRule = {
  id: string;
  title?: string;
  name?: string;
  category?: string;
  level: RedFlagLevel;
  keywords?: string[];
  triggers?: string[][];
  negation_tokens?: string[];
  instruction: string;
  followUp?: string;
  source?: string;
  reviewedBy?: string | null;
  reviewedOn?: string | null;
};

// Fallback rules in code to ensure zero dependencies failure
export const DEFAULT_RULES: RedFlagRule[] = [
  {
    id: 'RF-01',
    name: 'Possible stroke signs',
    category: 'mobility',
    level: 'emergency',
    keywords: ['droop', 'slurred', 'slur', 'stroke', 'arm weak', 'face drooping', 'slurd'],
    negation_tokens: ['no', 'without', 'not', 'denies'],
    instruction: 'Call {emergencyNumber} now. These can be signs of a stroke, and time matters.'
  },
  {
    id: 'RF-02',
    name: 'Chest pain or pressure',
    category: 'pain',
    level: 'emergency',
    keywords: ['chest pain', 'tight chest', 'chest pressure', 'heart attack', 'angina', 'pressure in chest'],
    negation_tokens: ['no', 'without', 'not', 'denies'],
    instruction: 'Call {emergencyNumber} now. This can be a sign of a heart attack.'
  },
  {
    id: 'RF-03',
    name: 'Severe breathing difficulty',
    category: 'other',
    level: 'emergency',
    keywords: ["can't breathe", "cannot breathe", "gasping", "blue lips", "struggling to breathe"],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now. Severe breathing difficulty is an emergency.'
  },
  {
    id: 'RF-04',
    name: 'Unresponsive or not breathing',
    category: 'other',
    level: 'emergency',
    keywords: ["won't wake up", "unconscious", "not breathing", "collapsed", "unresponsive"],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now. The person is unresponsive.'
  },
  {
    id: 'RF-05',
    name: 'Severe bleeding',
    category: 'other',
    level: 'emergency',
    keywords: ["bleeding won't stop", "deep cut spurting", "blood everywhere", "severe bleeding", "spurting"],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now for severe uncontrolled bleeding.'
  },
  {
    id: 'RF-06',
    name: 'Choking',
    category: 'other',
    level: 'emergency',
    keywords: ['choking', 'food stuck', "can't swallow and can't speak"],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now. The person is choking.'
  },
  {
    id: 'RF-07',
    name: 'Suspected overdose or poisoning',
    category: 'other',
    level: 'emergency',
    keywords: ['too many tablets', 'swallowed cleaning', 'overdose', 'poison', 'double dose and drowsy', 'took two doses'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} or poison control now. Keep the medication packaging ready.'
  },
  {
    id: 'RF-08',
    name: 'Seizure',
    category: 'other',
    level: 'emergency',
    keywords: ['seizure', 'fitting', 'convulsing', 'seizer', 'shaking and unresponsive'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now. The person is having a seizure.'
  },
  {
    id: 'RF-09',
    name: 'Serious fall',
    category: 'mobility',
    level: 'emergency',
    keywords: ['hit head', 'hit his head', 'hit her head', "can't get up after a fall", "hip pain after a fall"],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now. Suspected serious injury or head trauma from a fall.'
  },
  {
    id: 'RF-10',
    name: 'Severe allergic reaction',
    category: 'other',
    level: 'emergency',
    keywords: ['swollen lips', 'swollen tongue', 'hives and trouble breathing', 'anaphylaxis', 'hives and', 'swelling and she has hives'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now for a severe allergic reaction.'
  },
  {
    id: 'RF-11',
    name: 'Self-harm or suicide statements',
    category: 'other',
    level: 'emergency',
    keywords: ['end my life', 'end it all', 'hurt myself', 'hurting myself', 'suicide'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'If you or someone is in immediate danger, call {emergencyNumber} now. You can also contact a local crisis line.'
  },
  {
    id: 'RF-12',
    name: 'Sudden new confusion',
    category: 'mood',
    level: 'contact_clinician',
    keywords: ['suddenly confused', "doesn't recognize", 'new agitation', 'acute confusion', 'sudden confusion'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Contact {clinician} today about this sudden change in confusion.'
  },
  {
    id: 'RF-13',
    name: 'Reading outside caregiver-set range',
    category: 'other',
    level: 'contact_clinician',
    keywords: ['blood pressure out of range', 'glucose outside range'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Contact {clinician} today regarding readings outside the target range.'
  },
  {
    id: 'RF-14',
    name: 'Missed multiple doses',
    category: 'other',
    level: 'contact_clinician',
    keywords: ['missed multiple doses', 'two doses missed', 'multiple doses missed'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Contact {clinician} or pharmacist today regarding multiple missed doses.'
  },
  {
    id: 'RF-15',
    name: 'Fever with other warning words',
    category: 'other',
    level: 'contact_clinician',
    keywords: ['fever and shivering', 'fever and not drinking', 'high fever'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Contact {clinician} today regarding this persistent fever.'
  }
];

export function loadRedFlagRules(): RedFlagRule[] {
  const jsonPath = join(__dirname, '..', 'data', 'redflags.json');
  if (existsSync(jsonPath)) {
    try {
      const content = readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Fallback to DEFAULT_RULES
    }
  }
  return DEFAULT_RULES;
}

export type RedFlagMatch = {
  ruleId: string;
  level: RedFlagLevel;
  instruction: string;
  matched: string[];
  negated: string[];
} | null;

export function evaluateRedFlags(text: string, customRules?: RedFlagRule[]): RedFlagMatch {
  const rules = customRules || loadRedFlagRules();
  const lowerText = text.toLowerCase();
  const normalizedText = lowerText.replace(/[.,!?]/g, ' ');
  const words = normalizedText.split(/\s+/).filter(w => w.length > 0);

  let highestMatch: RedFlagRule | null = null;
  let highestMatchedTerms: string[] = [];
  let allNegatedTerms: string[] = [];

  for (const rule of rules) {
    let matched = false;
    let currentMatchedTerms: string[] = [];

    // Check trigger lists or keywords
    const keywordsToCheck = rule.keywords || [];
    if (rule.triggers) {
      for (const trigGroup of rule.triggers) {
        // All words in trigger group must be present in the text within a window
        const allPresent = trigGroup.every(term => lowerText.includes(term.toLowerCase()));
        if (allPresent) {
          // Check for negation near any trigger term
          let isNegated = false;
          for (const term of trigGroup) {
            const termIdx = words.findIndex(w => w.includes(term.toLowerCase()));
            if (termIdx > 0) {
              const startIdx = Math.max(0, termIdx - 3);
              const preceding = words.slice(startIdx, termIdx);
              const precedingStr = preceding.join(' ');
              // Check if preceded by ambiguous negation like "not sure if"
              if (precedingStr.includes('not sure') || precedingStr.includes('unsure')) {
                isNegated = false;
              } else if (preceding.some(p => (rule.negation_tokens || ['no', 'without', 'not']).includes(p))) {
                isNegated = true;
                allNegatedTerms.push(term);
                break;
              }
            }
          }
          if (!isNegated) {
            matched = true;
            currentMatchedTerms.push(...trigGroup);
            break;
          }
        }
      }
    }

    if (!matched && keywordsToCheck.length > 0) {
      for (const keyword of keywordsToCheck) {
        const kwLower = keyword.toLowerCase();
        if (lowerText.includes(kwLower)) {
          // Check negation before this keyword
          const kwFirstWord = kwLower.split(/\s+/)[0];
          const kwIdx = words.findIndex(w => w.includes(kwFirstWord));
          let isNegated = false;
          if (kwIdx > 0) {
            const startIdx = Math.max(0, kwIdx - 3);
            const preceding = words.slice(startIdx, kwIdx);
            const precedingStr = preceding.join(' ');
            if (precedingStr.includes('not sure') || precedingStr.includes('unsure')) {
              isNegated = false;
            } else if (preceding.some(p => (rule.negation_tokens || ['no', 'without', 'not']).includes(p))) {
              isNegated = true;
              allNegatedTerms.push(keyword);
            }
          }

          if (!isNegated) {
            matched = true;
            currentMatchedTerms.push(keyword);
            break;
          }
        }
      }
    }

    if (matched) {
      if (!highestMatch || (highestMatch.level === 'contact_clinician' && rule.level === 'emergency')) {
        highestMatch = rule;
        highestMatchedTerms = currentMatchedTerms;
      }
    }
  }

  if (highestMatch) {
    return {
      ruleId: highestMatch.id,
      level: highestMatch.level,
      instruction: highestMatch.instruction,
      matched: highestMatchedTerms,
      negated: Array.from(new Set(allNegatedTerms))
    };
  }

  return null;
}
