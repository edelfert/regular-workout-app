// State
let days = [];
let currentDayId = null;
let progressChart = null;

// --- API helpers ---

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// --- View switching ---

function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`view-${view}`).style.display = 'block';
  document.getElementById(`nav-${view}`).classList.add('active');

  if (view === 'dashboard') loadDashboard();
  if (view === 'progress') loadProgressSelects();
  if (view === 'manage') loadManageSelects();
}

// --- Dashboard ---

async function loadDashboard() {
  const loading = document.getElementById('loading-dashboard');
  const errorEl = document.getElementById('error-dashboard');
  const tabsEl = document.getElementById('day-tabs');
  const listEl = document.getElementById('exercises-list');

  loading.style.display = 'block';
  errorEl.style.display = 'none';
  listEl.innerHTML = '';

  try {
    days = await api('/api/days');
    loading.style.display = 'none';

    // Render day tabs
    tabsEl.innerHTML = '';
    days.forEach(day => {
      const btn = document.createElement('button');
      btn.className = 'day-tab' + (day.id === currentDayId ? ' active' : '');
      btn.textContent = day.name;
      btn.onclick = () => selectDay(day.id);
      tabsEl.appendChild(btn);
    });

    if (!currentDayId && days.length > 0) {
      // Default to today's day based on rotation
      const todayIndex = getDayRotation();
      currentDayId = days[todayIndex] ? days[todayIndex].id : days[0].id;
      // Re-render tabs with active state
      tabsEl.querySelectorAll('.day-tab').forEach((btn, i) => {
        if (days[i].id === currentDayId) btn.classList.add('active');
      });
    }

    if (currentDayId) loadExercises(currentDayId);
  } catch (err) {
    loading.style.display = 'none';
    errorEl.textContent = 'Failed to load workout days: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function getDayRotation() {
  // Simple rotation: days since a reference date modulo number of days
  const ref = new Date('2025-03-30'); // Day 1 was March 30, 2025
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - ref) / (1000 * 60 * 60 * 24));
  return ((diff % days.length) + days.length) % days.length;
}

function selectDay(dayId) {
  currentDayId = dayId;
  document.querySelectorAll('.day-tab').forEach((btn, i) => {
    btn.classList.toggle('active', days[i] && days[i].id === dayId);
  });
  loadExercises(dayId);
}

