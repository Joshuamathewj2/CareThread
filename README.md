# CareThread

**CareThread** is a voice-first, self-hosted MCP server designed to transform an Alexa+ smart speaker into a shared care log for families looking after a vulnerable relative. 

Built for the Amazon Developer Hackathon (Alexa+ Track).

## The Problem
Multiple family members, visiting nurses, and aides often care for a single relative. Hand-written notes are easily lost, text chains get fragmented, and miscommunication about medication—such as double-dosing—can be life-threatening. 

## The Solution
CareThread uses the new Model Context Protocol (MCP) to turn Alexa into the definitive source of truth. By speaking naturally, caregivers can log medications, record observations, check vitals, and generate doctor visit summaries. 
Crucially, **safety is never hallucinated**. CareThread wraps LLM inputs in strict, deterministic rules:
- **Dose Guard**: Warns if a medication is logged twice within a minimum interval or exceeds daily limits.
- **Red-flag Engine**: Deterministically matches symptoms (e.g., chest pain, facial drooping) to emergency protocols and overrides the conversational agent to instruct the caregiver to call emergency services.

## Architecture
- **Backend:** Node LTS, TypeScript, Express, better-sqlite3.
- **MCP Transport:** HTTP with Server-Sent Events (SSE) using the official `@modelcontextprotocol/sdk`.
- **Simulator:** A React/Vite web application that acts as an Alexa client and provides a real-time trace panel for judging.

## Running Locally
Requires Node v20+.

\`\`\`bash
# 1. Install dependencies
cd server
npm install

# 2. Seed the demo database
npm run seed:demo

# 3. Start the MCP server
npm run dev
\`\`\`

In a second terminal:
\`\`\`bash
# 4. Start the simulator
cd simulator
npm install
npm run dev
\`\`\`

Open `http://localhost:5173` to view the simulator and trace panel.

## Architecture Decision Records (ADRs)
See `docs/ADRs/` for technical decisions regarding state, safety, and protocols.

## License
MIT
