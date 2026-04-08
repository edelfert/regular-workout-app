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
  if (view === 'history') loadHistory();
  if (view === 'body') loadBodyMeasurements();
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

      // Set inputs with RPE selector
      let setsHtml = '';
      for (let i = 0; i < ex.target_sets; i++) {
        setsHtml += `
          <div class="input-group">
            <label for="rep-${ex.id}-${i}">Set ${i + 1}</label>
            <input type="number" min="1" id="rep-${ex.id}-${i}" placeholder="${ex.rep_range_low}-${ex.rep_range_high}"
              data-exercise-id="${ex.id}" data-set-index="${i}" data-total-sets="${ex.target_sets}" data-rest="${ex.rest_seconds}">
            <div class="rpe-selector">
              <label for="rpe-${ex.id}-${i}">RPE</label>
              <select id="rpe-${ex.id}-${i}"><option value="">-</option><option>6</option><option>6.5</option><option>7</option><option>7.5</option><option>8</option><option>8.5</option><option>9</option><option>9.5</option><option>10</option></select>
            </div>
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

      // Notes
      const noteText = ex.note || '';
      const noteHtml = `
        <div class="exercise-note" id="note-section-${ex.id}">
          <button class="exercise-note-toggle" onclick="toggleNoteArea(${ex.id})">+ Note</button>
          <textarea class="exercise-note-area" id="note-${ex.id}" placeholder="Add a note..." style="display:none;"
            onblur="saveNote(${ex.id})">${esc(noteText)}</textarea>
        </div>
      `;

      // Warmup sets (for compound non-bodyweight exercises with weight)
      let warmupHtml = '';
      if (!ex.is_bodyweight && ex.is_compound && prefillWeight && prefillWeight > 45) {
        const warmups = calculateWarmupSets(prefillWeight);
        if (warmups.length > 0) {
          const warmupRows = warmups.map(s => `<div class="warmup-set-row"><span>${s.label}</span><span>${s.weight} lbs x ${s.reps}</span></div>`).join('');
          warmupHtml = `
            <div class="warmup-sets" id="warmup-${ex.id}" style="${todaySession ? 'display:none;' : ''}">
              <button class="warmup-toggle" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">Warmup Sets</button>
              <div style="display:none;">${warmupRows}</div>
            </div>
          `;
        }
      }

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
        ${noteHtml}
        ${warmupHtml}
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

      // Wire plate calculator to weight input
      if (!ex.is_bodyweight && !todaySession) {
        const wInput = document.getElementById(`weight-${ex.id}`);
        if (wInput) {
          wInput.addEventListener('input', () => renderPlateCalculator(ex.id));
          if (wInput.value) renderPlateCalculator(ex.id);
        }
      }

      // Show existing note text if present
      if (noteText) {
        const noteArea = document.getElementById(`note-${ex.id}`);
        const noteToggle = card.querySelector('.exercise-note-toggle');
        if (noteArea && noteToggle) {
          noteArea.style.display = '';
          noteToggle.textContent = 'Note';
        }
      }

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

  // Collect RPE values
  const rpeValues = [];
  for (let i = 0; i < targetSets; i++) {
    const rpeSelect = document.getElementById(`rpe-${exerciseId}-${i}`);
    rpeValues.push(rpeSelect && rpeSelect.value ? parseFloat(rpeSelect.value) : null);
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

    const result = DB.logSession(exerciseId, today, weight, reps, rpeValues);

    // Auto-start workout duration timer on first log
    ensureWorkoutTimer();

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
      document.getElementById('progress-records').style.display = 'none';
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

    // 1RM and PR display
    const prSection = document.getElementById('progress-records');
    const e1rm = DB.getEstimated1RM(exerciseId);
    const prs = DB.getPersonalRecords(exerciseId);
    if ((e1rm || prs) && !data.exercise.is_bodyweight) {
      let prHtml = '<div class="pr-grid">';
      if (e1rm) prHtml += `<div class="pr-card"><div class="pr-value">${e1rm}</div><div class="pr-label">Est. 1RM (lbs)</div></div>`;
      if (prs && prs.maxWeight) prHtml += `<div class="pr-card"><div class="pr-value">${prs.maxWeight.value}</div><div class="pr-label">Max Weight</div></div>`;
      if (prs && prs.maxReps) prHtml += `<div class="pr-card"><div class="pr-value">${prs.maxReps.value}</div><div class="pr-label">Max Reps</div></div>`;
      if (prs && prs.maxVolume && prs.maxVolume.value > 0) prHtml += `<div class="pr-card"><div class="pr-value">${prs.maxVolume.value.toLocaleString()}</div><div class="pr-label">Best Volume</div></div>`;
      prHtml += '</div>';
      prSection.innerHTML = prHtml;
      prSection.style.display = 'block';
    } else {
      prSection.style.display = 'none';
    }

    // Suggestion
    if (data.suggestion) {
      suggestionEl.textContent = data.suggestion.message;
      let sugClass = 'suggestion-box';
      if (data.suggestion.action === 'drop') sugClass += ' drop';
      else if (data.suggestion.action === 'hold') sugClass += ' hold';
      suggestionEl.className = sugClass;
      suggestionEl.style.display = 'block';
    }

    // History table with volume column
    historyEl.style.display = 'block';
    const tbody = document.querySelector('#progress-table tbody');
    tbody.innerHTML = '';
    data.sessions.forEach(s => {
      const vol = s.weight != null ? s.reps.reduce((sum, r) => sum + r * s.weight, 0) : 0;
      const tr = document.createElement('tr');
      const tdDate = document.createElement('td');
      tdDate.textContent = formatDate(s.date);
      const tdWeight = document.createElement('td');
      tdWeight.textContent = s.weight !== null ? s.weight + ' lbs' : 'BW';
      const tdReps = document.createElement('td');
      tdReps.textContent = s.reps.join(', ');
      const tdAvg = document.createElement('td');
      tdAvg.textContent = s.avgReps;
      const tdVol = document.createElement('td');
      tdVol.textContent = vol > 0 ? vol.toLocaleString() : '-';
      const tdAction = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = 'Delete';
      delBtn.onclick = () => deleteSession(s.id, exerciseId);
      tdAction.appendChild(delBtn);
      tr.append(tdDate, tdWeight, tdReps, tdAvg, tdVol, tdAction);
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

  // Compute per-session estimated 1RM (best set)
  const e1rmData = data.sessions.map(s => {
    if (s.weight == null || s.weight <= 0) return null;
    let best = 0;
    for (const r of s.reps) {
      const e = DB.computeE1RM(s.weight, r);
      if (e > best) best = e;
    }
    return best > 0 ? best : null;
  });

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

    // 1RM trend line
    if (e1rmData.some(v => v !== null)) {
      datasets.push({
        label: 'Est. 1RM',
        data: e1rmData,
        borderColor: '#fbbf24',
        backgroundColor: 'transparent',
        yAxisID: 'y',
        tension: 0.35,
        fill: false,
        borderDash: [6, 3],
        pointRadius: data.sessions.length === 1 ? 5 : 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#fbbf24',
        borderWidth: 2,
      });
    }
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
    loadManageExercises();
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

// --- Manage Exercises (reorder, delete, move) ---

function loadManageExercises() {
  const select = document.getElementById('manage-day-select');
  const list = document.getElementById('manage-exercise-list');

  if (days.length === 0) days = DB.getDays();
  select.innerHTML = '<option value="">Select a day...</option>';
  days.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    select.appendChild(opt);
  });

  select.onchange = () => {
    const dayId = parseInt(select.value, 10);
    if (!dayId) { list.innerHTML = ''; return; }
    renderManageExerciseList(dayId);
  };
}

function renderManageExerciseList(dayId) {
  const list = document.getElementById('manage-exercise-list');
  const exercises = DB.getExercises(dayId);

  if (exercises.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No exercises on this day.</p></div>';
    return;
  }

  let html = '';
  exercises.forEach((ex, i) => {
    html += `<div class="manage-ex-row" draggable="true" data-ex-id="${ex.id}" data-day-id="${dayId}">
      <span class="drag-handle" aria-label="Drag to reorder">\u2261</span>
      <span class="manage-ex-name">${esc(ex.name)}</span>
      <div class="manage-ex-actions">
        <select class="move-day-select" data-ex-id="${ex.id}" aria-label="Move to day" onchange="moveExerciseToDay(${ex.id}, this.value, ${dayId})">
          <option value="">Move...</option>
          ${days.filter(d => d.id !== dayId).map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
        </select>
        <button class="delete-btn" onclick="deleteExercise(${ex.id}, ${dayId})">Delete</button>
      </div>
    </div>`;
  });
  list.innerHTML = html;

  // Drag-and-drop reorder
  let draggedEl = null;
  list.querySelectorAll('.manage-ex-row').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedEl = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedEl = null;
      // Save new order
      const ids = [...list.querySelectorAll('.manage-ex-row')].map(r => parseInt(r.dataset.exId, 10));
      try { DB.reorderExercises(dayId, ids); } catch (err) { showToast(err.message, 'error'); }
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedEl || draggedEl === row) return;
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        list.insertBefore(draggedEl, row);
      } else {
        list.insertBefore(draggedEl, row.nextSibling);
      }
    });
  });
}

function deleteExercise(exerciseId, dayId) {
  if (!confirm('Delete this exercise and all its session history?')) return;
  try {
    DB.deleteExercise(exerciseId);
    renderManageExerciseList(dayId);
    days = [];
    showToast('Exercise deleted', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function moveExerciseToDay(exerciseId, newDayId, oldDayId) {
  if (!newDayId) return;
  try {
    DB.moveExercise(exerciseId, parseInt(newDayId, 10));
    renderManageExerciseList(oldDayId);
    days = [];
    showToast('Exercise moved', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Data Export / Import ---

function exportData(format) {
  let content, filename, type;
  const dateStr = getLocalDateStr();
  if (format === 'json') {
    content = DB.exportJSON();
    filename = `workout-data-${dateStr}.json`;
    type = 'application/json';
  } else {
    content = DB.exportCSV();
    filename = `workout-sessions-${dateStr}.csv`;
    type = 'text/csv';
  }
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${format.toUpperCase()}`, 'success');
}

