// Pure functions: progression, weekly volume, deload, trends. No DOM, no storage.
import { MUSCLES } from './data.js';

const DAY = 864e5;

// Epley estimate. Good enough for a trend line; not a max attempt.
export function e1rm(weight, reps) {
  if (!(reps >= 1)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

export function jumpFor(ex, settings) {
  const j = ex.jump === 'lower' ? settings.jumpLower : settings.jumpUpper;
  return Number(j) || 0;
}

export function fmtLoad(weight, ex, units, forTarget = false) {
  if (weight == null || weight === '') return forTarget ? 'pick a weight' : '—';
  const w = Number(weight);
  const n = Number.isInteger(w) ? w : +w.toFixed(1);
  if (ex && ex.kind === 'bodyweight') return n === 0 ? 'BW' : `BW+${n}`;
  return `${n} ${units}`;
}

export function finishedSessions(sessions) {
  return sessions.filter(s => s.finishedAt).sort((a, b) => b.startedAt - a.startedAt);
}

export function setsFor(session, exId) {
  return session.sets.filter(s => s.exerciseId === exId && s.reps >= 1).sort((a, b) => a.n - b.n);
}

// Most recent `count` finished sessions that contain this exercise, newest first.
export function lastSessionsWith(sessions, exId, count = 2) {
  const out = [];
  for (const s of finishedSessions(sessions)) {
    const sets = setsFor(s, exId);
    if (sets.length) {
      out.push({ session: s, sets });
      if (out.length >= count) break;
    }
  }
  return out;
}

// The weight used for most sets; ties go to the heavier one.
export function workingWeight(sets) {
  const counts = new Map();
  for (const s of sets) counts.set(s.weight, (counts.get(s.weight) || 0) + 1);
  let best = null;
  for (const [w, c] of counts) {
    if (!best || c > best.c || (c === best.c && w > best.w)) best = { w, c };
  }
  return best ? best.w : 0;
}

export function summarize(sets, ex, units) {
  if (!sets.length) return '';
  const w = workingWeight(sets);
  const same = sets.every(s => s.weight === w);
  const body = same
    ? `${fmtLoad(w, ex, units)} × ${sets.map(s => s.reps).join(',')}`
    : sets.map(s => `${fmtLoad(s.weight, ex, units)}×${s.reps}`).join(', ');
  const rirs = sets.map(s => s.rir).filter(r => r != null);
  if (!rirs.length) return body;
  const lo = Math.min(...rirs), hi = Math.max(...rirs);
  return `${body} @ ${lo === hi ? lo : lo + '–' + hi} RIR`;
}

function missedFloor(sets, lo) {
  return sets.some(s => s.reps < lo && (s.rir == null || s.rir <= 1));
}

// Double progression.
//   up:   every working set reached the ceiling -> add one jump.
//   down: under the floor at 0-1 RIR two sessions running -> drop one jump.
//   hold: under the floor once -> same weight.
//   same: otherwise -> same weight, aim for one more rep per set.
export function prescribe(ex, item, sessions, settings, opts = {}) {
  const [lo, hi] = item.repRange || ex.repRange;
  const jump = jumpFor(ex, settings);
  const sets = opts.deload ? Math.max(1, Math.ceil(item.sets / 2)) : item.sets;
  const fill = v => Array.from({ length: sets }, () => v);
  const base = { lo, hi, sets, last: null };
  const hist = lastSessionsWith(sessions, ex.id, 2);
  const u = settings.units;

  if (!hist.length) {
    const bw = ex.kind === 'bodyweight';
    return {
      ...base,
      weight: bw ? 0 : null,
      targets: fill(lo),
      change: 'start',
      reason: bw
        ? `First session: bodyweight. Load gets added once every set reaches ${hi}.`
        : `First session: pick a weight you can lift ${hi} times with about 2 reps in reserve.`,
    };
  }

  const w = workingWeight(hist[0].sets);
  const work = hist[0].sets.filter(s => s.weight === w);
  const last = { weight: w, sets: work, date: hist[0].session.date };

  if (opts.deload) {
    return { ...base, weight: w, targets: fill(lo), change: 'deload', last,
      reason: `Deload: ${sets} ${sets === 1 ? 'set' : 'sets'} at the usual weight, stop around 4 RIR.` };
  }

  const allTop = work.every(s => s.reps >= hi);
  const missed = missedFloor(work, lo);
  let prevMissed = false;
  if (hist[1]) {
    const pw = workingWeight(hist[1].sets);
    prevMissed = pw >= w && missedFloor(hist[1].sets.filter(s => s.weight === pw), lo);
  }

  if (allTop) {
    return { ...base, weight: w + jump, targets: fill(lo), change: 'up', last,
      reason: `Every set reached ${hi} last time. Add ${jump} ${u}.` };
  }
  if (missed && prevMissed) {
    return { ...base, weight: Math.max(0, w - jump), targets: fill(lo), change: 'down', last,
      reason: `Under ${lo} reps two sessions running. Drop ${jump} ${u} and rebuild.` };
  }
  if (missed) {
    const targets = Array.from({ length: sets }, (_, i) => (work[i] ? Math.max(work[i].reps, lo) : lo));
    return { ...base, weight: w, targets, change: 'hold', last,
      reason: `A set fell under ${lo} last time. Same weight, try again.` };
  }
  const targets = Array.from({ length: sets }, (_, i) => (work[i] ? Math.min(hi, work[i].reps + 1) : lo));
  return { ...base, weight: w, targets, change: 'same', last,
    reason: `Same weight. Beat a rep where you can; load goes up when every set reaches ${hi}.` };
}

// Hard sets (RIR 3 or less, or RIR not logged) per muscle over the last 7 days.
// Primary muscles count 1, secondary count 0.5. `days` = distinct dates with primary work.
export function weeklyVolume(sessions, exercises, now = Date.now()) {
  const since = now - 7 * DAY;
  const ex = Object.fromEntries(exercises.map(e => [e.id, e]));
  const acc = Object.fromEntries(MUSCLES.map(m => [m, { hard: 0, days: new Set() }]));
  for (const s of sessions) {
    for (const set of s.sets) {
      if (!(set.ts >= since) || !(set.reps >= 1)) continue;
      if (set.rir != null && set.rir > 3) continue;
      const e = ex[set.exerciseId];
      if (!e) continue;
      for (const m of e.primary || []) if (acc[m]) { acc[m].hard += 1; acc[m].days.add(s.date); }
      for (const m of e.secondary || []) if (acc[m]) acc[m].hard += 0.5;
    }
  }
  return MUSCLES.map(m => ({ muscle: m, hard: acc[m].hard, days: acc[m].days.size }));
}

export function bodyweightFor(settings) {
  const bw = Number(settings.bodyweight);
  if (bw > 0) return bw;
  return settings.units === 'kg' ? 77 : 170; // assumption until set in Settings
}

// Best set of a session as an estimated 1RM. Bodyweight lifts include bodyweight.
export function sessionScore(sets, ex, settings) {
  let best = null;
  for (const s of sets) {
    const load = ex.kind === 'bodyweight' ? bodyweightFor(settings) + s.weight : s.weight;
    const score = e1rm(load, s.reps);
    if (!best || score > best.score) best = { score, weight: s.weight, reps: s.reps };
  }
  return best;
}

export function trendFor(ex, sessions, settings, limit = 12) {
  const out = [];
  for (const s of finishedSessions(sessions)) {
    const sets = setsFor(s, ex.id);
    if (!sets.length) continue;
    const b = sessionScore(sets, ex, settings);
    out.push({ date: s.date, score: Math.round(b.score), weight: b.weight, reps: b.reps });
    if (out.length >= limit) break;
  }
  return out.reverse();
}

// Monday of the ISO date's week, as YYYY-MM-DD.
export function weekKey(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const o = d.getTimezoneOffset() * 60000;
  return new Date(d - o).toISOString().slice(0, 10);
}

export function regressingExercises(sessions, exercises, settings) {
  const out = [];
  for (const ex of exercises) {
    const hist = lastSessionsWith(sessions, ex.id, 3);
    if (hist.length < 3) continue;
    const [a, b, c] = hist.map(h => sessionScore(h.sets, ex, settings).score);
    if (a < b && b < c) out.push(ex);
  }
  return out;
}

export function deloadStatus(sessions, exercises, settings, now = Date.now()) {
  if (settings.deloadUntil && now < settings.deloadUntil) {
    return { active: true, until: settings.deloadUntil, suggest: false, reason: '' };
  }
  const fin = finishedSessions(sessions).filter(s => !settings.lastDeloadEnd || s.startedAt > settings.lastDeloadEnd);
  const weeks = new Set(fin.map(s => weekKey(s.date))).size;
  const every = Number(settings.deloadEveryWeeks) || 5;
  const regress = regressingExercises(sessions, exercises, settings);
  const reasons = [];
  if (weeks >= every) reasons.push(`${weeks} training weeks since the last deload`);
  if (regress.length >= 2) reasons.push(`${regress.map(e => e.name).join(' and ')} have slipped two sessions running`);
  return { active: false, until: null, suggest: reasons.length > 0, reason: reasons.length ? reasons.join('; ') + '.' : '', weeks, regress };
}
