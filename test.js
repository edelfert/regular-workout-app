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
