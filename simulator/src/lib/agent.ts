import { mcpClient } from './mcpClient';

export type AgentReply = { text: string; safety?: { level: string; code: string | null } };

type FollowUp = { kind: 'confirm' | 'choose' | 'clarify'; prompt: string; tool?: string; arguments?: Record<string, unknown>; choices?: string[] };

// The server's followUp contract: a pending confirmation or choice carries the exact next tool call.
let pendingFollowUp: FollowUp | null = null;
let pendingFor: string | null = null;

async function run(name: string, args: Record<string, unknown>): Promise<AgentReply> {
  const result: any = await mcpClient.callTool(name, args);
  const sc = result.structuredContent;
  pendingFollowUp = sc?.followUp?.tool ? sc.followUp : null;
  return { text: result.content?.[0]?.text ?? '', safety: sc?.safety };
}

const YES = /\b(yes|yeah|yep|sure|confirm|do it|go ahead|anyway|correct)\b/;
const NO = /\b(no|nope|cancel|don't|do not|stop)\b/;

async function resolveFollowUp(lower: string): Promise<AgentReply | null> {
  const followUp = pendingFollowUp;
  if (!followUp?.tool) return null;

  if (followUp.kind === 'choose' && followUp.choices) {
    const choice = followUp.choices.find(c => lower.includes(c.toLowerCase()));
    if (!choice) return null;
    const args = Object.fromEntries(Object.entries(followUp.arguments ?? {}).map(([k, v]) => [k, v === '{choice}' ? choice : v]));
    return run(followUp.tool, args);
  }

  if (followUp.kind === 'confirm') {
    if (YES.test(lower)) return run(followUp.tool, followUp.arguments ?? {});
    if (NO.test(lower)) {
      pendingFollowUp = null;
      return { text: "Okay, I left the log as it is." };
    }
  }
  return null;
}

// Rule-based stand-in for the Alexa+ agent, routing caregiver speech to MCP tools
export async function handleUserVoice(text: string, memberId: string): Promise<AgentReply> {
  await mcpClient.connect(memberId);
  // A confirmation belongs to the caregiver who was asked
  if (pendingFor !== memberId) pendingFollowUp = null;
  pendingFor = memberId;
  const lower = text.toLowerCase();

  // 0. Answer to a pending confirmation or choice from the previous turn
  const followed = await resolveFollowUp(lower);
  if (followed) return followed;
  pendingFollowUp = null;

  // Undo a misheard entry (preview first; the server asks for confirmation)
  if (/\b(undo|scratch that|delete that|remove that|that's wrong)\b/.test(lower)) {
    return run('undo_last_entry', {});
  }

  // What needs doing now
  if (/(what('s| is) (next|due)|what does (he|she|dad|mom) need|anything due|what needs doing)/.test(lower)) {
    return run('care_next_actions', {});
  }

  // Free-form questions about the past go to ask_care_log (Amazon Bedrock when enabled)
  if (/^(when did|when was|how many times|how often|has (he|she|dad|mom) been|what did .* (eat|say)|ask the log)/.test(lower)) {
    return run('ask_care_log', { question: text });
  }

  // 1. Red-Flag Symptom Evaluation (Stateless Escalation)
  const redFlagKeywords = [
    'stroke', 'droop', 'slurred', 'chest pain', 'tight chest', 'cannot breathe',
    "can't breathe", 'unconscious', 'collapsed', 'choking', 'seizure', 'fell and hit',
    'hit his head', 'anaphylaxis', 'swollen lips', 'serious', 'emergency', 'is this bad',
    'fever', 'shivering', 'bleeding'
  ];
  if (redFlagKeywords.some(k => lower.includes(k)) && (lower.includes('is this') || lower.includes('worry') || lower.includes('serious') || lower.includes('notice') || lower.includes('started'))) {
    return run('redflag_check', {
      description: text
    });
  }

  // 2. Medication Administration Logging
  if (lower.includes('gave') || lower.includes('given') || lower.includes('took') || lower.includes('take') || lower.includes('administered')) {
    let med = 'Metformin';
    if (lower.includes('amlodipine')) med = 'Amlodipine';
    if (lower.includes('atorvastatin')) med = 'Atorvastatin';
    if (lower.includes('vitamin d')) med = 'Vitamin D';
    if (lower.includes('paracetamol')) med = 'Paracetamol';

    const status = lower.includes('skipped') ? 'skipped' : lower.includes('refused') ? 'refused' : 'given';

    return run('med_log_given', {
      medication: med,
      status
    });
  }

  // 3. Medication Status Check (Single drug or entire checklist)
  if (lower.includes('did anyone give') || lower.includes('has he had') || lower.includes('was it given') || lower.includes('check medication') || lower.includes('checklist')) {
    let med: string | undefined = undefined;
    if (lower.includes('metformin')) med = 'Metformin';
    if (lower.includes('amlodipine')) med = 'Amlodipine';
    if (lower.includes('atorvastatin')) med = 'Atorvastatin';

    return run('med_check_status', med ? { medication: med } : {});
  }

  // 4. Vital Signs Logging
  if (lower.includes('blood pressure') || lower.includes('bp') || lower.includes('glucose') || lower.includes('sugar') || lower.includes('temperature') || lower.includes('spo2') || lower.includes('pulse')) {
    if (lower.includes('blood pressure') || lower.includes('bp')) {
      const match = text.match(/(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/);
      const sys = match ? parseInt(match[1]) : 120;
      const dia = match ? parseInt(match[2]) : 80;
      return run('log_vital', {
        kind: 'bp',
        value: sys,
        value2: dia,
        unit: 'mmHg'
      });
    }

    if (lower.includes('glucose') || lower.includes('sugar')) {
      const match = text.match(/(\d{2,3})/);
      const val = match ? parseInt(match[1]) : 110;
      return run('log_vital', {
        kind: 'glucose',
        value: val,
        unit: 'mg/dL'
      });
    }

    if (lower.includes('temp')) {
      const match = text.match(/(\d{2,3}(?:\.\d)?)/);
      const val = match ? parseFloat(match[1]) : 37;
      return run('log_vital', {
        kind: 'temperature',
        value: val,
        unit: 'C'
      });
    }
  }

  // 5. Questions for the Doctor
  if (lower.includes('ask doctor') || lower.includes('ask the doctor') || lower.includes('question for doctor') || lower.includes('doctor list')) {
    if (lower.includes('list') || lower.includes('what are') || lower.includes('show')) {
      return run('question_for_doctor', { action: 'list' });
    }
    const cleanText = text.replace(/^(please\s+)?(ask\s+(the\s+)?doctor|save\s+(a\s+)?question\s+for\s+(the\s+)?doctor)\s*(about|that|:)?/i, '').trim();
    return run('question_for_doctor', {
      action: 'add',
      text: cleanText || text
    });
  }

  // 6. Care Timers
  if (lower.includes('timer')) {
    if (lower.includes('cancel')) {
      return run('care_timer', { action: 'cancel', name: 'Care Task' });
    }
    if (lower.includes('check') || lower.includes('how long')) {
      return run('care_timer', { action: 'check', name: 'Care Task' });
    }
    const match = text.match(/(\d+)\s*minute/i);
    const mins = match ? parseInt(match[1]) : 30;
    return run('care_timer', {
      action: 'start',
      name: 'Care Task',
      minutes: mins
    });
  }

  // 7. Caregiver Wellness Check-in
  if (lower.includes('check-in') || lower.includes('check in') || lower.includes('stressed') || lower.includes('exhausted') || lower.includes('burnout')) {
    return run('caregiver_checkin', {
      stressLevel: lower.includes('high') || lower.includes('exhausted') ? 4 : 2,
      restedLevel: lower.includes('exhausted') ? 2 : 4,
      notes: text
    });
  }

  // 8. Handoff Summary
  if (lower.includes('summary') || lower.includes('what happened') || lower.includes('handoff')) {
    return run('handoff_summary', { window: 'today' });
  }

  // 9. Clinical Visit Export
  if (lower.includes('doctor visit') || lower.includes('export') || lower.includes('clinical report')) {
    return run('visit_export', { daysBack: 14 });
  }

  // 10. Trend Insights
  if (lower.includes('trend') || lower.includes('pattern') || lower.includes('average')) {
    return run('trend_insights', { kind: 'bp', days: 7 });
  }

  // 11. Observations / General Notes (Evaluated with Red Flag engine automatically)
  let cat: 'meals' | 'mood' | 'mobility' | 'pain' | 'sleep' | 'bathroom' | 'other' = 'other';
  if (lower.includes('lunch') || lower.includes('ate') || lower.includes('meal') || lower.includes('breakfast') || lower.includes('dinner')) cat = 'meals';
  else if (lower.includes('mood') || lower.includes('happy') || lower.includes('confused') || lower.includes('agitated')) cat = 'mood';
  else if (lower.includes('walk') || lower.includes('mobility') || lower.includes('fell') || lower.includes('stumbled')) cat = 'mobility';
  else if (lower.includes('pain') || lower.includes('ache') || lower.includes('hurt')) cat = 'pain';
  else if (lower.includes('sleep') || lower.includes('nap') || lower.includes('tired')) cat = 'sleep';

  return run('log_observation', {
    category: cat,
    text
  });
}
