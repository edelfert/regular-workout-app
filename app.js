// Initialize / seed on first visit
DB.seed();

// State
let days = [];
let currentDayId = null;
let progressChart = null;
let progressDayId = null;
let progressExId = null;

// --- Helpers ---

// #1: Escape HTML to prevent XSS from user-supplied names
function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// #10: Get today's date in local timezone as YYYY-MM-DD
function getLocalDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr; // fallback for corrupt dates
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- Toast Notifications ---

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  // Cap visible toasts at 3 — remove oldest if needed
  while (container.children.length >= 3) {
    container.firstChild.remove();
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
    // Fallback removal if CSS animations are disabled (prefers-reduced-motion)
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
  }, 2500);
}

// --- View switching ---

function showView(view) {
  const viewEl = document.getElementById(`view-${view}`);
  const navEl = document.getElementById(`nav-${view}`);
  if (!viewEl || !navEl) return;
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  viewEl.style.display = 'block';
  navEl.classList.add('active');

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

    // #6: If currentDayId is set but no longer exists in days, reset it
    if (currentDayId && !days.some(d => d.id === currentDayId)) {
      currentDayId = null;
    }

    // Set currentDayId before building tabs to avoid visual flash
    if (!currentDayId && days.length > 0) {
      const todayIndex = getDayRotation();
      currentDayId = days[todayIndex] ? days[todayIndex].id : days[0].id;
    }

    tabsEl.innerHTML = '';
    days.forEach(day => {
      const btn = document.createElement('button');
      btn.className = 'day-tab' + (day.id === currentDayId ? ' active' : '');
      btn.textContent = day.name;
      btn.dataset.dayId = day.id;
      btn.onclick = () => selectDay(day.id);
      tabsEl.appendChild(btn);
    });

    if (currentDayId) loadExercises(currentDayId);
  } catch (err) {
    errorEl.textContent = 'Failed to load workout days: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function getDayRotation() {
  // Map day-of-week to workout day index (0-based)
  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const weekdayToDay = {
    0: 0, // Sunday  -> Day 1 (fallback/rest, same as Monday)
    1: 0, // Monday  -> Day 1
    2: 1, // Tuesday -> Day 2
    3: 1, // Wednesday -> Day 2
    4: 1, // Thursday  -> Day 2
    5: 2, // Friday  -> Day 3
    6: 3, // Saturday -> Day 4
  };
  const dow = new Date().getDay();
  const idx = weekdayToDay[dow] ?? 0;
  return Math.min(idx, days.length - 1);
}

function selectDay(dayId) {
  currentDayId = dayId;
  document.querySelectorAll('.day-tab').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.dayId, 10) === dayId);
  });
  loadExercises(dayId);
}

