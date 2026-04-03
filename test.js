const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { app, computeSuggestion } = require('./server');

let server;
let baseUrl;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

before(async () => {
  // Run seed
  require('./seed');

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

describe('API Smoke Tests', () => {

  it('GET /api/days returns workout days', async () => {
    const res = await request('GET', '/api/days');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 4);
  });

  it('GET /api/days/:dayId/exercises returns exercises', async () => {
    const days = (await request('GET', '/api/days')).body;
    const res = await request('GET', `/api/days/${days[0].id}/exercises`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
  });

  it('POST /api/sessions logs a valid workout session', async () => {
    const days = (await request('GET', '/api/days')).body;
    const exercises = (await request('GET', `/api/days/${days[0].id}/exercises`)).body;
    // Find a non-bodyweight exercise
    const ex = exercises.find(e => !e.is_bodyweight);

    const res = await request('POST', '/api/sessions', {
      exercise_id: ex.id,
      date: '2025-04-01',
      weight: ex.starting_weight || 50,
      reps: [10, 10, 10],
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.message);
    assert.ok(res.body.suggestion);
  });

  it('POST /api/sessions rejects duplicate session', async () => {
    const days = (await request('GET', '/api/days')).body;
    const exercises = (await request('GET', `/api/days/${days[0].id}/exercises`)).body;
    const ex = exercises.find(e => !e.is_bodyweight);

    const res = await request('POST', '/api/sessions', {
      exercise_id: ex.id,
      date: '2025-04-01',
      weight: ex.starting_weight || 50,
      reps: [10, 10, 10],
    });
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.error);
  });

  it('POST /api/sessions rejects missing fields', async () => {
    const res = await request('POST', '/api/sessions', {
      exercise_id: 1,
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('POST /api/sessions rejects zero reps', async () => {
    const res = await request('POST', '/api/sessions', {
      exercise_id: 1,
      date: '2025-04-02',
      weight: 50,
      reps: [0, 10, 10],
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('POST /api/sessions rejects negative weight', async () => {
    const days = (await request('GET', '/api/days')).body;
    const exercises = (await request('GET', `/api/days/${days[0].id}/exercises`)).body;
    const ex = exercises.find(e => !e.is_bodyweight);

    const res = await request('POST', '/api/sessions', {
      exercise_id: ex.id,
      date: '2025-04-03',
      weight: -5,
      reps: [10, 10, 10],
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('GET /api/exercises/:id/progress returns correct shape', async () => {
    const days = (await request('GET', '/api/days')).body;
    const exercises = (await request('GET', `/api/days/${days[0].id}/exercises`)).body;

    const res = await request('GET', `/api/exercises/${exercises[0].id}/progress`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.exercise);
    assert.ok(Array.isArray(res.body.sessions));
    if (res.body.sessions.length > 0) {
      const s = res.body.sessions[0];
      assert.ok('date' in s);
      assert.ok('reps' in s);
      assert.ok('avgReps' in s);
    }
  });
});

describe('Progressive Overload Suggestion Logic', () => {

  const compoundExercise = {
    is_bodyweight: 0,
    is_compound: 1,
    rep_range_low: 8,
    rep_range_high: 12,
  };

  const isolationExercise = {
    is_bodyweight: 0,
    is_compound: 0,
    rep_range_low: 8,
    rep_range_high: 12,
  };

  const bodyweightExercise = {
    is_bodyweight: 1,
    is_compound: 1,
    rep_range_low: 10,
    rep_range_high: 15,
  };

  it('suggests weight increase when all sets at top of range (compound)', () => {
    const result = computeSuggestion(compoundExercise, 100, [12, 12, 12]);
    assert.strictEqual(result.action, 'increase');
    assert.strictEqual(result.newWeight, 105);
  });

  it('suggests weight increase when all sets at top of range (isolation)', () => {
    const result = computeSuggestion(isolationExercise, 20, [12, 12, 12]);
    assert.strictEqual(result.action, 'increase');
    assert.strictEqual(result.newWeight, 22.5);
  });

  it('suggests hold when some sets at top, some not', () => {
    const result = computeSuggestion(compoundExercise, 100, [12, 10, 10]);
    assert.strictEqual(result.action, 'hold');
    assert.strictEqual(result.newWeight, 100);
  });

  it('suggests drop when any set below bottom of range', () => {
    const result = computeSuggestion(compoundExercise, 100, [7, 8, 6]);
    assert.strictEqual(result.action, 'drop');
    assert.ok(result.newWeight < 100);
  });

  it('handles bodyweight increase suggestion', () => {
    const result = computeSuggestion(bodyweightExercise, null, [15, 15, 15]);
    assert.strictEqual(result.action, 'increase_reps');
  });

  it('handles bodyweight hold suggestion', () => {
    const result = computeSuggestion(bodyweightExercise, null, [12, 12, 12]);
    assert.strictEqual(result.action, 'hold');
  });

  it('handles bodyweight below range', () => {
    const result = computeSuggestion(bodyweightExercise, null, [9, 10, 10]);
    assert.strictEqual(result.action, 'hold');
    assert.ok(result.message.includes('below'));
  });
});
