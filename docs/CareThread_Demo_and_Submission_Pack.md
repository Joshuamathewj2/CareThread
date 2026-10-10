# CareThread: Demo and Submission Pack

Amazon Developer Hackathon · Alexa+ Track · Draft v1

## 1. Purpose

This document covers everything needed to prove the project works and to submit it: the three-minute demo script, the user research plan, the README outline, the draft submission text, judge Q&A, a mini challenge decision matrix and the final checklist. Check the official hackathon page for exact submission fields, video length limits, judging criteria and deadlines. None of those are assumed here.

## 2. Story in one line

Two siblings share their father's care. A double dose is caught by one voice question, a possible stroke gets an instant escalation, and a clean handoff and doctor report appear without anyone typing.

## 3. Demo script (3 minutes)

Cast: Priya (primary caregiver), Arjun (son), plus a narrator. All data is synthetic. Run `npm run seed:demo` before every take.

| Time | Scene | What is said | What is on screen | Tools called |
| --- | --- | --- | --- | --- |
| 0:00 | Hook | Narrator: "Caring for a parent means ten people, one pill box and a sticky note nobody updated." | Photo or clip: hands full, phone out of reach, fridge note | none |
| 0:20 | Morning log | Priya: "I gave Dad his morning pills." Reply: "Logged: metformin, 8:05 am, by Priya." | Answer card, timeline gets Priya's colored entry, trace panel shows the call | med\_log\_given |
| 0:50 | Double-dose catch | Switch to Arjun. Arjun: "Did Dad take his morning metformin?" Reply: "Yes. Priya gave it at 8:05, about three hours ago." Arjun: "Log it as given." Reply: "Careful, Priya logged metformin at 8:05. Do you want to log another dose anyway?" Arjun: "No." | Amber caution banner above the answer card, trace shows dose guard code WITHIN\_INTERVAL | med\_check\_status, med\_log\_given |
| 1:20 | Observations | Priya: "Lunch was half eaten and he seemed confused around two." Reply: "Logged: lunch half eaten, confusion around 2 pm, by Priya." | Two chips slide into the timeline | log\_observation x2 |
| 1:40 | Red flag | Priya: "His face is drooping and his speech is slurred." Reply: "Call 112 now. These can be signs of a stroke, and time matters. I have noted the time as 3:42 pm." | Full-width red screen, Warning label, emergency number and clinician contact | log\_observation, redflag\_check |
| 2:05 | Handoff | Meera (aide) takes over. Meera: "Give me the handoff." Reply: "Today: morning doses given, evening metformin not logged yet. Lunch half eaten, confusion at 2 pm, and one urgent event at 3:42." | Handoff card, red-flag line first | handoff\_summary |
| 2:25 | Doctor report | Priya: "Make a report for the doctor." Reply: "Your visit report is ready: 14 days, 31 observations, 2 questions for the doctor." | Rendered markdown with disclaimer, Export and Copy | visit\_export |
| 2:45 | Close | Narrator: "Same MCP server answers Alexa+ and our simulator. Deterministic safety, no medical advice. Next: clinician review and real household voice profiles." | Architecture slide, repo link | none |

Demo rules

- The red-flag scene must be handled with care. Say before the scene that it is a scripted test with synthetic data.
- Never show real names, real medications of a real person, or real phone numbers.
- Keep the tool trace panel visible in every scene. It is the proof of the MCP work.
- If speech recognition fails live, type the same sentence. Both paths use the same server.

## 4. Pre-demo checklist

- [ ] Reset with `npm run seed:demo`
- [ ] Chrome, microphone permission granted, noise tested
- [ ] Demo members verified (Priya, Arjun, Meera) with the member switcher
- [ ] Server health check green, deployed URL and local fallback both tested
- [ ] Network backup: local run script and recorded video ready
- [ ] Zoom level and fonts readable at the back of a room
- [ ] Do not disturb on, no real notifications on screen
- [ ] All scripted phrases rehearsed at least five times
- [ ] Backup video exported and stored in two places

## 5. Backup plan