let dashboardInitialized = false;

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

    // Only animate on first dashboard load, not tab switches
    const animate = !dashboardInitialized;
    dashboardInitialized = true;

    const today = getLocalDateStr();

    exercises.forEach((ex, index) => {
      const card = document.createElement('div');
      card.className = 'exercise-card' + (animate ? ' animate-in' : '');
      card.id = `exercise-${ex.id}`;
      if (animate) card.style.animationDelay = `${index * 0.05}s`;

      // Check if already logged today
      const todaySession = DB.getTodaySession(ex.id, today);
      const lastSession = todaySession || DB.getLastSession(ex.id);

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
        lastHtml = `<div class="last-session-info" id="last-${ex.id}">Last: ${esc(weightStr)} \u2014 ${lastSession.reps.join(', ')} reps on ${esc(formatDate(lastSession.date))}</div>`;
      } else {
        lastHtml = `<div class="last-session-info" id="last-${ex.id}" style="display:none;"></div>`;
      }

      // Compute suggestion for pre-filling weight
      let suggestion = null;
      if (lastSession) {
        suggestion = DB.computeSuggestion(ex, lastSession.weight, lastSession.reps);
      }

      // Pre-fill weight: use suggestion's newWeight if available, else last session weight
      let prefillWeight = '';
      if (!ex.is_bodyweight) {
        if (suggestion && suggestion.newWeight != null) {
          prefillWeight = suggestion.newWeight;
        } else if (lastSession && lastSession.weight != null) {
          prefillWeight = lastSession.weight;
        }
      }

      // Set inputs
      let setsHtml = '';
      for (let i = 0; i < ex.target_sets; i++) {
        setsHtml += `
          <div class="input-group">
            <label for="rep-${ex.id}-${i}">Set ${i + 1}</label>
            <input type="number" min="1" id="rep-${ex.id}-${i}" placeholder="${ex.rep_range_low}-${ex.rep_range_high}"
              data-exercise-id="${ex.id}" data-set-index="${i}" data-total-sets="${ex.target_sets}" data-rest="${ex.rest_seconds}">
          </div>
        `;
      }

      // Weight input — pre-fill with suggested weight
      let weightHtml = '';
      if (!ex.is_bodyweight) {
        weightHtml = `
          <div class="input-group weight-group">
            <label for="weight-${ex.id}">Weight</label>
            <input type="number" min="0" step="0.5" id="weight-${ex.id}" value="${prefillWeight}" placeholder="${ex.starting_weight != null ? ex.starting_weight : 0}">
          </div>
        `;
      }

      // #9: Show starting weight even when it's 0
      const startWeightLabel = ex.starting_weight != null ? `<span>Start: ${ex.starting_weight} lbs</span>` : '';

      // If logged today, hide input area and show banner
      const inputDisplay = todaySession ? 'display:none;' : '';
      const actionsDisplay = todaySession ? 'display:none;' : '';

      // #1: Escape exercise name to prevent XSS
      card.innerHTML = `
        <div class="exercise-card-header">
          <h3>${esc(ex.name)}</h3>
          ${badgeHtml}
        </div>
        <div class="exercise-meta">
          <span>${ex.target_sets} sets \u00d7 ${ex.rep_range_low}\u2013${ex.rep_range_high} reps</span>
          ${startWeightLabel}
        </div>
        ${lastHtml}
        <div class="input-row" style="${inputDisplay}">
          ${weightHtml}
          ${setsHtml}
        </div>
        <div class="card-actions" style="${actionsDisplay}">
          <button class="log-btn" onclick="logWorkout(${ex.id}, ${ex.target_sets}, ${ex.is_bodyweight})">Log Workout</button>
        </div>
        <div id="error-${ex.id}" class="inline-error" style="display:none;"></div>
        <div id="suggestion-${ex.id}" class="suggestion-box" style="display:none;"></div>
      `;

      // If logged today, append the banner and suggestion
      if (todaySession) {
        const bannerEl = document.createElement('div');
        bannerEl.className = 'logged-banner';
        bannerEl.innerHTML = `
          <span class="logged-check">\u2713</span> Logged today
          <button class="edit-logged-btn" onclick="editLoggedWorkout(${ex.id})">Edit</button>
        `;
        card.appendChild(bannerEl);

        if (suggestion) {
          const sugEl = card.querySelector(`#suggestion-${ex.id}`);
          sugEl.textContent = suggestion.message;
          let sugClass = 'suggestion-box';
          if (suggestion.action === 'drop') sugClass += ' drop';
          else if (suggestion.action === 'hold') sugClass += ' hold';
          sugEl.className = sugClass;
          sugEl.style.display = 'block';
        }
      }

      listEl.appendChild(card);

      // Wire up rest timer triggers on rep inputs (only if not already logged today)
      if (!todaySession && ex.rest_seconds > 0) {
        for (let i = 0; i < ex.target_sets; i++) {
          const repInput = document.getElementById(`rep-${ex.id}-${i}`);
          if (repInput) {
            repInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSetComplete(repInput);
              }
            });
          }
        }
      }
    });
  } catch (err) {
    errorEl.textContent = 'Failed to load exercises: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function handleSetComplete(input) {
  const val = parseInt(input.value, 10);
  if (isNaN(val) || val < 1) return;

  const exId = parseInt(input.dataset.exerciseId, 10);
  const setIdx = parseInt(input.dataset.setIndex, 10);
  const totalSets = parseInt(input.dataset.totalSets, 10);
  const restSec = parseInt(input.dataset.rest, 10);

  // Mark this input as done
  input.classList.add('set-done');

  // If not last set and rest > 0, start timer
  if (setIdx < totalSets - 1 && restSec > 0) {
    if (typeof RestTimer !== 'undefined') {
      RestTimer.start(exId, restSec);
    }
    // Focus next set input
    const nextInput = document.getElementById(`rep-${exId}-${setIdx + 1}`);
    if (nextInput) nextInput.focus();
  }
}

