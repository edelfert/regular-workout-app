/**
 * Client-side data layer backed by localStorage.
 * All data persists in the browser under a single JSON key.
 */
// eslint-disable-next-line no-var
var DB = (() => {
  const STORAGE_KEY = 'workout_tracker_db';

  const EMPTY_DB = { workout_days: [], exercises: [], sessions: [], measurements: [], workout_sessions: [], _nextId: { days: 1, exercises: 1, sessions: 1, measurements: 1, workout_sessions: 1 } };

  let _cache = null;
  let _cacheRaw = null;

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { _cache = null; _cacheRaw = null; return JSON.parse(JSON.stringify(EMPTY_DB)); }
    if (_cache && _cacheRaw === raw) return _cache;
    try {
      const data = JSON.parse(raw);
      // Basic shape validation
      // Ensure new arrays exist for forward compat
      if (data && data._nextId) {
        if (!Array.isArray(data.measurements)) data.measurements = [];
        if (!Array.isArray(data.workout_sessions)) data.workout_sessions = [];
        if (!data._nextId.measurements) data._nextId.measurements = 1;
        if (!data._nextId.workout_sessions) data._nextId.workout_sessions = 1;
      }
      if (!data || !Array.isArray(data.workout_days) || !Array.isArray(data.exercises) || !Array.isArray(data.sessions) || !data._nextId) {
        console.warn('Workout DB: corrupt data detected, resetting.');
        localStorage.removeItem(STORAGE_KEY);
        return JSON.parse(JSON.stringify(EMPTY_DB));
      }
      // Auto-repair _nextId to prevent ID collisions after partial corruption
      const maxDayId = data.workout_days.reduce((m, d) => Math.max(m, d.id), 0);
      const maxExId = data.exercises.reduce((m, e) => Math.max(m, e.id), 0);
      const maxSessId = data.sessions.reduce((m, s) => Math.max(m, s.id), 0);
      if (data._nextId.days <= maxDayId) data._nextId.days = maxDayId + 1;
      if (data._nextId.exercises <= maxExId) data._nextId.exercises = maxExId + 1;
      if (data._nextId.sessions <= maxSessId) data._nextId.sessions = maxSessId + 1;
      const maxMeasId = data.measurements.reduce((m, e) => Math.max(m, e.id || 0), 0);
      const maxWsId = data.workout_sessions.reduce((m, e) => Math.max(m, e.id || 0), 0);
      if (data._nextId.measurements <= maxMeasId) data._nextId.measurements = maxMeasId + 1;
      if (data._nextId.workout_sessions <= maxWsId) data._nextId.workout_sessions = maxWsId + 1;
      // Migration: add rest_seconds to exercises missing it
      migrate(data);
      _cache = data;
      _cacheRaw = raw;
      return data;
    } catch (e) {
      console.warn('Workout DB: JSON parse failed, resetting.', e);
      localStorage.removeItem(STORAGE_KEY);
      return JSON.parse(JSON.stringify(EMPTY_DB));
    }
  }

  // Helper to extract raw rep numbers from set data (handles both old and new format)
  function rawReps(reps) {
    if (!Array.isArray(reps) || reps.length === 0) return [];
    if (typeof reps[0] === 'number') return reps;
    return reps.map(r => r.reps);
  }

  // Filter out warmup sets for progressive overload calculations
  function workingReps(reps) {
    if (!Array.isArray(reps) || reps.length === 0) return [];
    if (typeof reps[0] === 'number') return reps;
    return reps.filter(r => r.type !== 'warmup').map(r => r.reps);
  }

  function migrate(data) {
    let changed = false;
    for (const ex of data.exercises) {
      if (ex.rest_seconds === undefined) {
        ex.rest_seconds = ex.is_bodyweight ? 0 : (ex.is_compound ? 90 : 60);
        changed = true;
      }
      if (ex.superset_group === undefined) {
        ex.superset_group = null;
        changed = true;
      }
    }
    // Migrate reps arrays from plain numbers to objects with type
    for (const s of data.sessions) {
      if (Array.isArray(s.reps) && s.reps.length > 0 && typeof s.reps[0] === 'number') {
        s.reps = s.reps.map(r => ({ reps: r, type: 'normal' }));
        changed = true;
      }
    }
    if (changed) {
      try {
        const raw = JSON.stringify(data);
        localStorage.setItem(STORAGE_KEY, raw);
        _cache = data;
        _cacheRaw = raw;
      } catch (e) { /* ignore migration save errors */ }
    }
  }

  function save(data) {
    try {
      const raw = JSON.stringify(data);
      localStorage.setItem(STORAGE_KEY, raw);
      _cache = data;
      _cacheRaw = raw;
    } catch (e) {
      _cache = null;
      _cacheRaw = null;
      throw new Error('Failed to save data. Storage may be full.');
    }
  }

  function isSeeded() {
    const data = load();
    return data.workout_days.length > 0;
  }

  // --- Seed ---

  function seed() {
    if (isSeeded()) return;

    const data = load();
    const days = [
      { day_number: 1, name: 'Day 1 \u2014 Push A' },
      { day_number: 2, name: 'Day 2 \u2014 Pull A' },
      { day_number: 3, name: 'Day 3 \u2014 Push B' },
      { day_number: 4, name: 'Day 4 \u2014 Pull B' },
    ];

    const exercisesByDay = {
      1: [
        { name: 'Push-Ups', target_sets: 3, rep_range_low: 10, rep_range_high: 15, is_bodyweight: true, is_compound: true, starting_weight: null },
        { name: 'Leg Press', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: true, starting_weight: 90 },
        { name: 'Bicep Curls', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: false, starting_weight: 20 },
        { name: 'Hip Adductors', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 90 },
        { name: 'Overhead Press', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: true, starting_weight: 75 },
        { name: 'Calf Raises', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 55 },
      ],
      2: [
        { name: 'Lat Pulldowns', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: true, starting_weight: 70 },
        { name: 'Hamstring Curls', target_sets: 3, rep_range_low: 10, rep_range_high: 12, is_bodyweight: false, is_compound: false, starting_weight: 50 },
        { name: 'Overhead Tricep Extension', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: false, starting_weight: 25 },
        { name: 'Hip Abductors', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 90 },
        { name: 'Lateral Raises', target_sets: 3, rep_range_low: 10, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 10 },
        { name: 'Calf Raises', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 55 },
      ],
      3: [
        { name: 'Tricep Dip', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: true, starting_weight: 0 },
        { name: 'Leg Press', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: true, starting_weight: 90 },
        { name: 'Hammer Curls', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: false, starting_weight: 20 },
        { name: 'Hip Adductors', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 90 },
        { name: 'Rear Delt Fly', target_sets: 3, rep_range_low: 10, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 10 },
        { name: 'Calf Raises', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 55 },
      ],
      4: [
        { name: 'Seated Row', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: true, starting_weight: 70 },
        { name: 'Hamstring Curls', target_sets: 3, rep_range_low: 10, rep_range_high: 12, is_bodyweight: false, is_compound: false, starting_weight: 50 },
        { name: 'Tricep Pushdown', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: false, starting_weight: 30 },
        { name: 'Hip Abductors', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 90 },
        { name: 'Overhead Press', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: false, is_compound: true, starting_weight: 75 },
        { name: 'Calf Raises', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: false, is_compound: false, starting_weight: 55 },
      ],
    };

    // Insert days and exercises
    for (const day of days) {
      const dayId = data._nextId.days++;
      data.workout_days.push({ id: dayId, day_number: day.day_number, name: day.name });

      exercisesByDay[day.day_number].forEach((ex, idx) => {
        const exId = data._nextId.exercises++;
        const rest_seconds = ex.is_bodyweight ? 0 : (ex.is_compound ? 90 : 60);
        data.exercises.push({ id: exId, day_id: dayId, sort_order: idx, rest_seconds, ...ex });
      });
    }

    // Historical data: 2025-03-30 (Day 1)
    const day1Exercises = data.exercises.filter(e => e.day_id === 1);
    const historical = {
      'Push-Ups':       { weight: null, reps: [{reps:12,type:'normal'},{reps:12,type:'normal'},{reps:12,type:'normal'}] },
      'Leg Press':      { weight: 90,   reps: [{reps:10,type:'normal'},{reps:10,type:'normal'},{reps:10,type:'normal'}] },
      'Bicep Curls':    { weight: 20,   reps: [{reps:8,type:'normal'},{reps:8,type:'normal'},{reps:8,type:'normal'}] },
      'Hip Adductors':  { weight: 90,   reps: [{reps:15,type:'normal'},{reps:15,type:'normal'},{reps:15,type:'normal'}] },
      'Overhead Press': { weight: 75,   reps: [{reps:10,type:'normal'},{reps:10,type:'normal'},{reps:10,type:'normal'}] },
      'Calf Raises':    { weight: 55,   reps: [{reps:15,type:'normal'},{reps:15,type:'normal'},{reps:15,type:'normal'}] },
    };

    for (const ex of day1Exercises) {
      const h = historical[ex.name];
      if (h) {
        const sessId = data._nextId.sessions++;
        data.sessions.push({ id: sessId, exercise_id: ex.id, date: '2025-03-30', weight: h.weight, reps: h.reps });
      }
    }

    save(data);
  }

  // --- Query methods ---

  function getDays() {
    return load().workout_days.slice().sort((a, b) => a.day_number - b.day_number);
  }

  function createDay(name, exercises) {
    if (!name || !String(name).trim()) throw new Error('Day name is required');
    if (!Array.isArray(exercises) || exercises.length === 0) throw new Error('At least one exercise is required');
    validateExerciseList(exercises);

    const data = load();
    const maxNum = data.workout_days.reduce((m, d) => Math.max(m, d.day_number), 0);
    const dayId = data._nextId.days++;
    data.workout_days.push({ id: dayId, day_number: maxNum + 1, name: String(name).trim() });

    exercises.forEach((ex, idx) => {
      const exId = data._nextId.exercises++;
      const defaultRest = ex.is_bodyweight ? 0 : (ex.is_compound ? 90 : 60);
      data.exercises.push({
        id: exId,
        day_id: dayId,
        name: String(ex.name).trim(),
        target_sets: ex.target_sets,
        rep_range_low: ex.rep_range_low,
        rep_range_high: ex.rep_range_high,
        is_bodyweight: !!ex.is_bodyweight,
        is_compound: !!ex.is_compound,
        starting_weight: ex.starting_weight != null ? ex.starting_weight : null, // #3: preserve 0
        rest_seconds: ex.rest_seconds != null ? ex.rest_seconds : defaultRest,
        sort_order: idx,
      });
    });

    save(data);
    return data.workout_days.find(d => d.id === dayId);
  }

  function getExercises(dayId) {
    return load().exercises.filter(e => e.day_id === dayId).sort((a, b) => a.sort_order - b.sort_order);
  }

  function validateExerciseList(exercises) {
    for (const ex of exercises) {
      if (!ex.name || !String(ex.name).trim()) throw new Error('Exercise name is required');
      if (!Number.isInteger(ex.target_sets) || ex.target_sets < 1) throw new Error('Target sets must be at least 1');
      if (!Number.isInteger(ex.rep_range_low) || ex.rep_range_low < 1) throw new Error('Rep range low must be at least 1');
      if (!Number.isInteger(ex.rep_range_high) || ex.rep_range_high < ex.rep_range_low) throw new Error('Rep range high must be >= rep range low');
    }
  }

  function addExercise(dayId, ex) {
    const data = load();
    // #8: verify day exists
    if (!data.workout_days.some(d => d.id === dayId)) {
      throw new Error('Workout day not found');
    }
    validateExerciseList([ex]);
    const existing = data.exercises.filter(e => e.day_id === dayId);
    const maxOrder = existing.reduce((m, e) => Math.max(m, e.sort_order), -1);
    const exId = data._nextId.exercises++;
    const defaultRest = ex.is_bodyweight ? 0 : (ex.is_compound ? 90 : 60);
    const record = {
      id: exId,
      day_id: dayId,
      name: String(ex.name).trim(),
      target_sets: ex.target_sets,
      rep_range_low: ex.rep_range_low,
      rep_range_high: ex.rep_range_high,
      is_bodyweight: !!ex.is_bodyweight,
      is_compound: !!ex.is_compound,
      starting_weight: ex.starting_weight != null ? ex.starting_weight : null, // #3: preserve 0
      rest_seconds: ex.rest_seconds != null ? ex.rest_seconds : defaultRest,
      sort_order: maxOrder + 1,
    };
    data.exercises.push(record);
    save(data);
    return record;
  }

  function updateExercise(exerciseId, fields) {
    const data = load();
    const exercise = data.exercises.find(e => e.id === exerciseId);
    if (!exercise) throw new Error('Exercise not found');
    const allowed = ['rest_seconds', 'superset_group'];
    for (const key of allowed) {
      if (fields[key] !== undefined) exercise[key] = fields[key];
    }
    save(data);
    return exercise;
  }

  function setSupersetGroup(exerciseIds, groupId) {
    const data = load();
    for (const id of exerciseIds) {
      const ex = data.exercises.find(e => e.id === id);
      if (ex) ex.superset_group = groupId;
    }
    save(data);
  }

  function clearSupersetGroup(exerciseId) {
    const data = load();
    const ex = data.exercises.find(e => e.id === exerciseId);
    if (ex) ex.superset_group = null;
    save(data);
  }

  function deleteExercise(exerciseId) {
    const data = load();
    const idx = data.exercises.findIndex(e => e.id === exerciseId);
    if (idx === -1) throw new Error('Exercise not found');
    data.exercises.splice(idx, 1);
    data.sessions = data.sessions.filter(s => s.exercise_id !== exerciseId);
    save(data);
  }

  function reorderExercises(dayId, orderedIds) {
    const data = load();
    const dayExercises = data.exercises.filter(e => e.day_id === dayId);
    if (orderedIds.length !== dayExercises.length) throw new Error('ID count mismatch');
    for (const id of orderedIds) {
      if (!dayExercises.some(e => e.id === id)) throw new Error(`Exercise ${id} not found in day ${dayId}`);
    }
    orderedIds.forEach((id, i) => {
      const ex = data.exercises.find(e => e.id === id);
      ex.sort_order = i;
    });
    save(data);
  }

  function moveExercise(exerciseId, newDayId) {
    const data = load();
    const exercise = data.exercises.find(e => e.id === exerciseId);
    if (!exercise) throw new Error('Exercise not found');
    if (!data.workout_days.some(d => d.id === newDayId)) throw new Error('Day not found');
    const existing = data.exercises.filter(e => e.day_id === newDayId);
    const maxOrder = existing.reduce((m, e) => Math.max(m, e.sort_order), -1);
    exercise.day_id = newDayId;
    exercise.sort_order = maxOrder + 1;
    exercise.superset_group = null;
    save(data);
  }

  function normalizeDate(date) {
    // Ensure YYYY-MM-DD with zero-padding and valid ranges
    const match = String(date).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) throw new Error('Invalid date format. Expected YYYY-MM-DD.');
    const m = parseInt(match[2], 10);
    const d = parseInt(match[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error('Invalid date: month or day out of range.');
    return `${match[1]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function logSession(exerciseId, date, weight, reps, rpe) {
    const data = load();
    const exercise = data.exercises.find(e => e.id === exerciseId);
    if (!exercise) throw new Error('Exercise not found');

    // #7: validate reps length matches target sets
    const repsCount = Array.isArray(reps) ? reps.length : 0;
    if (repsCount !== exercise.target_sets) {
      throw new Error(`Expected ${exercise.target_sets} sets but got ${repsCount}`);
    }

    const normalizedDate = normalizeDate(date);
    const duplicate = data.sessions.find(s => s.exercise_id === exerciseId && s.date === normalizedDate);
    if (duplicate) throw new Error('Session already logged for this exercise on this date. Delete it first or choose a different date.');

    const normalizedWeight = exercise.is_bodyweight ? null : weight; // #4: normalize before storing and computing
    // Convert plain number reps to objects with type and optional RPE
    const normalizedReps = reps.map((r, i) => {
      const obj = typeof r === 'number' ? { reps: r, type: 'normal' } : r;
      if (rpe && rpe[i] != null) obj.rpe = rpe[i];
      return obj;
    });
    const sessId = data._nextId.sessions++;
    data.sessions.push({
      id: sessId,
      exercise_id: exerciseId,
      date: normalizedDate,
      weight: normalizedWeight,
      reps: normalizedReps,
    });
    save(data);

    return { id: sessId, suggestion: computeSuggestion(exercise, normalizedWeight, normalizedReps) };
  }

  function deleteSession(id) {
    const data = load();
    const idx = data.sessions.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Session not found');
    data.sessions.splice(idx, 1);
    save(data);
  }

  // #13: lightweight last-session lookup without full progress computation
  function getLastSession(exerciseId) {
    const data = load();
    const sessions = data.sessions
      .filter(s => s.exercise_id === exerciseId)
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first
    if (sessions.length === 0) return null;
    const s = sessions[0];
    return { ...s, reps: rawReps(s.reps), setsData: s.reps };
  }

  function getTodaySession(exerciseId, date) {
    const data = load();
    const normalized = normalizeDate(date);
    const s = data.sessions.find(s => s.exercise_id === exerciseId && s.date === normalized);
    if (!s) return null;
    return { ...s, reps: rawReps(s.reps), setsData: s.reps };
  }

  function getSessionsByDateRange(startDate, endDate) {
    const data = load();
    const start = normalizeDate(startDate);
    const end = normalizeDate(endDate);
    return data.sessions.filter(s => s.date >= start && s.date <= end).map(s => {
      const exercise = data.exercises.find(e => e.id === s.exercise_id);
      return {
        id: s.id,
        exercise_id: s.exercise_id,
        exerciseName: exercise ? exercise.name : 'Unknown',
        date: s.date,
        weight: s.weight,
        reps: rawReps(s.reps),
      };
    });
  }

  function getWorkoutStreak() {
    const data = load();
    if (data.sessions.length === 0) return 0;
    const dates = [...new Set(data.sessions.map(s => s.date))].sort().reverse();
    if (dates.length === 0) return 0;

    // Check if the streak includes today or yesterday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const latestDate = new Date(dates[0] + 'T00:00:00');
    const diffDays = Math.floor((today - latestDate) / 86400000);
    if (diffDays > 1) return 0; // streak is broken

    let streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + 'T00:00:00');
      const curr = new Date(dates[i] + 'T00:00:00');
      const gap = Math.floor((prev - curr) / 86400000);
      if (gap === 1) streak++;
      else break;
    }
    return streak;
  }

  function getProgress(exerciseId) {
    const data = load();
    const exercise = data.exercises.find(e => e.id === exerciseId);
    if (!exercise) throw new Error('Exercise not found');

    const sessions = data.sessions
      .filter(s => s.exercise_id === exerciseId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => {
        const rr = rawReps(s.reps);
        return {
          id: s.id,
          date: s.date,
          weight: s.weight,
          reps: rr,
          setsData: s.reps, // full set data with types
          avgReps: rr.length > 0 ? parseFloat((rr.reduce((a, b) => a + b, 0) / rr.length).toFixed(1)) : 0,
        };
      });

    let suggestion = null;
    if (sessions.length > 0) {
      const last = sessions[sessions.length - 1];
      // Use working reps (exclude warmup) for progressive overload
      const wr = workingReps(data.sessions.find(s => s.id === last.id).reps);
      suggestion = computeSuggestion(exercise, last.weight, wr.length > 0 ? wr : last.reps);
    }

    return { exercise, sessions, suggestion };
  }

  // --- 1RM Calculator (Epley formula) ---

  function computeE1RM(weight, reps) {
    if (reps <= 0 || weight <= 0) return 0;
    if (reps === 1) return weight;
    return parseFloat((weight * (1 + reps / 30)).toFixed(1));
  }

  function getEstimated1RM(exerciseId) {
    const data = load();
    const exercise = data.exercises.find(e => e.id === exerciseId);
    if (!exercise || exercise.is_bodyweight) return null;

    const sessions = data.sessions.filter(s => s.exercise_id === exerciseId);
    if (sessions.length === 0) return null;

    let best = 0;
    for (const s of sessions) {
      if (s.weight == null || s.weight <= 0) continue;
      for (const r of rawReps(s.reps)) {
        const e1rm = computeE1RM(s.weight, r);
        if (e1rm > best) best = e1rm;
      }
    }
    return best > 0 ? best : null;
  }

  // --- Personal Records ---

  function getPersonalRecords(exerciseId) {
    const data = load();
    const exercise = data.exercises.find(e => e.id === exerciseId);
    if (!exercise) return null;

    const sessions = data.sessions.filter(s => s.exercise_id === exerciseId);
    if (sessions.length === 0) return null;

    let maxWeight = null;
    let maxReps = null;
    let maxVolume = null;
    let max1RM = null;

    for (const s of sessions) {
      const rr = rawReps(s.reps);
      // Heaviest weight
      if (s.weight != null && (maxWeight === null || s.weight > maxWeight.value)) {
        maxWeight = { value: s.weight, date: s.date, sessionId: s.id };
      }
      // Highest single-set reps
      for (const r of rr) {
        if (maxReps === null || r > maxReps.value) {
          maxReps = { value: r, date: s.date, sessionId: s.id };
        }
      }
      // Session volume
      const w = s.weight || 0;
      const vol = rr.reduce((sum, r) => sum + r * w, 0);
      if (maxVolume === null || vol > maxVolume.value) {
        maxVolume = { value: vol, date: s.date, sessionId: s.id };
      }
      // Estimated 1RM
      if (s.weight != null && s.weight > 0) {
        for (const r of rr) {
          const e1rm = computeE1RM(s.weight, r);
          if (max1RM === null || e1rm > max1RM.value) {
            max1RM = { value: e1rm, date: s.date, sessionId: s.id };
          }
        }
      }
    }

    return { maxWeight, maxReps, maxVolume, max1RM };
  }

  // --- Progressive Overload ---

  function computeSuggestion(exercise, currentWeight, repsInput) {
    const reps = rawReps(repsInput);
    if (exercise.is_bodyweight) {
      const allAtTop = reps.every(r => r >= exercise.rep_range_high);
      const anyBelowBottom = reps.some(r => r < exercise.rep_range_low);
      if (allAtTop) {
        return { action: 'increase_reps', message: `Great work! Try adding a rep to each set next session (target: ${exercise.rep_range_high + 1}+ reps)` };
      } else if (anyBelowBottom) {
        return { action: 'hold', message: `Some sets were below ${exercise.rep_range_low} reps. Stay at this level and aim to hit ${exercise.rep_range_low}+ on every set.` };
      } else {
        return { action: 'hold', message: `Good progress. Stay here and aim for ${exercise.rep_range_high} reps on all sets.` };
      }
    }

    const increment = exercise.is_compound ? 5 : 2.5;
    const allAtTop = reps.every(r => r >= exercise.rep_range_high);
    const anyBelowBottom = reps.some(r => r < exercise.rep_range_low);

    if (allAtTop) {
      const newWeight = Math.round((currentWeight + increment) * 2) / 2;
      return { action: 'increase', newWeight, message: `Next session: try ${newWeight} lbs (+${increment})` };
    } else if (anyBelowBottom) {
      const dropped = Math.round((currentWeight * 0.95) * 2) / 2;
      // #14: When weight is very low (e.g. 0 or 2.5), dropped may equal currentWeight.
      // In that case we fall through to the hold suggestion, which is correct.
      if (dropped < currentWeight) {
        return { action: 'drop', newWeight: dropped, message: `Some sets below ${exercise.rep_range_low} reps. Consider dropping to ${dropped} lbs (-5%) or staying at ${currentWeight} lbs.` };
      }
      return { action: 'hold', newWeight: currentWeight, message: `Some sets below ${exercise.rep_range_low} reps. Stay at ${currentWeight} lbs and focus on form.` };
    } else {
      return { action: 'hold', newWeight: currentWeight, message: `Good progress at ${currentWeight} lbs. Stay here and aim for ${exercise.rep_range_high} reps on all sets.` };
    }
  }

  // --- Workout Duration (3.1) ---

  const WORKOUT_START_KEY = 'workout_tracker_session_start';

  function startWorkoutSession(dayId) {
    const now = Date.now();
    try { localStorage.setItem(WORKOUT_START_KEY, JSON.stringify({ dayId, startedAt: now })); } catch (e) { /* */ }
    return now;
  }

  function getActiveWorkoutSession() {
    try {
      const raw = localStorage.getItem(WORKOUT_START_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function endWorkoutSession() {
    const active = getActiveWorkoutSession();
    if (!active) return null;
    const duration = Math.round((Date.now() - active.startedAt) / 1000);
    const data = load();
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const id = data._nextId.workout_sessions++;
    data.workout_sessions.push({ id, day_id: active.dayId, date: dateStr, duration_seconds: duration, started_at: active.startedAt });
    save(data);
    localStorage.removeItem(WORKOUT_START_KEY);
    return { id, duration_seconds: duration };
  }

  // --- Body Measurements (3.2) ---

  function addMeasurement(entry) {
    const data = load();
    const date = normalizeDate(entry.date);
    const existing = data.measurements.findIndex(m => m.date === date);
    if (existing >= 0) {
      const m = data.measurements[existing];
      m.date = date;
      m.weight = entry.weight || null;
      m.chest = entry.chest || null;
      m.waist = entry.waist || null;
      m.hips = entry.hips || null;
      m.biceps_l = entry.biceps_l || null;
      m.biceps_r = entry.biceps_r || null;
      m.thigh_l = entry.thigh_l || null;
      m.thigh_r = entry.thigh_r || null;
    } else {
      const id = data._nextId.measurements++;
      data.measurements.push({ id, date, weight: entry.weight || null, chest: entry.chest || null, waist: entry.waist || null, hips: entry.hips || null, biceps_l: entry.biceps_l || null, biceps_r: entry.biceps_r || null, thigh_l: entry.thigh_l || null, thigh_r: entry.thigh_r || null });
    }
    save(data);
  }

  function getMeasurements() {
    return load().measurements.slice().sort((a, b) => a.date.localeCompare(b.date));
  }

  function getLatestBodyweight() {
    const m = load().measurements.slice().sort((a, b) => b.date.localeCompare(a.date));
    for (const entry of m) {
      if (entry.weight) return entry.weight;
    }
    return null;
  }

  // --- Notes (3.6) ---

  function setExerciseNote(exerciseId, note) {
    const data = load();
    const ex = data.exercises.find(e => e.id === exerciseId);
    if (!ex) throw new Error('Exercise not found');
    ex.note = note || '';
    save(data);
  }

  function setSessionNote(sessionId, note) {
    const data = load();
    const s = data.sessions.find(s => s.id === sessionId);
    if (!s) throw new Error('Session not found');
    s.note = note || '';
    save(data);
  }

  // --- Settings (3.7/3.8) ---

  const SETTINGS_KEY = 'workout_tracker_settings';

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : { unit: 'lbs', theme: 'dark' };
    } catch (e) { return { unit: 'lbs', theme: 'dark' }; }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function exportJSON() {
    return JSON.stringify(load(), null, 2);
  }

  function csvEscape(val) {
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function exportCSV() {
    const data = load();
    const rows = [['Date', 'Day', 'Exercise', 'Weight', 'Reps', 'Volume']];
    for (const s of data.sessions) {
      const exercise = data.exercises.find(e => e.id === s.exercise_id);
      const day = exercise ? data.workout_days.find(d => d.id === exercise.day_id) : null;
      const rr = rawReps(s.reps);
      const w = s.weight || 0;
      const vol = rr.reduce((sum, r) => sum + r * w, 0);
      rows.push([
        s.date,
        csvEscape(day ? day.name : ''),
        csvEscape(exercise ? exercise.name : ''),
        s.weight != null ? s.weight : 'BW',
        csvEscape(rr.join(', ')),
        vol,
      ]);
    }
    return rows.map(r => r.join(',')).join('\n');
  }

  function importJSON(jsonStr) {
    const data = JSON.parse(jsonStr);
    if (!data || !Array.isArray(data.workout_days) || !Array.isArray(data.exercises) || !Array.isArray(data.sessions) || !data._nextId) {
      throw new Error('Invalid workout data format');
    }
    // Ensure forward-compat arrays
    if (!Array.isArray(data.measurements)) data.measurements = [];
    if (!Array.isArray(data.workout_sessions)) data.workout_sessions = [];
    if (!data._nextId.measurements) data._nextId.measurements = 1;
    if (!data._nextId.workout_sessions) data._nextId.workout_sessions = 1;
    // Auto-repair _nextId to prevent collisions with imported IDs
    const maxDayId = data.workout_days.reduce((m, d) => Math.max(m, d.id), 0);
    const maxExId = data.exercises.reduce((m, e) => Math.max(m, e.id), 0);
    const maxSessId = data.sessions.reduce((m, s) => Math.max(m, s.id), 0);
    const maxMeasId = data.measurements.reduce((m, e) => Math.max(m, e.id || 0), 0);
    const maxWsId = data.workout_sessions.reduce((m, e) => Math.max(m, e.id || 0), 0);
    if (data._nextId.days <= maxDayId) data._nextId.days = maxDayId + 1;
    if (data._nextId.exercises <= maxExId) data._nextId.exercises = maxExId + 1;
    if (data._nextId.sessions <= maxSessId) data._nextId.sessions = maxSessId + 1;
    if (data._nextId.measurements <= maxMeasId) data._nextId.measurements = maxMeasId + 1;
    if (data._nextId.workout_sessions <= maxWsId) data._nextId.workout_sessions = maxWsId + 1;
    save(data);
    return data;
  }

  function resetDatabase() {
    localStorage.removeItem(STORAGE_KEY);
    _cache = null;
    _cacheRaw = null;
    seed();
  }

  return {
    seed,
    getDays,
    createDay,
    getExercises,
    addExercise,
    updateExercise,
    deleteExercise,
    reorderExercises,
    moveExercise,
    setSupersetGroup,
    clearSupersetGroup,
    logSession,
    deleteSession,
    getLastSession,
    getTodaySession,
    getSessionsByDateRange,
    getWorkoutStreak,
    getProgress,
    computeE1RM,
    getEstimated1RM,
    getPersonalRecords,
    computeSuggestion,
    startWorkoutSession,
    getActiveWorkoutSession,
    endWorkoutSession,
    addMeasurement,
    getMeasurements,
    getLatestBodyweight,
    setExerciseNote,
    setSessionNote,
    getSettings,
    saveSettings,
    exportJSON,
    exportCSV,
    importJSON,
    resetDatabase,
  };
})();
