import { ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { db } from '../db/index.js';

export function attachResourcesAndPrompts(server: Server) {
  // --- Resources ---
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
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
    if (request.params.uri === 'carethread://current-medications') {
      const meds = db.prepare(`SELECT * FROM medications WHERE active = 1`).all();
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(meds, null, 2)
        }]
      };
    }
    
    if (request.params.uri === 'carethread://active-redflags') {
      const since = new Date(Date.now() - 24 * 3600000).toISOString();
      const rf = db.prepare(`SELECT * FROM redflag_events WHERE at >= ?`).all(since);
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(rf, null, 2)
        }]
      };
    }

    throw new Error(`Resource not found: ${request.params.uri}`);
  });

  // --- Prompts ---
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'daily_summary',
          description: 'Generate a prompt to summarize the day for a family member',
          arguments: [
            { name: 'role', description: 'The role of the person asking (e.g. primary, viewer)', required: true }
          ]
        }
      ]
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name === 'daily_summary') {
      return {
        description: 'Daily Summary generation prompt',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are CareThread. Please summarize today's events for a ${request.params.arguments?.role || 'caregiver'}. Focus on medication adherence and any red flags.`
            }
          }
        ]
      };
    }

    throw new Error(`Prompt not found: ${request.params.name}`);
  });
}
