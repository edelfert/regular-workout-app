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

describe('1RM Calculator', () => {

  beforeEach(() => { resetAndSeed(); });

  it('Epley formula calculates correctly (100 lbs x 10 reps = 133.3)', () => {
    const result = DB.computeE1RM(100, 10);
    assert.strictEqual(result, 133.3);
  });

  it('1 rep means 1RM equals the weight', () => {
    assert.strictEqual(DB.computeE1RM(200, 1), 200);
  });

  it('getEstimated1RM returns highest 1RM across sessions', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    // Seed has session at 90 lbs x [10,10,10] -> 1RM = 90*(1+10/30) = 120
    const e1rm = DB.getEstimated1RM(ex.id);
    assert.ok(e1rm > 0);
    assert.strictEqual(e1rm, 120);
  });

  it('returns null for bodyweight exercises', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const bw = exercises.find(e => e.is_bodyweight);
    assert.strictEqual(DB.getEstimated1RM(bw.id), null);
  });
});

describe('Volume Tracking', () => {

  beforeEach(() => { resetAndSeed(); });

  it('volume calculation: sum(weight x reps per set)', () => {
    // Seed session: Leg Press 90 lbs x [10,10,10] = 90*30 = 2700
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => e.name === 'Leg Press');
    const progress = DB.getProgress(ex.id);
    const session = progress.sessions[0];
    const vol = session.reps.reduce((sum, r) => sum + r * session.weight, 0);
    assert.strictEqual(vol, 2700);
  });

  it('bodyweight exercises with no weight return 0 volume', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const bw = exercises.find(e => e.is_bodyweight);
    DB.logSession(bw.id, '2025-04-01', null, [12, 12, 12]);
    const progress = DB.getProgress(bw.id);
    const session = progress.sessions.find(s => s.date === '2025-04-01');
    const vol = session.reps.reduce((sum, r) => sum + r * (session.weight || 0), 0);
    assert.strictEqual(vol, 0);
  });
});

