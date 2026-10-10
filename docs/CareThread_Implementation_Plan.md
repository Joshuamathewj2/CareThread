# CareThread: Implementation Plan

Amazon Developer Hackathon · Alexa+ Track · Draft v1

## 1. Document map and pre-build gate

Documents (read in this order)

| # | Document | Use |
| --- | --- | --- |
| 1 | PRD | What and why |
| 2 | Safety Rules and Test Cases | What must never go wrong |
| 3 | MCP Tool Specification | Exact tool contracts |
| 4 | Data Model and Seed Data | Schema and demo data |
| 5 | Tech Stack and Architecture | How it is built |
| 6 | Voice Conversation Design | How it sounds |
| 7 | Design Document | How it looks |
| 8 | Security, Privacy and Responsible Use | How it is protected |
| 9 | Implementation Plan (this document) | In what order |
| 10 | Demo and Submission Pack | How it is shown and submitted |

Pre-build gate (complete before writing feature code)

- [ ] Hackathon rules, judging criteria, deadline and mini challenge list read and summarized in `docs/rules-notes.md`
- [ ] Alexa+ developer documentation read, and the integration questions in the Tech Stack document answered or marked unverified
- [ ] MCP SDK version chosen and its supported spec revision confirmed
- [ ] Bedrock model access confirmed in your region (or fallback chosen)
- [ ] Two to three caregiver conversations done or scheduled (see the research plan in the Demo pack)
- [ ] Safety document reviewed by a second person
- [ ] Repo created with the structure from the Tech Stack document, CI skeleton and README disclaimer
- [ ] Deadline backward-planned into the phases below

## 2. Team and roles

Works for one to four people. Assign one owner per area, even if one person holds several.

| Area | Owner responsibilities |
| --- | --- |
| Server and MCP | Registry, transport, tools, auth |
| Safety and tests | Dose guard, red-flag engine, output guard, CI tests |
| Simulator and design | React app, voice orb, timeline, trace panel, branding |
| Agent and voice | Bedrock agent loop, prompts, utterance tests |
| Demo and docs | Research, README, video, submission text |

## 3. Phases and exit criteria

Timeline is relative. Fit it to the real deadline and keep the last 20 percent for polish, video and slack.

| Phase | Focus | Exit criteria |
| --- | --- | --- |
| 0 | Rules, docs, research, repo setup | Pre-build gate complete |
| 1 | Skeleton | MCP server running locally on /mcp, Inspector lists tools, `med_check_status` and `med_log_given` work against SQLite with the dose guard |
| 2 | P0 complete | All P0 tools pass tests, red-flag engine and output guard live, simulator v1 with timeline and trace panel |
| 3 | Reach | Auth, cloud deployment, P1 features, privacy mode, check-in |
| 4 | Ship | Polish, accessibility pass, demo video, README, submission |

Scope freeze: the P0 list is frozen at the end of phase 1. Anything new goes to P1 or later.

## 4. Backlog

Priority: P0 must ship, P1 should ship, P2 if time allows. Estimates are in hours for one developer.

Foundation

| ID | Task | Pri | Est | Depends on |
| --- | --- | --- | --- | --- |
| F-01 | Repo, TypeScript config, lint, Vitest, CI skeleton | P0 | 2 | none |
| F-02 | SQLite repository, migrations, seed script | P0 | 4 | F-01 |
| F-03 | Express server with /health and Streamable HTTP /mcp endpoint using the MCP SDK | P0 | 4 | F-01 |
| F-04 | Registry file and tool registration helper, response envelope, error model | P0 | 4 | F-03 |
| F-05 | Auth middleware (bearer token to member and circle), role checks | P0 | 3 | F-02, F-03 |
| F-06 | Structured logging without health text, rate limiting, Origin check | P0 | 2 | F-03 |

Safety core

