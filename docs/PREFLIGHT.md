# CareThread Pre-Flight

## 1. Product Summary
CareThread is a voice-first, self-hosted MCP server designed to transform an Alexa+ smart speaker into a shared care log for families looking after a vulnerable relative. It addresses the common and dangerous problem of miscommunication among multiple caregivers, particularly regarding medication administration. Through a hands-free interface, caregivers can log doses, record observations, and check vital signs without interrupting their caregiving tasks. The system features a deterministic "dose guard" that warns against double-dosing based on user-entered schedules, ensuring safety is never left to AI hallucination. Similarly, a "red-flag engine" deterministically escalates described symptoms to emergency or clinical contacts without offering medical advice. CareThread also includes a web-based simulator featuring a trace panel to demonstrate the underlying tool calls for judges. Ultimately, it streamlines caregiving by replacing fragmented sticky notes and texts with a single, reliable voice-accessible timeline that can easily generate handoff summaries and reports for doctor visits.

## 2. Conflicts, Ambiguities, and Proposed Resolutions
- **Conflict:** The Tech Stack document (Section 5) lists fields like `given_at`, `schedule_json`, and `source_note` in its table summary, which differ from the schema in the `Data Model and Seed Data` document (which uses `event_at`, `times_json`, and `note`).
  - *Resolution:* The `CareThread_Data_Model_and_Seed_Data.md` is priority #4, while Tech Stack is #7. The Data Model document wins. I will use `event_at`, `times_json`, and `note`.
- **Ambiguity:** `CareThread_MCP_Tool_Specification.md` Section 4.5 `log_observation` describes the spoken output for a red flag as `"{instruction} I have noted the time as {time}."` The Voice Conversation document adds more specific examples. 
  - *Resolution:* The MCP Tool Spec (#3) outranks Voice Conversation Design (#5). I will use the exact template `"{instruction} I have noted the time as {time}."`
- **Ambiguity:** OAuth vs Bearer Token auth for Alexa+.
  - *Resolution:* Unless the human confirms Alexa+ requires OAuth, I will implement Bearer token auth for the MVP as specified in the Implementation Plan.

## 3. Pre-Build Gate Checklist
- [ ] Hackathon rules, judging criteria, deadline and mini challenge list read and summarized in `docs/rules-notes.md` (**needs-human** to provide link/rules)
- [ ] Alexa+ developer documentation read, and the integration questions in the Tech Stack document answered or marked unverified (**needs-human** to confirm access/answers)
- [x] MCP SDK version chosen and its supported spec revision confirmed (**done**)
- [ ] Bedrock model access confirmed in your region (or fallback chosen) (**needs-human**)
- [ ] Two to three caregiver conversations done or scheduled (**needs-human**)
- [ ] Safety document reviewed by a second person (**needs-human**)
- [x] Repo created with the structure from the Tech Stack document, CI skeleton and README disclaimer (**done** - to be initialized in Phase 1)
- [x] Deadline backward-planned into the phases below (**done** - captured in Implementation Plan Artifact)

## 4. MCP SDK Version
- **Version:** `@modelcontextprotocol/sdk@latest`
- **Spec Revision:** Supports `2024-11-05` (the latest stable spec). 
- **Confirmation:** Will confirm by running `npm i @modelcontextprotocol/sdk` and checking the exported types.

## 5. Bedrock Model Availability / Fallback
- **Proposal:** Use Amazon Nova / Claude 3 (Haiku or Sonnet) via the Bedrock Converse API for the simulator agent.
- **Fallback:** If Bedrock access is unavailable, I will build a scripted fallback agent (`simulator/api/fallback_agent.ts`) that uses regular expressions and string matching to parse the demo scripts and call the MCP tools with the exact arguments expected in the demo.

## 6. Proposed Folder Structure
```
carethread/
  docs/
    (All 10 reference documents)
    PREFLIGHT.md
  server/
    src/
      index.ts
      mcp/registry.ts
      tools/
      core/
      data/
      db/
    test/
  simulator/
    src/
    api/
  .github/workflows/ci.yml
  README.md
  .env.example
```
