# CareThread: Demo Video Script (under 3 minutes)

**Format.** One narrator plus three caregiver voices: Priya (primary caregiver, daughter), Arjun (son), Meera (aide). All data is synthetic.
**Length.** The narration and dialogue come to about 440 words, roughly 2:45 of speech at a brisk pace, plus a few seconds of on-screen member switching. That leaves little margin under 3:00, so time a dry run. If it runs over 2:55, use the cut list at the end (cutting Scene 3 alone saves about 20 seconds).
**Rule.** Keep the MCP trace panel visible in every demo shot. It is the proof that real tools run.

---

## Before you record

- [ ] `cd server && npm run seed:demo`, then `npm run dev`. Reseed before every take.
- [ ] Turn on Bedrock for the `ask_care_log` scene: `CARETHREAD_BEDROCK=on`, AWS credentials loaded, and `BEDROCK_MODEL_ID` set to a model your account can invoke. Open `http://localhost:3001/health` and confirm `"bedrock": { "enabled": true }`.
- [ ] Simulator open (`cd simulator && npm run dev`), member switcher on Priya, trace panel expanded.
- [ ] MCP Inspector open in a second tab, connected to `http://localhost:3001/mcp` with `Authorization: Bearer m_priya`, Tools tab loaded.
- [ ] Decide which Alexa+ line you can say truthfully (Phase 2, last beat). Say only what you actually ran.
- [ ] Let at least a minute pass between Priya's dose and Arjun's, so the warning reads "...N minutes ago" (code `WITHIN_INTERVAL`).

---

## Phase 1: Hook and problem

**ON SCREEN:** A close shot of a kitchen counter: a pill organizer, a sticky note on the fridge reading "Dad: gave AM tabs? - P", a phone buzzing out of reach. A hand reaches for the pill box while holding a cup.

**SAY (narrator):**
> When four people share the care of one parent, the medication record is a sticky note on the fridge. "Did anyone give Dad his tablet?" has no reliable answer. That is how double doses happen.

**ON SCREEN:** Cut to the smart speaker on the same counter.

**SAY:**
> The voice assistant is already in the kitchen, but a chatbot guessing about medicine is the last thing you want. CareThread turns Alexa+ into the family's shared care log, where safety is decided by code, not the model.

**ON SCREEN:** Title card: **CareThread**, with the line "A shared care log you can talk to."

---

## Phase 2: Architecture and implementation

**ON SCREEN:** An architecture diagram, built left to right as you speak: *Caregiver voice → Alexa+ agent → `POST /mcp` (Streamable HTTP) → CareThread MCP server → Dose Guard / Red-flag Engine / Output Guard → SQLite.* A side arrow runs from the server to **Amazon Bedrock**.

**SAY:**
> CareThread is a self-hosted MCP server on the official TypeScript SDK, implementing the 2025-11-25 spec over Streamable HTTP, with a session per caregiver.

**ON SCREEN:** Browser at `localhost:3001/health`, with `"mcpSpec": "2025-11-25"` and `"transport": "streamable-http (stateful)"` highlighted. Cut to MCP Inspector, Tools tab. Click `med_log_given` and highlight its input schema, `outputSchema`, and annotations.

**SAY:**
> Sixteen tools, each with an explicit contract: validated inputs, an output schema, and annotations marking what is read-only or destructive. Every result is one sentence to speak, plus a safety level and, when a caregiver must confirm, a follow-up with the exact next call.

**ON SCREEN:** The diagram again, with the three guards highlighted, then the Bedrock arrow.

**SAY:**
> Three deterministic guards check every answer. And our ask-the-log tool calls Amazon Bedrock's Converse API inside the tool handler, grounded only on the family's log, with a deterministic fallback.

**SAY (pick the line that is true for your recording):**
> A, if filmed on a device: *Here it is running on an Alexa+ device.*
> B, if not: *Our simulator stands in for the Alexa+ agent and calls the exact same endpoint.*

---

## Phase 3: Live working demo

Layout for every shot: the conversation on the left, the MCP trace panel on the right (tool name, arguments, `structuredContent`).

### Scene 1: Log a dose

**ON SCREEN:** Member switcher set to **Priya**. Tap the mic.

**PRIYA:** "I gave Dad his metformin."
**CARETHREAD:** "Logged: Metformin, just now, by Priya."

**ON SCREEN:** The trace shows `med_log_given {"medication":"Metformin","status":"given"}`, and a Priya-colored entry appears in the timeline.

### Scene 2: The double-dose catch

**ON SCREEN:** Switch the member to **Arjun**.

**ARJUN:** "I gave him metformin."
**CARETHREAD:** "Careful, Priya logged Metformin two minutes ago. Do you want to log another dose anyway?"