function importData() {
  const errorEl = document.getElementById('import-error');
  errorEl.style.display = 'none';
  const input = document.getElementById('import-file');
  if (!input.files || !input.files[0]) {
    errorEl.textContent = 'Select a JSON file first.';
    errorEl.style.display = 'block';
    return;
  }
  if (!confirm('This will replace ALL your current data. Are you sure?')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      DB.importJSON(e.target.result);
      days = [];
      currentDayId = null;
      showView('dashboard');
      showToast('Data imported successfully!', 'success');
    } catch (err) {
      errorEl.textContent = 'Import failed: ' + err.message;
      errorEl.style.display = 'block';
    }
  };
  reader.readAsText(input.files[0]);
}

// Reset database
document.getElementById('reset-db-btn').addEventListener('click', () => {
  if (!confirm('This will permanently delete all your workout data and reset to defaults. Are you sure?')) return;
  DB.resetDatabase();
  days = [];
  currentDayId = null;
  showView('dashboard');
  showToast('Database reset to defaults', 'success');
});

// --- History / Calendar View ---

let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth(); // 0-based

function loadHistory() {
  renderCalendar();
  renderCalendarStats();
  document.getElementById('calendar-day-detail').style.display = 'none';
}

function calendarPrev() {
  calendarMonth--;
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  loadHistory();
}

