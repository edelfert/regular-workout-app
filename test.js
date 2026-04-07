const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Shim localStorage for Node
const storage = {};
globalThis.localStorage = {
  getItem(key) { return storage[key] ?? null; },
  setItem(key, val) { storage[key] = String(val); },
  removeItem(key) { delete storage[key]; },
  clear() { for (const k in storage) delete storage[k]; },
};

// Load the DB module by evaluating db.js (it's an IIFE that assigns to DB)
const dbCode = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
eval(dbCode);

// Load the exercise library
const libCode = fs.readFileSync(path.join(__dirname, 'exercise-library.js'), 'utf8');
eval(libCode);

function resetAndSeed() {
  localStorage.clear();
  DB.seed();
}

describe('Data Layer', () => {

  beforeEach(() => { resetAndSeed(); });

  it('seed creates 4 workout days', () => {
    const days = DB.getDays();
    assert.strictEqual(days.length, 4);
    assert.strictEqual(days[0].day_number, 1);
    assert.strictEqual(days[3].day_number, 4);
  });

  it('seed is idempotent', () => {
    DB.seed(); // second call
    assert.strictEqual(DB.getDays().length, 4);
  });

  it('getExercises returns exercises for a day', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    assert.strictEqual(exercises.length, 6);
    assert.strictEqual(exercises[0].name, 'Push-Ups');
  });

  it('seed includes historical session data from 2025-03-30', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const progress = DB.getProgress(exercises[1].id); // Leg Press
    assert.strictEqual(progress.sessions.length, 1);
    assert.strictEqual(progress.sessions[0].date, '2025-03-30');
    assert.strictEqual(progress.sessions[0].weight, 90);
    assert.deepStrictEqual(progress.sessions[0].reps, [10, 10, 10]);
  });
});

describe('Session Logging', () => {

  beforeEach(() => { resetAndSeed(); });

  it('logs a valid workout session', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);

    const result = DB.logSession(ex.id, '2025-04-01', ex.starting_weight, [10, 10, 10]);
    assert.ok(result.id);
    assert.ok(result.suggestion);

    const progress = DB.getProgress(ex.id);
    assert.ok(progress.sessions.some(s => s.date === '2025-04-01'));
  });

  it('rejects duplicate session for same exercise and date', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);

    DB.logSession(ex.id, '2025-04-02', ex.starting_weight, [10, 10, 10]);
    assert.throws(
      () => DB.logSession(ex.id, '2025-04-02', ex.starting_weight, [10, 10, 10]),
      /already logged/
    );
  });

  it('logSession throws for non-existent exercise', () => {
    assert.throws(
      () => DB.logSession(9999, '2025-04-03', 50, [10, 10, 10]),
      /not found/
    );
  });

  it('logs bodyweight exercise without weight', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const bwEx = exercises.find(e => e.is_bodyweight);

    const result = DB.logSession(bwEx.id, '2025-04-01', null, [12, 12, 12]);
    assert.ok(result.id);

    const progress = DB.getProgress(bwEx.id);
    const session = progress.sessions.find(s => s.date === '2025-04-01');
    assert.strictEqual(session.weight, null);
  });

  it('deleteSession removes a session', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);

    const result = DB.logSession(ex.id, '2025-04-05', ex.starting_weight, [10, 10, 10]);
    DB.deleteSession(result.id);

    const progress = DB.getProgress(ex.id);
    assert.ok(!progress.sessions.some(s => s.date === '2025-04-05'));
  });

  it('deleteSession throws for non-existent session', () => {
    assert.throws(() => DB.deleteSession(99999), /not found/);
  });
});

describe('Progress', () => {

  beforeEach(() => { resetAndSeed(); });

  it('getProgress returns correct shape', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const progress = DB.getProgress(exercises[0].id);

    assert.ok(progress.exercise);
    assert.ok(Array.isArray(progress.sessions));
    if (progress.sessions.length > 0) {
      const s = progress.sessions[0];
      assert.ok('date' in s);
      assert.ok('reps' in s);
      assert.ok('avgReps' in s);
    }
  });

  it('getProgress returns suggestion based on last session', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    const progress = DB.getProgress(ex.id);
    assert.ok(progress.suggestion);
    assert.ok(progress.suggestion.message);
  });
});