| Failure | Response |
| --- | --- |
| Speech recognition misfires | Type the sentence, say "same server, same tools" |
| Bedrock agent slow or failing | Switch to scripted mode that calls the tools directly with the same arguments |
| Deployed endpoint down | Switch to `docker compose up` local run |
| Everything fails | Play the recorded video, walk through the trace panel screenshots |
| Alexa+ device path unavailable | Present the simulator as the permitted alternative, show the MCP endpoint answering the Inspector |

## 6. User research plan

Goal: at least five outside conversations before submission, with family caregivers, care professionals or nursing students. These make the problem credible and the voice wording better.

Consent line (read first)

"This is a student prototype. I won't ask for any real health information. I'd like your reaction to a short demo, and I'll only note what you say about your experience. You can stop at any time."

Interview guide (15 minutes)

1. Who do you help care for, and who else shares the care?
2. How do you track medications and daily events today?
3. Tell me about a time something was missed or done twice.
4. What do you do before a doctor visit to remember what happened?
5. When are your hands busy, and what do you do about your phone then?
6. How would you feel about a shared speaker that logs and answers? What worries you?
7. (After the demo) What would you change in the wording? What would you never want it to say?
8. Would your family use it? Who would resist?

Feedback form after the demo (1 to 5 scale plus comments)

- It would help me or my family.
- The double-dose warning was clear.
- The emergency instruction was appropriate.
- I felt my privacy was respected.
- I would use this weekly.

Record: date, role of the person (caregiver, nurse, student), top quote, top concern. Remove names in public material. Summarize in `docs/research-summary.md` and cite counts in the submission text.

Target thresholds: at least 4 of 5 say the double-dose warning was clear, and at least one change to wording or flow comes from the research.

## 7. Mini challenge decision matrix

Fill in after reading the full challenge list on the hackathon page. Each project can win one track prize and one mini challenge prize.

| Challenge | Requirement (from the rules page) | Fit with CareThread (1 to 5) | Extra work needed | Decision |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |
| | | | | |

Pick the challenge where the existing build already satisfies the requirement. Do not add features only to chase a prize.

## 8. README outline

1. Title, tagline and one-paragraph pitch
2. Prototype disclaimer (see the Security document for the exact wording)
3. Demo link, video link and screenshots (synthetic data only)
4. The problem in three sentences
5. What it does: the 13 tools in a table generated from the registry
6. Architecture diagram and a short explanation of MCP Streamable HTTP use
7. Quick start: prerequisites, `docker compose up`, open the simulator, reset demo data
8. Running the MCP Inspector against /mcp
9. How to connect to Alexa+ (steps confirmed, or clearly marked unverified)
10. Safety design: dose guard, red-flag engine, output guard, and their tests
11. Testing: commands and what each suite covers
12. Privacy and security summary
13. Research: what we learned from caregivers
14. What is next
15. Credits: libraries, icon set, fonts, inspiration designers if any component was directly inspired, public guidance sources
16. Licence

Make sure the README names the entry file for the MCP server (`server/src/index.ts`) and the registry file (`server/src/mcp/registry.ts`).

## 9. Draft submission text

Replace brackets with real details and numbers once measured.

Title: CareThread: a shared, hands-free care log for families

Tagline: Everyone's care, one thread.

Inspiration
Caring for a parent involves several people, one pill box and a lot of memory. When two siblings each assume the other gave the morning tablet, nobody can answer a simple question at 9 pm. Caregivers' hands are full at exactly the moments that matter, so a phone app is the wrong tool. We wanted to give families a shared voice-first record on the speaker already in the home.

What it does
CareThread is an MCP server that makes Alexa+ a shared care log. Caregivers log medications and observations by voice, ask whether a dose was already given and by whom, and get a warning before a repeat. Urgent symptom descriptions trigger an immediate escalation instruction. It produces a shift handoff and a clinician-ready visit report from the voice log. It never diagnoses, reassures or suggests doses.

How we built it
A TypeScript MCP server using the official SDK over Streamable HTTP with 13 tools, backed by SQLite behind a repository interface. A deterministic dose guard, red-flag engine and output guard keep safety out of the model's hands. A React simulator with a voice orb, care timeline and tool-call trace panel drives the same server through an Amazon Bedrock agent acting as an MCP client. [Deployed on AWS App Runner behind HTTPS.]

