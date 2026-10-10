# CareThread: Tech Stack and Architecture

Amazon Developer Hackathon · Alexa+ Track · Draft v1

## 1. Principles

- The repo must call the track technology in code: an MCP SDK import, a Streamable HTTP entry point and a loaded tool registry.
- One server, two clients: the same MCP server is used by Alexa+ and by our web simulator.
- Deterministic core: dose-interval checks, range checks and red-flag rules are plain tested functions, not model output. The model may phrase things, it never decides safety.
- Fail toward caution: if the system cannot be sure, it says so and sends the person to the family or the clinician.
- Boring where possible, ambitious only where it earns points.

## 2. Architecture

```
[Alexa+ (Preview)]        [Web Simulator: React + Web Speech]
        |                          |
        |                  [Sim API route: agent loop]
        |                          |  (Amazon Bedrock Converse + tool use)
        +------------+-------------+
                     |  MCP over Streamable HTTP (POST/GET /mcp)
              [CareThread MCP Server: Node + TypeScript]
               |            |              |             |
        [Dose guard]  [Red-flag rules] [Care log    ] [Report builder]
                                       [& trends    ]
                                           |
                                  [SQLite / DynamoDB]
```

## 3. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript on a current Node LTS | Official MCP SDK is TypeScript-first, strong typing for tool schemas |
| MCP | @modelcontextprotocol/sdk, StreamableHTTPServerTransport | Meets the Streamable HTTP requirement. Confirm the installed version supports spec 2025-11-25 |
| Validation | Zod | Tool input schemas and runtime checks in one place |
| HTTP | Express (or Hono) | Simple, well documented with the SDK |
| Storage | SQLite via better-sqlite3 for local and demo, repository interface so DynamoDB can replace it | Zero setup now, serverless later |
| Time handling | Luxon (or date-fns-tz), all times stored in UTC with the circle's time zone | Correct "two hours ago" and midnight edge cases for dose logic |
| Simulator UI | Vite, React, Tailwind CSS | Fast to build, matches the design tokens |
| Speech in simulator | Web Speech API (SpeechRecognition and speechSynthesis) | No cost, no keys, works in Chrome |
| Agent in simulator | Amazon Bedrock (Converse API with tool use, an Amazon Nova model) acting as an MCP client | Keeps the Amazon story consistent. Verify model access in your region |
| Testing | Vitest, MCP Inspector, supertest | Unit tests for dose and red-flag logic, protocol checks for the server |
| CI | GitHub Actions | Lint, test and build on each push |
| Hosting | Container on AWS App Runner or ECS Fargate behind HTTPS | Public endpoint needed for a remote MCP server |

## 4. MCP server design

- Endpoint: a single path, for example /mcp, supporting POST and GET as required by Streamable HTTP.
- Sessions: start stateless for simplicity and add session IDs only if a feature needs them. Identity of the speaker comes from the auth token or a spoken member name, never from session memory.
- Tools: registered from one registry file so the README, tests and server all read the same list.
- Tool annotations: mark status, summary and export tools as read-only, and log writes as non-destructive. Nothing in the server deletes care data except an explicit, confirmed delete tool.
- Results: short, voice-ready text in content, plus structured data (member, timestamp, rule fired) for the simulator.
- Errors: return clear tool errors with a spoken-friendly message, never stack traces.
- Resources: the care log exposed as readable resources. Prompts: a visit report template.
- Safety ordering: the red-flag check runs on every observation text before it is stored, and its result is returned first in the response.

Tool registration sketch

```ts
server.registerTool(
  'med_check_status',
  {
    title: 'Medication status check',
    description: 'Say whether a medication was already given, by whom and when, and whether the caregiver-set minimum interval has passed',
    inputSchema: { medication: z.string().max(80) },
    annotations: { readOnlyHint: true }
  },
  async ({ medication }, ctx) => {
    const status = doseStatus(repo, ctx.circleId, medication, clock.now())
    return {
      content: [{ type: 'text', text: speak(status) }],
      structuredContent: status
    }
  }
)
```

Check the exact registration API against the SDK version you install.

Dose guard rules (all deterministic and unit tested)

- The interval comes only from the caregiver-entered schedule. If none is set, the answer is "no interval is set, check the label or the pharmacist".
- If the last "given" event is inside the interval, return a caution naming who and when.
- If two events are within a few seconds of each other (two siblings speaking at once), flag a possible duplicate.
- If the logged history is incomplete (nothing logged today), say "nothing logged", never "not taken".
- Skipped and refused are separate statuses and are spoken as such.

Red-flag engine

- Rules live in src/data/redflags.json, written by us in short form from public first-aid guidance, each with a source link and a reviewed date.
- Matching uses keyword and phrase sets plus simple negation handling. It favors false alarms over misses.
- Output is always an escalation instruction (call the emergency number, call the clinician) and never an interpretation or reassurance.
- The model is allowed to extract symptoms from free speech into a normalized list, but the rule match and the instruction text are deterministic.

## 5. Data model