describe('Progressive Overload Suggestion Logic', () => {

  const compoundExercise = {
    is_bodyweight: false, is_compound: true,
    rep_range_low: 8, rep_range_high: 12,
  };

  const isolationExercise = {
    is_bodyweight: false, is_compound: false,
    rep_range_low: 8, rep_range_high: 12,
  };

  const bodyweightExercise = {
    is_bodyweight: true, is_compound: true,
    rep_range_low: 10, rep_range_high: 15,
  };

  it('suggests weight increase when all sets at top of range (compound)', () => {
    const result = DB.computeSuggestion(compoundExercise, 100, [12, 12, 12]);
    assert.strictEqual(result.action, 'increase');
    assert.strictEqual(result.newWeight, 105);
  });

  it('suggests weight increase when all sets at top of range (isolation)', () => {
    const result = DB.computeSuggestion(isolationExercise, 20, [12, 12, 12]);
    assert.strictEqual(result.action, 'increase');
    assert.strictEqual(result.newWeight, 22.5);
  });

  it('suggests hold when some sets at top, some not', () => {
    const result = DB.computeSuggestion(compoundExercise, 100, [12, 10, 10]);
    assert.strictEqual(result.action, 'hold');
    assert.strictEqual(result.newWeight, 100);
  });

  it('suggests drop when any set below bottom of range', () => {
    const result = DB.computeSuggestion(compoundExercise, 100, [7, 8, 6]);
    assert.strictEqual(result.action, 'drop');
    assert.ok(result.newWeight < 100);
  });

  it('handles bodyweight increase suggestion', () => {
    const result = DB.computeSuggestion(bodyweightExercise, null, [15, 15, 15]);
    assert.strictEqual(result.action, 'increase_reps');
  });

  it('handles bodyweight hold suggestion', () => {
    const result = DB.computeSuggestion(bodyweightExercise, null, [12, 12, 12]);
    assert.strictEqual(result.action, 'hold');
  });

  it('handles bodyweight below range', () => {
    const result = DB.computeSuggestion(bodyweightExercise, null, [9, 10, 10]);
    assert.strictEqual(result.action, 'hold');
    assert.ok(result.message.includes('below'));
  });
});

describe('Manage: Add Exercise & Day', () => {

  beforeEach(() => { resetAndSeed(); });

  it('addExercise adds to an existing day', () => {
    const days = DB.getDays();
    const before = DB.getExercises(days[0].id);
    DB.addExercise(days[0].id, {
      name: 'Face Pulls', target_sets: 3, rep_range_low: 12, rep_range_high: 15,
      is_bodyweight: false, is_compound: false, starting_weight: 20,
    });
    const after = DB.getExercises(days[0].id);
    assert.strictEqual(after.length, before.length + 1);
    assert.strictEqual(after[after.length - 1].name, 'Face Pulls');
  });

  it('addExercise throws for non-existent day', () => {
    assert.throws(
      () => DB.addExercise(9999, {
        name: 'Test', target_sets: 3, rep_range_low: 8, rep_range_high: 12,
      }),
      /not found/
    );
  });

  it('createDay adds a new workout day', () => {
    const before = DB.getDays();
    DB.createDay('Day 5 — Arms', [
      { name: 'Barbell Curl', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: false, starting_weight: 30 },
    ]);
    const after = DB.getDays();
    assert.strictEqual(after.length, before.length + 1);
    assert.strictEqual(after[after.length - 1].name, 'Day 5 — Arms');
  });

  it('resetDatabase restores defaults', () => {
    DB.createDay('Extra Day', [
      { name: 'Test', target_sets: 3, rep_range_low: 8, rep_range_high: 12 },
    ]);
    assert.strictEqual(DB.getDays().length, 5);
    DB.resetDatabase();
    assert.strictEqual(DB.getDays().length, 4);
  });
});