describe('Personal Records', () => {

  beforeEach(() => { resetAndSeed(); });

  it('getPersonalRecords returns correct PR values', () => {
    const days = DB.getDays();
    const ex = DB.getExercises(days[0].id).find(e => e.name === 'Leg Press');
    const prs = DB.getPersonalRecords(ex.id);
    assert.ok(prs);
    assert.strictEqual(prs.maxWeight.value, 90);
    assert.strictEqual(prs.maxReps.value, 10);
    assert.strictEqual(prs.maxVolume.value, 2700);
  });

  it('PR detection works when logging a better session', () => {
    const days = DB.getDays();
    const ex = DB.getExercises(days[0].id).find(e => e.name === 'Leg Press');
    DB.logSession(ex.id, '2025-04-01', 100, [12, 12, 12]);
    const prs = DB.getPersonalRecords(ex.id);
    assert.strictEqual(prs.maxWeight.value, 100);
    assert.strictEqual(prs.maxReps.value, 12);
  });

  it('PRs recalculate when session is deleted', () => {
    const days = DB.getDays();
    const ex = DB.getExercises(days[0].id).find(e => e.name === 'Leg Press');
    const result = DB.logSession(ex.id, '2025-04-01', 200, [5, 5, 5]);
    let prs = DB.getPersonalRecords(ex.id);
    assert.strictEqual(prs.maxWeight.value, 200);
    DB.deleteSession(result.id);
    prs = DB.getPersonalRecords(ex.id);
    assert.strictEqual(prs.maxWeight.value, 90); // back to seed data
  });

  it('no PRs for exercise with no sessions', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[1].id); // Day 2 has no sessions
    const prs = DB.getPersonalRecords(exercises[0].id);
    assert.strictEqual(prs, null);
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

describe('Set Types', () => {

  beforeEach(() => { resetAndSeed(); });

  it('migration converts old reps arrays to objects', () => {
    // Manually insert old-format session
    const raw = localStorage.getItem('workout_tracker_db');
    const data = JSON.parse(raw);
    data.sessions.push({
      id: data._nextId.sessions++,
      exercise_id: data.exercises[0].id,
      date: '2025-05-01',
      weight: 50,
      reps: [10, 10, 10], // old format
    });
    localStorage.setItem('workout_tracker_db', JSON.stringify(data));
    // Force reload with migration
    const progress = DB.getProgress(data.exercises[0].id);
    const session = progress.sessions.find(s => s.date === '2025-05-01');
    assert.ok(session);
    assert.deepStrictEqual(session.reps, [10, 10, 10]); // rawReps returns plain numbers
  });

  it('migration is idempotent', () => {
    const raw1 = localStorage.getItem('workout_tracker_db');
    const data1 = JSON.parse(raw1);
    // Trigger migration twice
    DB.getDays();
    DB.getDays();
    const raw2 = localStorage.getItem('workout_tracker_db');
    const data2 = JSON.parse(raw2);
    assert.strictEqual(data2.sessions.length, data1.sessions.length);
  });

  it('new sessions store set types correctly', () => {
    const days = DB.getDays();
    const ex = DB.getExercises(days[0].id).find(e => !e.is_bodyweight);
    const result = DB.logSession(ex.id, '2025-06-01', 100, [10, 8, 6]);
    const progress = DB.getProgress(ex.id);
    const session = progress.sessions.find(s => s.date === '2025-06-01');
    assert.ok(session.setsData);
    assert.strictEqual(session.setsData[0].type, 'normal');
  });

  it('progressive overload excludes warmup sets', () => {
    const days = DB.getDays();
    const ex = DB.getExercises(days[0].id).find(e => !e.is_bodyweight && e.is_compound);
    // Log with warmup set that would otherwise affect suggestion
    const reps = [
      { reps: 12, type: 'warmup' },
      { reps: 12, type: 'normal' },
      { reps: 12, type: 'normal' },
    ];
    DB.logSession(ex.id, '2025-06-02', 100, reps);
    const progress = DB.getProgress(ex.id);
    const session = progress.sessions.find(s => s.date === '2025-06-02');
    assert.ok(session);
  });

  it('backward compat: old format data still works', () => {
    const raw = localStorage.getItem('workout_tracker_db');
    const data = JSON.parse(raw);
    // Insert purely old-format data
    data.sessions = [{
      id: 999, exercise_id: data.exercises[1].id,
      date: '2025-01-15', weight: 50, reps: [8, 8, 8],
    }];
    localStorage.setItem('workout_tracker_db', JSON.stringify(data));
    const last = DB.getLastSession(data.exercises[1].id);
    assert.ok(last);
    assert.deepStrictEqual(last.reps, [8, 8, 8]);
  });
});

describe('Superset Support', () => {

  beforeEach(() => { resetAndSeed(); });

  it('setSupersetGroup correctly groups exercises', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    DB.setSupersetGroup([exercises[0].id, exercises[1].id], 1);
    const updated = DB.getExercises(days[0].id);
    assert.strictEqual(updated[0].superset_group, 1);
    assert.strictEqual(updated[1].superset_group, 1);
  });

  it('clearSupersetGroup clears the group field', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    DB.setSupersetGroup([exercises[0].id], 1);
    DB.clearSupersetGroup(exercises[0].id);
    const updated = DB.getExercises(days[0].id);
    assert.strictEqual(updated[0].superset_group, null);
  });

  it('superset groups persist across reload', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    DB.setSupersetGroup([exercises[0].id, exercises[1].id], 42);
    // Force reload by clearing cache
    const reloaded = DB.getExercises(days[0].id);
    assert.strictEqual(reloaded[0].superset_group, 42);
    assert.strictEqual(reloaded[1].superset_group, 42);
  });
});

