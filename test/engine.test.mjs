import test from 'node:test';
import assert from 'node:assert/strict';
import { prescribe, weeklyVolume, deloadStatus, workingWeight, trendFor } from '../js/engine.js';
import { SEED_EXERCISES, DEFAULT_SETTINGS } from '../js/data.js';

const ex = Object.fromEntries(SEED_EXERCISES.map(e => [e.id, e]));
const S = { ...DEFAULT_SETTINGS };
const DAY = 864e5;
let idc = 0;
// sets: [[exerciseId, weight, reps, rir], ...]
function session(daysAgo, sets, finished = true) {
  const startedAt = Date.now() - daysAgo * DAY;
  const date = new Date(startedAt).toISOString().slice(0, 10);
  const byEx = {};
  return {
    id: 's' + (++idc), date, startedAt, finishedAt: finished ? startedAt + 3e6 : null, dayIndex: 0, dayName: 'A', notes: '',
    sets: sets.map(([exerciseId, weight, reps, rir]) => ({ exerciseId, n: (byEx[exerciseId] = (byEx[exerciseId] || 0) + 1), weight, reps, rir, ts: startedAt + 1000 })),
  };
}
const item = (exerciseId, sets = 3) => ({ exerciseId, sets });

test('no history: weighted asks for a weight, bodyweight starts at 0', () => {
  const a = prescribe(ex.zercher, item('zercher'), [], S);
  assert.equal(a.change, 'start'); assert.equal(a.weight, null); assert.deepEqual(a.targets, [5, 5, 5]);
  const b = prescribe(ex.dip, item('dip'), [], S);
  assert.equal(b.weight, 0); assert.equal(b.change, 'start');
});

test('dips: every set at 6 -> add 5 lb', () => {
  const hist = [session(2, [['dip', 0, 6, 1], ['dip', 0, 6, 1], ['dip', 0, 6, 0]])];
  const p = prescribe(ex.dip, item('dip'), hist, S);
  assert.equal(p.change, 'up'); assert.equal(p.weight, 5); assert.deepEqual(p.targets, [3, 3, 3]);
});

test('dips: 6,5,4 -> same load, one more rep per set, capped at ceiling', () => {
  const hist = [session(2, [['dip', 0, 6, 1], ['dip', 0, 5, 1], ['dip', 0, 4, 0]])];
  const p = prescribe(ex.dip, item('dip'), hist, S);
  assert.equal(p.change, 'same'); assert.equal(p.weight, 0); assert.deepEqual(p.targets, [6, 6, 5]);
});

test('under the floor once -> hold; twice -> drop a jump (never below 0 added)', () => {
  const once = [session(2, [['dip', 5, 2, 0], ['dip', 5, 2, 0], ['dip', 5, 2, 0]])];
  assert.equal(prescribe(ex.dip, item('dip'), once, S).change, 'hold');
  const twice = [...once, session(5, [['dip', 5, 2, 0], ['dip', 5, 2, 0], ['dip', 5, 2, 0]])];
  const p = prescribe(ex.dip, item('dip'), twice, S);
  assert.equal(p.change, 'down'); assert.equal(p.weight, 0);
});

test('a miss right after a weight increase is a hold, not a drop', () => {
  const hist = [
    session(2, [['zercher', 145, 4, 0], ['zercher', 145, 4, 0], ['zercher', 145, 3, 0]]),
    session(5, [['zercher', 135, 4, 0], ['zercher', 135, 4, 0], ['zercher', 135, 4, 0]]),
  ];
  assert.equal(prescribe(ex.zercher, item('zercher'), hist, S).change, 'hold');
});

test('barbell: lower-body jump is 10', () => {
  const hist = [session(2, [['zercher', 135, 8, 2], ['zercher', 135, 8, 2], ['zercher', 135, 8, 1]])];
  const p = prescribe(ex.zercher, item('zercher'), hist, S);
  assert.equal(p.weight, 145); assert.equal(p.change, 'up');
});

test('high-RIR sets at the ceiling still trigger the add', () => {
  const hist = [session(2, [['pullup', 0, 6, 3], ['pullup', 0, 6, 4], ['pullup', 0, 7, 3]])];
  assert.equal(prescribe(ex.pullup, item('pullup'), hist, S).change, 'up');
});

test('deload halves the sets and keeps the weight', () => {
  const hist = [session(2, [['row', 95, 10, 1], ['row', 95, 10, 1], ['row', 95, 10, 1]])];
  const p = prescribe(ex.row, item('row'), hist, S, { deload: true });
  assert.equal(p.change, 'deload'); assert.equal(p.sets, 2); assert.equal(p.weight, 95);
});

test('working weight: most common wins, ties go heavier', () => {
  assert.equal(workingWeight([{ weight: 95 }, { weight: 135 }, { weight: 135 }]), 135);
  assert.equal(workingWeight([{ weight: 95 }, { weight: 135 }]), 135);
});

test('weekly volume counts primary 1, secondary 0.5, only last 7 days, RIR <= 3', () => {
  const s = [
    session(1, [['dip', 0, 6, 2], ['dip', 0, 6, 2], ['dip', 0, 5, 4]]), // third set too easy
    session(10, [['dip', 0, 6, 1]]),                                   // too old
  ];
  const v = Object.fromEntries(weeklyVolume(s, SEED_EXERCISES).map(r => [r.muscle, r]));
  assert.equal(v.chest.hard, 2); assert.equal(v.triceps.hard, 2); assert.equal(v.shoulders.hard, 1);
  assert.equal(v.chest.days, 1); assert.equal(v.quads.hard, 0);
});

test('deload suggested after N training weeks, active while deloadUntil is in the future', () => {
  const s = [0, 7, 14, 21, 28].map(d => session(d + 1, [['row', 95, 8, 2]]));
  const st = deloadStatus(s, SEED_EXERCISES, S);
  assert.equal(st.suggest, true); assert.match(st.reason, /5 training weeks/);
  assert.equal(deloadStatus(s, SEED_EXERCISES, S, Date.now() - 1).suggest, true);
  const active = deloadStatus(s, SEED_EXERCISES, { ...S, deloadUntil: Date.now() + DAY }).active;
  assert.equal(active, true);
  const after = deloadStatus(s, SEED_EXERCISES, { ...S, lastDeloadEnd: Date.now() });
  assert.equal(after.suggest, false);
});

test('deload suggested when two lifts regress two sessions running', () => {
  const s = [
    session(1, [['row', 95, 6, 0], ['dip', 0, 4, 0]]),
    session(4, [['row', 95, 8, 0], ['dip', 0, 5, 0]]),
    session(7, [['row', 95, 10, 0], ['dip', 0, 6, 0]]),
  ];
  const st = deloadStatus(s, SEED_EXERCISES, S);
  assert.equal(st.suggest, true); assert.match(st.reason, /slipped/);
});

test('trend is oldest-first and uses bodyweight for dips', () => {
  const s = [session(1, [['dip', 10, 5, 1]]), session(4, [['dip', 0, 6, 1]])];
  const t = trendFor(ex.dip, s, { ...S, bodyweight: 180 });
  assert.equal(t.length, 2); assert.ok(t[0].date < t[1].date);
  assert.equal(t[1].score, Math.round(190 * (1 + 5 / 30)));
});
