import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './timer.js';

const PROG = { version: 1 };
const T0 = 1_000_000_000;

const EMOM = { id: 'mon', label: 'Mon', type: 'emom', sets: 8, reps: 10, intervalSec: 60, weightLb: 40 };
const STRAIGHT = { id: 'wed', label: 'Wed', type: 'straight', sets: 5, reps: 15, restSec: 75, weightLb: 40 };
const UNI = { id: 'fri', label: 'Fri', type: 'unilateral', sets: 4, repsPerArm: 6, restSec: 75, weightLb: 20 };
const FT = { id: 'mon', label: 'Test', type: 'forTime', targetReps: 150, weightLb: 40 };

test('EMOM runs 8 rounds on exact 60s boundaries and finishes at 8:00', () => {
  const s = T.createSession(PROG, 1, EMOM, T0);
  let v = T.derive(s, T0);
  assert.equal(v.round, 1);
  assert.equal(v.remainingSec, 60);

  v = T.derive(s, T0 + 59_000);
  assert.equal(v.round, 1);
  assert.equal(v.remainingSec, 1);

  v = T.derive(s, T0 + 60_000);
  assert.equal(v.round, 2);
  assert.equal(v.remainingSec, 60);

  v = T.derive(s, T0 + 7 * 60_000 + 30_000);
  assert.equal(v.round, 8);

  v = T.derive(s, T0 + 479_999);
  assert.equal(v.done, false);

  v = T.derive(s, T0 + 480_000);
  assert.equal(v.done, true);
  assert.equal(v.elapsedSec, 480); // 8:00 exactly

  // Finish long after the fact still records 8:00, not wall-clock overshoot.
  T.finish(s, T0 + 900_000);
  assert.equal(Math.round((s.completedAtMs - s.anchorMs) / 1000), 480);
  assert.equal(T.totalReps(s), 80);
});

test('backgrounding mid-EMOM: derive at any later timestamp lands on the correct round', () => {
  const s = T.createSession(PROG, 1, EMOM, T0);
  // "away for 2:05" — no ticks happened in between
  const v = T.derive(s, T0 + 125_000);
  assert.equal(v.round, 3);
  assert.equal(v.remainingSec, 55);
});

test('pause freezes the anchor; resume shifts it so no time is lost', () => {
  const s = T.createSession(PROG, 1, EMOM, T0);
  T.pause(s, T0 + 30_000);
  // While paused, derived state does not advance.
  let v = T.derive(s, T0 + 90_000);
  assert.equal(v.round, 1);
  assert.equal(v.remainingSec, 30);
  T.resume(s, T0 + 90_000);
  v = T.derive(s, T0 + 90_000);
  assert.equal(v.round, 1);
  assert.equal(v.remainingSec, 30);
  // Session end moves out by the paused 60s.
  v = T.derive(s, T0 + 480_000 + 60_000);
  assert.equal(v.done, true);
});

test('straight day: set complete starts rest countdown, then flips to next set', () => {
  const s = T.createSession(PROG, 1, STRAIGHT, T0);
  T.completeTap(s, T0 + 40_000);
  assert.equal(s.phase, 'rest');
  assert.equal(s.setIndex, 1);
  assert.equal(s.sets[0].elapsedSec, 40);

  let v = T.derive(s, T0 + 70_000);
  assert.equal(v.phase, 'rest');
  assert.equal(v.remainingSec, 45);

  T.sync(s, T0 + 40_000 + 75_000);
  assert.equal(s.phase, 'work');
  v = T.derive(s, T0 + 40_000 + 75_000 + 5_000);
  assert.equal(v.setElapsedSec, 5);
});

test('logging 8 on a prescribed 10 reflects in totals; history keeps both numbers', () => {
  const s = T.createSession(PROG, 1, EMOM, T0);
  assert.equal(s.sets[0].actualReps, 10); // defaults to prescription
  T.adjustReps(s, 0, -2);
  assert.equal(s.sets[0].actualReps, 8);
  assert.equal(s.sets[0].prescribedReps, 10);
  T.finish(s, T0 + 480_000);
  assert.equal(T.totalReps(s), 78);
  const log = T.toLog(s, {});
  assert.equal(log.totalReps, 78);
  assert.equal(log.sets[0].prescribedReps, 10);
  assert.equal(log.sets[0].actualReps, 8);
});

test('unilateral: right arm then left arm completes one set; arms logged separately', () => {
  const s = T.createSession(PROG, 1, UNI, T0);
  assert.equal(s.arm, 'right');
  T.completeTap(s, T0 + 20_000);
  assert.equal(s.arm, 'left');
  assert.equal(s.setIndex, 0);
  T.adjustReps(s, 0, -1, 'left');
  T.completeTap(s, T0 + 45_000);
  assert.equal(s.phase, 'rest');
  assert.equal(s.setIndex, 1);
  assert.equal(s.arm, 'right');
  assert.equal(s.sets[0].actualReps, 6);
  assert.equal(s.sets[0].actualRepsLeft, 5);
});

test('forTime: done when the tally hits target; aggregate set logged', () => {
  const s = T.createSession(PROG, 12, FT, T0);
  T.addRep(s, 149);
  let v = T.derive(s, T0 + 300_000);
  assert.equal(v.done, false);
  T.addRep(s, 1);
  v = T.derive(s, T0 + 305_000);
  assert.equal(v.done, true);
  T.finish(s, T0 + 305_000);
  assert.equal(s.sets.length, 1);
  assert.equal(s.sets[0].actualReps, 150);
  assert.equal(s.sets[0].elapsedSec, 305);
});

test('end early saves only what was completed', () => {
  const s = T.createSession(PROG, 1, EMOM, T0);
  // 3 full rounds done, partway through round 4
  T.endEarly(s, T0 + 3 * 60_000 + 20_000);
  assert.equal(s.sets.length, 3);
  assert.equal(T.totalReps(s), 30);
  assert.equal(s.endedEarly, true);
  assert.equal(s.phase, 'done');
});

test('EMOM skip jumps to the next round boundary', () => {
  const s = T.createSession(PROG, 1, EMOM, T0);
  T.skipSet(s, T0 + 10_000);
  const v = T.derive(s, T0 + 10_000);
  assert.equal(v.round, 2);
  assert.equal(v.remainingSec, 60);
});

test('session state survives serialization (kill & restore)', () => {
  const s = T.createSession(PROG, 1, STRAIGHT, T0);
  T.completeTap(s, T0 + 40_000);
  const restored = JSON.parse(JSON.stringify(s));
  const v = T.derive(restored, T0 + 70_000);
  assert.equal(v.phase, 'rest');
  assert.equal(v.remainingSec, 45);
  // Rest long over by the time the app reopens → next set, in work phase.
  T.sync(restored, T0 + 200_000);
  assert.equal(restored.phase, 'work');
  assert.equal(restored.setIndex, 1);
});