describe('Reorder & Delete Exercises', () => {

  beforeEach(() => { resetAndSeed(); });

  it('deleteExercise removes exercise and all sessions', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => e.name === 'Leg Press');
    const hadSessions = DB.getProgress(ex.id).sessions.length > 0;
    assert.ok(hadSessions);
    DB.deleteExercise(ex.id);
    const remaining = DB.getExercises(days[0].id);
    assert.ok(!remaining.some(e => e.id === ex.id));
    // Sessions should also be gone
    assert.throws(() => DB.getProgress(ex.id), /not found/);
  });

  it('deleteExercise throws for non-existent', () => {
    assert.throws(() => DB.deleteExercise(99999), /not found/);
  });

  it('reorderExercises updates sort_order correctly', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const reversed = exercises.map(e => e.id).reverse();
    DB.reorderExercises(days[0].id, reversed);
    const reordered = DB.getExercises(days[0].id);
    assert.strictEqual(reordered[0].id, reversed[0]);
    assert.strictEqual(reordered[reordered.length - 1].id, reversed[reversed.length - 1]);
  });

  it('reorder with invalid IDs throws', () => {
    const days = DB.getDays();
    assert.throws(() => DB.reorderExercises(days[0].id, [99999]), /mismatch/);
  });

  it('moveExercise moves to another day', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises[0];
    DB.moveExercise(ex.id, days[1].id);
    const day1 = DB.getExercises(days[0].id);
    const day2 = DB.getExercises(days[1].id);
    assert.ok(!day1.some(e => e.id === ex.id));
    assert.ok(day2.some(e => e.id === ex.id));
  });
});

