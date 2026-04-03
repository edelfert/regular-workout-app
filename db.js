const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'workout.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS workout_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    target_sets INTEGER NOT NULL DEFAULT 3,
    rep_range_low INTEGER NOT NULL,
    rep_range_high INTEGER NOT NULL,
    is_bodyweight INTEGER NOT NULL DEFAULT 0,
    is_compound INTEGER NOT NULL DEFAULT 0,
    starting_weight REAL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (day_id) REFERENCES workout_days(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    weight REAL,
    reps TEXT NOT NULL,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
    UNIQUE(exercise_id, date)
  );
`);

module.exports = db;
