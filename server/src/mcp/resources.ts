import { ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { db } from '../db/index.js';
import { DateTime } from 'luxon';

export function attachResourcesAndPrompts(server: Server) {
  // --- Resources ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'carethread://circle/c_1/log/today',
          name: "Today's Care Timeline",
          description: "Today's live caregiver activity timeline as structured JSON",
          mimeType: 'application/json'
        },
        {
          uri: 'carethread://current-medications',
          name: 'Current Medications',
          description: 'A live view of all active medications for the circle',
          mimeType: 'application/json'
        },
        {
          uri: 'carethread://active-redflags',
          name: 'Active Red Flags',
          description: 'Recent emergency escalations in the last 24h',
          mimeType: 'application/json'
        }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    // Today's timeline for circle
    if (uri.startsWith('carethread://circle/') && uri.endsWith('/log/today')) {
      const parts = uri.replace('carethread://circle/', '').split('/');
      const circleId = parts[0] || 'c_1';
      const circle = db.prepare(`SELECT timezone FROM care_circles WHERE id = ?`).get(circleId) as { timezone?: string } | undefined;
      const tz = circle?.timezone || 'UTC';
      const startOfDay = DateTime.now().setZone(tz).startOf('day').toUTC().toISO()!;

      // Combine doses, observations, vitals, redflags
      const doses = db.prepare(`
        SELECT e.id, 'dose' as type, e.status, e.event_at as at, m.name as title, mem.display_name as member, e.note
        FROM med_events e
        JOIN medications m ON e.medication_id = m.id
        JOIN members mem ON e.member_id = mem.id
        WHERE m.circle_id = ? AND e.event_at >= ?
        ORDER BY e.event_at DESC
      `).all(circleId, startOfDay);

      const obs = db.prepare(`
        SELECT o.id, 'observation' as type, o.category, o.recorded_at as at, o.text as title, mem.display_name as member, o.severity
        FROM observations o
        JOIN members mem ON o.member_id = mem.id
        WHERE o.circle_id = ? AND o.recorded_at >= ?
        ORDER BY o.recorded_at DESC
      `).all(circleId, startOfDay);

      const vitals = db.prepare(`
        SELECT v.id, 'vital' as type, v.kind, v.recorded_at as at, (v.kind || ': ' || v.value || ' ' || v.unit) as title, mem.display_name as member, v.in_range
        FROM vitals v
        JOIN members mem ON v.member_id = mem.id
        WHERE v.circle_id = ? AND v.recorded_at >= ?
        ORDER BY v.recorded_at DESC
      `).all(circleId, startOfDay);

      const timeline = [...doses, ...obs, ...vitals].sort((a: any, b: any) => 
        new Date(b.at).getTime() - new Date(a.at).getTime()
      );

      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(timeline, null, 2)
        }]
      };
    }

    if (uri === 'carethread://current-medications') {
      const meds = db.prepare(`SELECT * FROM medications WHERE active = 1`).all();
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(meds, null, 2)
        }]
      };
    }
    
    if (uri === 'carethread://active-redflags') {
      const since = new Date(Date.now() - 24 * 3600000).toISOString();
      const rf = db.prepare(`SELECT * FROM redflag_events WHERE at >= ?`).all(since);
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(rf, null, 2)
        }]
      };
    }

    throw new Error(`Resource not found: ${uri}`);
  });

  // --- Prompts ---
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'handoff_template',
          description: 'Spoken caregiver shift handoff template (red flags -> doses/unlogged -> observations)',
          arguments: [
            { name: 'window', description: 'Time window (last_shift, today, last_24h)', required: false }
          ]
        },
        {
          name: 'visit_report_template',
          description: 'Clinical visit export markdown outline for clinician review',
          arguments: [
            { name: 'recipientName', description: 'Name of the care recipient', required: true }
          ]
        },
        {
          name: 'daily_summary',
          description: 'Summarize today\'s care events for a circle member',
          arguments: [
            { name: 'role', description: 'The role of the asking member (e.g. primary, viewer)', required: true }
          ]
        }
      ]
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name === 'handoff_template') {
      return {
        description: 'Spoken Caregiver Handoff Order',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: 'Deliver a concise 3-sentence caregiver handoff. Structure strictly in order: 1) Any red flags or clinical escalations, 2) Doses given and any scheduled doses not logged, 3) Observations, meals, moods, and questions saved for the doctor.'
          }
        }]
      };
    }

    if (request.params.name === 'visit_report_template') {
      return {
        description: 'Clinician Visit Export Template',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Generate a structured markdown clinical visit report for ${request.params.arguments?.recipientName || 'the patient'}. Include sections: 1. Active Medications, 2. Dose Adherence Log, 3. Vitals with Range Flags, 4. Observations by Day, 5. Red-Flag Events, 6. Questions for the Doctor.`
          }
        }]
      };
    }

    if (request.params.name === 'daily_summary') {
      return {
        description: 'Daily Summary generation prompt',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `You are CareThread. Please summarize today's events for a ${request.params.arguments?.role || 'caregiver'}. Focus on medication adherence and any red flags.`
          }
        }]
      };
    }

    throw new Error(`Prompt not found: ${request.params.name}`);
  });
}
