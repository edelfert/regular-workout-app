const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Workout Days ---

app.get('/api/days', (req, res) => {
  try {
    const days = db.prepare('SELECT * FROM workout_days ORDER BY day_number').all();
    res.json(days);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch workout days', details: err.message });
  }
});

app.post('/api/days', (req, res) => {
  try {
    const { name, exercises } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Day name is required' });
    }
    if (!Array.isArray(exercises) || exercises.length === 0) {
      return res.status(400).json({ error: 'At least one exercise is required' });
    }
    for (const ex of exercises) {
      if (!ex.name || typeof ex.name !== 'string' || !ex.name.trim()) {
        return res.status(400).json({ error: 'Each exercise must have a name' });
      }
      if (!Number.isInteger(ex.target_sets) || ex.target_sets < 1) {
        return res.status(400).json({ error: `Invalid target_sets for "${ex.name}"` });
      }
      if (!Number.isInteger(ex.rep_range_low) || ex.rep_range_low < 1) {
        return res.status(400).json({ error: `Invalid rep_range_low for "${ex.name}"` });
      }
      if (!Number.isInteger(ex.rep_range_high) || ex.rep_range_high < ex.rep_range_low) {
        return res.status(400).json({ error: `Invalid rep_range_high for "${ex.name}"` });
      }
    }

    const maxDay = db.prepare('SELECT COALESCE(MAX(day_number), 0) as max FROM workout_days').get();
    const newDayNumber = maxDay.max + 1;

    const tx = db.transaction(() => {
      const info = db.prepare('INSERT INTO workout_days (day_number, name) VALUES (?, ?)').run(newDayNumber, name.trim());
      const dayId = info.lastInsertRowid;
      const insert = db.prepare(`
        INSERT INTO exercises (day_id, name, target_sets, rep_range_low, rep_range_high, is_bodyweight, is_compound, starting_weight, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      exercises.forEach((ex, idx) => {
        insert.run(dayId, ex.name.trim(), ex.target_sets, ex.rep_range_low, ex.rep_range_high, ex.is_bodyweight ? 1 : 0, ex.is_compound ? 1 : 0, ex.starting_weight || null, idx);
      });
      return dayId;
    });

    const dayId = tx();
    const created = db.prepare('SELECT * FROM workout_days WHERE id = ?').get(dayId);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create workout day', details: err.message });
  }
});

// --- Exercises ---

app.get('/api/days/:dayId/exercises', (req, res) => {
  try {
    const exercises = db.prepare('SELECT * FROM exercises WHERE day_id = ? ORDER BY sort_order').all(req.params.dayId);
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exercises', details: err.message });
  }
});

app.post('/api/days/:dayId/exercises', (req, res) => {
  try {
    const dayId = parseInt(req.params.dayId, 10);
    const day = db.prepare('SELECT * FROM workout_days WHERE id = ?').get(dayId);
    if (!day) {
      return res.status(404).json({ error: 'Workout day not found' });
    }

    const { name, target_sets, rep_range_low, rep_range_high, is_bodyweight, is_compound, starting_weight } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Exercise name is required' });
    }
    if (!Number.isInteger(target_sets) || target_sets < 1) {
      return res.status(400).json({ error: 'target_sets must be a positive integer' });
    }
    if (!Number.isInteger(rep_range_low) || rep_range_low < 1) {
      return res.status(400).json({ error: 'rep_range_low must be a positive integer' });
    }
    if (!Number.isInteger(rep_range_high) || rep_range_high < rep_range_low) {
      return res.status(400).json({ error: 'rep_range_high must be >= rep_range_low' });
    }

    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max FROM exercises WHERE day_id = ?').get(dayId);
    const info = db.prepare(`
      INSERT INTO exercises (day_id, name, target_sets, rep_range_low, rep_range_high, is_bodyweight, is_compound, starting_weight, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(dayId, name.trim(), target_sets, rep_range_low, rep_range_high, is_bodyweight ? 1 : 0, is_compound ? 1 : 0, starting_weight || null, maxOrder.max + 1);

    const created = db.prepare('SELECT * FROM exercises WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add exercise', details: err.message });
  }
});

// --- Sessions ---

app.post('/api/sessions', (req, res) => {
  try {
    const { exercise_id, date, weight, reps } = req.body;

    if (!exercise_id || !Number.isInteger(exercise_id)) {
      return res.status(400).json({ error: 'exercise_id must be an integer' });
    }
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }
    if (!Array.isArray(reps) || reps.length === 0) {
      return res.status(400).json({ error: 'reps must be a non-empty array of integers' });
    }
    for (let i = 0; i < reps.length; i++) {
      if (!Number.isInteger(reps[i]) || reps[i] < 1) {
        return res.status(400).json({ error: `reps[${i}] must be a positive integer` });
      }
    }

    const exercise = db.prepare('SELECT * FROM exercises WHERE id = ?').get(exercise_id);
    if (!exercise) {
      return res.status(404).json({ error: 'Exercise not found' });
    }

    if (exercise.is_bodyweight) {
      // Bodyweight exercise: ignore weight
      const existing = db.prepare('SELECT id FROM sessions WHERE exercise_id = ? AND date = ?').get(exercise_id, date);
      if (existing) {
        return res.status(409).json({ error: 'Session already logged for this exercise on this date. Delete it first or choose a different date.' });
      }
      db.prepare('INSERT INTO sessions (exercise_id, date, weight, reps) VALUES (?, ?, NULL, ?)').run(exercise_id, date, JSON.stringify(reps));
    } else {
      if (weight === undefined || weight === null || typeof weight !== 'number' || weight < 0) {
        return res.status(400).json({ error: 'weight must be a non-negative number for weighted exercises' });
      }
      const existing = db.prepare('SELECT id FROM sessions WHERE exercise_id = ? AND date = ?').get(exercise_id, date);
      if (existing) {
        return res.status(409).json({ error: 'Session already logged for this exercise on this date. Delete it first or choose a different date.' });
      }
      db.prepare('INSERT INTO sessions (exercise_id, date, weight, reps) VALUES (?, ?, ?, ?)').run(exercise_id, date, weight, JSON.stringify(reps));
    }

    // Compute progressive overload suggestion
    const suggestion = computeSuggestion(exercise, weight, reps);

    res.status(201).json({ message: 'Session logged', suggestion });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Session already logged for this exercise on this date.' });
    }
    res.status(500).json({ error: 'Failed to log session', details: err.message });
  }
});

