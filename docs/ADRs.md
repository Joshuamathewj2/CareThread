# Architecture Decision Records (ADRs)

## ADR-001: SQLite for MVP State
**Decision:** Use `better-sqlite3` for local development and the hackathon demo.
**Rationale:** It requires zero external infrastructure, avoiding AWS credential sharing complexities for judges, and easily supports the structured relational model (circles, members, events) needed for the dose guard. We use the repository pattern so it can be swapped to DynamoDB for production.

## ADR-002: Deterministic Safety Engine
**Decision:** Do not rely on the LLM to decide if a dose is safe or if a symptom is an emergency.
**Rationale:** LLMs are prone to hallucination. CareThread extracts the entities (medication name, observation text) and passes them to pure TypeScript functions (`doseGuard.ts` and `redFlagEngine.ts`). These functions calculate time intervals and apply negation-aware keyword matching, returning an exact safety code and spoken text that the LLM must present.

## ADR-003: Streamable HTTP over Stdio
**Decision:** Use the MCP SDK's `SSEServerTransport` instead of Stdio.
**Rationale:** Alexa+ smart speakers and cloud-hosted voice clients cannot interact with a local CLI process via stdio. The MCP server must be exposed over the network via HTTP/SSE, allowing it to be hosted on AWS App Runner and accessed remotely by the Alexa backend.

## ADR-004: Bearer Token Auth Scoping
**Decision:** Inject `AuthContext` via `AsyncLocalStorage` in the Express layer.
**Rationale:** The MCP SDK tool handlers do not natively accept HTTP headers. By parsing the `Authorization` header in Express and putting it into node's `AsyncLocalStorage`, our tool handlers can securely attribute logs to the active speaker (Primary, Family, Aide) and block unauthorized edits (Viewer).

## ADR-005: Custom React Simulator
**Decision:** Build a custom Vite+React simulator instead of only providing the MCP server.
**Rationale:** Since judges may not have physical Alexa devices configured for developer preview skills, the web simulator demonstrates the voice interaction (via Web Speech API/text fallback) and prominently displays the MCP tool trace panel side-by-side to prove the technical implementation.

## ADR-006: Zod to JSON Schema Generation
**Decision:** Use `zod-to-json-schema`.
**Rationale:** We define our tool inputs using Zod for robust runtime parsing. Converting these Zod schemas to JSON Schema allows us to dynamically satisfy the MCP `ListToolsRequestSchema` contract without maintaining duplicate type definitions.