| Table | Key fields |
| --- | --- |
| users | id, created\_at |
| care\_circles | id, recipient\_name, timezone, created\_at |
| members | id, circle\_id, user\_id, display\_name, role, color |
| medications | id, circle\_id, name, schedule\_json, min\_interval\_minutes, source\_note |
| med\_events | id, medication\_id, member\_id, status, given\_at, note |
| observations | id, circle\_id, member\_id, category, text, severity, recorded\_at |
| vitals | id, circle\_id, member\_id, kind, value, unit, in\_range, recorded\_at |
| timers | id, circle\_id, name, ends\_at |
| doctor\_questions | id, circle\_id, member\_id, text, created\_at |
| checkins | id, member\_id, answers\_json, recorded\_at |
| audit\_log | id, circle\_id, member\_id, tool, summary, at |

The red-flag rules and the demo circle are seeded from files we write ourselves (synthetic family, synthetic medications), with links to public sources instead of copied text.

## 6. Authentication and security

- Remote MCP servers should follow the MCP authorization approach (OAuth 2.1 style). For the MVP, use a simple bearer token in front of the endpoint that maps to a member and circle, and add OAuth if the Alexa+ connection process requires it.
- Authorization: every tool call resolves the caller to a circle and role. View-only members cannot write. A caller can never read another circle's data.
- Validate every input with Zod and cap string lengths and numeric ranges.
- Encrypt data in transit (HTTPS only) and at rest. Consider field-level encryption for observation text.
- Rate limit per IP and per user.
- Check the Origin header.
- Secrets in environment variables or AWS Secrets Manager, never in the repo.
- Privacy: collect only what is needed, support export and delete per circle, keep no third-party analytics, log tool names and latency but not observation text.
- Safety policy in code: always escalate red-flag matches, never produce dose or drug recommendations, refuse requests to interpret symptoms or diagnose, and show a "not medical advice" note on every exported report.
- Compliance posture: this is a hackathon prototype using synthetic data. Do not claim HIPAA or equivalent compliance. List what a production version would need in the README.

## 7. Repository structure

```
carethread/
  server/
    src/index.ts            entry: starts HTTP + MCP transport
    src/mcp/registry.ts     all tool definitions
    src/tools/*.ts          one file per tool group
    src/core/*.ts           pure logic: dose guard, ranges, trends, report builder
    src/core/redflags.ts    rule matcher
    src/data/redflags.json
    src/data/demo-circle.json
    src/db/                 repository + migrations
    test/
  simulator/
    src/                    React app
    api/agent.ts            Bedrock agent loop (MCP client)
  docs/                     PRD, design, tech docs, diagrams
  .github/workflows/ci.yml
  README.md
```

## 8. Local setup

```
npm create vite@latest simulator -- --template react-ts
mkdir server && cd server && npm init -y
npm i @modelcontextprotocol/sdk zod express better-sqlite3 luxon
npm i -D typescript tsx vitest @types/node @types/express @types/luxon
npx @modelcontextprotocol/inspector
```

Run the server locally, point the MCP Inspector at the /mcp URL, and confirm every tool lists and runs before building anything else.

## 9. Deployment

1. Dockerfile for the server, with a health check route.
2. Push to Amazon ECR and deploy to App Runner or Fargate.
3. Add a custom domain or use the default HTTPS URL.
4. Store the database on a mounted volume, or switch the repository to DynamoDB if you deploy to a stateless runtime.
5. Keep a one-command local run (docker compose up) as a demo fallback, preloaded with the synthetic demo circle.

## 10. Alexa+ integration checklist

These steps are not assumed. Confirm each against the official Alexa+ developer documentation and office hours.

- How a self-hosted MCP server is registered or linked in Alexa+ during Preview.
- Required auth flow and account linking behavior.
- How different household members are distinguished (voice profiles, spoken names) so each log is attributed correctly.
- Response length, latency and content limits for voice, and rules for health-related content.
- Whether an Agent Skill wrapper is needed in addition to the MCP server.
- Test tooling available: simulators, sample code, SDKs.

Fallback: if device-level Alexa+ testing is not possible, the simulator path is explicitly allowed. Include its source and show it working in the demo.

## 11. Observability

- Structured JSON logs with tool name, latency and result status. No observation text or medication names in logs.
- A /health route and a /metrics-style summary for the demo.
- The simulator's trace panel reads the same call records.
- Counters for dose-guard cautions and red-flag escalations, so the demo can show the safety logic firing.

## 12. Testing plan

- Unit tests: dose guard against a written reference set (inside interval, outside interval, midnight rollover, daylight-saving change, two near-simultaneous logs, missing schedule, skipped versus refused).
- Red-flag tests: a reference set of urgent and non-urgent phrasings, with a target of zero misses on the urgent set.
- Authorization tests: view-only cannot write, cross-circle reads are denied.
- Protocol tests: MCP Inspector scripts and a CI test that lists tools and calls each one.
- Voice phrasing tests: snapshot the spoken text for 20 typical inputs, and check that no response ever contains reassurance or a dose suggestion.
- Manual test script covering the demo path end to end.

## 13. Verify before you build

- Installed MCP SDK version and which spec revision it implements.
- Bedrock model availability and quotas for your account and region.
- Hackathon rules about hosting, third-party services, health-related content and mini challenge requirements.
- Alexa+ policies on health and caregiving use cases.
- Sources and licensing for red-flag guidance, caregiver statistics, and any dataset or icon set you ship.
- Review of the red-flag rules and dose-guard wording by a nurse, pharmacist or caregiving organization, if one can be reached before submission.