describe('getLastSession', () => {

  beforeEach(() => { resetAndSeed(); });

  it('returns the most recent session for an exercise', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    // Seed has a historical session; log another
    DB.logSession(ex.id, '2025-04-10', ex.starting_weight, [10, 10, 10]);
    const last = DB.getLastSession(ex.id);
    assert.strictEqual(last.date, '2025-04-10');
  });

  it('returns null when no sessions exist', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[1].id); // Day 2 has no seed sessions
    const last = DB.getLastSession(exercises[0].id);
    assert.strictEqual(last, null);
  });
});

describe('History / Calendar (DB)', () => {

  beforeEach(() => { resetAndSeed(); });

  it('getSessionsByDateRange returns correct sessions within range', () => {
    const sessions = DB.getSessionsByDateRange('2025-03-01', '2025-03-31');
    assert.ok(sessions.length > 0, 'Should have sessions in March 2025 from seed');
    assert.ok(sessions.every(s => s.date >= '2025-03-01' && s.date <= '2025-03-31'));
  });

  it('getSessionsByDateRange excludes sessions outside range', () => {
    const sessions = DB.getSessionsByDateRange('2024-01-01', '2024-01-31');
    assert.strictEqual(sessions.length, 0);
  });

  it('empty date range returns empty array', () => {
    const sessions = DB.getSessionsByDateRange('2020-01-01', '2020-01-01');
    assert.strictEqual(sessions.length, 0);
  });

  it('getSessionsByDateRange includes exercise name', () => {
    const sessions = DB.getSessionsByDateRange('2025-03-30', '2025-03-30');
    assert.ok(sessions.length > 0);
    assert.ok(sessions[0].exerciseName, 'Session should have exerciseName');
  });

  it('streak counts consecutive workout days', () => {
    // Log sessions on consecutive days ending today
    const today = new Date();
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);

    for (let i = 2; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      try { DB.logSession(ex.id, dateStr, ex.starting_weight, [10, 10, 10]); } catch (e) { /* dupe */ }
    }
    const streak = DB.getWorkoutStreak();
    assert.ok(streak >= 3, `Expected streak >= 3, got ${streak}`);
  });

  it('streak breaks on a gap day', () => {
    // Log only 2 days ago (not yesterday or today)
    const days = DB.getDays();
    const exercises = DB.getExercises(days[1].id); // Day 2
    const ex = exercises[0];
    const d = new Date();
    d.setDate(d.getDate() - 3);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    try { DB.logSession(ex.id, dateStr, 50, [10, 10, 10]); } catch (e) { /* */ }
    const streak = DB.getWorkoutStreak();
    assert.strictEqual(streak, 0, 'Streak should be 0 if last workout was >1 day ago');
  });
});

describe('Exercise Library', () => {

  it('library has at least 80 exercises', () => {
    assert.ok(EXERCISE_LIBRARY.length >= 80, `Expected >=80, got ${EXERCISE_LIBRARY.length}`);
  });

  it('all entries have required fields', () => {
    const required = ['name', 'category', 'equipment', 'muscleGroup', 'secondaryMuscles',
      'isCompound', 'defaultSets', 'defaultRepRangeLow', 'defaultRepRangeHigh', 'description'];
    for (const ex of EXERCISE_LIBRARY) {
      for (const field of required) {
        assert.ok(ex[field] !== undefined, `${ex.name || 'unnamed'} missing ${field}`);
      }
    }
  });

  it('entries have valid categories', () => {
    const valid = ['chest', 'back', 'shoulders', 'legs', 'arms', 'core'];
    for (const ex of EXERCISE_LIBRARY) {
      assert.ok(valid.includes(ex.category), `${ex.name} has invalid category: ${ex.category}`);
    }
  });

  it('entries have valid equipment types', () => {
    const valid = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'band'];
    for (const ex of EXERCISE_LIBRARY) {
      assert.ok(valid.includes(ex.equipment), `${ex.name} has invalid equipment: ${ex.equipment}`);
    }
  });

  it('no duplicate exercise names', () => {
    const names = EXERCISE_LIBRARY.map(e => e.name.toLowerCase());
    const unique = new Set(names);
    assert.strictEqual(names.length, unique.size, 'Duplicate exercise names found');
  });

  it('adding from library creates valid exercise in DB', () => {
    resetAndSeed();
    const libEx = EXERCISE_LIBRARY[0];
    const days = DB.getDays();
    const added = DB.addExercise(days[0].id, {
      name: libEx.name,
      target_sets: libEx.defaultSets,
      rep_range_low: libEx.defaultRepRangeLow,
      rep_range_high: libEx.defaultRepRangeHigh,
      is_bodyweight: libEx.equipment === 'bodyweight',
      is_compound: libEx.isCompound,
      starting_weight: null,
    });
    assert.strictEqual(added.name, libEx.name);
    assert.strictEqual(added.target_sets, libEx.defaultSets);
  });
});

