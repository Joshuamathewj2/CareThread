# CareThread: Design Document

Amazon Developer Hackathon · Alexa+ Track · Draft v1

## 1. Design intent

CareThread is a voice-first product, so the interface mostly serves two jobs: proving to judges what the voice experience does, and giving a care circle a glanceable shared record. The look should feel like a quiet kitchen table at dusk: dark, warm, calm and trustworthy, with one soft accent color. Caregivers are tired and often anxious, so nothing on screen should shout except real safety information.

Principles

- Voice is primary. Screens confirm and record, they never ask for typing during a task.
- Glanceable from across the room. Key facts such as "last dose, 8:05 am, Priya" are large and carry names and times.
- Show the machinery. A tool-call trace panel makes the MCP work visible to judges.
- Safety is loud, everything else is quiet. Warnings use a distinct color and appear before answers.
- Warm, never clinical. Plain words, first names, no jargon.

## 2. Dribbble research plan

Design references come from Dribbble. Build three boards of 8 to 12 shots each, sorted by popular this year, and write one line per shot about what you will borrow. Borrow ideas, never artwork, and credit designers in the README if a shot directly inspires a component.

Suggested search queries

| Board | Queries to run |
| --- | --- |
| Mood | health dashboard dark, family care app, medication tracker, calm wellness UI |
| Voice | voice assistant UI, audio waveform orb, smart speaker app, listening state animation |
| Data and chat | activity timeline UI, tool call chat interface, developer console dark mode, report preview |

What to extract from each shot

- Palette: contrast ratios and how the accent color is used sparingly.
- Typography: pairing, number styling, size hierarchy.
- Layout: panel proportions, spacing rhythm, card density.
- Motion: how listening, thinking and speaking states are distinguished.

## 3. Brand

- Name: CareThread.
- Tagline: Everyone's care, one thread.
- Personality: warm, steady, quietly capable. Like a trusted nurse friend who always remembers what happened and never makes you feel behind.
- Logo idea: a single continuous line that loops into a heart-shaped knot and trails off as a sound wave, drawn in the accent color.

## 4. Visual system

Color tokens (dark theme default)

| Token | Value | Use |
| --- | --- | --- |
| bg | #0E1720 | App background |
| surface | #15222E | Cards and panels |
| surface-raised | #1D2E3D | Hover and active cards |
| border | #2B4052 | Dividers |
| text | #EAF1F5 | Primary text |
| text-muted | #93A9B8 | Secondary text |
| primary | #5EEAD4 | Voice orb, links, active states |
| warning | #FFB020 | Caution banners, such as a recent dose already logged |
| success | #7BE0A5 | Confirmed logs |
| danger | #FF6B6B | Red-flag escalation and errors |
| member-1 to member-4 | #A5B4FC, #F9A8D4, #FDE68A, #FDBA74 | Care circle member dots and timeline attribution |

Typography

- Headings: Fraunces, semibold, for warmth.
- Body: Inter, regular.
- Times, doses and tool output: JetBrains Mono, so values align and are easy to scan.
- Scale: 12, 14, 16, 20, 28, 40. Hero facts (last dose time) use 40.

Spacing, shape and depth

- 4 px base grid, common steps 8, 16, 24, 32.
- Card radius 16, buttons 12, chips fully rounded.
- Depth from a subtle 1 px border and a soft glow on primary elements, not heavy shadows.
- Icons: Lucide, 1.5 px stroke.

## 5. Simulator layout

Desktop uses three panels.

- Left (260 px): care circle rail with the recipient, member list with colored dots, today's medication checklist, timer list and a check-in entry.
- Center (flexible): conversation with the voice orb pinned at the bottom, answer cards above it, and a day timeline that fills as things are logged.
- Right (340 px): tool trace and data inspector. Shows each MCP call with arguments, result and latency, and a live log table.

Mobile collapses to one column. The orb is a floating button, the rail becomes a drawer, and the trace opens as a bottom sheet.

## 6. Key screens