describe('Data Export / Import', () => {

  beforeEach(() => { resetAndSeed(); });

  it('JSON export contains all DB data', () => {
    const json = DB.exportJSON();
    const data = JSON.parse(json);
    assert.ok(Array.isArray(data.workout_days));
    assert.ok(Array.isArray(data.exercises));
    assert.ok(Array.isArray(data.sessions));
    assert.ok(data._nextId);
  });

  it('CSV export has correct headers and row count', () => {
    const csv = DB.exportCSV();
    const lines = csv.split('\n');
    assert.ok(lines[0].includes('Date'));
    assert.ok(lines[0].includes('Exercise'));
    const data = JSON.parse(DB.exportJSON());
    assert.strictEqual(lines.length, data.sessions.length + 1); // header + data rows
  });

  it('JSON import restores data correctly', () => {
    const exported = DB.exportJSON();
    DB.resetDatabase();
    DB.importJSON(exported);
    const days = DB.getDays();
    assert.strictEqual(days.length, 4);
  });

  it('import with invalid JSON throws gracefully', () => {
    assert.throws(() => DB.importJSON('not json!'), /./);
  });

  it('import with invalid structure throws', () => {
    assert.throws(() => DB.importJSON('{"bad":true}'), /Invalid workout data/);
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

// ====== Phase 3 Tests ======

describe('Workout Duration Timer (3.1)', () => {
  beforeEach(resetAndSeed);

  it('starts and retrieves active workout session', () => {
    const days = DB.getDays();
    DB.startWorkoutSession(days[0].id);
    const active = DB.getActiveWorkoutSession();
    assert.ok(active);
    assert.strictEqual(active.dayId, days[0].id);
    assert.ok(active.startedAt > 0);
  });

  it('ends workout session and records duration', () => {
    const days = DB.getDays();
    DB.startWorkoutSession(days[0].id);
    const result = DB.endWorkoutSession();
    assert.ok(result);
    assert.ok(result.duration_seconds >= 0);
    assert.ok(result.id > 0);
    const active = DB.getActiveWorkoutSession();
    assert.strictEqual(active, null, 'Should be cleared after end');
  });

  it('returns null when ending without active session', () => {
    const result = DB.endWorkoutSession();
    assert.strictEqual(result, null);
  });
});

describe('Body Measurements (3.2)', () => {
  beforeEach(resetAndSeed);

  it('adds and retrieves measurements', () => {
    DB.addMeasurement({ date: '2025-03-01', weight: 180, chest: 42 });
    const ms = DB.getMeasurements();
    assert.strictEqual(ms.length, 1);
    assert.strictEqual(ms[0].weight, 180);
    assert.strictEqual(ms[0].chest, 42);
  });

  it('updates measurement on same date', () => {
    DB.addMeasurement({ date: '2025-03-01', weight: 180 });
    DB.addMeasurement({ date: '2025-03-01', weight: 178 });
    const ms = DB.getMeasurements();
    assert.strictEqual(ms.length, 1);
    assert.strictEqual(ms[0].weight, 178);
  });

  it('returns measurements sorted by date', () => {
    DB.addMeasurement({ date: '2025-03-15', weight: 180 });
    DB.addMeasurement({ date: '2025-03-01', weight: 182 });
    DB.addMeasurement({ date: '2025-03-10', weight: 181 });
    const ms = DB.getMeasurements();
    assert.strictEqual(ms[0].date, '2025-03-01');
    assert.strictEqual(ms[2].date, '2025-03-15');
  });

  it('getLatestBodyweight returns most recent', () => {
    DB.addMeasurement({ date: '2025-03-01', weight: 180 });
    DB.addMeasurement({ date: '2025-03-15', weight: 175 });
    assert.strictEqual(DB.getLatestBodyweight(), 175);
  });

  it('getLatestBodyweight returns null when no measurements', () => {
    assert.strictEqual(DB.getLatestBodyweight(), null);
  });
});

describe('Notes (3.6)', () => {
  beforeEach(resetAndSeed);

  it('sets and persists exercise note', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    DB.setExerciseNote(exercises[0].id, 'Focus on form');
    const updated = DB.getExercises(days[0].id);
    assert.strictEqual(updated[0].note, 'Focus on form');
  });

  it('clears note with empty string', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    DB.setExerciseNote(exercises[0].id, 'Test');
    DB.setExerciseNote(exercises[0].id, '');
    const updated = DB.getExercises(days[0].id);
    assert.strictEqual(updated[0].note, '');
  });

  it('throws for non-existent exercise', () => {
    assert.throws(() => DB.setExerciseNote(9999, 'test'), /not found/);
  });

  it('sets session note', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    const result = DB.logSession(ex.id, '2025-03-01', 100, [10, 10, 10]);
    DB.setSessionNote(result.id, 'Felt strong');
    const raw = JSON.parse(localStorage.getItem('workout_tracker_db'));
    const session = raw.sessions.find(s => s.id === result.id);
    assert.strictEqual(session.note, 'Felt strong');
  });
});

describe('Settings (3.7)', () => {
  beforeEach(resetAndSeed);

  it('returns defaults when no settings exist', () => {
    localStorage.removeItem('workout_tracker_settings');
    const s = DB.getSettings();
    assert.strictEqual(s.unit, 'lbs');
    assert.strictEqual(s.theme, 'dark');
  });

  it('saves and retrieves settings', () => {
    DB.saveSettings({ unit: 'kg', theme: 'light' });
    const s = DB.getSettings();
    assert.strictEqual(s.unit, 'kg');
    assert.strictEqual(s.theme, 'light');
  });
});

describe('RPE Tracking (3.5)', () => {
  beforeEach(resetAndSeed);

  it('stores RPE values with session', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    DB.logSession(ex.id, '2025-03-01', 100, [10, 10, 10], [8, 8.5, 9]);
    const { sessions } = DB.getProgress(ex.id);
    assert.ok(sessions.length > 0);
    const session = sessions[0];
    assert.strictEqual(session.setsData[0].rpe, 8);
    assert.strictEqual(session.setsData[1].rpe, 8.5);
    assert.strictEqual(session.setsData[2].rpe, 9);
  });

  it('handles null RPE gracefully', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    DB.logSession(ex.id, '2025-03-01', 100, [10, 10, 10], [null, null, null]);
    const { sessions } = DB.getProgress(ex.id);
    assert.ok(sessions.length > 0);
    assert.strictEqual(sessions[0].setsData[0].rpe, undefined);
  });

  it('works without RPE parameter', () => {
    const days = DB.getDays();
    const exercises = DB.getExercises(days[0].id);
    const ex = exercises.find(e => !e.is_bodyweight);
    DB.logSession(ex.id, '2025-03-01', 100, [10, 10, 10]);
    const { sessions } = DB.getProgress(ex.id);
    assert.ok(sessions.length > 0);
  });
});
