const db = require('./db');

function seed() {
  const days = [
    { day_number: 1, name: 'Day 1 — Push A' },
    { day_number: 2, name: 'Day 2 — Pull A' },
    { day_number: 3, name: 'Day 3 — Push B' },
    { day_number: 4, name: 'Day 4 — Pull B' },
  ];

  const exercises = {
    1: [
      { name: 'Push-Ups', target_sets: 3, rep_range_low: 10, rep_range_high: 15, is_bodyweight: 1, is_compound: 1, starting_weight: null },
      { name: 'Leg Press', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 1, starting_weight: 90 },
      { name: 'Bicep Curls', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 0, starting_weight: 20 },
      { name: 'Hip Adductors', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 90 },
      { name: 'Overhead Press', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 1, starting_weight: 75 },
      { name: 'Calf Raises', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 55 },
    ],
    2: [
      { name: 'Lat Pulldowns', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 1, starting_weight: 70 },
      { name: 'Hamstring Curls', target_sets: 3, rep_range_low: 10, rep_range_high: 12, is_bodyweight: 0, is_compound: 0, starting_weight: 50 },
      { name: 'Overhead Tricep Extension', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 0, starting_weight: 25 },
      { name: 'Hip Abductors', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 90 },
      { name: 'Lateral Raises', target_sets: 3, rep_range_low: 10, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 10 },
      { name: 'Calf Raises', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 55 },
    ],
    3: [
      { name: 'Tricep Dip', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 1, starting_weight: 0 },
      { name: 'Leg Press', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 1, starting_weight: 90 },
      { name: 'Hammer Curls', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 0, starting_weight: 20 },
      { name: 'Hip Adductors', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 90 },
      { name: 'Rear Delt Fly', target_sets: 3, rep_range_low: 10, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 10 },
      { name: 'Calf Raises', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 55 },
    ],
    4: [
      { name: 'Seated Row', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 1, starting_weight: 70 },
      { name: 'Hamstring Curls', target_sets: 3, rep_range_low: 10, rep_range_high: 12, is_bodyweight: 0, is_compound: 0, starting_weight: 50 },
      { name: 'Tricep Pushdown', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 0, starting_weight: 30 },
      { name: 'Hip Abductors', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 90 },
      { name: 'Overhead Press', target_sets: 3, rep_range_low: 8, rep_range_high: 12, is_bodyweight: 0, is_compound: 1, starting_weight: 75 },
      { name: 'Calf Raises', target_sets: 3, rep_range_low: 12, rep_range_high: 15, is_bodyweight: 0, is_compound: 0, starting_weight: 55 },
    ],
  };

  // Idempotent: skip if days already exist
  const existingDays = db.prepare('SELECT COUNT(*) as cnt FROM workout_days').get();
  if (existingDays.cnt > 0) {
    console.log('Seed data already exists, skipping.');
    return;
  }

  const insertDay = db.prepare('INSERT INTO workout_days (day_number, name) VALUES (?, ?)');
  const insertExercise = db.prepare(`
    INSERT INTO exercises (day_id, name, target_sets, rep_range_low, rep_range_high, is_bodyweight, is_compound, starting_weight, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO sessions (exercise_id, date, weight, reps) VALUES (?, ?, ?, ?)
  `);

  const seedTx = db.transaction(() => {
    for (const day of days) {
      const info = insertDay.run(day.day_number, day.name);
      const dayId = info.lastInsertRowid;
      const dayExercises = exercises[day.day_number];
      dayExercises.forEach((ex, idx) => {
        insertExercise.run(dayId, ex.name, ex.target_sets, ex.rep_range_low, ex.rep_range_high, ex.is_bodyweight, ex.is_compound, ex.starting_weight, idx);
      });
    }

    // Seed historical data: 2025-03-30 (Day 1)
    const day1Exercises = db.prepare('SELECT e.id, e.name FROM exercises e JOIN workout_days d ON e.day_id = d.id WHERE d.day_number = 1 ORDER BY e.sort_order').all();
    const historicalData = {
      'Push-Ups': { weight: null, reps: [12, 12, 12] },
      'Leg Press': { weight: 90, reps: [10, 10, 10] },
      'Bicep Curls': { weight: 20, reps: [8, 8, 8] },
      'Hip Adductors': { weight: 90, reps: [15, 15, 15] },
      'Overhead Press': { weight: 75, reps: [10, 10, 10] },
      'Calf Raises': { weight: 55, reps: [15, 15, 15] },
    };

    for (const ex of day1Exercises) {
      const data = historicalData[ex.name];
      if (data) {
        insertSession.run(ex.id, '2025-03-30', data.weight, JSON.stringify(data.reps));
      }
    }
  });

  seedTx();
  console.log('Seed data inserted successfully.');
}

seed();