1. Idle: large orb, today's medication checklist, three suggested prompts such as 'Did Dad take his morning pills?', 'Log lunch', 'Give me a handoff'.
2. Listening: orb expands and the live transcript appears under it.
3. Answer card: spoken answer as a large time with a name, for example 'Given 8:05 am by Priya', the interval rule in small mono text, and a 'Why this answer' expander. A caution banner appears above it if a repeat dose is risky.
4. Care timeline: shared day view of timestamped doses, meals, moods and vitals, color-coded by member, with a pulse on the newest entry.
5. Handoff and visit report preview: rendered markdown with Export and Copy buttons and a visible 'Not medical advice' note.
6. Tool trace inspector: expandable rows for every tool call.
7. Red-flag escalation: full-width danger screen with an icon, the word Warning, the instruction to call the local emergency number and the clinician contact from the profile.

## 7. Components

- Voice orb with four states: idle (slow breathing), listening (reactive rings), thinking (rotating arc), speaking (waveform).
- Answer card with headline fact, member name, time and a safety slot.
- Log chip: category icon, text, member dot and a check mark once saved.
- Safety banner: amber for caution, red for red-flag, icon on the left, appears above the answer, never dismissed automatically.
- Medication checklist row: name, due time, status (given, due, overdue, skipped), who gave it.
- Tool call row: tool name, status dot, latency, expand for JSON.
- Timer ring: circular progress with a large remaining time.
- Check-in card: one gentle question at a time with large tap or voice answers.

## 8. Voice interface design

Example 1 (double-dose guard)

- Brother: Did Dad take his evening medication?
- CareThread: Yes. Priya gave it at 6:10 pm, about two hours ago.

Example 2 (logging)

- Daughter: Mum ate half her lunch and seemed confused around two.
- CareThread: Logged. Lunch half eaten, confusion at 2 pm, noted by Priya.

Example 3 (caution before a repeat)

- Brother: Log Dad's morning pills as given.
- CareThread: Careful, Priya logged those at 8:05 this morning. Do you want to log a second dose anyway?

Example 4 (safety)

- Daughter: Dad's face is drooping and his speech is slurred.
- CareThread: Call emergency services now. These can be signs of a stroke. I will note the time as 3:42 pm.

Rules: lead with the answer, keep it under two sentences, say names and times every time, confirm every write action, never reassure about a symptom, never suggest a dose.

## 9. Motion

- Orb state changes use 250 ms ease-out. Waveform reacts to real audio levels.
- New log entries slide in from the bottom of the timeline over 200 ms.
- Red-flag screen appears instantly with no animation delay.
- Respect reduced motion by replacing animation with a static state label.

## 10. Accessibility

- Text contrast at least 4.5:1, large facts at least 3:1.
- Everything the assistant says also appears as text, so the simulator works without sound, and caregivers who are hard of hearing are included.
- Full keyboard control: space to talk, Escape to cancel, focus rings in the primary color.
- Screen reader labels for orb state changes and live regions for new log entries.
- Do not rely on color alone for safety states or member identity. Pair with an icon, the word Warning, and member initials.
- Large touch targets (at least 48 px) for use with wet or gloved hands.

## 11. Deliverables

- Figma file with tokens, components and the seven screens.
- Logo as SVG, favicon and a 1280 x 640 social image.
- Dribbble inspiration board export with a one-line note per shot.
- Three-minute demo storyboard (below).

## 12. Demo storyboard (3 minutes)

| Time | Scene |
| --- | --- |
| 0:00 | Hook: a daughter lifting her father, phone out of reach, a sticky note on the fridge that no one updated |
| 0:20 | Daughter logs the morning pills by voice, show the answer card and the trace |
| 0:50 | Evening: the brother asks if Dad took his pills, hears who and when, then tries to log again and gets the caution |
| 1:30 | Log lunch and a confusion episode, then describe stroke signs and show the red-flag screen |
| 2:00 | Ask for a handoff, then export the visit report with trends and the doctor questions |
| 2:30 | Show the same server answering from the real Alexa+ path or simulator, then architecture and what is next |
