import { mcpClient } from './mcpClient';

// Smart rule-based voice agent routing caregiver natural speech to MCP tools
export async function handleUserVoice(text: string, memberId: string): Promise<string> {
  await mcpClient.connect(memberId);
  const lower = text.toLowerCase();

  // 1. Red-Flag Symptom Evaluation (Stateless Escalation)
  const redFlagKeywords = [
    'stroke', 'droop', 'slurred', 'chest pain', 'tight chest', 'cannot breathe',
    "can't breathe", 'unconscious', 'collapsed', 'choking', 'seizure', 'fell and hit',
    'hit his head', 'anaphylaxis', 'swollen lips', 'serious', 'emergency', 'is this bad',
    'fever', 'shivering', 'bleeding'
  ];
  if (redFlagKeywords.some(k => lower.includes(k)) && (lower.includes('is this') || lower.includes('worry') || lower.includes('serious') || lower.includes('notice') || lower.includes('started'))) {
    const res = await mcpClient.callTool('redflag_check', {
      description: text
    });
    return (res.content as any)[0].text;
  }

  // 2. Medication Administration Logging
  if (lower.includes('gave') || lower.includes('given') || lower.includes('took') || lower.includes('take') || lower.includes('administered')) {
    let med = 'Metformin';
    if (lower.includes('amlodipine')) med = 'Amlodipine';
    if (lower.includes('atorvastatin')) med = 'Atorvastatin';
    if (lower.includes('vitamin d')) med = 'Vitamin D';
    if (lower.includes('paracetamol')) med = 'Paracetamol';

    const confirm = lower.includes('anyway') || lower.includes('actually') || lower.includes('yes') || lower.includes('override');
    const status = lower.includes('skipped') ? 'skipped' : lower.includes('refused') ? 'refused' : 'given';

    const result = await mcpClient.callTool('med_log_given', {
      medication: med,
      status,
      confirmRepeat: confirm
    });
    return (result.content as any)[0].text;
  }

  // 3. Medication Status Check (Single drug or entire checklist)
  if (lower.includes('did anyone give') || lower.includes('has he had') || lower.includes('was it given') || lower.includes('check medication') || lower.includes('checklist')) {
    let med: string | undefined = undefined;
    if (lower.includes('metformin')) med = 'Metformin';
    if (lower.includes('amlodipine')) med = 'Amlodipine';
    if (lower.includes('atorvastatin')) med = 'Atorvastatin';

    const result = await mcpClient.callTool('med_check_status', med ? { medication: med } : {});
    return (result.content as any)[0].text;
  }

  // 4. Vital Signs Logging
  if (lower.includes('blood pressure') || lower.includes('bp') || lower.includes('glucose') || lower.includes('sugar') || lower.includes('temperature') || lower.includes('spo2') || lower.includes('pulse')) {
    if (lower.includes('blood pressure') || lower.includes('bp')) {
      const match = text.match(/(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/);
      const sys = match ? parseInt(match[1]) : 120;
      const dia = match ? parseInt(match[2]) : 80;
      const res = await mcpClient.callTool('log_vital', {
        kind: 'bp',
        value: sys,
        value2: dia,
        unit: 'mmHg'
      });
      return (res.content as any)[0].text;
    }

    if (lower.includes('glucose') || lower.includes('sugar')) {
      const match = text.match(/(\d{2,3})/);
      const val = match ? parseInt(match[1]) : 110;
      const res = await mcpClient.callTool('log_vital', {
        kind: 'glucose',
        value: val,
        unit: 'mg/dL'
      });
      return (res.content as any)[0].text;
    }

    if (lower.includes('temp')) {
      const match = text.match(/(\d{2,3}(?:\.\d)?)/);
      const val = match ? parseFloat(match[1]) : 37;
      const res = await mcpClient.callTool('log_vital', {
        kind: 'temperature',
        value: val,
        unit: 'C'
      });
      return (res.content as any)[0].text;
    }
  }

  // 5. Questions for the Doctor
  if (lower.includes('ask doctor') || lower.includes('ask the doctor') || lower.includes('question for doctor') || lower.includes('doctor list')) {
    if (lower.includes('list') || lower.includes('what are') || lower.includes('show')) {
      const res = await mcpClient.callTool('question_for_doctor', { action: 'list' });
      return (res.content as any)[0].text;
    }
    const cleanText = text.replace(/^(please\s+)?(ask\s+(the\s+)?doctor|save\s+(a\s+)?question\s+for\s+(the\s+)?doctor)\s*(about|that|:)?/i, '').trim();
    const res = await mcpClient.callTool('question_for_doctor', {
      action: 'add',
      text: cleanText || text
    });
    return (res.content as any)[0].text;
  }

  // 6. Care Timers
  if (lower.includes('timer')) {
    if (lower.includes('cancel')) {
      const res = await mcpClient.callTool('care_timer', { action: 'cancel', name: 'check' });
      return (res.content as any)[0].text;
    }
    if (lower.includes('check') || lower.includes('how long')) {
      const res = await mcpClient.callTool('care_timer', { action: 'check', name: 'check' });
      return (res.content as any)[0].text;
    }
    const match = text.match(/(\d+)\s*minute/i);
    const mins = match ? parseInt(match[1]) : 30;
    const res = await mcpClient.callTool('care_timer', {
      action: 'start',
      name: 'Care Task',
      minutes: mins
    });
    return (res.content as any)[0].text;
  }

  // 7. Caregiver Wellness Check-in
  if (lower.includes('check-in') || lower.includes('check in') || lower.includes('stressed') || lower.includes('exhausted') || lower.includes('burnout')) {
    const res = await mcpClient.callTool('caregiver_checkin', {
      stressLevel: lower.includes('high') || lower.includes('exhausted') ? 4 : 2,
      restedLevel: lower.includes('exhausted') ? 2 : 4,
      notes: text
    });
    return (res.content as any)[0].text;
  }

  // 8. Handoff Summary
  if (lower.includes('summary') || lower.includes('what happened') || lower.includes('handoff')) {
    const result = await mcpClient.callTool('handoff_summary', { window: 'today' });
    return (result.content as any)[0].text;
  }

  // 9. Clinical Visit Export
  if (lower.includes('doctor visit') || lower.includes('export') || lower.includes('clinical report')) {
    const result = await mcpClient.callTool('visit_export', { daysBack: 14 });
    return (result.content as any)[0].text;
  }

  // 10. Trend Insights
  if (lower.includes('trend') || lower.includes('pattern') || lower.includes('average')) {
    const result = await mcpClient.callTool('trend_insights', { kind: 'bp', days: 7 });
    return (result.content as any)[0].text;
  }

  // 11. Observations / General Notes (Evaluated with Red Flag engine automatically)
  let cat: 'meals' | 'mood' | 'mobility' | 'pain' | 'sleep' | 'bathroom' | 'other' = 'other';
  if (lower.includes('lunch') || lower.includes('ate') || lower.includes('meal') || lower.includes('breakfast') || lower.includes('dinner')) cat = 'meals';
  else if (lower.includes('mood') || lower.includes('happy') || lower.includes('confused') || lower.includes('agitated')) cat = 'mood';
  else if (lower.includes('walk') || lower.includes('mobility') || lower.includes('fell') || lower.includes('stumbled')) cat = 'mobility';
  else if (lower.includes('pain') || lower.includes('ache') || lower.includes('hurt')) cat = 'pain';
  else if (lower.includes('sleep') || lower.includes('nap') || lower.includes('tired')) cat = 'sleep';

  const result = await mcpClient.callTool('log_observation', {
    category: cat,
    text
  });
  return (result.content as any)[0].text;
}