function editLoggedWorkout(exerciseId) {
  const card = document.getElementById(`exercise-${exerciseId}`);
  const inputRow = card.querySelector('.input-row');
  const actions = card.querySelector('.card-actions');
  const banner = card.querySelector('.logged-banner');
  const suggestionEl = document.getElementById(`suggestion-${exerciseId}`);

  // Re-show the input area
  if (inputRow) inputRow.style.display = '';
  if (actions) actions.style.display = '';
  if (banner) banner.remove();
  if (suggestionEl) suggestionEl.style.display = 'none';

  // Pre-fill inputs with today's logged values so user can edit
  const today = getLocalDateStr();
  const todaySession = DB.getTodaySession(exerciseId, today);
  if (todaySession) {
    const wInput = document.getElementById(`weight-${exerciseId}`);
    if (wInput && todaySession.weight != null) wInput.value = todaySession.weight;
    todaySession.reps.forEach((r, i) => {
      const repInput = document.getElementById(`rep-${exerciseId}-${i}`);
      if (repInput) repInput.value = r;
    });
  }

  // Update button text to indicate re-log
  const btn = card.querySelector('.log-btn');
  if (btn) {
    btn.textContent = 'Update Workout';
    btn.disabled = false;
  }
}

function logWorkout(exerciseId, targetSets, isBodyweight) {
  const errorEl = document.getElementById(`error-${exerciseId}`);
  const suggestionEl = document.getElementById(`suggestion-${exerciseId}`);
  const btn = document.querySelector(`#exercise-${exerciseId} .log-btn`);

  // #5: Disable button immediately to prevent double submit
  if (btn.disabled) return;
  btn.disabled = true;

  errorEl.style.display = 'none';
  suggestionEl.style.display = 'none';

  // Clear previous input errors
  const repInputs = [];
  for (let i = 0; i < targetSets; i++) {
    const input = document.getElementById(`rep-${exerciseId}-${i}`);
    input.classList.remove('input-error');
    repInputs.push(input);
  }
  let wInput = null;
  if (!isBodyweight) {
    wInput = document.getElementById(`weight-${exerciseId}`);
    if (wInput) wInput.classList.remove('input-error');
  }

  // Validate — collect all values first, then check
  const reps = [];
  let valid = true;

  for (let i = 0; i < targetSets; i++) {
    const val = parseInt(repInputs[i].value, 10);
    reps.push(val); // always push (may be NaN)
    if (isNaN(val) || val < 1) {
      repInputs[i].classList.add('input-error');
      valid = false;
    }
  }

  let weight = null;
  if (!isBodyweight && wInput) {
    weight = parseFloat(wInput.value);
    if (isNaN(weight) || weight < 0) {
      wInput.classList.add('input-error');
      valid = false;
    }
  }

  if (!valid) {
    errorEl.textContent = 'Fill in all fields. Reps must be at least 1' + (isBodyweight ? '.' : ', weight at least 0.');
    errorEl.style.display = 'block';
    btn.disabled = false; // Re-enable on validation failure
    return;
  }

  // #10: Use local date, not UTC
  const today = getLocalDateStr();

  try {
    // If editing a previously logged session, delete the old one first
    const existing = DB.getTodaySession(exerciseId, today);
    if (existing) DB.deleteSession(existing.id);

    const result = DB.logSession(exerciseId, today, weight, reps);

    showToast(existing ? 'Workout updated!' : 'Workout logged!', 'success');

    // Collapse card into completed state
    const card = document.getElementById(`exercise-${exerciseId}`);
    const inputRow = card.querySelector('.input-row');
    const actions = card.querySelector('.card-actions');
    if (inputRow) inputRow.style.display = 'none';
    if (actions) actions.style.display = 'none';
    errorEl.style.display = 'none';

    // Update the last-session-info bar
    const lastEl = document.getElementById(`last-${exerciseId}`);
    if (lastEl) {
      const weightStr = weight !== null ? `${weight} lbs` : 'Bodyweight';
      lastEl.textContent = `Last: ${weightStr} \u2014 ${reps.join(', ')} reps on ${formatDate(today)}`;
      lastEl.style.display = '';
    }

    // Show completed banner
    const oldBanner = card.querySelector('.logged-banner');
    if (oldBanner) oldBanner.remove();
    const doneEl = document.createElement('div');
    doneEl.className = 'logged-banner';
    doneEl.innerHTML = `<span class="logged-check">\u2713</span> Logged today <button class="edit-logged-btn" onclick="editLoggedWorkout(${exerciseId})">Edit</button>`;
    card.appendChild(doneEl);

    // Show suggestion below the banner
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
    btn.disabled = false; // Re-enable on error
  }
}