**ON SCREEN:** An amber caution banner. In the trace, highlight `safety: { level: "caution", code: "WITHIN_INTERVAL" }`, then the `followUp` block with `confirmRepeat: true`.

**ARJUN:** "No."
**CARETHREAD:** "Okay, I left the log as it is."

**SAY (narrator, quickly):**
> That was the dose guard, not the model. Nothing is written until a human answers.

### Scene 3: Undo a mistake

**ON SCREEN:** Switch to **Priya**.

**PRIYA:** "His blood pressure is 150 over 95."
**CARETHREAD:** "Logged bp reading of 150 over 95 mmHg."
**PRIYA:** "Scratch that."
**CARETHREAD:** "Your last entry was the bp reading of 150 over 95, at 4:12 PM. Remove it?"
**PRIYA:** "Yes."
**CARETHREAD:** "Removed the bp reading of 150 over 95."

**ON SCREEN:** The trace shows two `undo_last_entry` calls: a preview, then `{"confirm":true,"entryId":"v_..."}`. The timeline entry disappears.

### Scene 4: What needs doing, and asking the log

**ON SCREEN:** Switch to **Meera** (aide, starting her shift).

**MEERA:** "What's next for Dad?"
**CARETHREAD:** *(reads the prioritized list, e.g.)* "Amlodipine for 8:00 AM is not logged yet. Vitamin D for 9:00 AM is not logged yet."

**ON SCREEN:** The trace shows `care_next_actions`.

**MEERA:** "When was he dizzy?"
**CARETHREAD:** *(Bedrock's answer, grounded in the log, e.g. "Priya noted he was dizzy after standing on Saturday morning.")*

**ON SCREEN:** The trace shows `ask_care_log`. Highlight `"engine": "bedrock"`, the `modelId`, and the latency.

### Scene 5: Red flag

**ON SCREEN:** A caption in the corner reads "Scripted test, synthetic data."

**SAY (narrator):**
> This next one is a scripted test.

**PRIYA:** "His face is drooping and his speech is slurred."
**CARETHREAD:** "Call 112 now. These can be signs of a stroke, and time matters. I have noted the time as 4:14 PM."

**ON SCREEN:** A full-width red alert. In the trace, highlight `safety: { level: "emergency", code: "RF-01" }`.

**SAY (narrator):**
> A fixed instruction from the red-flag engine. No model can soften it.

---

## Phase 4: Impact and developer insights

**ON SCREEN:** Back to the narrator, or a slide with three short lines: *Families · Aides and agencies · Clinicians*.

**SAY:**
> It's for families sharing care of an aging parent, and aides handing over shifts. One spoken question replaces the group-chat scramble.

**ON SCREEN:** A slide reading *Stateless mode · Sessions per caregiver · 78 automated tests*.

**SAY:**
> Stateless mode runs behind a load balancer, and seventy-eight automated tests cover the safety rules, multi-turn flows, and the transport.

**ON SCREEN:** A slide headed "What we learned building on MCP".

**SAY:**
> On MCP: explicit tool contracts made the agent far more reliable. Rough edges: stateless transports must be rebuilt per request, and output schemas need a JSON Schema dialect clients can validate. We'd love a voice-friendly confirmation pattern in the spec.

**ON SCREEN:** End card with the repo URL, "MIT licensed", "Built with MCP + Amazon Bedrock", and the line "Not a medical device. Synthetic data."

**SAY:**
> CareThread. One thread for everyone who cares.

---

## Cut list (if the take runs over 2:55)

1. Drop Scene 3 (undo). It saves about 20 seconds; mention `undo_last_entry` in one line in Phase 4 instead.
2. In Phase 2, drop the Inspector schema close-up and keep only the health check.
3. In Phase 4, keep only the MCP feedback paragraph and the end line.

## Technical notes for Q&A (not spoken)

| Claim in the video | Where it lives in the code |
| --- | --- |
| Streamable HTTP, 2025-11-25, sessions | `server/src/app.ts` (`StreamableHTTPServerTransport`, `Mcp-Session-Id`, GET/POST/DELETE `/mcp`) |
| Explicit contracts, annotations, outputSchema | `server/src/mcp/registry.ts` (`listTools`, `ToolEnvelopeSchema`) |
| Follow-up for confirmations | `FollowUpSchema` in `registry.ts`; used in `med_log_given` and `undo_last_entry` |
| Bedrock in the tool path | `server/src/aws/bedrock.ts` (`ConverseCommand`), `server/src/tools/askCareLog.ts` |
| Deterministic guards | `server/src/core/doseGuard.ts`, `redFlagEngine.ts`, `outputGuard.ts` |
| 78 tests incl. end-to-end transport | `server/test/transport.test.ts`, `conversation.test.ts`, `askCareLog.test.ts` |
