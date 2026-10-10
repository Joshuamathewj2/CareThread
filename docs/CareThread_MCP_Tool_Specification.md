# CareThread: MCP Tool Specification

Amazon Developer Hackathon · Alexa+ Track · Draft v1

## 1. Purpose and conventions

This document is the contract between the MCP server, the simulator agent and Alexa+. Every tool in the PRD catalog is defined here with inputs, outputs, spoken text, errors and tests. Code, README and tests must read from one registry file (`server/src/mcp/registry.ts`) so this document and the code never drift.

Conventions

- Tool names are snake_case. Field names are camelCase.
- All timestamps are ISO 8601 with offset on the wire and UTC in the database. Spoken times use the circle's time zone.
- Inputs are validated with Zod. Strings are capped (names 80, free text 500). Unknown fields are rejected.
- Every tool returns a spoken sentence first and structured data second. The spoken text is the only thing Alexa+ needs to read aloud.
- Safety information always comes first in the spoken text.
- The server never invents data. If something is not logged, it says "nothing logged", never "not taken".
- Verify the exact registration API (`registerTool`, `structuredContent`, `outputSchema`) against the MCP SDK version you install.

## 2. Request context and response envelope

Request context (resolved by auth middleware, never sent by the model)

| Field | Meaning |
| --- | --- |
| circleId | The care circle the token belongs to |
| memberId | The member who is speaking, used for attribution |
| role | primary, family, aide or viewer |
| now | Server clock, injectable for tests |

Response envelope (the `structuredContent` of every successful call)

```json
{
  "ok": true,
  "tool": "med_check_status",
  "safety": { "level": "none", "code": null },
  "data": {},
  "attribution": { "memberId": "m_1", "memberName": "Priya" },
  "at": "2026-10-10T14:05:00+05:30"
}
```

- `safety.level` is one of `none`, `caution`, `redflag`.
- `safety.code` is a stable code from the safety spec (for example `WITHIN_INTERVAL`, `RF-01`).
- When `safety.level` is not `none`, the first sentence of the spoken text states the safety message.

Spoken text rules

- At most two short sentences by default.
- Names and times in every write confirmation.
- Round to plain language: "about two hours ago", "this morning at 8:05".
- Never include reassurance, diagnosis or dose suggestions.

## 3. Error model

Errors use `isError: true` with a spoken-friendly message and a stable code. No stack traces, no internal IDs.

| Code | When | Spoken message |
| --- | --- | --- |
| FORBIDDEN\_ROLE | Viewer tries to write | "You can view the log but not change it. Ask the primary caregiver to add you." |
| NO\_CIRCLE | Token has no circle | "I can't find your care circle. Please set it up in the app first." |
| MEDICATION\_NOT\_FOUND | No match for the name | "I don't have a medication called {name}. Want me to add it?" |
| AMBIGUOUS\_MEDICATION | More than one match | "Do you mean {a} or {b}?" |
| INVALID\_TIME | Future time or unparseable | "I couldn't use that time. Tell me how long ago it was." |
| INVALID\_VALUE | Out of numeric bounds | "That number looks off. Say it again?" |
| RATE\_LIMITED | Too many calls | "I'm getting too many requests, try again in a moment." |
| INTERNAL | Unexpected failure | "Something went wrong and I did not save that. Please try again." |

Rule: a failed write must say clearly that nothing was saved.

## 4. Tool definitions

Shared input fragments

- `at` (optional string): ISO 8601 timestamp for when the thing happened.
- `minutesAgo` (optional integer, 0 to 1440): alternative to `at`. Exactly one of the two may be set. Neither means now. Anything more than 5 minutes in the future is `INVALID_TIME`.
- Medication names match case-insensitively against name and aliases, with fuzzy matching within two edits. One match proceeds, several return `AMBIGUOUS_MEDICATION`, none returns `MEDICATION_NOT_FOUND`.

### 4.1 recipient\_profile

Purpose: set or read the care recipient's basics.
Annotations: readOnlyHint false, destructiveHint false.
Roles: read by all, write by primary.

| Input | Type | Notes |
| --- | --- | --- |
| action | "get" or "set" | |
| recipientName | string | set only |
| timezone | IANA string | set only, validated |
| allergies | string[] (max 20) | set only, caregiver-entered text |
| clinicians | { name, role, phone }[] (max 5) | set only |
| emergencyNumber | string | defaults by locale, caregiver may override |
| vitalRanges | map of kind to { min, max, unit } | set only, entered from clinician instructions |
| privacyMode | boolean | set only |

Spoken (set): "Saved the profile for {recipientName}."
Spoken (get): "{recipientName}. Allergies on file: {list or none}. Emergency number {n}."
Errors: FORBIDDEN\_ROLE, INVALID\_VALUE.

### 4.2 med\_schedule\_set