// --- Progress View ---

function loadProgressSelects() {
  const daySelect = document.getElementById('progress-day-select');
  const exSelect = document.getElementById('progress-exercise-select');

  try {
    if (days.length === 0) days = DB.getDays();

    const prevDayId = progressDayId;
    const prevExId = progressExId;

    daySelect.innerHTML = '<option value="">Select a day...</option>';
    days.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      if (d.id === prevDayId) opt.selected = true;
      daySelect.appendChild(opt);
    });

    daySelect.onchange = () => {
      const dayId = parseInt(daySelect.value, 10);
      progressDayId = dayId || null;
      progressExId = null;
      exSelect.innerHTML = '<option value="">Select an exercise...</option>';
      // #11: Destroy chart when changing day to free memory
      if (progressChart) { progressChart.destroy(); progressChart = null; }
      document.getElementById('progress-chart-container').style.display = 'none';
      document.getElementById('progress-suggestion').style.display = 'none';
      document.getElementById('progress-history').style.display = 'none';
      document.getElementById('error-progress').style.display = 'none';
      if (!dayId) return;
      const exercises = DB.getExercises(dayId);
      exercises.forEach(ex => {
        const opt = document.createElement('option');
        opt.value = ex.id;
        opt.textContent = ex.name;
        exSelect.appendChild(opt);
      });
    };

    exSelect.onchange = () => {
      if (exSelect.value) {
        progressExId = parseInt(exSelect.value, 10);
        loadProgress(progressExId);
      }
    };

    // Restore previous selection if available
    if (prevDayId && days.some(d => d.id === prevDayId)) {
      daySelect.value = prevDayId;
      daySelect.onchange(); // populate exercise select
      if (prevExId) {
        exSelect.value = prevExId;
        if (exSelect.value) loadProgress(prevExId);
      }
    }
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
      const tdDate = document.createElement('td');
      tdDate.textContent = formatDate(s.date);
      const tdWeight = document.createElement('td');
      tdWeight.textContent = s.weight !== null ? s.weight + ' lbs' : 'BW';
      const tdReps = document.createElement('td');
      tdReps.textContent = s.reps.join(', ');
      const tdAvg = document.createElement('td');
      tdAvg.textContent = s.avgReps;
      const tdAction = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = 'Delete';
      delBtn.onclick = () => deleteSession(s.id, exerciseId);
      tdAction.appendChild(delBtn);
      tr.append(tdDate, tdWeight, tdReps, tdAvg, tdAction);
      tbody.appendChild(tr);
    });
  } catch (err) {
    errorEl.textContent = 'Failed to load progress: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function renderChart(data) {
  if (typeof Chart === 'undefined') {
    document.getElementById('error-progress').textContent = 'Chart library failed to load. Check your internet connection and reload.';
    document.getElementById('error-progress').style.display = 'block';
    document.getElementById('progress-chart-container').style.display = 'none';
    return;
  }
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
      title: { display: true, text: 'Weight (lbs)', color: '#717799', font: { size: 11, family: 'Inter' } },
      ticks: { color: '#717799', font: { size: 11, family: 'Inter' } },
      grid: { color: gridColor },
      border: { color: 'transparent' },
    };
    scales.y1 = {
      type: 'linear', position: 'right',
      title: { display: true, text: 'Avg Reps', color: '#717799', font: { size: 11, family: 'Inter' } },
      ticks: { color: '#717799', font: { size: 11, family: 'Inter' } },
      grid: { drawOnChartArea: false },
      border: { color: 'transparent' },
    };
  } else {
    scales.y = {
      type: 'linear', position: 'left',
      title: { display: true, text: 'Avg Reps', color: '#717799', font: { size: 11, family: 'Inter' } },
      ticks: { color: '#717799', font: { size: 11, family: 'Inter' } },
      grid: { color: gridColor },
      border: { color: 'transparent' },
    };
  }

  scales.x = {
    ticks: { color: '#717799', font: { size: 11, family: 'Inter' }, maxRotation: 45 },
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
      // #1: Escape day name
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      select.appendChild(opt);
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
  const weightVal = document.getElementById('add-ex-weight').value;
  const starting_weight = weightVal !== '' ? parseFloat(weightVal) : null; // #3: preserve 0
  const restVal = document.getElementById('add-ex-rest').value;
  const rest_seconds = restVal !== '' ? parseInt(restVal, 10) : null;

  if (!dayId) { errorEl.textContent = 'Please select a day.'; errorEl.style.display = 'block'; return; }
  if (!name) { errorEl.textContent = 'Exercise name is required.'; errorEl.style.display = 'block'; return; }
  if (isNaN(target_sets) || target_sets < 1) { errorEl.textContent = 'Target sets must be at least 1.'; errorEl.style.display = 'block'; return; }
  if (isNaN(rep_range_low) || rep_range_low < 1) { errorEl.textContent = 'Rep range low must be at least 1.'; errorEl.style.display = 'block'; return; }
  if (isNaN(rep_range_high) || rep_range_high < rep_range_low) { errorEl.textContent = 'Rep range high must be at least rep range low.'; errorEl.style.display = 'block'; return; }

  try {
    DB.addExercise(dayId, { name, target_sets, rep_range_low, rep_range_high, is_bodyweight, is_compound, starting_weight, rest_seconds });
    showToast(`"${name}" added!`, 'success');
    e.target.reset();
    days = [];
    // Re-populate and restore selected day so user can add another to the same day
    loadManageSelects();
    document.getElementById('add-ex-day').value = dayId;
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
    <input type="text" placeholder="Exercise name" data-role="name" aria-label="Exercise name">
    <input type="number" placeholder="Sets" value="3" min="1" style="width:50px" data-role="sets" aria-label="Target sets">
    <input type="number" placeholder="Low" min="1" style="width:50px" data-role="low" aria-label="Rep range low">
    <input type="number" placeholder="High" min="1" style="width:50px" data-role="high" aria-label="Rep range high">
    <label class="checkbox-label"><input type="checkbox" class="ndex-bw"> BW</label>
    <label class="checkbox-label"><input type="checkbox" class="ndex-compound"> Compound</label>
    <input type="number" placeholder="Weight" step="0.5" min="0" style="width:60px" data-role="weight" aria-label="Starting weight">
    <input type="number" placeholder="Rest(s)" min="0" style="width:60px" data-role="rest" aria-label="Rest timer seconds">
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
    const exName = row.querySelector('[data-role="name"]').value.trim();
    const sets = parseInt(row.querySelector('[data-role="sets"]').value, 10);
    const low = parseInt(row.querySelector('[data-role="low"]').value, 10);
    const high = parseInt(row.querySelector('[data-role="high"]').value, 10);
    const isBw = row.querySelector('.ndex-bw').checked;
    const isCompound = row.querySelector('.ndex-compound').checked;
    const weightVal = row.querySelector('[data-role="weight"]').value;
    const weight = weightVal !== '' ? parseFloat(weightVal) : null; // #3: preserve 0
    const restVal = row.querySelector('[data-role="rest"]').value;
    const rest = restVal !== '' ? parseInt(restVal, 10) : null;

    if (!exName) { errorEl.textContent = 'All exercises must have a name.'; errorEl.style.display = 'block'; return; }
    if (isNaN(sets) || sets < 1) { errorEl.textContent = `Invalid sets for "${exName}".`; errorEl.style.display = 'block'; return; }
    if (isNaN(low) || low < 1) { errorEl.textContent = `Invalid rep low for "${exName}".`; errorEl.style.display = 'block'; return; }
    if (isNaN(high) || high < low) { errorEl.textContent = `Invalid rep high for "${exName}".`; errorEl.style.display = 'block'; return; }

    exercises.push({ name: exName, target_sets: sets, rep_range_low: low, rep_range_high: high, is_bodyweight: isBw, is_compound: isCompound, starting_weight: weight, rest_seconds: rest });
  }

  try {
    DB.createDay(name, exercises);
    showToast(`"${name}" created!`, 'success');
    days = [];
    e.target.reset();
    document.getElementById('new-day-ex-list').innerHTML = '';
    addNewDayExerciseRow();
    loadManageSelects(); // refresh "Add Exercise" day dropdown with the new day
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

// --- Exercise Library ---

let libraryFilter = { search: '', category: '', equipment: '' };
let libraryDetail = null;

function openLibrary() {
  const modal = document.getElementById('library-modal');
  modal.style.display = 'flex';
  document.getElementById('library-search-input').value = '';
  libraryFilter = { search: '', category: '', equipment: '' };
  libraryDetail = null;
  renderLibraryFilters();
  renderLibraryResults();
  document.getElementById('library-search-input').focus();

  document.getElementById('library-search-input').oninput = (e) => {
    libraryFilter.search = e.target.value.toLowerCase();
    libraryDetail = null;
    renderLibraryResults();
  };
}

function closeLibrary() {
  document.getElementById('library-modal').style.display = 'none';
}

function renderLibraryFilters() {
  const el = document.getElementById('library-filters');
  if (typeof EXERCISE_LIBRARY === 'undefined') { el.innerHTML = ''; return; }

  const categories = [...new Set(EXERCISE_LIBRARY.map(e => e.category))].sort();
  const equipments = [...new Set(EXERCISE_LIBRARY.map(e => e.equipment))].sort();

  let html = '<span class="filter-chip-group">';
  categories.forEach(cat => {
    const active = libraryFilter.category === cat ? ' active' : '';
    html += `<button class="filter-chip${active}" onclick="toggleLibraryFilter('category','${cat}')">${cat}</button>`;
  });
  html += '</span><span class="filter-chip-group">';
  equipments.forEach(eq => {
    const active = libraryFilter.equipment === eq ? ' active' : '';
    html += `<button class="filter-chip${active}" onclick="toggleLibraryFilter('equipment','${eq}')">${eq}</button>`;
  });
  html += '</span>';
  el.innerHTML = html;
}

function toggleLibraryFilter(type, value) {
  if (libraryFilter[type] === value) {
    libraryFilter[type] = '';
  } else {
    libraryFilter[type] = value;
  }
  libraryDetail = null;
  renderLibraryFilters();
  renderLibraryResults();
}

function renderLibraryResults() {
  const el = document.getElementById('library-results');
  if (typeof EXERCISE_LIBRARY === 'undefined') {
    el.innerHTML = '<div class="empty-state"><p>Exercise library not loaded.</p></div>';
    return;
  }

  // If showing detail view
  if (libraryDetail !== null) {
    renderLibraryDetail(el);
    return;
  }

  const filtered = EXERCISE_LIBRARY.filter(ex => {
    if (libraryFilter.search && !ex.name.toLowerCase().includes(libraryFilter.search) &&
        !ex.muscleGroup.toLowerCase().includes(libraryFilter.search) &&
        !ex.category.toLowerCase().includes(libraryFilter.search)) return false;
    if (libraryFilter.category && ex.category !== libraryFilter.category) return false;
    if (libraryFilter.equipment && ex.equipment !== libraryFilter.equipment) return false;
    return true;
  });

  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>No exercises match your filters.</p></div>';
    return;
  }

  let html = `<div class="library-count">${filtered.length} exercise${filtered.length !== 1 ? 's' : ''}</div>`;
  filtered.forEach((ex, idx) => {
    const badgeClass = ex.isCompound ? 'badge-compound' : 'badge-isolation';
    const badgeText = ex.isCompound ? 'Compound' : 'Isolation';
    html += `
      <div class="library-item" onclick="showLibraryDetail(${idx}, '${esc(libraryFilter.search)}', '${esc(libraryFilter.category)}', '${esc(libraryFilter.equipment)}')">
        <div class="library-item-header">
          <span class="library-item-name">${esc(ex.name)}</span>
          <div class="library-item-badges">
            <span class="exercise-badge ${badgeClass}">${badgeText}</span>
          </div>
        </div>
        <div class="library-item-desc">${esc(ex.description)}</div>
        <div class="library-item-meta">${esc(ex.muscleGroup)} &middot; ${esc(ex.equipment)} &middot; ${ex.defaultSets}&times;${ex.defaultRepRangeLow}-${ex.defaultRepRangeHigh}</div>
      </div>
    `;
  });
  el.innerHTML = html;
}

function showLibraryDetail(filteredIndex) {
  const filtered = EXERCISE_LIBRARY.filter(ex => {
    if (libraryFilter.search && !ex.name.toLowerCase().includes(libraryFilter.search) &&
        !ex.muscleGroup.toLowerCase().includes(libraryFilter.search) &&
        !ex.category.toLowerCase().includes(libraryFilter.search)) return false;
    if (libraryFilter.category && ex.category !== libraryFilter.category) return false;
    if (libraryFilter.equipment && ex.equipment !== libraryFilter.equipment) return false;
    return true;
  });
  libraryDetail = filtered[filteredIndex] || null;
  renderLibraryResults();
}

function renderLibraryDetail(el) {
  const ex = libraryDetail;
  if (!ex) return;

  // Build day select
  if (days.length === 0) days = DB.getDays();
  let dayOptions = '<option value="">Select day...</option>';
  days.forEach(d => {
    dayOptions += `<option value="${d.id}">${esc(d.name)}</option>`;
  });

  const secondary = ex.secondaryMuscles.length > 0 ? ex.secondaryMuscles.join(', ') : 'None';
  const tipsHtml = ex.tips ? `<div class="library-detail-tips">${esc(ex.tips)}</div>` : '';

  el.innerHTML = `
    <button class="btn btn-ghost" onclick="libraryDetail=null;renderLibraryResults()" style="margin-bottom:12px;">&larr; Back to results</button>
    <div class="library-detail">
      <h3>${esc(ex.name)}</h3>
      <div class="library-detail-muscles">
        <strong>Primary:</strong> ${esc(ex.muscleGroup)} &middot;
        <strong>Secondary:</strong> ${esc(secondary)} &middot;
        <strong>Equipment:</strong> ${esc(ex.equipment)}
      </div>
      <div class="library-detail-desc">${esc(ex.description)}</div>
      ${tipsHtml}
      <div class="library-add-form">
        <div class="select-wrapper">
          <select id="library-add-day" aria-label="Select day to add exercise">${dayOptions}</select>
        </div>
        <button class="btn btn-primary" onclick="addFromLibrary()">Add to Day</button>
      </div>
    </div>
  `;
}

function addFromLibrary() {
  const ex = libraryDetail;
  if (!ex) return;
  const dayId = parseInt(document.getElementById('library-add-day').value, 10);
  if (!dayId) { showToast('Select a day first', 'error'); return; }

  try {
    DB.addExercise(dayId, {
      name: ex.name,
      target_sets: ex.defaultSets,
      rep_range_low: ex.defaultRepRangeLow,
      rep_range_high: ex.defaultRepRangeHigh,
      is_bodyweight: ex.equipment === 'bodyweight',
      is_compound: ex.isCompound,
      starting_weight: null,
    });
    showToast(`"${ex.name}" added!`, 'success');
    days = [];
    closeLibrary();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Init ---
loadDashboard();