| ID | Task | Pri | Est | Depends on |
| --- | --- | --- | --- | --- |
| S-01 | Dose guard pure functions and all DG test cases | P0 | 6 | F-02 |
| S-02 | Red-flag rule loader, matcher, negation handling, RF test cases | P0 | 6 | F-01 |
| S-03 | Output guard and forbidden-pattern tests | P0 | 3 | F-04 |
| S-04 | Locale emergency number defaults and crisis wording | P0 | 1 | S-02 |
| S-05 | Rule file review notes and reviewer field | P1 | 2 | S-02 |

Tools

| ID | Task | Pri | Est | Depends on |
| --- | --- | --- | --- | --- |
| T-01 | med\_schedule\_set, recipient\_profile | P0 | 3 | F-04, F-05 |
| T-02 | med\_log\_given with guard and idempotency | P0 | 4 | S-01, T-01 |
| T-03 | med\_check\_status | P0 | 3 | S-01, T-01 |
| T-04 | log\_observation with red-flag pass | P0 | 3 | S-02, F-04 |
| T-05 | log\_vital with range check | P0 | 3 | T-01 |
| T-06 | redflag\_check | P0 | 2 | S-02 |
| T-07 | handoff\_summary | P0 | 4 | T-02 to T-05 |
| T-08 | visit\_export markdown builder with disclaimer | P0 | 4 | T-02 to T-05 |
| T-09 | question\_for\_doctor | P1 | 2 | F-04 |
| T-10 | trend\_insights | P1 | 4 | T-04, T-05 |
| T-11 | care\_timer | P1 | 2 | F-04 |
| T-12 | caregiver\_checkin with crisis path | P1 | 3 | S-02 |
| T-13 | MCP resources and prompts | P1 | 3 | T-08 |

Simulator and agent

| ID | Task | Pri | Est | Depends on |
| --- | --- | --- | --- | --- |
| U-01 | Vite React app, tokens, fonts, layout shell with three panels | P0 | 4 | F-01 |
| U-02 | Voice orb with four states and Web Speech input and output | P0 | 5 | U-01 |
| U-03 | Bedrock agent route acting as MCP client, system prompt | P0 | 6 | F-03 |
| U-04 | Answer card, caution banner, red-flag screen | P0 | 5 | U-02 |
| U-05 | Care timeline with member colors and live updates | P0 | 5 | U-03 |
| U-06 | Tool trace inspector reading call records | P0 | 4 | U-03 |
| U-07 | Report preview with copy and export | P0 | 3 | T-08 |
| U-08 | Member switcher for the demo (act as Priya, Arjun, Meera) | P0 | 2 | U-03 |
| U-09 | Privacy mode toggle and behavior | P1 | 3 | U-04 |
| U-10 | Accessibility pass (keyboard, live regions, contrast, reduced motion) | P1 | 4 | U-04 |
| U-11 | Check-in card, doctor questions list, timer ring | P1 | 4 | T-09 to T-12 |
| U-12 | Mobile layout | P1 | 4 | U-05 |

Deployment and quality

| ID | Task | Pri | Est | Depends on |
| --- | --- | --- | --- | --- |
| D-01 | Dockerfile, docker compose with seeded demo | P0 | 3 | F-02 |
| D-02 | Deploy to App Runner or Fargate behind HTTPS | P1 | 5 | D-01 |
| D-03 | OAuth flow if Alexa+ requires it | P1 | 8 | F-05 |
| D-04 | Real Alexa+ connection attempt and notes | P1 | 6 | D-02 |
| Q-01 | CI that lists tools and calls each one through the Inspector or SDK client | P0 | 3 | F-04 |
| Q-02 | Snapshot tests for 20 spoken responses | P0 | 3 | S-03, T-07 |
| Q-03 | Authorization tests (viewer, cross-circle) | P0 | 2 | F-05 |
| Q-04 | End-to-end demo script run | P0 | 2 | U-08 |
| Q-05 | Performance check against latency budgets | P1 | 2 | T-07 |

P2 (only after P1 is done): photo of a label to schedule draft, PDF and FHIR-style export, aide shift view.

## 5. Suggested build order

