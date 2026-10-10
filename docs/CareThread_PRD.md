# CareThread: Product Requirements Document

Amazon Developer Hackathon · Alexa+ Track · Draft v1

## 1. One-line pitch

CareThread is a self-hosted MCP server that turns Alexa+ into a shared, hands-free care log for families looking after an older or ill relative. Caregivers log medications and observations by voice, ask "did Dad already take his pills?" and hand over a clean summary to the next caregiver or the doctor, without putting down the person they are helping.

## 2. Problem

Most home care is run by family members, often several of them (siblings, a spouse, a paid aide), and almost none of it is recorded in one place. Information lives in sticky notes, group chats and memory. Three failures follow:

- **Double and missed doses.** Two caregivers each assume the other gave the morning medication. Nobody can answer "did he already take it?" at 9 pm without phoning around.
- **Lost handoffs.** The evening carer does not know the afternoon was rough, that lunch was skipped or that a new dizzy spell started. Context is rebuilt from scratch every shift.
- **Useless doctor visits.** Clinicians get a short appointment and a caregiver who says "he's been worse lately." Dates, patterns and questions are reconstructed from memory, so decisions are made on weak evidence.

The moments that matter happen with busy hands (feeding, bathing, lifting, steadying someone on the stairs), when typing into a phone app is exactly what a caregiver will not do. Existing apps assume the carer has a free hand and the discipline to open them. Voice is the only interface that works in the moment, and a smart speaker in the home is shared by everyone in the care circle.

Why this is unresolved: care apps exist, but none are voice-first, shared across a household's speaker and built around the single question that causes real harm, which is "was this already given, and by whom?" Figures on the number of family caregivers and medication-error rates should be sourced from current public reports (for example national caregiving surveys) and verified before they go into the submission text.

## 3. Target users

- Primary: family caregivers of an older adult or a person with a chronic condition, including sandwich-generation adults who share care with siblings.
- Secondary: paid home aides and visiting nurses who need to leave and read structured shift notes.
- Tertiary: clinicians and care coordinators who want a concise, dated summary before an appointment.

## 4. Goals and non-goals

Goals

- Ship a working MCP server (spec 2025-11-25 or later, Streamable HTTP) with at least 10 useful tools, usable from Alexa+.
- Ship a web-based Alexa+ simulator that drives the same server, so judges can see it working without a device.
- Make voice clearly better than a phone or a paper notebook for this use case.
- Prevent double-dose confusion between caregivers with a deterministic "already given?" check.
- Produce a shift handoff summary and a clinician-ready visit report automatically from voice-logged data.

Non-goals

- Diagnosing, triaging or giving medical advice. CareThread records and retrieves what the family says. It never recommends a dose, a drug or a treatment.
- Deciding dosing intervals. Minimum intervals come from the label or the prescriber, entered by the caregiver. The system only enforces what it was told.
- Replacing electronic health records, pharmacy systems or emergency services.
- Building speech recognition. Alexa+ and the browser handle speech.
- Claiming regulatory compliance. The demo uses synthetic data only, and v1 is a prototype, not a medical device.

## 5. Hackathon strategy

- Track fit: the repo imports the official MCP SDK, exposes a Streamable HTTP endpoint, and loads a real tool config. This is code, not a README mention.
- Dual path: the real MCP server plus a simulated Alexa+ web app. The simulator source is included in the repo and shown working in the demo.
- Demo clarity: one story told in 3 minutes (two siblings share care, the double dose is caught, a handoff and a doctor report are produced).
- Memorable moment: the double-dose catch. One voice question prevents a real-world harm and judges understand it instantly.
- Mini challenge: pick one after reading the full challenge list on the hackathon page. Each project can win one track prize and one mini challenge prize.
- Check the official judging criteria and deadlines on the hackathon page before locking scope. They are not assumed here.

## 6. User stories

1. As a daughter helping her father out of the bath, I say "I gave Dad his morning pills" and hear a confirmation with the time, so my brother can see it later.
2. As the brother arriving that evening, I ask "did Dad take his evening medication?" and hear who gave it and when, or that nothing is logged yet.
3. As a caregiver about to repeat a dose by mistake, I am warned that it was logged recently by someone else and asked whether to proceed.
4. As a caregiver, I say "Mum ate half her lunch and seemed confused around two" and have it stored as a timestamped observation.
5. As a caregiver, I describe a worrying symptom and immediately hear a clear instruction to contact emergency services or the clinician, never reassurance.
6. As the evening carer, I ask for a handoff and hear a short summary of the day: doses given, meals, mood, anything unusual.
7. As a caregiver the day before an appointment, I ask for a visit report and receive a structured markdown file with dated observations, trends and my saved questions for the doctor.
8. As a tired caregiver, I answer a short voice check-in about my own sleep and stress, and get pointed to support options if I am struggling.

## 7. Functional requirements

P0 (must ship)

- MCP server over Streamable HTTP with tool discovery, structured input schemas and clear voice-friendly text results.
- Care circle model: one care recipient, several members with roles (primary, family, aide, view-only), each action attributed to a member.
- Medication tools: caregiver-entered schedule with minimum intervals, log a dose given, skipped or refused, and an "already given?" status check that names who and when.
- Observation logging by category (meals, mood, mobility, pain, sleep, bathroom, other) and numeric vitals with units (blood pressure, glucose, temperature, weight), checked against ranges the caregiver or clinician set.
- Red-flag check: a deterministic rule set that always escalates urgent phrases to emergency or clinician contact. It never says a symptom is fine.
- Shift handoff summary and visit report export (markdown).
- Web simulator: mic or text input, assistant reply, tool-call trace panel, care timeline.

