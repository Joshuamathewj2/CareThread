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
