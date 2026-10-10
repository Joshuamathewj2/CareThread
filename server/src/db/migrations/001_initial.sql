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