1. F-01 to F-04, then S-01 and T-01 to T-03. This gives the double-dose scene running in the Inspector.
2. S-02, S-03, T-04 to T-06. This gives the red-flag scene.
3. T-07, T-08, then U-01 to U-08. This gives the complete demo path in the simulator.
4. Q-01 to Q-04 and D-01. Lock P0.
5. P1 items in this order: D-02, U-09, T-10, T-09, T-12, U-10, D-03, D-04.
6. Polish, record video, write submission.

## 6. Cut line (if time runs short)

Cut in this order, protecting the demo story:

1. P2 items
2. Mobile layout (U-12)
3. Caregiver check-in (T-12) and trend insights (T-10)
4. OAuth (D-03), keeping bearer auth
5. Cloud deployment (D-02), keeping the docker compose local run

Never cut: dose guard, red-flag engine, output guard, tool trace panel, report export, the safety wording tests.

## 7. Definition of done

A task is done when

- Code is merged with tests and CI is green.
- Spoken outputs have snapshot tests and pass the output guard.
- It is listed correctly in the registry and in the README tool table.
- Any new data field or tool is reflected in the Tool Specification and Data Model documents.
- A second person has reviewed any change to a safety file.

## 8. Repo conventions

- Branches: `main` is always demoable. Work in `feature/<id>-short-name`. Squash merge.
- Commits: `<type>(<scope>): message`, for example `feat(dose-guard): add max per day rule`.
- Code style: TypeScript strict mode, ESLint, Prettier.
- No `any` in safety code. No network calls in pure core functions.
- Time is always injected (`clock.now()`), never `Date.now()` in core logic.
- Docs live in `docs/`. Safety rules and the red-flag JSON have a CODEOWNERS entry requiring review.

## 9. Environment variables

| Name | Purpose |
| --- | --- |
| PORT | Server port |
| DATABASE\_PATH | SQLite file path |
| AUTH\_TOKEN\_SECRET | Secret for token hashing |
| ALLOWED\_ORIGINS | Simulator origin and any others |
| AWS\_REGION | Region for Bedrock |
| BEDROCK\_MODEL\_ID | Model for the simulator agent |
| MCP\_SERVER\_URL | Used by the simulator agent to reach the server |
| DEFAULT\_EMERGENCY\_NUMBER | Fallback if circle has none |
| NODE\_ENV | development or production |

Provide `.env.example` with placeholders only. Never commit real values.

## 10. Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start server with reload |
| `npm run test` | Unit and protocol tests |
| `npm run test:safety` | Dose guard, red-flag and output guard suites only |
| `npm run seed:demo` | Reset to the synthetic demo state |
| `npm run inspector` | Open the MCP Inspector against local /mcp |
| `npm run demo` | Server and simulator together |
| `docker compose up` | One-command local run with demo data |

## 11. Architecture decision records to write

Keep each to half a page in `docs/adr/`.

| ADR | Decision |
| --- | --- |
| 001 | Deterministic safety logic, the model never decides safety |
| 002 | Stateless MCP with auth-derived identity |
| 003 | SQLite first behind a repository interface |
| 004 | UTC storage, elapsed-minute interval math |
| 005 | Bearer token first, OAuth if Alexa+ needs it |
| 006 | Simulator uses Bedrock as MCP client |

## 12. Weekly checkpoints

- Does the double-dose scene work end to end?
- Does every urgent test phrase escalate?
- Is every spoken response inside the output guard?
- Can a new person run the demo from the README in under 10 minutes?
- What is on the cut line right now?

## 13. Risks tracked during the build

| Risk | Trigger | Response |
| --- | --- | --- |
| Alexa+ connection blocked | No device path by phase 2 | Commit to the simulator path, document the attempt |
| Bedrock access or quota issue | Agent calls fail | Switch to another Bedrock model or a stub agent for tests, keep the demo recording |
| Speech recognition unreliable in Chrome | Misheard names or numbers | Text input fallback, clarifying prompts, rehearsed demo phrases |
| Time zone or DST bug | Failing DG-06 or DG-07 | Stop feature work, fix, add test |
| Scope creep | New idea after freeze | Add to P2 list, do not build |
| Safety wording regression | Output guard test fails | Block merge |
