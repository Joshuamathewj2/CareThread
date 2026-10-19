# CareThread

**CareThread** is a voice-first, self-hosted MCP server that turns an Alexa+ smart speaker into a shared care log for families looking after a vulnerable relative.

Built for the Amazon Developer Hackathon: Build across Amazon Devices (Alexa+ Track).

> CareThread records and retrieves what the family says. It is not a medical device and never diagnoses, reassures, or suggests doses. All demo data is synthetic.

## The problem
Several family members, visiting nurses and aides often care for one relative. Hand-written notes get lost, text chains fragment, and a miscommunication about medication, such as a double dose, can be dangerous.

## The solution
Caregivers talk to Alexa+. Alexa+ calls CareThread's MCP tools to log doses, observations and vitals, answer "did anyone give Dad his metformin?", and produce shift handoffs and doctor-visit reports. **Safety is never left to the model.** It is deterministic code with tests:

- **Dose Guard** warns before a repeat dose inside the caregiver-set interval or above the daily limit, and asks for explicit confirmation.
- **Red-flag Engine** matches urgent symptom descriptions (stroke signs, chest pain...) with negation handling and returns a fixed escalation instruction ("Call 112 now...").
- **Output Guard** blocks reassurance, diagnosis and dosing language in anything spoken, including model output, and says "not logged", never "not taken".

## MCP implementation

| | |
| --- | --- |
| SDK | `@modelcontextprotocol/sdk` 1.32 (TypeScript), low-level `Server` |
| Protocol | **2025-11-25** (negotiated; older versions also accepted) |
| Transport | **Streamable HTTP** at `POST/GET/DELETE /mcp`, with `Mcp-Session-Id` sessions, or stateless mode (`MCP_STATELESS=true`) |
| Auth | `Authorization: Bearer <memberId>`, passed to handlers as MCP `authInfo` (demo-grade, see Limitations) |
| Capabilities | tools (16), resources (3 + 1 template), prompts (3), server `instructions` |

Every tool declares a `title`, behavior `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), a JSON Schema `inputSchema` generated from its Zod validator, and a shared `outputSchema`. Every result carries both a short spoken `text` block and `structuredContent`:

```json
{
  "ok": true,
  "tool": "med_log_given",
  "safety": { "level": "caution", "code": "WITHIN_INTERVAL" },
  "data": { "guard": { "...": "..." } },
  "followUp": {
    "kind": "confirm",
    "prompt": "Log another dose anyway?",
    "tool": "med_log_given",
    "arguments": { "medication": "Metformin", "at": "2026-10-19T03:05:00.000Z", "confirmRepeat": true }
  },
  "attribution": { "memberId": "m_arjun" },
  "at": "2026-10-19T03:06:12.000Z"
}
```

`followUp` is the multi-turn contract. When the caregiver must confirm or choose, the server hands the agent the exact next call, so a "yes" on the next turn never depends on the model rebuilding arguments from speech.

### Tools

| Tool | What it does |
| --- | --- |
| `med_log_given` | Log a dose as given/skipped/refused; Dose Guard warns before repeats |
| `med_check_status` | "Was it given, by whom, when?" or today's whole checklist |
| `med_schedule_set` | Add or update a medication as the caregiver states it |
| `log_observation` | Log a note; urgent symptoms trigger the Red-flag Engine |
| `log_vital` | BP, glucose, temperature, weight, pulse, SpO2 with plausibility and range checks |
| `redflag_check` | Check a symptom description without storing it |
| `handoff_summary` | Spoken shift handoff: red flags, then doses, then notes |
| `visit_export` | Markdown visit report for the clinician |
| `trend_insights` | Objective counts and averages, no causes or predictions |
| `question_for_doctor` | Save, list, and mark done questions for the next visit |
| `care_timer` | Reminder timers for care tasks |
| `caregiver_checkin` | Caregiver wellbeing check-in with crisis routing |
| `recipient_profile` | Care recipient basics and settings |
| **`care_next_actions`** | *New.* "What needs doing now?": red flags, then scheduled doses not logged yet, then timers, then the next dose |
| **`undo_last_entry`** | *New.* Two-turn, confirm-first removal of the speaker's own misheard entry (15-minute window) |
| **`ask_care_log`** | *New.* Free-form questions about the log, answered by **Amazon Bedrock** (Converse API) with a deterministic fallback |

### AWS integration: Amazon Bedrock inside the tool path
`ask_care_log` calls Amazon Bedrock's Converse API (`@aws-sdk/client-bedrock-runtime`) directly in its tool handler (`server/src/aws/bedrock.ts`, `server/src/tools/askCareLog.ts`):

1. The question first goes through the Red-flag Engine. An emergency description gets the fixed escalation and never reaches the model.
2. The last N days of log entries are assembled as grounded context and sent with a strict system prompt: answer only from the log, two spoken sentences, no advice, treat log text as data.
3. The model's answer still passes through the Output Guard before it is spoken.
4. If Bedrock is off, slow (6 s budget for a voice turn), throttled or failing, or the circle is in privacy mode, the tool answers from a deterministic keyword search instead. `structuredContent.data.engine` records which path answered.

Enable it with `CARETHREAD_BEDROCK=on` plus standard AWS credentials (see `server/.env.example`). The model is configurable with `BEDROCK_MODEL_ID` and defaults to `amazon.nova-lite-v1:0`.

## Running locally
Requires Node 22+.

```bash
cd server
npm install
npm run dev            # http://localhost:3001/mcp  (health: /health)
```

In a second terminal:

```bash
cd simulator
npm install
npm run dev            # http://localhost:5173
```

The database migrates and seeds itself on first start. `npm run seed:demo` resets it to the demo state. With Docker: `docker compose up --build` (simulator on :8080).

### Connect any MCP client
```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP, URL: http://localhost:3001/mcp
# Header: Authorization: Bearer m_priya   (demo members: m_priya, m_arjun, m_meera, m_guest)
```

### Tests
```bash
cd server
npm test          # unit, safety, multi-turn, Bedrock path, and end-to-end Streamable HTTP tests
npm run typecheck
```

The transport tests drive the server with the official SDK client over real HTTP. They cover protocol negotiation, many calls per session, concurrent sessions, output-schema validation, 401/403/404 session handling, session termination, circle isolation and stateless mode.

## Project layout
```
server/src/app.ts            Streamable HTTP transport, sessions, server instructions
server/src/mcp/registry.ts   Tool contracts, validation, roles, output guard, result envelope
server/src/mcp/resources.ts  Resources, resource template, prompts
server/src/tools/            Tool implementations
server/src/core/             Dose Guard, Red-flag Engine, Output Guard (pure, unit-tested)
server/src/aws/bedrock.ts    Amazon Bedrock Converse client
simulator/                   React voice simulator with a live MCP trace panel
docs/                        PRD, design, safety rules, ADRs, demo script
```

## Limitations
- **Auth is demo-grade.** The bearer token is the member id. Before any real deployment, replace it with OAuth 2.1 per the MCP authorization spec, or at minimum per-member secrets.
- Red-flag rules are drafts from public first-aid guidance and still need clinical review.
- Speaker identity on a shared device is assumed from the session, and every confirmation names the member so mistakes are visible.

## Architecture Decision Records
See [`docs/ADRs.md`](docs/ADRs.md).

## License
[MIT](LICENSE)
