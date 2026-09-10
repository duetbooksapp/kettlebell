// All persistence goes through this module. v1 backs onto localStorage; a
// Firebase adapter can replace the read/write pair later without touching UI.

const K = {
  logs: 'kb.logs',
  progress: 'kb.progress',
  settings: 'kb.settings',
  active: 'kb.activeSession',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function getLogs() {
  return read(K.logs, []);
}

export function addLog(log) {
  const logs = getLogs();
  logs.push(log);
  write(K.logs, logs);
}

export function getProgress() {
  return read(K.progress, { currentWeek: 1, completedDays: [], repeatCount: {} });
}

export function saveProgress(p) {
  write(K.progress, p);
}

export function getSettings() {
  return { audio: true, vibrate: true, bellsLb: null, ...read(K.settings, {}) };
}

export function saveSettings(s) {
  write(K.settings, s);
}

export function getActiveSession() {
  return read(K.active, null);
}

export function saveActiveSession(state) {
  write(K.active, state);
}

export function clearActiveSession() {
  try {
    localStorage.removeItem(K.active);
  } catch {}
}

export function resetAll() {
  for (const key of Object.values(K)) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}
