/**
 * Rest Timer module — countdown between sets with audio/vibration alerts.
 * Uses performance.now() + requestAnimationFrame for drift-free timing.
 */
// eslint-disable-next-line no-var
var RestTimer = (() => {
  const timers = {}; // keyed by exerciseId
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browsers require user gesture)
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function beep() {
    try {
      const ctx = getAudioCtx();
      // Two-tone alert
      [0, 0.25].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = i === 0 ? 800 : 1000;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.2);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.25);
      });
    } catch (e) { /* audio not available */ }
  }

  function vibrate() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  function formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function start(exerciseId, durationSeconds) {
    if (durationSeconds <= 0) return;
    stop(exerciseId);

    const now = performance.now();
    timers[exerciseId] = {
      duration: durationSeconds * 1000,
      remaining: durationSeconds * 1000,
      startTime: now,
      paused: false,
      pausedElapsed: 0,
      rafId: null,
    };
    renderUI(exerciseId);
    tick(exerciseId);
  }

  function tick(exerciseId) {
    const t = timers[exerciseId];
    if (!t || t.paused) return;

    const elapsed = performance.now() - t.startTime + t.pausedElapsed;
    t.remaining = Math.max(0, t.duration - elapsed);
    updateDisplay(exerciseId);

    if (t.remaining <= 0) {
      beep();
      vibrate();
      complete(exerciseId);
      return;
    }
    t.rafId = requestAnimationFrame(() => tick(exerciseId));
  }

  function pause(exerciseId) {
    const t = timers[exerciseId];
    if (!t || t.paused) return;
    t.paused = true;
    t.pausedElapsed += performance.now() - t.startTime;
    if (t.rafId) cancelAnimationFrame(t.rafId);
    updateControls(exerciseId);
  }

  function resume(exerciseId) {
    const t = timers[exerciseId];
    if (!t || !t.paused) return;
    t.paused = false;
    t.startTime = performance.now();
    tick(exerciseId);
    updateControls(exerciseId);
  }

  function togglePause(exerciseId) {
    const t = timers[exerciseId];
    if (!t) return;
    t.paused ? resume(exerciseId) : pause(exerciseId);
  }

  function adjust(exerciseId, deltaSec) {
    const t = timers[exerciseId];
    if (!t) return;
    t.duration = Math.max(0, t.duration + deltaSec * 1000);
    if (t.paused) updateDisplay(exerciseId);
  }

  function stop(exerciseId) {
    const t = timers[exerciseId];
    if (!t) return;
    if (t.rafId) cancelAnimationFrame(t.rafId);
    delete timers[exerciseId];
    removeUI(exerciseId);
  }

  function complete(exerciseId) {
    const el = document.getElementById(`timer-${exerciseId}`);
    if (el) {
      el.querySelector('.timer-display').textContent = '00:00';
      el.querySelector('.timer-progress-fill').style.width = '100%';
      el.classList.add('timer-done');
    }
    const t = timers[exerciseId];
    if (t && t.rafId) cancelAnimationFrame(t.rafId);
    delete timers[exerciseId];
    setTimeout(() => removeUI(exerciseId), 3000);
  }

  function isRunning(exerciseId) {
    return !!timers[exerciseId];
  }

  // --- UI ---

  function renderUI(exerciseId) {
    removeUI(exerciseId);
    const card = document.getElementById(`exercise-${exerciseId}`);
    if (!card) return;

    const t = timers[exerciseId];
    const el = document.createElement('div');
    el.id = `timer-${exerciseId}`;
    el.className = 'rest-timer';
    el.innerHTML = `
      <div class="timer-header">
        <span class="timer-label">Rest</span>
        <span class="timer-display">${formatTime(t.remaining)}</span>
      </div>
      <div class="timer-progress"><div class="timer-progress-fill"></div></div>
      <div class="timer-controls">
        <button type="button" class="timer-btn" onclick="RestTimer.adjust(${exerciseId},-15)" aria-label="Subtract 15 seconds">&minus;15s</button>
        <button type="button" class="timer-btn timer-btn-pause" onclick="RestTimer.togglePause(${exerciseId})" aria-label="Pause timer">
          <span class="pause-icon">&#10074;&#10074;</span>
        </button>
        <button type="button" class="timer-btn" onclick="RestTimer.adjust(${exerciseId},15)" aria-label="Add 15 seconds">+15s</button>
        <button type="button" class="timer-btn timer-btn-skip" onclick="RestTimer.stop(${exerciseId})" aria-label="Skip rest timer">Skip</button>
      </div>
    `;

    // Insert after .input-row
    const inputRow = card.querySelector('.input-row');
    if (inputRow && inputRow.nextSibling) {
      inputRow.parentNode.insertBefore(el, inputRow.nextSibling);
    } else {
      card.appendChild(el);
    }
  }

  function updateDisplay(exerciseId) {
    const t = timers[exerciseId];
    const el = document.getElementById(`timer-${exerciseId}`);
    if (!t || !el) return;

    el.querySelector('.timer-display').textContent = formatTime(t.remaining);
    const pct = t.duration > 0 ? (1 - t.remaining / t.duration) * 100 : 100;
    el.querySelector('.timer-progress-fill').style.width = `${pct}%`;
  }

  function updateControls(exerciseId) {
    const t = timers[exerciseId];
    const el = document.getElementById(`timer-${exerciseId}`);
    if (!t || !el) return;

    const btn = el.querySelector('.timer-btn-pause');
    if (btn) {
      btn.innerHTML = t.paused
        ? '<span class="play-icon">&#9654;</span>'
        : '<span class="pause-icon">&#10074;&#10074;</span>';
    }
  }

  function removeUI(exerciseId) {
    const el = document.getElementById(`timer-${exerciseId}`);
    if (el) el.remove();
  }

  return { start, stop, pause, resume, togglePause, adjust, isRunning };
})();
