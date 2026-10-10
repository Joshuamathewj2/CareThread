# CareThread: Alexa+ Track Submission

## 1. Tagline
A voice-first, shared care log for families that guards against double-dosing and deterministically flags emergencies.

## 2. Problem Statement
Multiple caregivers (family members, visiting nurses) rely on fragmented texts or sticky notes to track a vulnerable relative's medications and symptoms. This leads to dangerous miscommunications, missed doses, or accidental double-dosing.

## 3. Solution & MCP Usage
CareThread is a self-hosted Model Context Protocol (MCP) server that acts as a secure, shared timeline. By leveraging the MCP HTTP/SSE transport, the Alexa+ agent can seamlessly invoke tools to log doses, record observations, check vitals, and generate handoff summaries. 

**MCP Features Used:**
- **Tools:** `med_log_given`, `log_observation`, `trend_insights`, `visit_export`, etc.
- **Resources:** Real-time access to `carethread://current-medications` and `carethread://active-redflags`.
- **Prompts:** Dynamic generation of a `daily_summary` tailored to the caregiver's role.

## 4. The Safety Guardrails
The core innovation is that **safety is never hallucinated**.
- The **Dose Guard** mathematically evaluates the minimum interval and daily limits of a requested medication against the SQLite history before allowing a log.
- The **Red-flag Engine** scans observation text for critical keywords (like "chest pain" or "slurred speech"), checks for negations (up to 3 words back), and forcefully interrupts the LLM to output a localized emergency instruction (e.g., "Call 112 now.").
- The **Output Guard** strips sensitive free-text PHI from system logs.

## 5. Team & Repositories
(Fill in DevPost details here)