describe('Rest Timer (DB)', () => {

  beforeEach(() => { resetAndSeed(); });

  it('seed sets rest_seconds defaults: compound=90, isolation=60, bodyweight=0', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const bw = exercises.find(e => e.is_bodyweight);
    const compound = exercises.find(e => !e.is_bodyweight && e.is_compound);
    const isolation = exercises.find(e => !e.is_bodyweight && !e.is_compound);
    assert.strictEqual(bw.rest_seconds, 0);
    assert.strictEqual(compound.rest_seconds, 90);
    assert.strictEqual(isolation.rest_seconds, 60);
  });

  it('custom rest_seconds persists after save/reload', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises[0];
    DB.updateExercise(ex.id, { rest_seconds: 120 });
    const updated = DB.getExercises(days[0].id).find(e => e.id === ex.id);
    assert.strictEqual(updated.rest_seconds, 120);
  });

  it('rest_seconds of 0 means timer disabled', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const bw = exercises.find(e => e.is_bodyweight);
    assert.strictEqual(bw.rest_seconds, 0);
  });

  it('addExercise with custom rest_seconds', () => {
    const days = DB.getDays();
    const added = DB.addExercise(days[0].id, {
      name: 'Custom Rest', target_sets: 3, rep_range_low: 8, rep_range_high: 12,
      is_bodyweight: false, is_compound: false, starting_weight: 20, rest_seconds: 45,
    });
    assert.strictEqual(added.rest_seconds, 45);
  });

  it('addExercise without rest_seconds gets default', () => {
    const days = DB.getDays();
    const added = DB.addExercise(days[0].id, {
      name: 'No Rest Specified', target_sets: 3, rep_range_low: 8, rep_range_high: 12,
      is_bodyweight: false, is_compound: true, starting_weight: 50,
    });
    assert.strictEqual(added.rest_seconds, 90);
  });

  it('migration adds rest_seconds to exercises missing it', () => {
    // Simulate old data without rest_seconds
    const raw = localStorage.getItem('workout_tracker_db');
    const data = JSON.parse(raw);
    for (const ex of data.exercises) delete ex.rest_seconds;
    localStorage.setItem('workout_tracker_db', JSON.stringify(data));
    // Force cache invalidation by reading after modification
    const exercises = DB.getExercises(DB.getDays()[0].id);
    exercises.forEach(ex => {
      assert.ok(ex.rest_seconds !== undefined, `${ex.name} should have rest_seconds after migration`);
    });
  });
});