async function loadExercises(dayId) {
  const listEl = document.getElementById('exercises-list');
  const errorEl = document.getElementById('error-dashboard');
  listEl.innerHTML = '<div class="loading">Loading exercises...</div>';
  errorEl.style.display = 'none';

  try {
    const exercises = await api(`/api/days/${dayId}/exercises`);
    listEl.innerHTML = '';
    const today = new Date().toISOString().split('T')[0];

    exercises.forEach(ex => {
      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.id = `exercise-${ex.id}`;

      let setsHtml = '';
      for (let i = 0; i < ex.target_sets; i++) {
        setsHtml += `
          <div class="set-input-group">
            <label>Set ${i + 1}</label>
            <input type="number" min="1" id="rep-${ex.id}-${i}" placeholder="${ex.rep_range_low}-${ex.rep_range_high}" required>
          </div>
        `;
      }

      const weightHtml = ex.is_bodyweight ? '' : `
        <div class="weight-input-group">
          <label>Weight (lbs)</label>
          <input type="number" min="0" step="0.5" id="weight-${ex.id}" placeholder="${ex.starting_weight || 0}">
        </div>
      `;

      card.innerHTML = `
        <h3>${ex.name}${ex.is_bodyweight ? ' <span style="color:#888;font-size:0.8rem;">(bodyweight)</span>' : ''}</h3>
        <div class="exercise-meta">${ex.target_sets} sets × ${ex.rep_range_low}-${ex.rep_range_high} reps${ex.is_compound ? ' • Compound' : ' • Isolation'}${ex.starting_weight ? ' • Starting: ' + ex.starting_weight + ' lbs' : ''}</div>
        <div class="sets-row">
          ${weightHtml}
          ${setsHtml}
          <button class="log-btn" onclick="logWorkout(${ex.id}, ${ex.target_sets}, ${ex.is_bodyweight})">Log Workout</button>
        </div>
        <div id="error-${ex.id}" class="inline-error" style="display:none;"></div>
        <div id="suggestion-${ex.id}" class="suggestion-box" style="display:none;"></div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    listEl.innerHTML = '';
    errorEl.textContent = 'Failed to load exercises: ' + err.message;
    errorEl.style.display = 'block';
  }
}

async function logWorkout(exerciseId, targetSets, isBodyweight) {
  const errorEl = document.getElementById(`error-${exerciseId}`);
  const suggestionEl = document.getElementById(`suggestion-${exerciseId}`);
  errorEl.style.display = 'none';
  suggestionEl.style.display = 'none';

  // Clear previous input errors
  for (let i = 0; i < targetSets; i++) {
    document.getElementById(`rep-${exerciseId}-${i}`).classList.remove('input-error');
  }
  if (!isBodyweight) {
    const wEl = document.getElementById(`weight-${exerciseId}`);
    if (wEl) wEl.classList.remove('input-error');
  }

  // Validate inputs
  const reps = [];
  let valid = true;

  for (let i = 0; i < targetSets; i++) {
    const input = document.getElementById(`rep-${exerciseId}-${i}`);
    const val = parseInt(input.value, 10);
    if (isNaN(val) || val < 1) {
      input.classList.add('input-error');
      valid = false;
    } else {
      reps.push(val);
    }
  }

  let weight = null;
  if (!isBodyweight) {
    const wInput = document.getElementById(`weight-${exerciseId}`);
    weight = parseFloat(wInput.value);
    if (isNaN(weight) || weight < 0) {
      wInput.classList.add('input-error');
      valid = false;
    }
  }

  if (!valid) {
    errorEl.textContent = 'Please fill in all fields with valid values. Reps must be ≥ 1' + (isBodyweight ? '.' : ' and weight must be ≥ 0.');
    errorEl.style.display = 'block';
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const btn = document.querySelector(`#exercise-${exerciseId} .log-btn`);
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const body = { exercise_id: exerciseId, date: today, reps };
    if (!isBodyweight) body.weight = weight;

    const result = await api('/api/sessions', { method: 'POST', body: JSON.stringify(body) });

    btn.textContent = 'Logged ✓';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Log Workout'; }, 2000);

    if (result.suggestion) {
      suggestionEl.textContent = result.suggestion.message;
      suggestionEl.className = 'suggestion-box' + (result.suggestion.action === 'drop' ? ' drop' : '');
      suggestionEl.style.display = 'block';
    }
  } catch (err) {
    const btn = document.querySelector(`#exercise-${exerciseId} .log-btn`);
    btn.disabled = false;
    btn.textContent = 'Log Workout';
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
}

// --- Progress View ---

async function loadProgressSelects() {
  const daySelect = document.getElementById('progress-day-select');
  const exSelect = document.getElementById('progress-exercise-select');

  try {
    if (days.length === 0) days = await api('/api/days');

    daySelect.innerHTML = '<option value="">Select a day...</option>';
    days.forEach(d => {
      daySelect.innerHTML += `<option value="${d.id}">${d.name}</option>`;
    });

    daySelect.onchange = async () => {
      const dayId = daySelect.value;
      exSelect.innerHTML = '<option value="">Select an exercise...</option>';
      if (!dayId) return;
      const exercises = await api(`/api/days/${dayId}/exercises`);
      exercises.forEach(ex => {
        exSelect.innerHTML += `<option value="${ex.id}">${ex.name}</option>`;
      });
    };

    exSelect.onchange = () => {
      if (exSelect.value) loadProgress(parseInt(exSelect.value, 10));
    };
  } catch (err) {
    document.getElementById('error-progress').textContent = 'Failed to load: ' + err.message;
    document.getElementById('error-progress').style.display = 'block';
  }
}

async function loadProgress(exerciseId) {
  const loadingEl = document.getElementById('loading-progress');
  const errorEl = document.getElementById('error-progress');
  const chartContainer = document.getElementById('progress-chart-container');
  const suggestionEl = document.getElementById('progress-suggestion');
  const historyEl = document.getElementById('progress-history');

  loadingEl.style.display = 'block';
  errorEl.style.display = 'none';
  chartContainer.style.display = 'none';
  suggestionEl.style.display = 'none';
  historyEl.style.display = 'none';

  try {
    const data = await api(`/api/exercises/${exerciseId}/progress`);
    loadingEl.style.display = 'none';

    if (data.sessions.length === 0) {
      errorEl.textContent = 'No sessions logged yet for this exercise.';
      errorEl.style.display = 'block';
      return;
    }

    // Chart
    chartContainer.style.display = 'block';
    renderChart(data);

    // Suggestion
    if (data.suggestion) {
      suggestionEl.textContent = data.suggestion.message;
      suggestionEl.className = 'suggestion-box' + (data.suggestion.action === 'drop' ? ' drop' : '');
      suggestionEl.style.display = 'block';
    }

    // History table
    historyEl.style.display = 'block';
    const tbody = document.querySelector('#progress-table tbody');
    tbody.innerHTML = '';
    data.sessions.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s.date}</td>
        <td>${s.weight !== null ? s.weight + ' lbs' : 'BW'}</td>
        <td>${s.reps.join(', ')}</td>
        <td>${s.avgReps}</td>
        <td><button class="delete-btn" onclick="deleteSession(${s.id}, ${exerciseId})">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.textContent = 'Failed to load progress: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function renderChart(data) {
  const ctx = document.getElementById('progress-chart').getContext('2d');

  if (progressChart) progressChart.destroy();

  const labels = data.sessions.map(s => s.date);
  const weights = data.sessions.map(s => s.weight);
  const avgReps = data.sessions.map(s => s.avgReps);
  const isBodyweight = data.exercise.is_bodyweight;

  const datasets = [];

  if (!isBodyweight) {
    datasets.push({
      label: 'Weight (lbs)',
      data: weights,
      borderColor: '#2d5ff5',
      backgroundColor: 'rgba(45, 95, 245, 0.1)',
      yAxisID: 'y',
      tension: 0.3,
      pointRadius: data.sessions.length === 1 ? 6 : 4,
      pointHoverRadius: 7,
    });
  }

  datasets.push({
    label: 'Avg Reps',
    data: avgReps,
    borderColor: '#6fcf6f',
    backgroundColor: 'rgba(111, 207, 111, 0.1)',
    yAxisID: isBodyweight ? 'y' : 'y1',
    tension: 0.3,
    pointRadius: data.sessions.length === 1 ? 6 : 4,
    pointHoverRadius: 7,
  });

  const scales = {};
  if (!isBodyweight) {
    scales.y = {
      type: 'linear',
      position: 'left',
      title: { display: true, text: 'Weight (lbs)', color: '#888' },
      ticks: { color: '#888' },
      grid: { color: '#2a2d37' },
    };
    scales.y1 = {
      type: 'linear',
      position: 'right',
      title: { display: true, text: 'Avg Reps', color: '#888' },
      ticks: { color: '#888' },
      grid: { drawOnChartArea: false },
    };
  } else {
    scales.y = {
      type: 'linear',
      position: 'left',
      title: { display: true, text: 'Avg Reps', color: '#888' },
      ticks: { color: '#888' },
      grid: { color: '#2a2d37' },
    };
  }

  scales.x = {
    ticks: { color: '#888' },
    grid: { color: '#2a2d37' },
  };

  progressChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#e0e0e0' } },
        tooltip: {
          callbacks: {
            afterBody: function(context) {
              const idx = context[0].dataIndex;
              const s = data.sessions[idx];
              return `Reps: [${s.reps.join(', ')}]`;
            }
          }
        }
      },
      scales,
    },
  });
}

