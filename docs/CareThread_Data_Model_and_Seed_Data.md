# CareThread: Data Model and Seed Data

Amazon Developer Hackathon · Alexa+ Track · Draft v1

## 1. Principles

- Store only what the care circle tells us. No inferred diagnoses, no scores about the recipient.
- All timestamps in UTC (ISO 8601 text) with the circle's IANA time zone stored once. Elapsed-time logic uses real elapsed minutes, never wall-clock subtraction.
- Writes are attributed to a member and recorded in an audit log.
- Soft delete first, hard purge on a schedule or on request.
- A repository interface sits in front of the database so SQLite can be replaced by DynamoDB.

## 2. Entity overview

```
users 1--n members n--1 care_circles
care_circles 1--n medications 1--n med_events
care_circles 1--n observations
care_circles 1--n vitals
care_circles 1--n timers
care_circles 1--n doctor_questions
members 1--n checkins
care_circles 1--n redflag_events
care_circles 1--n audit_log
```

## 3. SQLite schema

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE care_circles (
  id TEXT PRIMARY KEY,
  recipient_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  emergency_number TEXT NOT NULL DEFAULT '112',
  privacy_mode INTEGER NOT NULL DEFAULT 0,
  allergies_json TEXT NOT NULL DEFAULT '[]',
  clinicians_json TEXT NOT NULL DEFAULT '[]',
  vital_ranges_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES care_circles(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary','family','aide','viewer')),
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (circle_id, user_id)
);

CREATE TABLE medications (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES care_circles(id),
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  dose_text TEXT,
  times_json TEXT NOT NULL DEFAULT '[]',
  min_interval_minutes INTEGER
    CHECK (min_interval_minutes IS NULL OR min_interval_minutes BETWEEN 15 AND 1440),
  max_per_day INTEGER CHECK (max_per_day IS NULL OR max_per_day BETWEEN 1 AND 24),
  as_needed INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_meds_circle ON medications(circle_id, active);

CREATE TABLE med_events (
  id TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL REFERENCES medications(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL CHECK (status IN ('given','skipped','refused')),
  event_at TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  note TEXT,
  override_repeat INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE
);
CREATE INDEX idx_med_events_time ON med_events(medication_id, event_at DESC);

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES care_circles(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  category TEXT NOT NULL
    CHECK (category IN ('meals','mood','mobility','pain','sleep','bathroom','other')),
  text TEXT NOT NULL,
  severity INTEGER CHECK (severity IS NULL OR severity BETWEEN 1 AND 3),
  redflag_rule_id TEXT,
  recorded_at TEXT NOT NULL,
  logged_at TEXT NOT NULL
);
CREATE INDEX idx_obs_circle_time ON observations(circle_id, recorded_at DESC);

CREATE TABLE vitals (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES care_circles(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK (kind IN ('bp','glucose','temperature','weight','pulse','spo2')),
  value REAL NOT NULL,
  value2 REAL,
  unit TEXT NOT NULL,
  in_range INTEGER,
  recorded_at TEXT NOT NULL,
  logged_at TEXT NOT NULL
);
CREATE INDEX idx_vitals_circle_time ON vitals(circle_id, kind, recorded_at DESC);

CREATE TABLE timers (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES care_circles(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  name TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE TABLE doctor_questions (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES care_circles(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at TEXT NOT NULL
);

CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  answers_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE redflag_events (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES care_circles(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  rule_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('emergency','contact_clinician')),
  source_tool TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES care_circles(id),
  member_id TEXT REFERENCES members(id),
  tool TEXT NOT NULL,
  summary TEXT NOT NULL,
  at TEXT NOT NULL
);
```

Notes

- `audit_log.summary` holds tool name and subject type only, for example "med_log_given: dose override". It does not copy observation text.
- Redflag rules are not in the database. They are loaded from `src/data/redflags.json` so they can be reviewed as code.
- `override_repeat` marks a dose the speaker confirmed after a caution.

## 4. Data dictionary (key decisions)

| Field | Decision |
| --- | --- |
| event\_at vs logged\_at | event\_at is when it happened (may be backdated up to 24 h), logged\_at is when it was said. Guard logic uses event\_at |
| min\_interval\_minutes | Caregiver-entered from label or prescriber. NULL means no guard. Never filled in by us |
| severity | The speaker's words only ("worse than usual" is 3). Never computed |
| in\_range | NULL when no range is set. We never assume a default clinical range |
| role | primary can edit profile and medications, family and aide can log, viewer can read |
| color | Member color token for timeline attribution |

## 5. Query patterns (index check)

| Pattern | Query shape | Index used |
| --- | --- | --- |
| Last dose of a medication | latest med\_events by medication ordered by event\_at | idx\_med\_events\_time |
| Today's checklist | active medications joined with today's events | idx\_meds\_circle, idx\_med\_events\_time |
| Handoff window | observations and vitals by circle within a time range | idx\_obs\_circle\_time, idx\_vitals\_circle\_time |
| Trend counts | observations grouped by day and bucket | idx\_obs\_circle\_time |

## 6. Seed data (synthetic only)

Every seed value is fictional and for demonstration. The minimum gaps below are demo values, not guidance, and the README must say so.

Circle

| Field | Value |
| --- | --- |
| recipient\_name | Mr. Sharma ("Dad") |
| timezone | Asia/Kolkata |
| emergency\_number | 112 |
| clinicians | Dr. Rao, family doctor, 000-000-0000 (placeholder) |
| vital\_ranges | bp systolic 100 to 150, glucose 70 to 180 mg/dL (demo values) |

Members

| Name | Role | Color |
| --- | --- | --- |
| Priya | primary | #A5B4FC |
| Arjun | family | #F9A8D4 |
| Meera | aide | #FDE68A |
| Guest | viewer | #FDBA74 |

Medications

| Name | Dose text | Times | Min gap | Max/day |
| --- | --- | --- | --- | --- |
| Metformin | 500 mg tablet | 08:00, 20:00 | 480 min | 2 |
| Amlodipine | 5 mg tablet | 08:00 | 1200 min | 1 |
| Vitamin D | 1 capsule | 09:00 | 1380 min | 1 |

Pre-loaded history (so the demo works instantly)

- Yesterday: all scheduled doses given, one confusion note at 15:00, lunch half eaten.
- Two days ago: BP 142 over 90 mmHg, one note "dizzy after standing."
- Questions for doctor: "Is the dizziness related to the new tablet?", "Should his lunch portion change?"

Demo reset script: `npm run seed:demo` recreates this state and sets today's morning doses to unlogged so the live demo can start from a clean slate.

## 7. Retention, export and delete

| Action | Behavior |
| --- | --- |
| Export | Primary member can export the whole circle as JSON and the latest visit report as markdown |
| Delete | Sets `deleted_at` on the circle, hides all data immediately, hard purge after 7 days (demo: immediate purge option) |
| Demo accounts | Auto purge after 30 days |
| Backups | None for the hackathon. Production would need encrypted backups with the same delete guarantees |

## 8. Migrations

- Numbered SQL files in `server/src/db/migrations`, applied in order on startup and recorded in a `schema_migrations` table.
- Never edit a shipped migration. Add a new one.
- CI runs migrations on an empty database and on the seeded database.

## 9. DynamoDB mapping (later)

| Entity | Partition key | Sort key |
| --- | --- | --- |
| Circle | CIRCLE#id | META |
| Member | CIRCLE#id | MEMBER#id |
| Medication | CIRCLE#id | MED#id |
| Med event | CIRCLE#id | MEDEVT#medId#eventAt |
| Observation | CIRCLE#id | OBS#recordedAt#id |
| Vital | CIRCLE#id | VITAL#kind#recordedAt |

All access is by circle, so one partition per circle keeps authorization simple and queries cheap.
