import { db } from './index.js';
import { DateTime } from 'luxon';

export function seedDemo() {
  const now = DateTime.now().toUTC();
  
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM redflag_events;
    DELETE FROM checkins;
    DELETE FROM doctor_questions;
    DELETE FROM timers;
    DELETE FROM vitals;
    DELETE FROM observations;
    DELETE FROM med_events;
    DELETE FROM medications;
    DELETE FROM members;
    DELETE FROM care_circles;
    DELETE FROM users;
  `);

  // Insert Users
  db.prepare(`INSERT INTO users (id, created_at) VALUES (?, ?)`).run('u_priya', now.toISO());
  db.prepare(`INSERT INTO users (id, created_at) VALUES (?, ?)`).run('u_arjun', now.toISO());
  db.prepare(`INSERT INTO users (id, created_at) VALUES (?, ?)`).run('u_meera', now.toISO());
  db.prepare(`INSERT INTO users (id, created_at) VALUES (?, ?)`).run('u_guest', now.toISO());

  // Insert Circle
  const circleId = 'c_1';
  db.prepare(`
    INSERT INTO care_circles (id, recipient_name, timezone, emergency_number, privacy_mode, clinicians_json, vital_ranges_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    circleId, 
    'Mr. Sharma ("Dad")', 
    'Asia/Kolkata', 
    '112', 
    0, 
    JSON.stringify([{ name: 'Dr. Rao', role: 'family doctor', phone: '000-000-0000' }]),
    JSON.stringify({
      bp: { min: 100, max: 150, unit: 'mmHg' }, // Assuming min/max logic
      glucose: { min: 70, max: 180, unit: 'mg/dL' }
    }),
    now.toISO()
  );

  // Insert Members
  const insertMember = db.prepare(`INSERT INTO members (id, circle_id, user_id, display_name, role, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertMember.run('m_priya', circleId, 'u_priya', 'Priya', 'primary', '#A5B4FC', now.toISO());
  insertMember.run('m_arjun', circleId, 'u_arjun', 'Arjun', 'family', '#F9A8D4', now.toISO());
  insertMember.run('m_meera', circleId, 'u_meera', 'Meera', 'aide', '#FDE68A', now.toISO());
  insertMember.run('m_guest', circleId, 'u_guest', 'Guest', 'viewer', '#FDBA74', now.toISO());

  // Insert Medications
  const insertMed = db.prepare(`
    INSERT INTO medications (id, circle_id, name, dose_text, times_json, min_interval_minutes, max_per_day, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMed.run('med_metformin', circleId, 'Metformin', '500 mg tablet', JSON.stringify(['08:00', '20:00']), 480, 2, 'm_priya', now.toISO());
  insertMed.run('med_amlodipine', circleId, 'Amlodipine', '5 mg tablet', JSON.stringify(['08:00']), 1200, 1, 'm_priya', now.toISO());
  insertMed.run('med_vitamind', circleId, 'Vitamin D', '1 capsule', JSON.stringify(['09:00']), 1380, 1, 'm_priya', now.toISO());

  // Insert past events (Yesterday)
  const yesterday = now.minus({ days: 1 }).setZone('Asia/Kolkata').startOf('day');
  const insertMedEvent = db.prepare(`
    INSERT INTO med_events (id, medication_id, member_id, status, event_at, logged_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  // All scheduled doses given yesterday
  insertMedEvent.run('evt_1', 'med_metformin', 'm_priya', 'given', yesterday.set({ hour: 8 }).toUTC().toISO(), now.toISO());
  insertMedEvent.run('evt_2', 'med_metformin', 'm_arjun', 'given', yesterday.set({ hour: 20 }).toUTC().toISO(), now.toISO());
  insertMedEvent.run('evt_3', 'med_amlodipine', 'm_priya', 'given', yesterday.set({ hour: 8 }).toUTC().toISO(), now.toISO());
  insertMedEvent.run('evt_4', 'med_vitamind', 'm_priya', 'given', yesterday.set({ hour: 9 }).toUTC().toISO(), now.toISO());

  const insertObs = db.prepare(`
    INSERT INTO observations (id, circle_id, member_id, category, text, recorded_at, logged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertObs.run('obs_1', circleId, 'm_meera', 'other', 'confusion note', yesterday.set({ hour: 15 }).toUTC().toISO(), now.toISO());
  insertObs.run('obs_2', circleId, 'm_meera', 'meals', 'lunch half eaten', yesterday.set({ hour: 13 }).toUTC().toISO(), now.toISO());

  // Insert two days ago
  const twoDaysAgo = now.minus({ days: 2 }).setZone('Asia/Kolkata').startOf('day');
  const insertVital = db.prepare(`
    INSERT INTO vitals (id, circle_id, member_id, kind, value, value2, unit, recorded_at, logged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertVital.run('v_1', circleId, 'm_priya', 'bp', 142, 90, 'mmHg', twoDaysAgo.set({ hour: 10 }).toUTC().toISO(), now.toISO());
  insertObs.run('obs_3', circleId, 'm_priya', 'other', 'dizzy after standing', twoDaysAgo.set({ hour: 10, minute: 30 }).toUTC().toISO(), now.toISO());

  // Insert questions
  const insertQ = db.prepare(`
    INSERT INTO doctor_questions (id, circle_id, member_id, text, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertQ.run('q_1', circleId, 'm_priya', 'Is the dizziness related to the new tablet?', now.toISO());
  insertQ.run('q_2', circleId, 'm_priya', 'Should his lunch portion change?', now.toISO());

  console.log('Database seeded with demo data');
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedDemo();
}