Purpose: add or update a medication as entered by the caregiver. The server stores what it is told and gives no dosing advice.
Roles: primary.

| Input | Type | Notes |
| --- | --- | --- |
| name | string | required |
| aliases | string[] | optional, for example brand names |
| doseText | string | free text as printed on the label, for display only |
| times | string[] of "HH:mm" | scheduled times, optional |
| asNeeded | boolean | default false |
| minIntervalMinutes | integer 15 to 1440 | from the label or prescriber, optional |
| maxPerDay | integer 1 to 24 | optional |
| note | string | optional |

Spoken: "Added {name}. {interval sentence}" where the interval sentence is "Minimum gap {x} hours." or "No minimum gap set, so I can't warn about repeats."
Note: when no interval is set, the spoken text always says so.

### 4.3 med\_log\_given

Purpose: record a dose as given, skipped or refused, attributed to the speaker.
Roles: primary, family, aide.

| Input | Type | Notes |
| --- | --- | --- |
| medication | string | required |
| status | "given", "skipped" or "refused" | default "given" |
| at / minutesAgo | see shared fragments | optional |
| note | string | optional |
| confirmRepeat | boolean | default false |
| idempotencyKey | string | optional, set by the agent per user turn to prevent double writes |

Behavior

1. Resolve medication. Run the dose guard against the event time.
2. If the guard returns a caution and `confirmRepeat` is false, do not write. Return `safety.level = caution` and ask one yes or no question.
3. If `confirmRepeat` is true, write with `override_repeat = 1` and record the caution in the audit log.
4. Otherwise write and confirm with member, time and medication.

Spoken (written): "Logged: {medication}, {time}, by {member}."
Spoken (caution, not written): "Careful, {member2} logged {medication} {when}. Do you want to log another dose anyway?"
Output data: `{ eventId, status, eventAt, guard: { code, lastEventAt, lastMember } }`

### 4.4 med\_check\_status

Purpose: answer "was it already given, by whom and when?" Read-only.
Roles: all.

| Input | Type | Notes |
| --- | --- | --- |
| medication | string | optional. Omit to get today's whole checklist |

Output data: `{ medication, state, lastEvent: { status, at, member } | null, nextDueAt, intervalCode }` where `state` is `given`, `skipped`, `refused`, `nothing_logged`.

Spoken examples

- "Yes. Priya gave it at 6:10 pm, about two hours ago."
- "Nothing is logged for metformin today."
- Whole list: "Today: metformin given at 8:05, amlodipine given at 8:07, evening metformin not logged yet."

Never say "not taken". Say "not logged".

### 4.5 log\_observation

Purpose: store a categorized observation. The text is run through the red-flag engine first.
Roles: primary, family, aide.

| Input | Type | Notes |
| --- | --- | --- |
| category | meals, mood, mobility, pain, sleep, bathroom, other | the agent picks, default other |
| text | string max 500 | what the speaker said, lightly cleaned |
| severity | 1 to 3 | optional, 3 means "worse than usual" as said by the speaker |
| at / minutesAgo | see shared fragments | optional |

Behavior: if a red-flag rule matches, the response leads with the escalation instruction, the observation is still saved, and a `redflag_events` row is written.
Spoken (normal): "Logged: {short summary}, by {member}."
Spoken (red flag): "{instruction} I have noted the time as {time}."

### 4.6 log\_vital

Purpose: store a numeric reading and compare it with ranges the caregiver or clinician set.
Roles: primary, family, aide.

| Input | Type | Notes |
| --- | --- | --- |
| kind | bp, glucose, temperature, weight, pulse, spo2 | |
| value | number | systolic for bp |
| value2 | number | diastolic for bp only |
| unit | string | mmHg, mg/dL, mmol/L, C, F, kg, lb, bpm, percent |
| at / minutesAgo | see shared fragments | optional |

Behavior

- Bounds check for plausibility (for example temperature 30 to 45 C) returns `INVALID_VALUE` if impossible.
- If a range exists for this kind, `in_range` is stored. Out of range returns `safety.level = caution` with "outside the range set for {name}. Contact {clinician or the family doctor}." If no range exists, say "No range is set, so I can't compare it."
- Unit conversion is not done silently. Different unit than the profile range returns a clarifying question.

Spoken: "Logged: blood pressure 138 over 86 mmHg at 9:15, by {member}."

### 4.7 redflag\_check

Purpose: take a described symptom and return an escalation instruction without storing anything. Read-only.
Roles: all.

| Input | Type | Notes |
| --- | --- | --- |
| description | string max 500 | what the speaker described |
| symptoms | string[] | optional, normalized terms extracted by the agent |

Output data: `{ level: "emergency" | "contact_clinician" | "none", ruleId, instruction, emergencyNumber, matched: string[], negated: string[] }`