async function deleteSession(sessionId, exerciseId) {
  if (!confirm('Delete this session entry?')) return;
  try {
    await api(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    loadProgress(exerciseId);
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

// --- Manage View ---

async function loadManageSelects() {
  const select = document.getElementById('add-ex-day');
  try {
    if (days.length === 0) days = await api('/api/days');
    select.innerHTML = '<option value="">Select...</option>';
    days.forEach(d => {
      select.innerHTML += `<option value="${d.id}">${d.name}</option>`;
    });
  } catch (err) {
    document.getElementById('add-ex-error').textContent = 'Failed to load days: ' + err.message;
    document.getElementById('add-ex-error').style.display = 'block';
  }
}

// Add exercise form
document.getElementById('add-exercise-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('add-ex-error');
  errorEl.style.display = 'none';

  const dayId = document.getElementById('add-ex-day').value;
  const name = document.getElementById('add-ex-name').value.trim();
  const target_sets = parseInt(document.getElementById('add-ex-sets').value, 10);
  const rep_range_low = parseInt(document.getElementById('add-ex-low').value, 10);
  const rep_range_high = parseInt(document.getElementById('add-ex-high').value, 10);
  const is_bodyweight = document.getElementById('add-ex-bw').checked;
  const is_compound = document.getElementById('add-ex-compound').checked;
  const starting_weight = parseFloat(document.getElementById('add-ex-weight').value) || null;

  if (!dayId) { errorEl.textContent = 'Please select a day.'; errorEl.style.display = 'block'; return; }
  if (!name) { errorEl.textContent = 'Exercise name is required.'; errorEl.style.display = 'block'; return; }
  if (isNaN(target_sets) || target_sets < 1) { errorEl.textContent = 'Target sets must be ≥ 1.'; errorEl.style.display = 'block'; return; }
  if (isNaN(rep_range_low) || rep_range_low < 1) { errorEl.textContent = 'Rep range low must be ≥ 1.'; errorEl.style.display = 'block'; return; }
  if (isNaN(rep_range_high) || rep_range_high < rep_range_low) { errorEl.textContent = 'Rep range high must be ≥ low.'; errorEl.style.display = 'block'; return; }

  try {
    await api(`/api/days/${dayId}/exercises`, {
      method: 'POST',
      body: JSON.stringify({ name, target_sets, rep_range_low, rep_range_high, is_bodyweight, is_compound, starting_weight }),
    });
    alert('Exercise added!');
    e.target.reset();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});

// Add day form
let newDayExCounter = 0;

function addNewDayExerciseRow() {
  const list = document.getElementById('new-day-ex-list');
  const row = document.createElement('div');
  row.className = 'new-day-exercise-row';
  row.id = `new-day-ex-${newDayExCounter}`;
  row.innerHTML = `
    <input type="text" placeholder="Exercise name" required>
    <input type="number" placeholder="Sets" value="3" min="1" style="width:50px" required>
    <input type="number" placeholder="Low" min="1" style="width:50px" required>
    <input type="number" placeholder="High" min="1" style="width:50px" required>
    <label style="font-size:0.75rem;color:#888;"><input type="checkbox" class="ndex-bw"> BW</label>
    <label style="font-size:0.75rem;color:#888;"><input type="checkbox" class="ndex-compound"> Compound</label>
    <input type="number" placeholder="Weight" step="0.5" min="0" style="width:60px">
    <button type="button" class="remove-ex-btn" onclick="this.parentElement.remove()">×</button>
  `;
  list.appendChild(row);
  newDayExCounter++;
}

document.getElementById('add-day-ex-btn').addEventListener('click', addNewDayExerciseRow);

// Add one row by default
addNewDayExerciseRow();

document.getElementById('add-day-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('add-day-error');
  errorEl.style.display = 'none';

  const name = document.getElementById('add-day-name').value.trim();
  if (!name) { errorEl.textContent = 'Day name is required.'; errorEl.style.display = 'block'; return; }

  const rows = document.querySelectorAll('.new-day-exercise-row');
  if (rows.length === 0) { errorEl.textContent = 'Add at least one exercise.'; errorEl.style.display = 'block'; return; }

  const exercises = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll('input');
    const exName = inputs[0].value.trim();
    const sets = parseInt(inputs[1].value, 10);
    const low = parseInt(inputs[2].value, 10);
    const high = parseInt(inputs[3].value, 10);
    const isBw = row.querySelector('.ndex-bw').checked;
    const isCompound = row.querySelector('.ndex-compound').checked;
    const weight = parseFloat(inputs[6].value) || null;

    if (!exName) { errorEl.textContent = 'All exercises must have a name.'; errorEl.style.display = 'block'; return; }
    if (isNaN(sets) || sets < 1) { errorEl.textContent = `Invalid sets for "${exName}".`; errorEl.style.display = 'block'; return; }
    if (isNaN(low) || low < 1) { errorEl.textContent = `Invalid rep low for "${exName}".`; errorEl.style.display = 'block'; return; }
    if (isNaN(high) || high < low) { errorEl.textContent = `Invalid rep high for "${exName}".`; errorEl.style.display = 'block'; return; }

    exercises.push({
      name: exName,
      target_sets: sets,
      rep_range_low: low,
      rep_range_high: high,
      is_bodyweight: isBw,
      is_compound: isCompound,
      starting_weight: weight,
    });
  }

  try {
    await api('/api/days', {
      method: 'POST',
      body: JSON.stringify({ name, exercises }),
    });
    alert('Workout day created!');
    days = []; // force reload
    e.target.reset();
    document.getElementById('new-day-ex-list').innerHTML = '';
    addNewDayExerciseRow();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});

// --- Init ---
loadDashboard();
