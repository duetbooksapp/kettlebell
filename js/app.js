import * as store from './storage.js';
import * as engine from './timer.js';

const DAY_NAMES = { mon: 'Monday', wed: 'Wednesday', fri: 'Friday' };
const DOW = { mon: 1, wed: 3, fri: 5 };

let program = null;
let progress = null;
let settings = null;
let active = null; // in-flight engine session state
let view = 'today';
let rafId = null;
let lastShape = null;
let lastCueKey = null;
let prevView = null; // previous derived view, for cue-edge detection
let wakeLock = null;
let actx = null;

const $ = (sel) => document.querySelector(sel);
const screenEl = () => $('#screen');

init();

async function init() {
  program = await (await fetch('program.json')).json();
  progress = store.getProgress();
  settings = store.getSettings();
  active = store.getActiveSession();

  document.addEventListener('visibilitychange', onVisibility);
  $('#tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) show(btn.dataset.view);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Restore a session in progress after an app kill.
  if (active && active.phase === 'done') show('wrapup');
  else if (active) show('session');
  else show('today');
}

function show(v) {
  view = v;
  cancelAnimationFrame(rafId);
  const inSession = v === 'session' || v === 'wrapup';
  $('#tabbar').classList.toggle('hidden', inSession);
  screenEl().classList.toggle('session-mode', v === 'session');
  for (const b of document.querySelectorAll('#tabbar button')) {
    b.classList.toggle('active', b.dataset.view === v);
  }
  if (v === 'today') renderToday();
  else if (v === 'session') startSessionView();
  else if (v === 'wrapup') renderWrapup();
  else if (v === 'history') renderHistory();
  else if (v === 'settings') renderSettings();
}

/* ================= Today ================= */

function currentWeekObj() {
  return program.weeks.find((w) => w.week === progress.currentWeek) || null;
}

function pickNextDay() {
  const week = currentWeekObj();
  if (!week) return null;
  const remaining = week.days.filter((d) => d.type !== 'rest' && !progress.completedDays.includes(d.id));
  if (remaining.length === 0) return { week, day: null };
  const todayDow = new Date().getDay();
  const todays = remaining.find((d) => DOW[d.id] === todayDow);
  return { week, day: todays || remaining[0], isToday: !!todays };
}

function prescriptionText(day) {
  switch (day.type) {
    case 'emom': {
      const ivl = day.intervalSec === 60 ? 'minute' : `${day.intervalSec} seconds`;
      return `${day.sets} sets of ${day.reps}, one set on every ${ivl}, ${day.weightLb} lb`;
    }
    case 'straight':
      return `${day.sets} sets of ${day.reps}, ${day.restSec}s rest between sets, ${day.weightLb} lb`;
    case 'unilateral':
      return `${day.sets} sets of ${day.repsPerArm} per arm, ${day.restSec}s rest, ${day.weightLb} lb`;
    case 'forTime':
      return `${day.targetReps} swings for time, ${day.weightLb} lb`;
    case 'unilateralForTime':
      return `${day.targetRepsPerArm} swings per arm for time, ${day.weightLb} lb`;
    default:
      return 'No session.';
  }
}

function renderToday() {
  const pick = pickNextDay();

  if (!pick) {
    screenEl().innerHTML = `
      <h1>Program complete 🎉</h1>
      <div class="card">
        <p>All 12 weeks are in the books. History has the full record.</p>
        <p class="muted small">Reset progress in Settings to run it again.</p>
      </div>`;
    return;
  }

  if (!pick.day) {
    // Every day logged, but the advance/repeat decision hasn't been made
    // (e.g. app killed while the prompt was up). Re-evaluate — never advance
    // silently.
    screenEl().innerHTML = `
      <h1>Week ${pick.week.week} <span class="muted">of 12</span></h1>
      <div class="card">
        <div style="font-weight:700">All sessions logged ✓</div>
        <div class="muted small" style="margin-top:4px">Checking flags before advancing…</div>
      </div>`;
    evaluateWeekCompletion(pick.week);
    return;
  }

  const { week, day, isToday } = pick;
  const repeats = progress.repeatCount[week.week] || 0;
  const dots = week.days
    .filter((d) => d.type !== 'rest')
    .map((d) => {
      const done = progress.completedDays.includes(d.id);
      const next = day && d.id === day.id;
      return `<div class="dot ${done ? 'done' : next ? 'next' : ''}">${DAY_NAMES[d.id].slice(0, 3)}${done ? ' ✓' : ''}</div>`;
    })
    .join('');

  screenEl().innerHTML = `
    <h1>Week ${week.week} <span class="muted">of 12</span></h1>
    ${week.deload ? `<span class="badge deload">Deload week</span> <span class="muted small">The drop in volume is intentional — recover, don't chase numbers.</span>` : ''}
    ${repeats ? `<div class="muted small" style="margin-top:4px">Repeating this week (pass ${repeats + 1})</div>` : ''}
    <div class="week-dots">${dots}</div>
    <div class="card">
      ${isToday ? '' : `<div class="muted small" style="margin-bottom:6px">Today isn't a scheduled day — next up:</div>`}
      <div style="font-weight:700">${day.label}</div>
      <div class="prescription">${prescriptionText(day)}</div>
      <div class="muted small">${day.note || ''}</div>
    </div>
    <h2>Warm-up <span class="muted" style="text-transform:none;letter-spacing:0">· ~${Math.round(program.warmup.durationSec / 60)} min</span></h2>
    <div class="card">
      <ul class="checklist" id="warmup-list">
        ${program.warmup.items.map((it, i) => `<li><input type="checkbox" id="wu${i}"><label for="wu${i}">${it}</label></li>`).join('')}
      </ul>
    </div>
    <button class="btn primary big" id="start-btn">${isToday ? 'Start session' : 'Start it anyway'}</button>
    <details class="rules">
      <summary>Rules of the program</summary>
      <ul>${program.rules.map((r) => `<li>${r}</li>`).join('')}</ul>
    </details>`;

  $('#warmup-list').addEventListener('change', (e) => {
    e.target.closest('li').classList.toggle('checked', e.target.checked);
  });
  $('#start-btn').addEventListener('click', () => startSession(week.week, day));
}

/* ================= Session ================= */

function startSession(weekNum, day) {
  // Audio + wake lock must be unlocked inside this user-gesture handler,
  // or iOS Safari refuses both silently.
  unlockAudio();
  requestWakeLock();
  active = engine.createSession(program, weekNum, day, Date.now());
  store.saveActiveSession(active);
  lastShape = null;
  lastCueKey = null;
  prevView = null;
  show('session');
}

function startSessionView() {
  lastShape = null;
  prevView = null;
  loop();
}

function loop() {
  if (view !== 'session' || !active) return;
  const now = Date.now();
  engine.sync(active, now);
  const v = engine.derive(active, now);
  handleCues(v);
  if (v.done) {
    engine.finish(active, now);
    store.saveActiveSession(active);
    cue('tone');
    show('wrapup');
    return;
  }
  renderFrame(v);
  prevView = v;
  rafId = requestAnimationFrame(loop);
}

function shapeKey(v) {
  const s = active;
  const repVals = s.sets.map((x) => `${x.actualReps}.${x.actualRepsLeft ?? ''}`).join(',');
  return [v.type, v.phase, v.setIndex, v.arm, v.paused, s.tally, s.tallyLeft, repVals].join('|');
}

function renderFrame(v) {
  const key = shapeKey(v);
  if (key !== lastShape) {
    lastShape = key;
    buildSessionDom(v);
  }
  updateTimes(v);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildSessionDom(v) {
  const d = active.day;
  const head = `
    <div class="session-head">
      <div>
        <div class="title">Week ${active.week} · ${d.label}</div>
        <div class="sub">${prescriptionText(d)}</div>
      </div>
      <button class="btn ghost small" data-action="end">End</button>
    </div>`;

  let zone = '';
  let controls = '';
  const pauseBtn = v.paused
    ? `<button class="btn primary" data-action="resume">Resume</button>`
    : `<button class="btn" data-action="pause">Pause</button>`;

  if (v.type === 'emom') {
    const set = active.sets[v.setIndex];
    zone = `
      <div class="big-num" id="t-main">${v.remainingSec}</div>
      <div class="timer-label">seconds to next round</div>
      <div class="round-line">Round ${v.round} / ${v.rounds} · target ${v.repTarget} reps</div>
      ${v.paused ? '<div class="paused-note">PAUSED</div>' : ''}
      <div class="rep-adjust">
        <div class="rep-cap">reps this round</div>
        <button class="rep-btn" data-action="rep-">−</button>
        <div class="rep-val">${set.actualReps}</div>
        <button class="rep-btn" data-action="rep+">+</button>
      </div>`;
    controls = `
      <div class="row">${pauseBtn}<button class="btn" data-action="skipset">Skip round</button></div>
      <div class="muted small" style="text-align:center">total <span id="t-elapsed">${fmtTime(v.elapsedSec)}</span></div>`;
  } else if (v.type === 'straight' || v.type === 'unilateral') {
    const uni = v.type === 'unilateral';
    if (v.phase === 'rest') {
      const prev = active.sets[v.setIndex - 1];
      zone = `
        <div class="big-num resting" id="t-main">${v.remainingSec}</div>
        <div class="timer-label">rest — next: set ${v.setIndex + 1} of ${v.setCount}</div>
        ${v.paused ? '<div class="paused-note">PAUSED</div>' : ''}
        <div class="rep-adjust">
          <div class="rep-cap">last set — reps${uni ? ' (right / left)' : ''}</div>
          <button class="rep-btn" data-action="prev-rep-">−</button>
          <div class="rep-val">${prev.actualReps}${uni ? ` / ${prev.actualRepsLeft}` : ''}</div>
          <button class="rep-btn" data-action="prev-rep+">+</button>
          ${uni ? `<button class="rep-btn" data-action="prev-repL-">−L</button><button class="rep-btn" data-action="prev-repL+">+L</button>` : ''}
        </div>`;
      controls = `<div class="row">${pauseBtn}<button class="btn" data-action="skiprest">Skip rest</button></div>`;
    } else {
      const set = active.sets[v.setIndex];
      const repsShown = uni && v.arm === 'left' ? set.actualRepsLeft : set.actualReps;
      const adjPrefix = uni && v.arm === 'left' ? 'repL' : 'rep';
      zone = `
        <div class="big-num" id="t-main">${fmtTime(v.setElapsedSec ?? 0)}</div>
        <div class="timer-label">set clock</div>
        <div class="round-line">Set ${v.setIndex + 1} / ${v.setCount} · ${set.prescribedReps} reps @ ${set.weightLb} lb</div>
        ${uni ? `<div class="arm-badge">${v.arm === 'right' ? 'RIGHT ARM' : 'LEFT ARM'}</div>` : ''}
        ${v.paused ? '<div class="paused-note">PAUSED</div>' : ''}
        <div class="rep-adjust">
          <div class="rep-cap">reps${uni ? ` — ${v.arm} arm` : ''}</div>
          <button class="rep-btn" data-action="${adjPrefix}-">−</button>
          <div class="rep-val">${repsShown}</div>
          <button class="rep-btn" data-action="${adjPrefix}+">+</button>
        </div>`;
      const doneLabel = uni ? (v.arm === 'right' ? 'Right arm done' : 'Left arm done — set complete') : 'Set complete';
      controls = `
        <button class="btn primary big" data-action="complete">${doneLabel}</button>
        <div class="row">${pauseBtn}<button class="btn" data-action="skipset">Skip set</button></div>
        <div class="muted small" style="text-align:center">total <span id="t-elapsed">${fmtTime(v.elapsedSec)}</span></div>`;
    }
  } else if (v.type === 'forTime') {
    const hit = active.tally >= v.target;
    zone = `
      <div class="big-num" id="t-main">${fmtTime(v.elapsedSec)}</div>
      <div class="timer-label">elapsed</div>
      <div class="tally-grid">
        <div class="tally-col">
          <div class="t-cap">reps · target ${v.target}</div>
          <div class="t-num ${hit ? 'hit' : ''}">${active.tally}</div>
        </div>
      </div>
      ${v.paused ? '<div class="paused-note">PAUSED</div>' : ''}`;
    controls = `
      <button class="btn primary big" data-action="add1">+1 rep</button>
      <div class="row">
        <button class="btn" data-action="add5">+5</button>
        <button class="btn" data-action="sub1">−1</button>
        ${pauseBtn}
      </div>`;
  } else if (v.type === 'unilateralForTime') {
    const hitR = active.tally >= v.targetPerArm;
    const hitL = active.tallyLeft >= v.targetPerArm;
    zone = `
      <div class="big-num" id="t-main">${fmtTime(v.elapsedSec)}</div>
      <div class="timer-label">elapsed · target ${v.targetPerArm} per arm</div>
      <div class="tally-grid">
        <div class="tally-col">
          <div class="t-cap">RIGHT</div>
          <div class="t-num ${hitR ? 'hit' : ''}">${active.tally}</div>
          <button class="btn" data-action="add1" style="width:100%;margin-top:6px">+1 R</button>
          <button class="btn ghost small" data-action="add5">+5</button>
          <button class="btn ghost small" data-action="sub1">−1</button>
        </div>
        <div class="tally-col">
          <div class="t-cap">LEFT</div>
          <div class="t-num ${hitL ? 'hit' : ''}">${active.tallyLeft}</div>
          <button class="btn" data-action="add1L" style="width:100%;margin-top:6px">+1 L</button>
          <button class="btn ghost small" data-action="add5L">+5</button>
          <button class="btn ghost small" data-action="sub1L">−1</button>
        </div>
      </div>
      ${v.paused ? '<div class="paused-note">PAUSED</div>' : ''}`;
    controls = `<div class="row">${pauseBtn}</div>`;
  }

  screenEl().innerHTML = `
    <div class="session">
      ${head}
      <div class="timer-zone">${zone}</div>
      <div class="session-controls">${controls}</div>
    </div>`;

  screenEl().querySelectorAll('[data-action]').forEach((b) => {
    b.addEventListener('click', () => onAction(b.dataset.action));
  });
}

function updateTimes(v) {
  const main = $('#t-main');
  if (main) {
    if (v.type === 'emom') main.textContent = v.remainingSec;
    else if (v.phase === 'rest') main.textContent = v.remainingSec;
    else if (v.type === 'straight' || v.type === 'unilateral') main.textContent = fmtTime(v.setElapsedSec ?? 0);
    else main.textContent = fmtTime(v.elapsedSec);
  }
  const el = $('#t-elapsed');
  if (el) el.textContent = fmtTime(v.elapsedSec);
}

function onAction(a) {
  const now = Date.now();
  const v = engine.derive(active, now);
  switch (a) {
    case 'pause': engine.pause(active, now); break;
    case 'resume': engine.resume(active, now); unlockAudio(); requestWakeLock(); break;
    case 'complete': engine.completeTap(active, now); break;
    case 'skiprest': engine.skipRest(active, now); break;
    case 'skipset': engine.skipSet(active, now); break;
    case 'end': confirmEnd(); return;
    case 'rep-': engine.adjustReps(active, v.setIndex, -1); break;
    case 'rep+': engine.adjustReps(active, v.setIndex, +1); break;
    case 'repL-': engine.adjustReps(active, v.setIndex, -1, 'left'); break;
    case 'repL+': engine.adjustReps(active, v.setIndex, +1, 'left'); break;
    case 'prev-rep-': engine.adjustReps(active, v.setIndex - 1, -1); break;
    case 'prev-rep+': engine.adjustReps(active, v.setIndex - 1, +1); break;
    case 'prev-repL-': engine.adjustReps(active, v.setIndex - 1, -1, 'left'); break;
    case 'prev-repL+': engine.adjustReps(active, v.setIndex - 1, +1, 'left'); break;
    case 'add1': engine.addRep(active, +1); break;
    case 'add5': engine.addRep(active, +5); break;
    case 'sub1': engine.addRep(active, -1); break;
    case 'add1L': engine.addRep(active, +1, 'left'); break;
    case 'add5L': engine.addRep(active, +5, 'left'); break;
    case 'sub1L': engine.addRep(active, -1, 'left'); break;
  }
  store.saveActiveSession(active);
  lastShape = null; // force rebuild next frame
}

function confirmEnd() {
  modal('End this session early? Everything logged so far will be saved.', [
    { label: 'Keep going', primary: true },
    {
      label: 'End session',
      fn: () => {
        engine.endEarly(active, Date.now());
        store.saveActiveSession(active);
        show('wrapup');
      },
    },
  ]);
}

/* ---- cues ---- */

function handleCues(v) {
  if (v.paused || v.done) return;
  let key = null;
  let kind = null;
  if (v.type === 'emom') {
    if (prevView && !prevView.done && prevView.setIndex !== v.setIndex) {
      key = `round${v.setIndex}`;
      kind = 'tone';
    } else if (v.remainingSec <= 3 && v.remainingSec >= 1) {
      key = `b${v.setIndex}:${v.remainingSec}`;
      kind = 'beep';
    }
  } else if (v.type === 'straight' || v.type === 'unilateral') {
    if (prevView && prevView.phase === 'rest' && v.phase === 'work') {
      key = `go${v.setIndex}`;
      kind = 'tone';
    } else if (v.phase === 'rest' && v.remainingSec <= 3 && v.remainingSec >= 1) {
      key = `rb${v.setIndex}:${v.remainingSec}`;
      kind = 'beep';
    }
  }
  if (key && key !== lastCueKey) {
    lastCueKey = key;
    cue(kind);
  }
}

function unlockAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    // Zero-gain buffer inside the gesture — unlocks iOS audio for later cues.
    const buf = actx.createBuffer(1, 1, 22050);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const g = actx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(actx.destination);
    src.start(0);
  } catch {}
}

function playTone(freq, dur, vol = 0.4) {
  if (!settings.audio || !actx || actx.state !== 'running') return;
  try {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    const t = actx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch {}
}

function cue(kind) {
  if (kind === 'beep') {
    playTone(880, 0.12);
    vibrate(80);
  } else {
    playTone(1318.5, 0.35);
    vibrate([120, 60, 120]);
  }
}

function vibrate(pattern) {
  if (settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}

function onVisibility() {
  if (document.visibilityState !== 'visible') return;
  if (active && active.phase !== 'done' && view === 'session') {
    // The wake lock is dropped on background — take it again, resume audio,
    // and let the next frame recompute set/round from the anchor.
    requestWakeLock();
    if (actx && actx.state === 'suspended') actx.resume();
    lastShape = null;
    cancelAnimationFrame(rafId);
    loop();
  }
}

/* ================= Wrap-up ================= */

function renderWrapup() {
  const total = engine.totalReps(active);
  const dur = active.completedAtMs ? Math.round((active.completedAtMs - active.anchorMs) / 1000) : 0;
  screenEl().innerHTML = `
    <h1>Session done</h1>
    <div class="muted">Week ${active.week} · ${active.day.label}${active.endedEarly ? ' · ended early' : ''}</div>
    <div class="stat-row">
      <div class="stat"><div class="v">${total}</div><div class="k">total reps</div></div>
      <div class="stat"><div class="v">${fmtTime(dur)}</div><div class="k">time</div></div>
    </div>
    <h2>How hard was it?</h2>
    <div class="card">
      <div class="rpe-row">
        <span class="muted small">RPE</span>
        <input type="range" id="rpe" min="1" max="10" step="1" value="6">
        <span class="rpe-val" id="rpe-val">6</span>
      </div>
    </div>
    <h2>Flags</h2>
    <div class="card">
      <div class="toggle-row"><label for="backFlag">Did your low back complain?</label><input type="checkbox" id="backFlag"></div>
      <div class="toggle-row"><label for="formFlag">Did your hinge break down in the last 2 sets?</label><input type="checkbox" id="formFlag"></div>
    </div>
    <h2>Notes</h2>
    <textarea id="notes" placeholder="Anything worth remembering…"></textarea>
    <h2>Cooldown</h2>
    <div class="card">
      <ul class="checklist">${program.cooldown.items.map((it) => `<li><label>${it}</label></li>`).join('')}</ul>
    </div>
    <button class="btn primary big" id="save-btn" style="margin-top:14px">Save session</button>`;

  $('#rpe').addEventListener('input', (e) => {
    $('#rpe-val').textContent = e.target.value;
  });
  $('#save-btn').addEventListener('click', saveSession);
}

function saveSession() {
  if (!active) return;
  const log = engine.toLog(active, {
    rpe: Number($('#rpe').value),
    backFlag: $('#backFlag').checked,
    formFlag: $('#formFlag').checked,
    notes: $('#notes').value.trim(),
  });
  store.addLog(log);
  store.clearActiveSession();
  active = null;
  releaseWakeLock();
  afterSave(log);
}

function releaseWakeLock() {
  try { wakeLock && wakeLock.release(); } catch {}
  wakeLock = null;
}

/* ================= Progression ================= */

function afterSave(log) {
  if (log.week === progress.currentWeek && !progress.completedDays.includes(log.dayId)) {
    progress.completedDays.push(log.dayId);
    store.saveProgress(progress);
  }
  // renderToday notices when the week is fully logged and runs the
  // advance/repeat evaluation itself, so a killed app re-prompts on reopen.
  show('today');
}

function evaluateWeekCompletion(week) {
  // Latest log per day of this week decides the flags (repeats look at the
  // most recent pass, not stale earlier attempts).
  const logs = store.getLogs();
  const flagged = [];
  for (const day of week.days) {
    if (day.type === 'rest') continue;
    const latest = logs
      .filter((l) => l.week === week.week && l.dayId === day.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (latest && (latest.backFlag || latest.formFlag)) {
      flagged.push({ day, log: latest });
    }
  }

  if (flagged.length === 0) {
    advanceWeek();
    show('today');
    toast(week.week >= 12 ? 'Program complete!' : `Week ${week.week} complete — on to week ${week.week + 1}`);
    return;
  }

  const f = flagged[0];
  const what = f.log.backFlag ? 'back flagged' : 'hinge broke down';
  const msg = `Your ${what} on ${DAY_NAMES[f.day.id]}. Repeating this week is the recommended call — advance anyway?`;
  modal(msg, [
    {
      label: `Repeat week ${week.week} (recommended)`,
      primary: true,
      fn: () => { repeatWeek(week.week); show('today'); toast(`Repeating week ${week.week}`); },
    },
    {
      label: 'Advance anyway',
      fn: () => { advanceWeek(); show('today'); toast(`Advanced to week ${Math.min(progress.currentWeek, 12)}`); },
    },
  ]);
}

function advanceWeek() {
  progress.currentWeek += 1;
  progress.completedDays = [];
  store.saveProgress(progress);
}

function repeatWeek(weekNum) {
  progress.repeatCount[weekNum] = (progress.repeatCount[weekNum] || 0) + 1;
  progress.completedDays = [];
  store.saveProgress(progress);
}

/* ================= History ================= */

function renderHistory() {
  const logs = store.getLogs().slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const volumes = {};
  for (const l of store.getLogs()) volumes[l.week] = (volumes[l.week] || 0) + l.totalReps;

  const items = logs.map((l) => {
    const date = new Date(l.startedAt);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const flags = [l.backFlag ? 'back' : null, l.formFlag ? 'form' : null].filter(Boolean).join(' · ');
    return `
      <div class="card hist-item" data-id="${l.id}">
        <div class="hist-line">
          <span class="who">W${l.week} · ${DAY_NAMES[l.dayId] || l.dayId}</span>
          <span class="muted small">${dateStr}</span>
        </div>
        <div class="hist-line">
          <span>${l.totalReps} reps · ${l.durationSec != null ? fmtTime(l.durationSec) : '—'}${l.rpe ? ` · RPE ${l.rpe}` : ''}</span>
        </div>
        ${flags ? `<div class="hist-flags">⚑ ${flags}</div>` : ''}
        <div class="hist-detail" hidden>
          ${setsTable(l)}
          ${l.notes ? `<div class="muted small" style="margin-top:6px">${l.notes}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  screenEl().innerHTML = `
    <h1>History</h1>
    <h2>Weekly volume</h2>
    <div class="card chart-wrap">${volumeChart(volumes)}</div>
    <h2>Sessions</h2>
    ${items || '<div class="card muted">Nothing logged yet.</div>'}`;

  screenEl().querySelectorAll('.hist-item').forEach((el) => {
    el.addEventListener('click', () => {
      const det = el.querySelector('.hist-detail');
      det.hidden = !det.hidden;
    });
  });
}

function setsTable(l) {
  const uni = l.sets.some((s) => 'actualRepsLeft' in s && s.actualRepsLeft != null);
  const rows = l.sets.map((s) => `
    <tr>
      <td>${s.index + 1}</td>
      <td>${s.prescribedReps}</td>
      <td>${s.actualReps}${uni ? ` / ${s.actualRepsLeft ?? 0}` : ''}</td>
      <td>${s.weightLb} lb</td>
      <td>${s.elapsedSec != null ? fmtTime(s.elapsedSec) : '—'}</td>
    </tr>`).join('');
  return `
    <table class="sets">
      <tr><th>Set</th><th>Rx</th><th>Done${uni ? ' R/L' : ''}</th><th>Weight</th><th>Time</th></tr>
      ${rows}
    </table>`;
}

function volumeChart(volumes) {
  const W = 320, H = 130, padL = 30, padR = 8, padT = 10, padB = 22;
  const weeks = Array.from({ length: 12 }, (_, i) => i + 1);
  const max = Math.max(100, ...Object.values(volumes));
  const x = (w) => padL + ((w - 1) / 11) * (W - padL - padR);
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const pts = weeks.filter((w) => volumes[w] != null);
  const line = pts.map((w) => `${x(w).toFixed(1)},${y(volumes[w]).toFixed(1)}`).join(' ');
  const dots = pts.map((w) => `<circle cx="${x(w).toFixed(1)}" cy="${y(volumes[w]).toFixed(1)}" r="3.5" fill="var(--accent)"/>`).join('');
  const labels = weeks.map((w) => `<text x="${x(w).toFixed(1)}" y="${H - 6}" font-size="9" fill="var(--muted)" text-anchor="middle">${w}</text>`).join('');
  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-label="Weekly volume">
      <text x="4" y="${y(max) + 4}" font-size="9" fill="var(--muted)">${max}</text>
      <text x="4" y="${y(0) + 4}" font-size="9" fill="var(--muted)">0</text>
      <line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" stroke="var(--line)"/>
      ${pts.length > 1 ? `<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>` : ''}
      ${dots}
      ${labels}
    </svg>`;
}

/* ================= Settings ================= */

function renderSettings() {
  const bells = settings.bellsLb || program.bellsLb;
  screenEl().innerHTML = `
    <h1>Settings</h1>
    <div class="card">
      <div class="setting-row"><label for="s-audio">Audio cues</label><input type="checkbox" id="s-audio" ${settings.audio ? 'checked' : ''}></div>
      <div class="setting-row"><label for="s-vib">Vibration</label><input type="checkbox" id="s-vib" ${settings.vibrate ? 'checked' : ''}></div>
      <div class="setting-row"><label for="s-bells">Bells owned (lb)</label><input type="text" id="s-bells" value="${bells.join(', ')}" inputmode="numeric"></div>
    </div>
    <h2>Program</h2>
    <div class="card muted small">${program.name} · v${program.version}<br>Week ${Math.min(progress.currentWeek, 12)} of 12${progress.currentWeek > 12 ? ' — complete' : ''}</div>
    <h2>Danger zone</h2>
    <button class="btn danger big" id="reset-btn">Reset all progress</button>`;

  $('#s-audio').addEventListener('change', (e) => { settings.audio = e.target.checked; store.saveSettings(settings); });
  $('#s-vib').addEventListener('change', (e) => { settings.vibrate = e.target.checked; store.saveSettings(settings); });
  $('#s-bells').addEventListener('change', (e) => {
    const nums = e.target.value.split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
    settings.bellsLb = nums.length ? nums : null;
    store.saveSettings(settings);
  });
  $('#reset-btn').addEventListener('click', () => {
    modal('Wipe all progress, history and settings? This cannot be undone.', [
      { label: 'Cancel', primary: true },
      {
        label: 'Reset everything',
        fn: () => {
          store.resetAll();
          progress = store.getProgress();
          settings = store.getSettings();
          active = null;
          show('today');
          toast('Progress reset');
        },
      },
    ]);
  });
}

/* ================= UI helpers ================= */

function modal(text, buttons) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const box = document.createElement('div');
  box.className = 'modal';
  const p = document.createElement('p');
  p.textContent = text;
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = `btn ${b.primary ? 'primary' : ''}`;
    el.textContent = b.label;
    el.addEventListener('click', () => {
      wrap.remove();
      if (b.fn) b.fn();
    });
    btns.append(el);
  }
  box.append(p, btns);
  wrap.append(box);
  document.body.append(wrap);
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}