describe('Validation', () => {

  beforeEach(() => { resetAndSeed(); });

  it('logSession rejects wrong number of sets', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight); // target_sets: 3
    assert.throws(
      () => DB.logSession(ex.id, '2025-05-01', ex.starting_weight, [10, 10]),
      /Expected 3 sets but got 2/
    );
  });

  it('recovers from corrupt localStorage data', () => {
    localStorage.setItem('workout_tracker_db', 'not valid json!!!');
    // Should not throw — falls back to empty DB
    const days = DB.getDays();
    assert.strictEqual(days.length, 0);
  });

  it('recovers from malformed localStorage object', () => {
    localStorage.setItem('workout_tracker_db', JSON.stringify({ bad: true }));
    const days = DB.getDays();
    assert.strictEqual(days.length, 0);
  });

  it('preserves starting_weight of 0', () => {
    const days = DB.getDays();
    const added = DB.addExercise(days[0].id, {
      name: 'Zero Weight Ex', target_sets: 3, rep_range_low: 8, rep_range_high: 12,
      is_bodyweight: false, is_compound: false, starting_weight: 0,
    });
    assert.strictEqual(added.starting_weight, 0);
  });

  it('normalizes date format in logSession', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    // Log with non-padded date
    const result = DB.logSession(ex.id, '2025-4-1', ex.starting_weight, [10, 10, 10]);
    assert.ok(result.id);
    const progress = DB.getProgress(ex.id);
    const session = progress.sessions.find(s => s.date === '2025-04-01');
    assert.ok(session, 'Date should be normalized to zero-padded format');
  });

  it('rejects invalid date format in logSession', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    assert.throws(
      () => DB.logSession(ex.id, 'not-a-date', ex.starting_weight, [10, 10, 10]),
      /Invalid date format/
    );
  });

  it('createDay rejects empty name', () => {
    assert.throws(
      () => DB.createDay('', [{ name: 'Test', target_sets: 3, rep_range_low: 8, rep_range_high: 12 }]),
      /Day name is required/
    );
  });

  it('createDay rejects empty exercise list', () => {
    assert.throws(
      () => DB.createDay('Test Day', []),
      /At least one exercise/
    );
  });

  it('addExercise rejects invalid exercise fields', () => {
    const days = DB.getDays();
    assert.throws(
      () => DB.addExercise(days[0].id, {
        name: '', target_sets: 3, rep_range_low: 8, rep_range_high: 12,
      }),
      /Exercise name is required/
    );
    assert.throws(
      () => DB.addExercise(days[0].id, {
        name: 'Test', target_sets: 0, rep_range_low: 8, rep_range_high: 12,
      }),
      /Target sets must be at least 1/
    );
    assert.throws(
      () => DB.addExercise(days[0].id, {
        name: 'Test', target_sets: 3, rep_range_low: 8, rep_range_high: 5,
      }),
      /Rep range high must be >= rep range low/
    );
  });

  it('computeSuggestion rounds increase weight to nearest 0.5', () => {
    const ex = { is_bodyweight: false, is_compound: false, rep_range_low: 8, rep_range_high: 12 };
    // 22.3 + 2.5 = 24.8 -> should round to 25.0
    const result = DB.computeSuggestion(ex, 22.3, [12, 12, 12]);
    assert.strictEqual(result.action, 'increase');
    assert.strictEqual(result.newWeight, 25); // rounded to nearest 0.5
  });

  it('rejects semantically invalid date (month 13)', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    assert.throws(
      () => DB.logSession(ex.id, '2025-13-01', ex.starting_weight, [10, 10, 10]),
      /month or day out of range/
    );
  });

  it('rejects semantically invalid date (day 0)', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    assert.throws(
      () => DB.logSession(ex.id, '2025-01-00', ex.starting_weight, [10, 10, 10]),
      /month or day out of range/
    );
  });

  it('auto-repairs _nextId after loading data with high IDs', () => {
    // Manually tamper with storage to simulate partial corruption
    // Must read directly from localStorage (bypassing cache) and write back
    const raw = localStorage.getItem('workout_tracker_db');
    assert.ok(raw, 'DB should exist in localStorage after seed');
    const data = JSON.parse(raw);
    data._nextId.days = 1; // set too low — should be auto-repaired
    data._nextId.exercises = 1;
    data._nextId.sessions = 1;
    localStorage.setItem('workout_tracker_db', JSON.stringify(data));
    // Creating a new day triggers load() which should auto-repair _nextId
    const day = DB.createDay('Test Day', [
      { name: 'Test Ex', target_sets: 3, rep_range_low: 8, rep_range_high: 12 },
    ]);
    const allDays = DB.getDays();
    const ids = allDays.map(d => d.id);
    // Verify all IDs are unique
    assert.strictEqual(new Set(ids).size, ids.length, 'All day IDs should be unique');
  });
});
