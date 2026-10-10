import { mcpClient } from './mcpClient';

// A simple scripted agent replacing Bedrock for the hackathon MVP demo
export async function handleUserVoice(text: string, memberId: string): Promise<string> {
  await mcpClient.connect(memberId);
  
  const lower = text.toLowerCase();
  
  // 1. med_log_given
  if (lower.includes('gave') || lower.includes('given') || lower.includes('took')) {
    let med = 'Unknown';
    if (lower.includes('metformin')) med = 'Metformin';
    if (lower.includes('amlodipine')) med = 'Amlodipine';
    
    // Check for idempotency test "actually I gave it"
    const confirm = lower.includes('anyway') || lower.includes('actually');
    
    const result = await mcpClient.callTool('med_log_given', {
      medication: med,
      status: 'given',
      confirmRepeat: confirm
    });
    return (result.content as any)[0].text;
  }
  
  // 2. med_check_status
  if (lower.includes('did anyone give') || lower.includes('has he had')) {
    let med = 'Unknown';
    if (lower.includes('metformin')) med = 'Metformin';
    if (lower.includes('amlodipine')) med = 'Amlodipine';
    
    const result = await mcpClient.callTool('med_check_status', {
      medication: med
    });
    return (result.content as any)[0].text;
  }
  
  // 3. log_observation
  if (lower.includes('note that') || lower.includes('he is') || lower.includes('complaining')) {
    let cat = 'other';
    if (lower.includes('lunch') || lower.includes('ate')) cat = 'meals';
    
    const result = await mcpClient.callTool('log_observation', {
      category: cat,
      text: text
    });
    return (result.content as any)[0].text;
  }
  
  // 4. handoff_summary
  if (lower.includes('summary') || lower.includes('what happened')) {
    const result = await mcpClient.callTool('handoff_summary', {});
    return (result.content as any)[0].text;
  }
  
  // 5. visit_export
  if (lower.includes('doctor visit') || lower.includes('export')) {
    const result = await mcpClient.callTool('visit_export', { daysBack: 7 });
    return (result.content as any)[0].text;
  }
  
  return "I'm sorry, I didn't understand that command for the demo.";
}
