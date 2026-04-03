/**
 * Client-side data layer backed by localStorage.
 * Drop-in replacement for the SQLite backend — same data model, all in the browser.
 */
// eslint-disable-next-line no-var
var DB = (() => {
  const STORAGE_KEY = 'workout_tracker_db';

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    return { workout_days: [], exercises: [], sessions: [], _nextId: { days: 1, exercises: 1, sessions: 1 } };
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
        data.exercises.push({ id: exId, day_id: dayId, sort_order: idx, ...ex });
      });
    }

    // Historical data: 2025-03-30 (Day 1)
    const day1Exercises = data.exercises.filter(e => e.day_id === 1);
    const historical = {
      'Push-Ups':       { weight: null, reps: [12, 12, 12] },
      'Leg Press':      { weight: 90,   reps: [10, 10, 10] },
      'Bicep Curls':    { weight: 20,   reps: [8, 8, 8] },
      'Hip Adductors':  { weight: 90,   reps: [15, 15, 15] },
      'Overhead Press': { weight: 75,   reps: [10, 10, 10] },
      'Calf Raises':    { weight: 55,   reps: [15, 15, 15] },
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
    const data = load();
    const maxNum = data.workout_days.reduce((m, d) => Math.max(m, d.day_number), 0);
    const dayId = data._nextId.days++;
    data.workout_days.push({ id: dayId, day_number: maxNum + 1, name });

    exercises.forEach((ex, idx) => {
      const exId = data._nextId.exercises++;
      data.exercises.push({
        id: exId,
        day_id: dayId,
        name: ex.name,
        target_sets: ex.target_sets,
        rep_range_low: ex.rep_range_low,
        rep_range_high: ex.rep_range_high,
        is_bodyweight: !!ex.is_bodyweight,
        is_compound: !!ex.is_compound,
        starting_weight: ex.starting_weight || null,
        sort_order: idx,
      });
    });

    save(data);
    return data.workout_days.find(d => d.id === dayId);
  }

  function getExercises(dayId) {
    return load().exercises.filter(e => e.day_id === dayId).sort((a, b) => a.sort_order - b.sort_order);
  }

  function getExerciseById(id) {
    return load().exercises.find(e => e.id === id) || null;
  }

  function addExercise(dayId, ex) {
    const data = load();
    const existing = data.exercises.filter(e => e.day_id === dayId);
    const maxOrder = existing.reduce((m, e) => Math.max(m, e.sort_order), -1);
    const exId = data._nextId.exercises++;
    const record = {
      id: exId,
      day_id: dayId,
      name: ex.name,
      target_sets: ex.target_sets,
      rep_range_low: ex.rep_range_low,
      rep_range_high: ex.rep_range_high,
      is_bodyweight: !!ex.is_bodyweight,
      is_compound: !!ex.is_compound,
      starting_weight: ex.starting_weight || null,
      sort_order: maxOrder + 1,
    };
    data.exercises.push(record);
    save(data);
    return record;
  }

  function logSession(exerciseId, date, weight, reps) {
    const data = load();
    const exercise = data.exercises.find(e => e.id === exerciseId);
    if (!exercise) throw new Error('Exercise not found');

    const duplicate = data.sessions.find(s => s.exercise_id === exerciseId && s.date === date);
    if (duplicate) throw new Error('Session already logged for this exercise on this date. Delete it first or choose a different date.');

    const sessId = data._nextId.sessions++;
    data.sessions.push({
      id: sessId,
      exercise_id: exerciseId,
      date,
      weight: exercise.is_bodyweight ? null : weight,
      reps,
    });
    save(data);

    return { id: sessId, suggestion: computeSuggestion(exercise, weight, reps) };
  }

  function deleteSession(id) {
    const data = load();
    const idx = data.sessions.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Session not found');
    data.sessions.splice(idx, 1);
    save(data);
  }

  function getProgress(exerciseId) {
    const data = load();
    const exercise = data.exercises.find(e => e.id === exerciseId);
    if (!exercise) throw new Error('Exercise not found');

    const sessions = data.sessions
      .filter(s => s.exercise_id === exerciseId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => ({
        id: s.id,
        date: s.date,
        weight: s.weight,
        reps: s.reps,
        avgReps: parseFloat((s.reps.reduce((a, b) => a + b, 0) / s.reps.length).toFixed(1)),
      }));

    let suggestion = null;
    if (sessions.length > 0) {
      const last = sessions[sessions.length - 1];
      suggestion = computeSuggestion(exercise, last.weight, last.reps);
    }

    return { exercise, sessions, suggestion };
  }

  // --- Progressive Overload ---

  function computeSuggestion(exercise, currentWeight, reps) {
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
      const newWeight = currentWeight + increment;
      return { action: 'increase', newWeight, message: `Next session: try ${newWeight} lbs (+${increment})` };
    } else if (anyBelowBottom) {
      const dropped = Math.round((currentWeight * 0.95) * 2) / 2;
      if (dropped < currentWeight) {
        return { action: 'drop', newWeight: dropped, message: `Some sets below ${exercise.rep_range_low} reps. Consider dropping to ${dropped} lbs (-5%) or staying at ${currentWeight} lbs.` };
      }
      return { action: 'hold', newWeight: currentWeight, message: `Some sets below ${exercise.rep_range_low} reps. Stay at ${currentWeight} lbs and focus on form.` };
    } else {
      return { action: 'hold', newWeight: currentWeight, message: `Good progress at ${currentWeight} lbs. Stay here and aim for ${exercise.rep_range_high} reps on all sets.` };
    }
  }

  function resetDatabase() {
    localStorage.removeItem(STORAGE_KEY);
    seed();
  }

  return {
    seed,
    getDays,
    createDay,
    getExercises,
    getExerciseById,
    addExercise,
    logSession,
    deleteSession,
    getProgress,
    computeSuggestion,
    resetDatabase,
  };
})();