app.delete('/api/sessions/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid session id' });
    }
    const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete session', details: err.message });
  }
});

// --- Progress ---

app.get('/api/exercises/:exerciseId/progress', (req, res) => {
  try {
    const exerciseId = parseInt(req.params.exerciseId, 10);
    const exercise = db.prepare('SELECT * FROM exercises WHERE id = ?').get(exerciseId);
    if (!exercise) {
      return res.status(404).json({ error: 'Exercise not found' });
    }
    const sessions = db.prepare('SELECT * FROM sessions WHERE exercise_id = ? ORDER BY date ASC').all(exerciseId);
    const data = sessions.map(s => ({
      id: s.id,
      date: s.date,
      weight: s.weight,
      reps: JSON.parse(s.reps),
      avgReps: parseFloat((JSON.parse(s.reps).reduce((a, b) => a + b, 0) / JSON.parse(s.reps).length).toFixed(1)),
    }));

    // Suggestion based on most recent session
    let suggestion = null;
    if (data.length > 0) {
      const last = data[data.length - 1];
      suggestion = computeSuggestion(exercise, last.weight, last.reps);
    }

    res.json({ exercise, sessions: data, suggestion });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch progress', details: err.message });
  }
});

// --- Progressive Overload Logic ---

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
    return {
      action: 'increase',
      newWeight,
      message: `Next session: try ${newWeight} lbs (+${increment})`,
    };
  } else if (anyBelowBottom) {
    const dropped = Math.round((currentWeight * 0.95) * 2) / 2; // round to nearest 0.5
    if (dropped < currentWeight) {
      return {
        action: 'drop',
        newWeight: dropped,
        message: `Some sets below ${exercise.rep_range_low} reps. Consider dropping to ${dropped} lbs (-5%) or staying at ${currentWeight} lbs.`,
      };
    }
    return {
      action: 'hold',
      newWeight: currentWeight,
      message: `Some sets below ${exercise.rep_range_low} reps. Stay at ${currentWeight} lbs and focus on form.`,
    };
  } else {
    return {
      action: 'hold',
      newWeight: currentWeight,
      message: `Good progress at ${currentWeight} lbs. Stay here and aim for ${exercise.rep_range_high} reps on all sets.`,
    };
  }
}

// Export for tests
module.exports = { app, computeSuggestion };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Workout tracker running at http://localhost:${PORT}`);
  });
}
