// Initialize / seed on first visit
DB.seed();

// State
let days = [];
let currentDayId = null;
let progressChart = null;

// --- Toast Notifications ---

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 2500);
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

function loadDashboard() {
  const errorEl = document.getElementById('error-dashboard');
  const tabsEl = document.getElementById('day-tabs');
  const listEl = document.getElementById('exercises-list');

  errorEl.style.display = 'none';
  listEl.innerHTML = '';

  try {
    days = DB.getDays();

    tabsEl.innerHTML = '';
    days.forEach(day => {
      const btn = document.createElement('button');
      btn.className = 'day-tab' + (day.id === currentDayId ? ' active' : '');
      btn.textContent = day.name;
      btn.onclick = () => selectDay(day.id);
      tabsEl.appendChild(btn);
    });

    if (!currentDayId && days.length > 0) {
      const todayIndex = getDayRotation();
      currentDayId = days[todayIndex] ? days[todayIndex].id : days[0].id;
      tabsEl.querySelectorAll('.day-tab').forEach((btn, i) => {
        if (days[i].id === currentDayId) btn.classList.add('active');
      });
    }

    if (currentDayId) loadExercises(currentDayId);
  } catch (err) {
    errorEl.textContent = 'Failed to load workout days: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function getDayRotation() {
  const ref = new Date('2025-03-30');
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

function getLastSession(exerciseId) {
  try {
    const progress = DB.getProgress(exerciseId);
    if (progress.sessions.length > 0) {
      return progress.sessions[progress.sessions.length - 1];
    }
  } catch (_) { /* ignore */ }
  return null;
}

function loadExercises(dayId) {
  const listEl = document.getElementById('exercises-list');
  const errorEl = document.getElementById('error-dashboard');
  listEl.innerHTML = '';
  errorEl.style.display = 'none';

  try {
    const exercises = DB.getExercises(dayId);

    if (exercises.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>No exercises on this day yet.<br>Go to Manage to add some.</p></div>';
      return;
    }

    exercises.forEach((ex, index) => {
      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.id = `exercise-${ex.id}`;
      card.style.animationDelay = `${index * 0.05}s`;

      const lastSession = getLastSession(ex.id);

      // Badge
      let badgeHtml = '';
      if (ex.is_bodyweight) {
        badgeHtml = '<span class="exercise-badge badge-bodyweight">Bodyweight</span>';
      } else if (ex.is_compound) {
        badgeHtml = '<span class="exercise-badge badge-compound">Compound</span>';
      } else {
        badgeHtml = '<span class="exercise-badge badge-isolation">Isolation</span>';
      }

      // Last session info
      let lastHtml = '';
      if (lastSession) {
        const weightStr = lastSession.weight !== null ? `${lastSession.weight} lbs` : 'Bodyweight';
        lastHtml = `<div class="last-session-info">Last: ${weightStr} \u2014 ${lastSession.reps.join(', ')} reps on ${lastSession.date}</div>`;
      }

      // Set inputs — always blank, last session shown as reference above
      let setsHtml = '';
      for (let i = 0; i < ex.target_sets; i++) {
        setsHtml += `
          <div class="input-group">
            <label>Set ${i + 1}</label>
            <input type="number" min="1" id="rep-${ex.id}-${i}" placeholder="${ex.rep_range_low}-${ex.rep_range_high}">
          </div>
        `;
      }

      // Weight input — always blank
      let weightHtml = '';
      if (!ex.is_bodyweight) {
        weightHtml = `
          <div class="input-group weight-group">
            <label>Weight</label>
            <input type="number" min="0" step="0.5" id="weight-${ex.id}" placeholder="${ex.starting_weight || 0}">
          </div>
        `;
      }

      card.innerHTML = `
        <div class="exercise-card-header">
          <h3>${ex.name}</h3>
          ${badgeHtml}
        </div>
        <div class="exercise-meta">
          <span>${ex.target_sets} sets \u00d7 ${ex.rep_range_low}\u2013${ex.rep_range_high} reps</span>
          ${ex.starting_weight ? `<span>Start: ${ex.starting_weight} lbs</span>` : ''}
        </div>
        ${lastHtml}
        <div class="input-row">
          ${weightHtml}
          ${setsHtml}
        </div>
        <div class="card-actions">
          <button class="log-btn" onclick="logWorkout(${ex.id}, ${ex.target_sets}, ${ex.is_bodyweight})">Log Workout</button>
        </div>
        <div id="error-${ex.id}" class="inline-error" style="display:none;"></div>
        <div id="suggestion-${ex.id}" class="suggestion-box" style="display:none;"></div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    errorEl.textContent = 'Failed to load exercises: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function logWorkout(exerciseId, targetSets, isBodyweight) {
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

  // Validate
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
    errorEl.textContent = 'Fill in all fields. Reps must be at least 1' + (isBodyweight ? '.' : ', weight at least 0.');
    errorEl.style.display = 'block';
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const result = DB.logSession(exerciseId, today, weight, reps);

    const btn = document.querySelector(`#exercise-${exerciseId} .log-btn`);
    btn.textContent = 'Logged \u2713';
    btn.disabled = true;
    showToast('Workout logged!', 'success');

    setTimeout(() => { btn.disabled = false; btn.textContent = 'Log Workout'; }, 2500);

    if (result.suggestion) {
      suggestionEl.textContent = result.suggestion.message;
      let sugClass = 'suggestion-box';
      if (result.suggestion.action === 'drop') sugClass += ' drop';
      else if (result.suggestion.action === 'hold') sugClass += ' hold';
      suggestionEl.className = sugClass;
      suggestionEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    showToast(err.message, 'error');
  }
}

// --- Progress View ---

function loadProgressSelects() {
  const daySelect = document.getElementById('progress-day-select');
  const exSelect = document.getElementById('progress-exercise-select');

  try {
    if (days.length === 0) days = DB.getDays();

    daySelect.innerHTML = '<option value="">Select a day...</option>';
    days.forEach(d => {
      daySelect.innerHTML += `<option value="${d.id}">${d.name}</option>`;
    });

    daySelect.onchange = () => {
      const dayId = parseInt(daySelect.value, 10);
      exSelect.innerHTML = '<option value="">Select an exercise...</option>';
      document.getElementById('progress-chart-container').style.display = 'none';
      document.getElementById('progress-suggestion').style.display = 'none';
      document.getElementById('progress-history').style.display = 'none';
      document.getElementById('error-progress').style.display = 'none';
      if (!dayId) return;
      const exercises = DB.getExercises(dayId);
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

function loadProgress(exerciseId) {
  const errorEl = document.getElementById('error-progress');
  const chartContainer = document.getElementById('progress-chart-container');
  const suggestionEl = document.getElementById('progress-suggestion');
  const historyEl = document.getElementById('progress-history');

  errorEl.style.display = 'none';
  chartContainer.style.display = 'none';
  suggestionEl.style.display = 'none';
  historyEl.style.display = 'none';

  try {
    const data = DB.getProgress(exerciseId);

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
      let sugClass = 'suggestion-box';
      if (data.suggestion.action === 'drop') sugClass += ' drop';
      else if (data.suggestion.action === 'hold') sugClass += ' hold';
      suggestionEl.className = sugClass;
      suggestionEl.style.display = 'block';
    }

    // History table
    historyEl.style.display = 'block';
    const tbody = document.querySelector('#progress-table tbody');
    tbody.innerHTML = '';
    data.sessions.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(s.date)}</td>
        <td>${s.weight !== null ? s.weight + ' lbs' : 'BW'}</td>
        <td>${s.reps.join(', ')}</td>
        <td>${s.avgReps}</td>
        <td><button class="delete-btn" onclick="deleteSession(${s.id}, ${exerciseId})">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    errorEl.textContent = 'Failed to load progress: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderChart(data) {
  const ctx = document.getElementById('progress-chart').getContext('2d');
  if (progressChart) progressChart.destroy();

  const labels = data.sessions.map(s => formatDate(s.date));
  const weights = data.sessions.map(s => s.weight);
  const avgReps = data.sessions.map(s => s.avgReps);
  const isBodyweight = data.exercise.is_bodyweight;

  const datasets = [];

  if (!isBodyweight) {
    datasets.push({
      label: 'Weight (lbs)',
      data: weights,
      borderColor: '#4f6ef7',
      backgroundColor: 'rgba(79, 110, 247, 0.08)',
      yAxisID: 'y',
      tension: 0.35,
      fill: true,
      pointRadius: data.sessions.length === 1 ? 6 : 4,
      pointHoverRadius: 7,
      pointBackgroundColor: '#4f6ef7',
      borderWidth: 2.5,
    });
  }

  datasets.push({
    label: 'Avg Reps',
    data: avgReps,
    borderColor: '#34d399',
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    yAxisID: isBodyweight ? 'y' : 'y1',
    tension: 0.35,
    fill: true,
    pointRadius: data.sessions.length === 1 ? 6 : 4,
    pointHoverRadius: 7,
    pointBackgroundColor: '#34d399',
    borderWidth: 2.5,
  });

  const gridColor = 'rgba(30, 34, 53, 0.6)';
  const scales = {};

  if (!isBodyweight) {
    scales.y = {
      type: 'linear', position: 'left',
      title: { display: true, text: 'Weight (lbs)', color: '#555a70', font: { size: 11, family: 'Inter' } },
      ticks: { color: '#555a70', font: { size: 11, family: 'Inter' } },
      grid: { color: gridColor },
      border: { color: 'transparent' },
    };
    scales.y1 = {
      type: 'linear', position: 'right',
      title: { display: true, text: 'Avg Reps', color: '#555a70', font: { size: 11, family: 'Inter' } },
      ticks: { color: '#555a70', font: { size: 11, family: 'Inter' } },
      grid: { drawOnChartArea: false },
      border: { color: 'transparent' },
    };
  } else {
    scales.y = {
      type: 'linear', position: 'left',
      title: { display: true, text: 'Avg Reps', color: '#555a70', font: { size: 11, family: 'Inter' } },
      ticks: { color: '#555a70', font: { size: 11, family: 'Inter' } },
      grid: { color: gridColor },
      border: { color: 'transparent' },
    };
  }

  scales.x = {
    ticks: { color: '#555a70', font: { size: 11, family: 'Inter' }, maxRotation: 45 },
    grid: { color: gridColor },
    border: { color: 'transparent' },
  };

  progressChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#8a8fa8', font: { size: 12, family: 'Inter', weight: '500' }, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: '#1a1e2e',
          titleColor: '#f0f0f5',
          bodyColor: '#8a8fa8',
          borderColor: '#1e2235',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' },
          callbacks: {
            afterBody: function(context) {
              const idx = context[0].dataIndex;
              const s = data.sessions[idx];
              return 'Reps: [' + s.reps.join(', ') + ']';
            }
          }
        }
      },
      scales,
    },
  });
}

function deleteSession(sessionId, exerciseId) {
  if (!confirm('Delete this session entry?')) return;
  try {
    DB.deleteSession(sessionId);
    loadProgress(exerciseId);
    showToast('Session deleted', 'success');
  } catch (err) {
    showToast('Failed to delete: ' + err.message, 'error');
  }
}

// --- Manage View ---

function loadManageSelects() {
  const select = document.getElementById('add-ex-day');
  try {
    if (days.length === 0) days = DB.getDays();
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
document.getElementById('add-exercise-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('add-ex-error');
  errorEl.style.display = 'none';

  const dayId = parseInt(document.getElementById('add-ex-day').value, 10);
  const name = document.getElementById('add-ex-name').value.trim();
  const target_sets = parseInt(document.getElementById('add-ex-sets').value, 10);
  const rep_range_low = parseInt(document.getElementById('add-ex-low').value, 10);
  const rep_range_high = parseInt(document.getElementById('add-ex-high').value, 10);
  const is_bodyweight = document.getElementById('add-ex-bw').checked;
  const is_compound = document.getElementById('add-ex-compound').checked;
  const starting_weight = parseFloat(document.getElementById('add-ex-weight').value) || null;

  if (!dayId) { errorEl.textContent = 'Please select a day.'; errorEl.style.display = 'block'; return; }
  if (!name) { errorEl.textContent = 'Exercise name is required.'; errorEl.style.display = 'block'; return; }
  if (isNaN(target_sets) || target_sets < 1) { errorEl.textContent = 'Target sets must be at least 1.'; errorEl.style.display = 'block'; return; }
  if (isNaN(rep_range_low) || rep_range_low < 1) { errorEl.textContent = 'Rep range low must be at least 1.'; errorEl.style.display = 'block'; return; }
  if (isNaN(rep_range_high) || rep_range_high < rep_range_low) { errorEl.textContent = 'Rep range high must be at least rep range low.'; errorEl.style.display = 'block'; return; }

  try {
    DB.addExercise(dayId, { name, target_sets, rep_range_low, rep_range_high, is_bodyweight, is_compound, starting_weight });
    showToast(`"${name}" added!`, 'success');
    e.target.reset();
    days = [];
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
    <label class="checkbox-label"><input type="checkbox" class="ndex-bw"> BW</label>
    <label class="checkbox-label"><input type="checkbox" class="ndex-compound"> Compound</label>
    <input type="number" placeholder="Weight" step="0.5" min="0" style="width:60px">
    <button type="button" class="remove-ex-btn" onclick="this.parentElement.remove()">\u00d7</button>
  `;
  list.appendChild(row);
  newDayExCounter++;
}

document.getElementById('add-day-ex-btn').addEventListener('click', addNewDayExerciseRow);
addNewDayExerciseRow();

document.getElementById('add-day-form').addEventListener('submit', (e) => {
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

    exercises.push({ name: exName, target_sets: sets, rep_range_low: low, rep_range_high: high, is_bodyweight: isBw, is_compound: isCompound, starting_weight: weight });
  }

  try {
    DB.createDay(name, exercises);
    showToast(`"${name}" created!`, 'success');
    days = [];
    e.target.reset();
    document.getElementById('new-day-ex-list').innerHTML = '';
    addNewDayExerciseRow();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});

// Reset database
document.getElementById('reset-db-btn').addEventListener('click', () => {
  if (!confirm('This will permanently delete all your workout data and reset to defaults. Are you sure?')) return;
  DB.resetDatabase();
  days = [];
  currentDayId = null;
  showView('dashboard');
  showToast('Database reset to defaults', 'success');
});

// --- Init ---
loadDashboard();
