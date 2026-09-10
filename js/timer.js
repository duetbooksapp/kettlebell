// Pure timer engine for the Kettlebell Progression Trainer.
// No DOM, no Date.now() — every function takes an explicit `nowMs`, so the
// whole thing is unit-testable with fake timestamps. State is a plain
// serializable object; all timing derives from anchor timestamps, never from
// interval ticks, so backgrounding/killing the app can't drift the clock.

export function createSession(program, week, day, nowMs) {
  const s = {
    id: `${nowMs}-w${week}-${day.id}`,
    programVersion: program.version,
    week,
    dayId: day.id,
    day,
    startedAt: new Date(nowMs).toISOString(),
    type: day.type,
    anchorMs: nowMs,
    pausedAtMs: null,
    phase: 'work',
    setIndex: 0,
    arm: day.type === 'unilateral' ? 'right' : null,
    setStartMs: nowMs,
    restEndMs: null,
    completedAtMs: null,
    endedEarly: false,
    tally: 0,
    tallyLeft: 0,
    sets: [],
  };
  if (day.type === 'emom' || day.type === 'straight') {
    for (let i = 0; i < day.sets; i++) s.sets.push(makeSet(i, day.reps, day.weightLb));
  } else if (day.type === 'unilateral') {
    for (let i = 0; i < day.sets; i++) {
      const set = makeSet(i, day.repsPerArm, day.weightLb);
      set.actualRepsLeft = day.repsPerArm;
      s.sets.push(set);
    }
  }
  return s;
}

function makeSet(index, reps, weightLb) {
  // Logged reps default to the prescription; only exceptions need a tap.
  return { index, prescribedReps: reps, actualReps: reps, weightLb, elapsedSec: null };
}

// (state, nowMs) -> display view. Read-only.
export function derive(state, nowMs) {
  const now = state.pausedAtMs ?? nowMs;
  const d = state.day;
  const v = {
    type: state.type,
    paused: state.pausedAtMs != null,
    phase: state.phase,
    setIndex: state.setIndex,
    arm: state.arm,
    elapsedSec: Math.max(0, Math.floor((now - state.anchorMs) / 1000)),
    done: state.phase === 'done',
  };
  if (v.done) return v;

  if (state.type === 'emom') {
    const ivl = d.intervalSec * 1000;
    const totalMs = d.sets * ivl;
    const el = now - state.anchorMs;
    v.rounds = d.sets;
    v.repTarget = d.reps;
    if (el >= totalMs) {
      v.done = true;
      v.setIndex = d.sets;
      v.elapsedSec = Math.round(totalMs / 1000);
      return v;
    }
    v.setIndex = Math.floor(el / ivl);
    v.round = v.setIndex + 1;
    v.remainingSec = Math.ceil((ivl - (el % ivl)) / 1000);
  } else if (state.type === 'straight' || state.type === 'unilateral') {
    v.setCount = d.sets;
    if (state.phase === 'rest' && now < state.restEndMs) {
      v.remainingSec = Math.ceil((state.restEndMs - now) / 1000);
    } else {
      v.phase = 'work';
      v.setElapsedSec = Math.max(0, Math.floor((now - state.setStartMs) / 1000));
    }
  } else if (state.type === 'forTime') {
    v.tally = state.tally;
    v.target = d.targetReps;
    v.done = state.tally >= d.targetReps;
  } else if (state.type === 'unilateralForTime') {
    v.tally = state.tally;
    v.tallyLeft = state.tallyLeft;
    v.targetPerArm = d.targetRepsPerArm;
    v.done = state.tally >= d.targetRepsPerArm && state.tallyLeft >= d.targetRepsPerArm;
  }
  return v;
}

// Promote a rest phase whose countdown has expired. Call before dispatching
// user actions and once per frame.
export function sync(state, nowMs) {
  const now = state.pausedAtMs ?? nowMs;
  if (state.phase === 'rest' && now >= state.restEndMs) {
    state.phase = 'work';
    state.restEndMs = null;
  }
  return state;
}

export function pause(state, nowMs) {
  if (state.pausedAtMs == null && state.phase !== 'done') state.pausedAtMs = nowMs;
  return state;
}

export function resume(state, nowMs) {
  if (state.pausedAtMs == null) return state;
  const delta = nowMs - state.pausedAtMs;
  state.anchorMs += delta;
  state.setStartMs += delta;
  if (state.restEndMs != null) state.restEndMs += delta;
  state.pausedAtMs = null;
  return state;
}

// "Set complete" tap for straight/unilateral days. Unilateral: first tap ends
// the right arm, second tap ends the set.
export function completeTap(state, nowMs) {
  sync(state, nowMs);
  if (state.phase !== 'work' || state.pausedAtMs != null) return state;
  if (state.type === 'unilateral' && state.arm === 'right') {
    state.arm = 'left';
    return state;
  }
  const set = state.sets[state.setIndex];
  set.elapsedSec = Math.max(0, Math.round((nowMs - state.setStartMs) / 1000));
  if (state.setIndex >= state.day.sets - 1) return finish(state, nowMs);
  state.setIndex += 1;
  state.arm = state.type === 'unilateral' ? 'right' : null;
  state.phase = 'rest';
  state.restEndMs = nowMs + state.day.restSec * 1000;
  state.setStartMs = state.restEndMs; // next set starts when rest ends
  return state;
}