P1 (should ship)

- Questions-for-the-doctor list built by voice and merged into the visit report.
- Trend insights (for example confusion events by time of day, meals eaten per day) computed with plain statistics, shown as facts, never as diagnosis.
- Care timer with named steps (for example "check blood sugar in 30 minutes").
- Caregiver check-in with a short, validated-style set of wellbeing questions and a gentle pointer to support.
- MCP resources for the care log and an MCP prompt for the visit report template.
- OAuth-based authorization per the MCP spec for remote servers.
- Privacy mode: speaker says minimal detail ("Logged for your father") and shows the rest on screen.

P2 (if time allows)

- Photo of a pill organizer or prescription label to schedule draft in the simulator (caregiver must confirm every field).
- Export to PDF and to a FHIR-style JSON bundle.
- Aide view with shift check-in and check-out.

## 8. MCP tool catalog (draft)

| Tool | Purpose |
| --- | --- |
| recipient\_profile | Set or read the care recipient's name, allergies and clinician contacts |
| med\_schedule\_set | Add a medication with times and minimum interval entered by the caregiver |
| med\_log\_given | Record a dose as given, skipped or refused, attributed to the speaker |
| med\_check\_status | Answer "was it already given?" with who, when and interval status |
| log\_observation | Append a categorized, timestamped observation |
| log\_vital | Append a numeric reading with unit and range check |
| redflag\_check | Match a described symptom against escalation rules and return an urgent instruction |
| handoff\_summary | Short spoken and written summary of a time window |
| trend\_insights | Counts and patterns over days, stated as facts |
| visit\_export | Generate a markdown visit report for the clinician |
| question\_for\_doctor | Add or list questions to raise at the next appointment |
| care\_timer | Start or check a named timer |
| caregiver\_checkin | Ask or record a short wellbeing check-in |

## 9. Voice UX requirements

- Replies are at most two short sentences by default, with details offered on request.
- Every write action is confirmed with who, what and when ("Logged: metformin, 8:05 am, by Priya").
- Times are spoken in the home's local time and in plain words ("about three hours ago").
- Ambiguity is resolved with one clarifying question, never a menu. If two medications match, ask which.
- Safety first: red-flag phrases and double-dose risks are spoken before anything else.
- CareThread never says "that is normal" or "that is fine" about a symptom, and never suggests a dose or a drug.
- Emergencies get a direct instruction to call the local emergency number, repeated once, with no further questions.
- Privacy mode keeps sensitive details off the speaker when guests are present.

## 10. Non-functional requirements

- Tool response time under 500 ms for logs and status checks and under 1.5 s end to end for summaries.
- Deterministic interval, range and red-flag logic with unit tests and published behavior.
- Data minimization: care circle data and an account ID only. Per-circle export and delete on request.
- Encryption in transit and at rest, per-circle access control, audit trail of who logged what.
- Public HTTPS endpoint with rate limiting and input validation.
- Synthetic data only in demos and tests.

## 11. Success metrics

- 13 tools passing automated MCP conformance and unit tests.
- A judge can complete the full demo story in under 3 minutes without help.
- Double-dose guard catches 100% of cases in a written reference test set, with zero false "safe" answers.
- Red-flag rules escalate 100% of a reference set of urgent scenarios drawn from public first-aid guidance.
- At least 5 outside family caregivers or care professionals try it or review the demo and give feedback before submission.

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Alexa+ integration steps are in Preview and may differ from assumptions | Read the official Alexa+ docs first, attend office hours, keep the simulator as a full fallback |
| Product is mistaken for medical advice | Record-and-retrieve only, visible disclaimer, red-flag rules always escalate, no dose or drug suggestions |
| Wrong "already given?" answer causes harm | Deterministic logic, fail toward caution ("I can't confirm, check with the family"), unit tests on edge cases such as time zones and midnight |
| Sensitive health data privacy | Synthetic data in the demo, encryption, per-circle access, delete on request, no third-party analytics |
| Shared speaker exposes private details | Privacy mode, screen-first details, optional voice PIN as a later feature |
| Scope creep | P0 list frozen after day 2 |
| Medical source copyright and accuracy | Write short rules ourselves from public guidance and link to the source, store no copied text |
| Demo failure on the day | Record a backup video and keep a local run script |

## 13. Milestones

Timeline is relative. Fit it to the real deadline.

- Phase 0: read the rules, docs and challenge list, pick the mini challenge, interview two or three caregivers.
- Phase 1: MCP server skeleton with medication log and "already given?" check running locally.
- Phase 2: all P0 tools, SQLite storage, simulator v1 with care timeline.
- Phase 3: auth, deployment to the cloud, P1 features.
- Phase 4: polish, tests, demo video, README, submission.

## 14. Submission checklist

- Public repo with a README that includes a quick start and architecture diagram.
- Code that actually imports and runs the MCP SDK (entry point in a clearly named file).
- Simulator source included.
- Deployed endpoint or one-command local run.
- Demo video showing the server working.
- Text description covering features, tech used and what is next.
- Clear statement that CareThread is a prototype record-keeper, not medical advice, and that the demo uses synthetic data.

## 15. Open questions

- Exact process to connect a self-hosted MCP server to Alexa+ during Preview.
- How Alexa+ identifies different household members, and whether per-person attribution is possible by voice profile or needs a spoken name.
- Whether the hackathon requires a specific hosting provider or account type.
- Which mini challenge best matches this project.
- Which public sources to cite for red-flag rules and caregiver statistics.