function calendarNext() {
  calendarMonth++;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  loadHistory();
}

function calendarToday() {
  calendarYear = new Date().getFullYear();
  calendarMonth = new Date().getMonth();
  loadHistory();
}

function renderCalendar() {
  const label = document.getElementById('calendar-month-label');
  const grid = document.getElementById('calendar-grid');

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  label.textContent = `${monthNames[calendarMonth]} ${calendarYear}`;

  // Get sessions for this month
  const startDate = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-01`;
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const endDate = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  let sessions = [];
  try {
    sessions = DB.getSessionsByDateRange(startDate, endDate);
  } catch (e) { /* empty */ }

  const workoutDates = new Set(sessions.map(s => s.date));

  // Build grid: header row (Mon-Sun) + day cells
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay(); // 0=Sun
  const startOffset = (firstDay === 0 ? 6 : firstDay - 1); // Mon=0

  const today = getLocalDateStr();

  let html = '<div class="calendar-header-row">';
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => {
    html += `<div class="calendar-header-cell">${d}</div>`;
  });
  html += '</div><div class="calendar-body">';

  // Empty cells before first day
  for (let i = 0; i < startOffset; i++) {
    html += '<div class="calendar-cell empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hasWorkout = workoutDates.has(dateStr);
    const isToday = dateStr === today;
    let classes = 'calendar-cell';
    if (hasWorkout) classes += ' has-workout';
    if (isToday) classes += ' is-today';

    html += `<div class="${classes}" onclick="showCalendarDay('${dateStr}')">
      <span class="calendar-day-num">${d}</span>
      ${hasWorkout ? '<span class="calendar-dot"></span>' : ''}
    </div>`;
  }

  html += '</div>';
  grid.innerHTML = html;
}

function showCalendarDay(dateStr) {
  const detail = document.getElementById('calendar-day-detail');
  let sessions = [];
  try {
    sessions = DB.getSessionsByDateRange(dateStr, dateStr);
  } catch (e) { /* empty */ }

  if (sessions.length === 0) {
    detail.innerHTML = `<div class="calendar-detail-card"><p class="empty-state">No workouts on ${formatDate(dateStr)}</p></div>`;
    detail.style.display = 'block';
    return;
  }

  // Group by exercise
  const byExercise = {};
  sessions.forEach(s => {
    if (!byExercise[s.exercise_id]) {
      byExercise[s.exercise_id] = { name: s.exerciseName, weight: s.weight, reps: s.reps, volume: 0 };
    }
    const entry = byExercise[s.exercise_id];
    const w = s.weight || 0;
    entry.volume += s.reps.reduce((sum, r) => sum + r * w, 0);
  });

  let totalVolume = 0;
  let totalSets = 0;
  let html = `<div class="calendar-detail-card">
    <h3 class="section-title">${formatDate(dateStr)}</h3>
    <div class="calendar-detail-list">`;

  Object.values(byExercise).forEach(entry => {
    const weightStr = entry.weight != null ? `${entry.weight} lbs` : 'BW';
    totalVolume += entry.volume;
    totalSets += entry.reps.length;
    html += `<div class="calendar-detail-item">
      <span class="calendar-detail-name">${esc(entry.name)}</span>
      <span class="calendar-detail-info">${weightStr} &mdash; ${entry.reps.join(', ')} reps</span>
    </div>`;
  });

  html += `</div>
    <div class="calendar-detail-summary">
      <span>${Object.keys(byExercise).length} exercises</span>
      <span>${totalSets} sets</span>
      ${totalVolume > 0 ? `<span>${totalVolume.toLocaleString()} lbs vol</span>` : ''}
    </div>
  </div>`;

  detail.innerHTML = html;
  detail.style.display = 'block';
}

function renderCalendarStats() {
  const el = document.getElementById('calendar-stats');

  // Get sessions for current displayed month
  const startDate = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-01`;
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const endDate = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  let sessions = [];
  try {
    sessions = DB.getSessionsByDateRange(startDate, endDate);
  } catch (e) { /* empty */ }

  if (sessions.length === 0) {
    el.innerHTML = '<div class="stats-empty">No workouts logged this month</div>';
    return;
  }

  const workoutDays = new Set(sessions.map(s => s.date)).size;
  const totalSets = sessions.reduce((sum, s) => sum + s.reps.length, 0);
  const totalVolume = sessions.reduce((sum, s) => {
    const w = s.weight || 0;
    return sum + s.reps.reduce((rs, r) => rs + r * w, 0);
  }, 0);

  let streak = 0;
  try { streak = DB.getWorkoutStreak(); } catch (e) { /* empty */ }

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${workoutDays}</div>
        <div class="stat-label">Workouts</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalSets}</div>
        <div class="stat-label">Total Sets</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalVolume > 0 ? (totalVolume >= 1000 ? Math.round(totalVolume / 1000) + 'k' : totalVolume) : '-'}</div>
        <div class="stat-label">Volume (lbs)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${streak}</div>
        <div class="stat-label">Day Streak</div>
      </div>
    </div>
  `;
}

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

// --- Notes (3.6) ---

function toggleNoteArea(exerciseId) {
  const area = document.getElementById(`note-${exerciseId}`);
  const toggle = area.previousElementSibling;
  if (area.style.display === 'none') {
    area.style.display = '';
    toggle.textContent = 'Note';
    area.focus();
  } else {
    area.style.display = 'none';
    toggle.textContent = '+ Note';
  }
}

function saveNote(exerciseId) {
  const area = document.getElementById(`note-${exerciseId}`);
  if (!area) return;
  try {
    DB.setExerciseNote(exerciseId, area.value.trim());
  } catch (e) { /* ignore */ }
}

// --- Body Measurements (3.2) ---

let bodyweightChart = null;

function loadBodyMeasurements() {
  const form = document.getElementById('measurement-form');
  const historyEl = document.getElementById('measurements-history');
  const chartContainer = document.getElementById('bodyweight-chart-container');

  const dateInput = document.getElementById('meas-date');
  if (!dateInput.value) dateInput.value = getLocalDateStr();

  if (!form.dataset.wired) {
    form.dataset.wired = '1';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const entry = {
        date: dateInput.value,
        weight: parseFloat(document.getElementById('meas-weight').value) || null,
        chest: parseFloat(document.getElementById('meas-chest').value) || null,
        waist: parseFloat(document.getElementById('meas-waist').value) || null,
        hips: parseFloat(document.getElementById('meas-hips').value) || null,
        biceps_l: parseFloat(document.getElementById('meas-biceps-l').value) || null,
        biceps_r: parseFloat(document.getElementById('meas-biceps-r').value) || null,
        thigh_l: parseFloat(document.getElementById('meas-thigh-l').value) || null,
        thigh_r: parseFloat(document.getElementById('meas-thigh-r').value) || null,
      };
      if (!entry.weight && !entry.chest && !entry.waist && !entry.hips && !entry.biceps_l && !entry.biceps_r && !entry.thigh_l && !entry.thigh_r) {
        showToast('Enter at least one measurement', 'error');
        return;
      }
      DB.addMeasurement(entry);
      showToast('Measurement saved!', 'success');
      form.reset();
      dateInput.value = getLocalDateStr();
      loadBodyMeasurements();
    });
  }

  const measurements = DB.getMeasurements();
  if (measurements.length === 0) {
    historyEl.innerHTML = '<div class="empty-state"><p>No measurements recorded yet.</p></div>';
    chartContainer.style.display = 'none';
    return;
  }

  let html = '';
  for (let i = measurements.length - 1; i >= 0; i--) {
    const m = measurements[i];
    const vals = [];
    if (m.weight) vals.push(`<span><span class="measurement-label">Weight</span> ${m.weight}</span>`);
    if (m.chest) vals.push(`<span><span class="measurement-label">Chest</span> ${m.chest}</span>`);
    if (m.waist) vals.push(`<span><span class="measurement-label">Waist</span> ${m.waist}</span>`);
    if (m.hips) vals.push(`<span><span class="measurement-label">Hips</span> ${m.hips}</span>`);
    if (m.biceps_l) vals.push(`<span><span class="measurement-label">Bicep L</span> ${m.biceps_l}</span>`);
    if (m.biceps_r) vals.push(`<span><span class="measurement-label">Bicep R</span> ${m.biceps_r}</span>`);
    if (m.thigh_l) vals.push(`<span><span class="measurement-label">Thigh L</span> ${m.thigh_l}</span>`);
    if (m.thigh_r) vals.push(`<span><span class="measurement-label">Thigh R</span> ${m.thigh_r}</span>`);
    html += `<div class="measurement-row"><span class="measurement-date">${esc(formatDate(m.date))}</span><div class="measurement-values">${vals.join('')}</div></div>`;
  }
  historyEl.innerHTML = html;

  const withWeight = measurements.filter(m => m.weight);
  if (withWeight.length >= 2 && typeof Chart !== 'undefined') {
    chartContainer.style.display = '';
    if (bodyweightChart) bodyweightChart.destroy();
    const ctx = document.getElementById('bodyweight-chart').getContext('2d');
    bodyweightChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: withWeight.map(m => formatDate(m.date)),
        datasets: [{
          label: 'Body Weight',
          data: withWeight.map(m => m.weight),
          borderColor: '#4f6ef7',
          backgroundColor: 'rgba(79, 110, 247, 0.1)',
          fill: true,
          tension: 0.3,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: '#8a8fa8' }, grid: { color: 'rgba(30,34,53,0.5)' } },
          x: { ticks: { color: '#8a8fa8', maxTicksLimit: 8 }, grid: { display: false } },
        },
      },
    });
  } else {
    chartContainer.style.display = 'none';
  }
}

// --- Workout Duration Timer (3.1) ---

let workoutTimerInterval = null;

function startWorkoutTimer() {
  const active = DB.getActiveWorkoutSession();
  if (!active && currentDayId) {
    DB.startWorkoutSession(currentDayId);
  }
  updateWorkoutTimerDisplay();
  if (!workoutTimerInterval) {
    workoutTimerInterval = setInterval(updateWorkoutTimerDisplay, 1000);
  }
}

function stopWorkoutTimer() {
  if (workoutTimerInterval) {
    clearInterval(workoutTimerInterval);
    workoutTimerInterval = null;
  }
  const result = DB.endWorkoutSession();
  const display = document.getElementById('workout-timer-display');
  if (display) display.style.display = 'none';
  if (result) {
    const mins = Math.floor(result.duration_seconds / 60);
    showToast(`Workout complete! Duration: ${mins} min`, 'success');
  }
}

function updateWorkoutTimerDisplay() {
  const active = DB.getActiveWorkoutSession();
  const display = document.getElementById('workout-timer-display');
  const value = document.getElementById('workout-timer-value');
  if (!active || !display || !value) return;
  display.style.display = '';
  const elapsed = Math.floor((Date.now() - active.startedAt) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  value.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function ensureWorkoutTimer() {
  const active = DB.getActiveWorkoutSession();
  if (!active && currentDayId) {
    startWorkoutTimer();
  } else if (active && !workoutTimerInterval) {
    workoutTimerInterval = setInterval(updateWorkoutTimerDisplay, 1000);
    updateWorkoutTimerDisplay();
  }
}

// --- Plate Calculator (3.3) ---

function calculatePlates(targetWeight, barWeight) {
  if (barWeight === undefined) barWeight = 45;
  const availablePlates = [45, 35, 25, 10, 5, 2.5];
  const perSide = (targetWeight - barWeight) / 2;
  if (perSide <= 0) return { plates: [], perSide: 0, barWeight };
  let remaining = perSide;
  const plates = [];
  for (const plate of availablePlates) {
    while (remaining >= plate) {
      plates.push(plate);
      remaining -= plate;
    }
  }
  return { plates, perSide, barWeight };
}

function renderPlateCalculator(exerciseId) {
  const wInput = document.getElementById(`weight-${exerciseId}`);
  if (!wInput) return;
  const existing = document.getElementById(`plates-${exerciseId}`);
  const weight = parseFloat(wInput.value);
  if (isNaN(weight) || weight <= 0) {
    if (existing) existing.remove();
    return;
  }
  const barWeight = 45;
  let text = '';
  if (weight < barWeight) {
    text = '<span class="plate-warning">Below bar weight</span>';
  } else if (weight === barWeight) {
    text = '<span class="plate-info">Empty bar</span>';
  } else {
    const result = calculatePlates(weight, barWeight);
    text = result.plates.length > 0
      ? `<span class="plate-info">Per side: ${result.plates.join(' + ')} lbs</span>`
      : '';
  }
  if (existing) {
    existing.innerHTML = text;
  } else {
    const el = document.createElement('div');
    el.id = `plates-${exerciseId}`;
    el.className = 'plate-display';
    el.innerHTML = text;
    wInput.parentElement.after(el);
  }
}

// --- Warmup Set Calculator (3.4) ---

function calculateWarmupSets(workingWeight, barWeight) {
  if (barWeight === undefined) barWeight = 45;
  if (workingWeight <= barWeight) return [];
  const pcts = [0, 0.5, 0.7, 0.85];
  const reps = [5, 5, 3, 2];
  return pcts.map((pct, i) => {
    const w = pct === 0 ? barWeight : Math.round((workingWeight * pct) * 2) / 2;
    return { weight: Math.max(w, barWeight), reps: reps[i], label: pct === 0 ? 'Bar' : `${Math.round(pct * 100)}%` };
  }).filter((s, i, arr) => i === 0 || s.weight !== arr[i - 1].weight);
}

// --- Unit Conversion (3.7) ---

function getUnitLabel() {
  const settings = DB.getSettings();
  return settings.unit || 'lbs';
}

function convertWeight(lbs, toUnit) {
  if (toUnit === 'kg') return parseFloat((lbs / 2.20462).toFixed(1));
  return lbs;
}

function displayWeight(lbs) {
  const unit = getUnitLabel();
  if (lbs == null) return 'BW';
  return `${convertWeight(lbs, unit)} ${unit}`;
}

// --- Theme (3.8) ---

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const settings = DB.getSettings();
  settings.theme = theme;
  DB.saveSettings(settings);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '\u2600' : '\u263E';
}

function toggleTheme() {
  const settings = DB.getSettings();
  applyTheme(settings.theme === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  const settings = DB.getSettings();
  let theme = settings.theme;
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '\u2600' : '\u263E';
}

function toggleUnit() {
  const settings = DB.getSettings();
  settings.unit = settings.unit === 'lbs' ? 'kg' : 'lbs';
  DB.saveSettings(settings);
  const btn = document.getElementById('unit-toggle');
  if (btn) btn.textContent = settings.unit;
  if (currentDayId) loadExercises(currentDayId);
  showToast(`Units: ${settings.unit}`, 'success');
}

// --- Init ---
initTheme();
(function initUnit() {
  const btn = document.getElementById('unit-toggle');
  if (btn) btn.textContent = getUnitLabel();
})();
ensureWorkoutTimer();
loadDashboard();