export function skipRest(state, nowMs) {
  if (state.phase === 'rest') {
    state.phase = 'work';
    state.restEndMs = null;
    state.setStartMs = state.pausedAtMs ?? nowMs;
  }
  return state;
}

export function skipSet(state, nowMs) {
  sync(state, nowMs);
  if (state.type === 'emom') {
    // Jump the anchor so the next round boundary is now.
    const now = state.pausedAtMs ?? nowMs;
    const ivl = state.day.intervalSec * 1000;
    const el = now - state.anchorMs;
    if (el < state.day.sets * ivl) state.anchorMs -= ivl - (el % ivl);
    return state;
  }
  if (state.type === 'straight' || state.type === 'unilateral') {
    const set = state.sets[state.setIndex];
    set.actualReps = 0;
    if ('actualRepsLeft' in set) set.actualRepsLeft = 0;
    set.elapsedSec = 0;
    if (state.setIndex >= state.day.sets - 1) return finish(state, nowMs);
    state.setIndex += 1;
    state.arm = state.type === 'unilateral' ? 'right' : null;
    state.phase = 'work';
    state.restEndMs = null;
    state.setStartMs = state.pausedAtMs ?? nowMs;
  }
  return state;
}

export function adjustReps(state, setIndex, delta, arm = 'right') {
  const set = state.sets[setIndex];
  if (!set) return state;
  if (arm === 'left') set.actualRepsLeft = Math.max(0, (set.actualRepsLeft || 0) + delta);
  else set.actualReps = Math.max(0, (set.actualReps || 0) + delta);
  return state;
}

// forTime tally. arm is 'right' (default) or 'left' for unilateralForTime.
export function addRep(state, n, arm = 'right') {
  if (arm === 'left') state.tallyLeft = Math.max(0, state.tallyLeft + n);
  else state.tally = Math.max(0, state.tally + n);
  return state;
}

export function endEarly(state, nowMs) {
  state.endedEarly = true;
  if (state.type === 'emom') {
    const v = derive(state, nowMs);
    const completedRounds = Math.min(v.setIndex, state.day.sets);
    state.sets = state.sets.slice(0, completedRounds);
    for (const s of state.sets) if (s.elapsedSec == null) s.elapsedSec = state.day.intervalSec;
  } else if (state.type === 'straight' || state.type === 'unilateral') {
    state.sets = state.sets.filter((s) => s.elapsedSec != null);
  }
  return finish(state, nowMs);
}

export function finish(state, nowMs) {
  if (state.phase === 'done') return state;
  const now = state.pausedAtMs ?? nowMs;
  state.pausedAtMs = null;
  state.phase = 'done';
  const d = state.day;
  if (state.type === 'emom') {
    const totalMs = d.sets * d.intervalSec * 1000;
    state.completedAtMs = Math.min(now, state.anchorMs + totalMs);
    if (!state.endedEarly) {
      for (const s of state.sets) if (s.elapsedSec == null) s.elapsedSec = d.intervalSec;
    }
  } else {
    state.completedAtMs = now;
  }
  const elapsedSec = Math.max(0, Math.round((state.completedAtMs - state.anchorMs) / 1000));
  if (state.type === 'forTime') {
    state.sets = [{ index: 0, prescribedReps: d.targetReps, actualReps: state.tally, weightLb: d.weightLb, elapsedSec }];
  } else if (state.type === 'unilateralForTime') {
    state.sets = [{ index: 0, prescribedReps: d.targetRepsPerArm, actualReps: state.tally, actualRepsLeft: state.tallyLeft, weightLb: d.weightLb, elapsedSec }];
  }
  return state;
}

export function totalReps(state) {
  return state.sets.reduce((t, s) => t + (s.actualReps || 0) + (s.actualRepsLeft || 0), 0);
}

export function toLog(state, extras = {}) {
  const d = state.day;
  return {
    id: state.id,
    programVersion: state.programVersion,
    week: state.week,
    dayId: state.dayId,
    type: state.type,
    label: d.label,
    startedAt: state.startedAt,
    completedAt: state.completedAtMs ? new Date(state.completedAtMs).toISOString() : null,
    prescribed: {
      sets: d.sets ?? 1,
      reps: d.reps ?? d.repsPerArm ?? d.targetReps ?? d.targetRepsPerArm ?? 0,
      weightLb: d.weightLb ?? null,
    },
    sets: state.sets,
    totalReps: totalReps(state),
    durationSec: state.completedAtMs ? Math.max(0, Math.round((state.completedAtMs - state.anchorMs) / 1000)) : null,
    endedEarly: state.endedEarly,
    rpe: extras.rpe ?? null,
    backFlag: !!extras.backFlag,
    formFlag: !!extras.formFlag,
    notes: extras.notes || '',
  };
}
