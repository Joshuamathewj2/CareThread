export type RedFlagLevel = 'emergency' | 'contact_clinician';

export type RedFlagRule = {
  id: string;
  name: string;
  category: string;
  level: RedFlagLevel;
  keywords: string[];
  negation_tokens: string[];
  instruction: string;
};

// Hardcoded for MVP based on safety spec
export const DEFAULT_RULES: RedFlagRule[] = [
  {
    id: 'RF-01',
    name: 'Chest Pain',
    category: 'pain',
    level: 'emergency',
    keywords: ['chest', 'heart', 'angina'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now. This can be a sign of a heart attack.'
  },
  {
    id: 'RF-02',
    name: 'Face drooping / Weakness',
    category: 'mobility',
    level: 'emergency',
    keywords: ['droop', 'weak', 'slur', 'stroke'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Call {emergencyNumber} now. These can be signs of a stroke.'
  },
  {
    id: 'RF-03',
    name: 'Severe bleeding',
    category: 'other',
    level: 'emergency',
    keywords: ['bleed', 'blood', 'hemorrhage'],
    negation_tokens: ['no', 'without', 'not', 'stop'],
    instruction: 'Call {emergencyNumber} now for severe bleeding.'
  },
  {
    id: 'RF-04',
    name: 'Fever',
    category: 'other',
    level: 'contact_clinician',
    keywords: ['fever', 'temperature', 'hot'],
    negation_tokens: ['no', 'without', 'not'],
    instruction: 'Please contact the clinician today regarding the fever.'
  }
];

export type RedFlagMatch = {
  ruleId: string;
  level: RedFlagLevel;
  instruction: string;
} | null;

export function evaluateRedFlags(text: string, rules: RedFlagRule[] = DEFAULT_RULES): RedFlagMatch {
  const normalizedText = text.toLowerCase().replace(/[.,!?]/g, ' ');
  const words = normalizedText.split(/\s+/).filter(w => w.length > 0);

  let highestMatch: RedFlagRule | null = null;

  for (const rule of rules) {
    let matched = false;
    for (const keyword of rule.keywords) {
      // Find all occurrences of the keyword
      // Keyword might be a sub-word or multi-word, but for MVP we match tokens
      const keywordTokens = keyword.toLowerCase().split(/\s+/);
      
      for (let i = 0; i <= words.length - keywordTokens.length; i++) {
        // Check if keyword matches at position i
        let isMatch = true;
        for (let j = 0; j < keywordTokens.length; j++) {
          if (!words[i + j].includes(keywordTokens[j])) {
            isMatch = false;
            break;
          }
        }

        if (isMatch) {
          // Look back up to 3 words for negation
          const startIdx = Math.max(0, i - 3);
          const precedingWords = words.slice(startIdx, i);
          
          let isNegated = false;
          for (const neg of rule.negation_tokens) {
            if (precedingWords.includes(neg.toLowerCase().trim())) {
              isNegated = true;
              break;
            }
          }

          if (!isNegated) {
            matched = true;
            break;
          }
        }
      }
      if (matched) break;
    }

    if (matched) {
      if (!highestMatch || highestMatch.level === 'contact_clinician' && rule.level === 'emergency') {
        highestMatch = rule;
      }
    }
  }

  if (highestMatch) {
    return {
      ruleId: highestMatch.id,
      level: highestMatch.level,
      instruction: highestMatch.instruction
    };
  }

  return null;
}