Challenges
Interval math across midnight and daylight-saving changes, attributing logs to the right family member, writing escalation language that is clear without sounding like a diagnosis, and treating stored notes as untrusted data.

Accomplishments
[N] automated tests including [N] dose guard cases and [N] red-flag phrasings with zero misses on the urgent set, conversations with [N] caregivers, and a complete three-minute demo path that runs from the same server on a device or in the simulator.

What we learned
[Fill in from research: the top finding and what changed in the wording.]

What's next
Clinical review of every rule with a nurse or pharmacist, real household voice profiles on Alexa+, aide shift workflows, and PDF or FHIR-style export for clinicians.

Built with
TypeScript, Node, @modelcontextprotocol/sdk, Express, Zod, SQLite (better-sqlite3), Luxon, React, Vite, Tailwind CSS, Web Speech API, Amazon Bedrock, AWS App Runner, Docker, Vitest, GitHub Actions.

## 10. Likely judge questions and answers

| Question | Answer |
| --- | --- |
| Is this a medical device? | No. It records and retrieves what the family says. It does not diagnose or advise, and says so in the product and the README. |
| What if the dose guard is wrong? | It only knows what was logged and the interval the caregiver entered. It says "not logged", never "not taken", and fails toward caution. It has 20 reference tests including midnight and daylight-saving cases. |
| Why MCP and not just an Alexa skill? | MCP gives one server that both Alexa+ and our simulator use, with discoverable tools and structured results. The same logic works wherever an agent can call tools. |
| Why not let the model handle safety? | Models can be fluent and wrong. Safety logic is deterministic code with tests, and the model only extracts fields and phrases non-critical text. |
| How do you handle privacy on a shared speaker? | Privacy mode keeps details on screen, roles limit access, data is minimized, and families can export or delete. Emergency instructions are always spoken. |
| Who is it for first? | Families with two or more caregivers for an older parent, and aides handing over shifts. |
| How would it make money or scale? | Family subscription, care agency licences, and clinician report integrations. Out of scope for this build, which focuses on the safety and voice experience. |
| What did you validate with real people? | [N] conversations with caregivers or care professionals. [One concrete change we made because of them.] |
| What happens if Alexa+ cannot identify who is speaking? | The agent asks "Who is logging this?" once, and the confirmation always names the member, so mistakes are visible. |
| What is the red-flag list based on? | Short rules we wrote from public first-aid guidance, with source links. They are drafts pending clinical review, and the README says so. |
| How do you prevent bad advice from the model? | The output guard blocks reassurance, diagnosis and dosing language and substitutes a safe fallback. Snapshot tests cover typical responses. |
| What is the real Alexa+ status? | [State exactly what was tested on a device and what ran in the simulator.] |

## 11. Video checklist (3 minutes)

- [ ] Hook in the first 15 seconds
- [ ] Voice and screen visible together
- [ ] Trace panel visible during tool calls
- [ ] Double-dose scene clear and slow enough to read
- [ ] Red-flag scene introduced as a scripted test with synthetic data
- [ ] Architecture slide shows MCP over Streamable HTTP and the two clients
- [ ] Captions for all spoken lines
- [ ] Music low or none, audio levels checked
- [ ] No real personal data anywhere
- [ ] Exported at the required resolution and length, uploaded, link tested while logged out

## 12. Asset checklist

- [ ] Logo SVG, favicon, 1280 x 640 social image
- [ ] Screenshots (idle, caution, red-flag, timeline, report, trace)
- [ ] Architecture diagram image
- [ ] Demo video and backup video
- [ ] Figma link (view only) and Dribbble board export with notes
- [ ] README with quick start tested on a clean machine
- [ ] Research summary
- [ ] Credits and licences file

## 13. Final submission checklist

- [ ] Public repo, README complete, disclaimer present
- [ ] MCP SDK imported and running in `server/src/index.ts`, tool registry loaded
- [ ] Simulator source included and runnable
- [ ] Deployed endpoint working or `docker compose up` verified
- [ ] All safety tests green in CI
- [ ] Demo video shows the server working
- [ ] Submission text covers features, tech used and what is next
- [ ] Mini challenge requirements ticked off against the official page
- [ ] Official rules, deadline and required fields re-read one hour before submitting
- [ ] Submission previewed while logged out