Spoken (emergency): "Call {emergencyNumber} now. {rule-specific one line}."
Spoken (contact clinician): "Contact {clinician name or your doctor} today about this."
Spoken (none): "I can't judge symptoms. If you are worried, contact the doctor or call {emergencyNumber}."

The "none" result never reassures.

### 4.8 handoff\_summary

Purpose: short summary of a time window for the next caregiver. Read-only.
Roles: all.

| Input | Type | Notes |
| --- | --- | --- |
| window | last\_shift, today, last\_24h | default last\_shift |
| hours | integer 1 to 72 | optional override |

Output data: `{ window, doses: [], missedOrNotLogged: [], meals: [], moods: [], vitals: [], redflags: [], openQuestions: n }`

Spoken: at most three sentences. Order: red flags first, then doses and anything not logged, then observations. Example: "Today: all morning doses given, evening metformin not logged yet. Lunch half eaten and some confusion at 2 pm. One question saved for the doctor."
The full text is also written to the screen. If privacy mode is on, spoken text is "Your handoff for {recipientName} is on the screen."

### 4.9 trend\_insights

Purpose: plain counts and patterns, stated as facts. Read-only.
Roles: all.

| Input | Type | Notes |
| --- | --- | --- |
| metric | meals\_eaten, confusion\_episodes, sleep\_issues, falls, vitals\_out\_of\_range, doses\_not\_logged | |
| days | integer 3 to 30 | default 7 |

Method: counts per day and per time-of-day bucket (morning, afternoon, evening, night). No predictions, no causes.
Spoken: "In the last 7 days, confusion was noted 4 times, 3 of them between 1 and 4 pm."
If fewer than 3 entries: "There isn't enough logged to see a pattern yet."

### 4.10 visit\_export

Purpose: generate a markdown report for the clinician. Read-only.
Roles: primary, family.

| Input | Type | Notes |
| --- | --- | --- |
| fromDate / toDate | ISO dates | default last 14 days |
| appointmentDate | ISO date | optional, shown in the header |

Report sections (in order)

1. Title, recipient name, period, generated by and time, "Prepared from a family caregiver's voice log. Not medical advice."
2. Medications as entered by the caregiver (name, dose text, schedule, minimum gap).
3. Dose record: counts of given, skipped, refused, not logged per medication.
4. Vitals table with range flags.
5. Observation timeline grouped by day.
6. Trends from `trend_insights`.
7. Red-flag events with times and who logged them.
8. Questions for the doctor.
9. Caregiver notes placeholder.

Output data: `{ markdown, resourceUri, counts }`
Spoken: "Your visit report is ready: 14 days, {n} observations, {q} questions for the doctor."

### 4.11 question\_for\_doctor

| Input | Type | Notes |
| --- | --- | --- |
| action | add, list, mark\_done | |
| text | string max 300 | add only |
| questionId | string | mark\_done only |

Spoken (add): "Saved for the next appointment: {short text}." (list): "{n} questions saved. First: {text}."

### 4.12 care\_timer

| Input | Type | Notes |
| --- | --- | --- |
| action | start, check, cancel | |
| name | string max 60 | for example "recheck blood sugar" |
| minutes | integer 1 to 720 | start only |

Spoken: "Timer set: {name}, {minutes} minutes." (check): "{name} has {m} minutes left."
Timers are informational. They are not a medication reminder system and never imply a dose is due.

### 4.13 caregiver\_checkin

Purpose: a short wellbeing check for the caregiver, not a clinical screening.

| Input | Type | Notes |
| --- | --- | --- |
| action | start, answer, summary | |
| questionId | string | answer only |
| answer | integer 1 to 5 or short text | answer only |

Questions (fixed list, max five): sleep last night, stress today, physical strain, help available this week, anything you need to tell someone.
Spoken (summary): "Thanks for checking in. It sounds like a heavy week. Want me to save a note to ask the family for help?"
If any answer mentions self-harm, the response is the crisis instruction from the safety spec, not a check-in summary.

## 5. Resources and prompts

Resources (read-only)

- `carethread://circle/{id}/log/today`: today's timeline as JSON.
- `carethread://circle/{id}/report/{reportId}`: a generated visit report in markdown.

Prompts

- `visit_report_template`: the section list above, so Alexa+ or a client can ask for a report in a consistent format.
- `handoff_template`: the spoken handoff order of information.

## 6. Registry file format

One file defines every tool: name, title, description, input schema, annotations, handler reference, roles and spoken template ids. The README tool table, the tests and the Inspector script are generated from it.

## 7. Conformance checklist

- Every tool appears in tool discovery with a description under 200 characters, an input schema and annotations.
- Every tool has a happy-path test, an error test and a role test.
- Every write tool returns a confirmation containing member, subject and time.
- Every spoken response is two sentences or fewer in the default path.
- No response matches the forbidden-output patterns in the safety spec.
- Tools respond within the latency budget (500 ms for logs and status, 1.5 s for summaries).
