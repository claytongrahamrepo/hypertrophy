// UI and state. Rendering is innerHTML per tab with delegated events.
import { MUSCLES, SEED_EXERCISES, DEFAULT_PLAN, DEFAULT_SETTINGS } from './data.js';
import * as db from './db.js';
import { prescribe, weeklyVolume, deloadStatus, trendFor, finishedSessions, fmtLoad, summarize, jumpFor } from './engine.js';

const DAY = 864e5;
const state = {
  settings: null, plan: null, exercises: [], sessions: [], current: null,
  tab: 'today', drafts: {}, editing: {}, extra: {},
  ui: { dayIndex: null, expanded: {}, trendEx: null, trendPoints: [], trendExObj: null, editTarget: null },
  timer: null, timerInt: null, notesT: null,
};
let audioCtx = null;

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = (d = new Date()) => { const o = d.getTimezoneOffset() * 60000; return new Date(d - o).toISOString().slice(0, 10); };
const exMap = () => Object.fromEntries(state.exercises.map(e => [e.id, e]));
const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
const shortDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const fmtNum = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ---------- boot ----------
async function boot() {
  const [settings, plan, exercises, sessions] = await Promise.all([
    db.kvGet('settings'), db.kvGet('plan'), db.getAll('exercises'), db.getAll('sessions'),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.plan = plan || structuredClone(DEFAULT_PLAN);
  if (!exercises || !exercises.length) {
    state.exercises = structuredClone(SEED_EXERCISES);
    for (const e of state.exercises) await db.put('exercises', e);
  } else {
    state.exercises = exercises;
  }
  state.sessions = sessions || [];
  if (!settings) await db.kvPut('settings', state.settings);
  if (!plan) await db.kvPut('plan', state.plan);
  const open = state.sessions.filter(s => !s.finishedAt).sort((a, b) => b.startedAt - a.startedAt);
  state.current = open[0] || null;

  buildMuscleBoxes();
  bind();
  render();

  try { navigator.storage?.persist?.(); } catch {}
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function buildMuscleBoxes() {
  const box = name => MUSCLES.map(m => `<label><input type="checkbox" name="${name}" value="${m}"> ${m}</label>`).join('');
  $('#ex-primary').innerHTML = box('primary');
  $('#ex-secondary').innerHTML = box('secondary');
}

function bind() {
  $('.tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    render();
    window.scrollTo(0, 0);
  });
  const view = $('#view');
  view.addEventListener('click', onClick);
  view.addEventListener('input', onInput);
  view.addEventListener('change', onChange);
  $('#timer').addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (!a || !state.timer) return;
    if (a.dataset.action === 'timer-add') { state.timer.endAt += 30000; state.timer.fired = false; tickTimer(); }
    else stopTimer();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tickTimer(); });
  $('#setdlg').addEventListener('close', onSetDialogClose);
  $('#exdlg').addEventListener('close', onExDialogClose);
}

// ---------- render ----------
function render() {
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  const views = { today: renderToday, history: renderHistory, volume: renderVolume, plan: renderPlan, settings: renderSettings };
  $('#view').innerHTML = views[state.tab]();
  if (state.tab === 'volume') attachChart();
}

function currentDayIndex() {
  if (state.current) return state.current.dayIndex;
  const n = state.plan.days.length;
  if (!n) return 0;
  const i = state.ui.dayIndex ?? state.plan.nextDay ?? 0;
  return ((i % n) + n) % n;
}

function groupItems(items) {
  const groups = [];
  let g = [];
  items.forEach((item, idx) => {
    g.push({ item, idx });
    if (!item.pairNext || idx === items.length - 1) { groups.push(g); g = []; }
  });
  if (g.length) groups.push(g);
  return groups;
}

function renderToday() {
  const days = state.plan.days;
  if (!days.length) return `<section class="card"><p>No training days in the plan. Add one on the Plan tab.</p></section>`;
  const di = currentDayIndex();
  const day = days[di];
  const cur = state.current;
  const ex = exMap();
  const S = state.settings;
  const dl = deloadStatus(state.sessions, state.exercises, S, Date.now());
  let html = '<section class="dayhead">';
  if (cur) {
    html += `<h2>Day ${esc(day.name)}</h2><p class="sub">Started ${fmtTime(cur.startedAt)} · ${cur.sets.length} ${cur.sets.length === 1 ? 'set' : 'sets'} logged</p>`;
  } else {
    html += `<label class="sub">Next up
      <select data-action="pick-day">${days.map((d, i) => `<option value="${i}" ${i === di ? 'selected' : ''}>Day ${esc(d.name)}</option>`).join('')}</select>
    </label>`;
  }
  html += '</section>';

  if (dl.active) {
    html += `<section class="banner"><strong>Deload week</strong> through ${fmtDate(todayISO(new Date(dl.until)))}: half the sets, stop around 4 RIR.
      <button class="link" data-action="end-deload">End early</button></section>`;
  } else if (dl.suggest && !(S.deloadDismissedAt && Date.now() - S.deloadDismissedAt < 7 * DAY)) {
    html += `<section class="banner"><strong>Deload suggested.</strong> ${esc(dl.reason)}
      <div class="row"><button class="btn small" data-action="start-deload">Start deload week</button><button class="btn small ghost" data-action="dismiss-deload">Not now</button></div></section>`;
  }

  for (const g of groupItems(day.items)) {
    const inner = g.map(({ item }) => renderExerciseCard(item, ex[item.exerciseId], dl.active)).join('');
    html += g.length > 1
      ? `<section class="superset"><div class="sslabel">Superset · alternate, rest ${S.restPair}s between</div>${inner}</section>`
      : inner;
  }

  html += `<section class="card"><label class="sub">Notes
    <textarea data-action="notes" rows="2" placeholder="Sleep, pain, anything worth remembering">${esc(cur?.notes || '')}</textarea></label></section>`;
  if (cur) {
    html += `<section class="actions"><button class="btn primary big" data-action="finish">Finish session</button>
      <button class="btn ghost" data-action="discard">Discard session</button></section>`;
  }
  return html;
}

function renderExerciseCard(item, ex, deload) {
  if (!ex) return `<section class="card"><p>Unknown exercise "${esc(item.exerciseId)}". Fix it on the Plan tab.</p></section>`;
  const S = state.settings;
  const cur = state.current;
  const p = prescribe(ex, item, state.sessions, S, { deload });
  const logged = cur ? cur.sets.filter(s => s.exerciseId === ex.id) : [];
  const rows = Math.max(p.sets, logged.length ? Math.max(...logged.map(s => s.n)) : 0, state.extra[ex.id] || 0);
  let rowsHtml = '';
  for (let n = 1; n <= rows; n++) {
    const key = ex.id + ':' + n;
    const set = logged.find(s => s.n === n);
    if (set && !state.editing[key]) {
      rowsHtml += `<button class="setrow done" data-action="edit-set" data-key="${key}" aria-label="edit set ${n}">
        <span class="n">${n}</span><span class="val">${esc(fmtLoad(set.weight, ex, S.units))} × ${set.reps}</span>
        <span class="rir">${set.rir == null ? 'RIR ?' : 'RIR ' + (set.rir === 4 ? '4+' : set.rir)}</span><span class="chk">✓</span></button>`;
      continue;
    }
    // Unlogged sets prefill from the last set logged this session, else the prescription.
    const prevLogged = logged.filter(s => s.n < n).sort((a, b) => b.n - a.n)[0];
    const defW = prevLogged ? prevLogged.weight : (p.weight ?? (ex.kind === 'bodyweight' ? 0 : ''));
    const d = state.drafts[key] || (state.drafts[key] = set
      ? { weight: set.weight, reps: set.reps, rir: set.rir }
      : { weight: defW, reps: p.targets[n - 1] ?? p.lo, rir: null });
    rowsHtml += `<div class="setrow" data-key="${key}">
      <span class="n">${n}</span>
      <div class="stepper w"><button data-action="step" data-field="weight" data-delta="-1" aria-label="less weight">−</button><input data-field="weight" inputmode="decimal" value="${esc(d.weight)}" aria-label="${ex.kind === 'bodyweight' ? 'added weight' : 'weight'}" placeholder="${ex.kind === 'bodyweight' ? '+' : S.units}"><button data-action="step" data-field="weight" data-delta="1" aria-label="more weight">+</button></div>
      <div class="stepper r"><button data-action="step" data-field="reps" data-delta="-1" aria-label="fewer reps">−</button><input data-field="reps" inputmode="numeric" value="${esc(d.reps)}" aria-label="reps" placeholder="reps"><button data-action="step" data-field="reps" data-delta="1" aria-label="more reps">+</button></div>
      <div class="rirrow"><span class="lbl">RIR</span>${[0, 1, 2, 3, 4].map(r => `<button data-action="rir" data-val="${r}" aria-pressed="${d.rir === r}">${r === 4 ? '4+' : r}</button>`).join('')}<button class="log" data-action="log" aria-label="log set ${n}">✓</button></div>
    </div>`;
  }
  const last = p.last ? `Last (${shortDate(p.last.date)}): ${summarize(p.last.sets, ex, S.units)}` : '';
  return `<section class="card ex" data-ex="${ex.id}">
    <div class="exhead"><h3>${esc(ex.name)}</h3><span class="target">${esc(fmtLoad(p.weight, ex, S.units, true))} × ${p.lo}–${p.hi}</span></div>
    <p class="why ${p.change}">${esc(p.reason)}</p>
    ${last ? `<p class="sub">${esc(last)}</p>` : ''}
    ${rowsHtml}
    <button class="link" data-action="add-set" data-ex="${ex.id}">+ set</button>
  </section>`;
}

function renderHistory() {
  const list = finishedSessions(state.sessions);
  if (!list.length) return `<section class="card"><p>No finished sessions yet.</p></section>`;
  const ex = exMap();
  const S = state.settings;
  return list.slice(0, 100).map(s => {
    const open = state.ui.expanded[s.id];
    const byEx = [];
    for (const set of [...s.sets].sort((a, b) => a.ts - b.ts)) {
      let g = byEx.find(x => x.id === set.exerciseId);
      if (!g) { g = { id: set.exerciseId, sets: [] }; byEx.push(g); }
      g.sets.push(set);
    }
    const mins = Math.max(1, Math.round((s.finishedAt - s.startedAt) / 60000));
    const summary = byEx.map(g => {
      const e = ex[g.id];
      return `<div class="hline"><span>${esc(e ? e.name : g.id)}</span><span class="sub">${esc(summarize(g.sets, e, S.units))}</span></div>`;
    }).join('');
    let detail = '';
    if (open) {
      detail = byEx.map(g => {
        const e = ex[g.id];
        return `<div class="hgroup"><div class="sub">${esc(e ? e.name : g.id)}</div>${[...g.sets].sort((a, b) => a.n - b.n).map(set =>
          `<div class="hset"><span>Set ${set.n}</span><span>${esc(fmtLoad(set.weight, e, S.units))} × ${set.reps} · RIR ${set.rir ?? '?'}</span>
            <span><button class="link" data-action="hedit" data-sid="${s.id}" data-ex="${g.id}" data-n="${set.n}">Edit</button><button class="link danger" data-action="hdel" data-sid="${s.id}" data-ex="${g.id}" data-n="${set.n}">Delete</button></span></div>`).join('')}</div>`;
      }).join('');
      if (s.notes) detail += `<p class="sub">Notes: ${esc(s.notes)}</p>`;
      detail += `<button class="link danger" data-action="hdelsession" data-sid="${s.id}">Delete session</button>`;
    }
    return `<section class="card hist"><button class="hhead" data-action="toggle" data-sid="${s.id}" aria-expanded="${!!open}">
      <strong>${esc(fmtDate(s.date))}</strong><span class="sub">Day ${esc(s.dayName)} · ${mins} min · ${s.sets.length} sets</span></button>${summary}${detail}</section>`;
  }).join('');
}

function renderVolume() {
  const vol = weeklyVolume(state.sessions, state.exercises, Date.now());
  const rows = vol.map(v => {
    const pct = Math.min(v.hard, 25) / 25 * 100;
    const flag = v.hard === 0 ? 'none' : v.hard < 10 ? 'low' : v.hard > 20 ? 'high' : 'ok';
    const txt = { none: 'nothing logged', low: 'under 10', ok: 'in range', high: 'over 20' }[flag];
    const freq = v.hard > 0 && v.days < 2 ? ` · 1 day` : '';
    return `<div class="vrow"><span class="vm">${v.muscle}</span>
      <div class="vbar" role="img" aria-label="${fmtNum(v.hard)} hard sets"><div class="vfill" style="width:${pct}%"></div><span class="tick" style="left:40%"></span><span class="tick" style="left:80%"></span></div>
      <span class="vn">${fmtNum(v.hard)}</span><span class="vf ${flag}">${txt}${freq}</span></div>`;
  }).join('');
  const used = state.exercises.filter(e => state.sessions.some(s => s.finishedAt && s.sets.some(x => x.exerciseId === e.id)));
  const selId = state.ui.trendEx && used.some(e => e.id === state.ui.trendEx) ? state.ui.trendEx : (used[0]?.id || null);
  const selEx = selId ? exMap()[selId] : null;
  const trend = selEx ? trendFor(selEx, state.sessions, state.settings) : [];
  state.ui.trendPoints = trend;
  state.ui.trendExObj = selEx;
  const bwNote = selEx && selEx.kind === 'bodyweight'
    ? (Number(state.settings.bodyweight) > 0 ? ' Includes your bodyweight from Settings.' : ' Assumes 170 lb bodyweight until you set it in Settings.')
    : '';
  return `<section class="card"><h3>Hard sets, last 7 days</h3>
    <p class="sub">Sets at 3 RIR or less. Indirect work counts half. Ticks at 10 and 20. Rolling week, so it dips on rest days.</p>${rows}</section>
    <section class="card"><div class="exhead"><h3>Trend</h3>${used.length ? `<select data-action="trend-ex" aria-label="exercise">${used.map(e => `<option value="${e.id}" ${e.id === selId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>` : ''}</div>
    ${trend.length ? `<p class="sub">Estimated 1RM of the best set, last ${trend.length} sessions.${bwNote}</p>${chartSVG(trend)}${trendTable(trend, selEx)}` : '<p class="sub">Finish a session to see a trend.</p>'}</section>`;
}

function chartSVG(points) {
  const W = 320, H = 150, px = 36, py = 18, pb = 22;
  const n = points.length;
  const xs = points.map((_, i) => (n === 1 ? (W + px) / 2 : px + (W - px - 10) * i / (n - 1)));
  const vals = points.map(p => p.score);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += 10; lo -= 10; }
  const pad = (hi - lo) * 0.15;
  const y = v => py + (H - py - pb) * (1 - (v - (lo - pad)) / (hi - lo + 2 * pad));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const grid = [lo, hi].map(v => `<line class="grid" x1="${px}" x2="${W - 10}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${px - 5}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const lastP = points[n - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated one-rep max over ${n} sessions">
    ${grid}<path class="line" d="${path}"/>
    ${points.map((p, i) => `<circle class="dot" data-i="${i}" cx="${xs[i].toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="4"/>`).join('')}
    <text x="${xs[0].toFixed(1)}" y="${H - 6}" text-anchor="${n > 1 ? 'start' : 'middle'}">${shortDate(points[0].date)}</text>
    ${n > 1 ? `<text x="${xs[n - 1].toFixed(1)}" y="${H - 6}" text-anchor="end">${shortDate(lastP.date)}</text>` : ''}
    <text x="${xs[n - 1].toFixed(1)}" y="${(y(lastP.score) - 9).toFixed(1)}" text-anchor="end" font-weight="600">${lastP.score}</text>
  </svg><div class="tip" id="tip">Tap a point for the set behind it.</div>`;
}

function trendTable(points, ex) {
  const u = state.settings.units;
  return `<details><summary>Table</summary><table><tr><th>Date</th><th>Best set</th><th>Est. 1RM</th></tr>
    ${[...points].reverse().map(p => `<tr><td>${esc(shortDate(p.date))}</td><td>${esc(fmtLoad(p.weight, ex, u))} × ${p.reps}</td><td>${p.score}</td></tr>`).join('')}</table></details>`;
}

function attachChart() {
  const svg = $('.chart');
  if (!svg) return;
  svg.addEventListener('pointerdown', e => {
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 320;
    let best = 0, bd = Infinity;
    svg.querySelectorAll('.dot').forEach(c => {
      const d = Math.abs(+c.getAttribute('cx') - x);
      if (d < bd) { bd = d; best = +c.dataset.i; }
    });
    const p = state.ui.trendPoints[best];
    if (!p) return;
    $('#tip').textContent = `${fmtDate(p.date)}: best set ${fmtLoad(p.weight, state.ui.trendExObj, state.settings.units)} × ${p.reps}, est. 1RM ${p.score}`;
    svg.querySelectorAll('.dot').forEach(c => c.setAttribute('r', +c.dataset.i === best ? 6 : 4));
  });
}

function renderPlan() {
  const ex = exMap();
  const days = state.plan.days.map((d, di) => `<section class="card">
    <div class="exhead"><h3>Day ${esc(d.name)}</h3><span><button class="link" data-action="rename-day" data-day="${di}">Rename</button><button class="link danger" data-action="del-day" data-day="${di}">Delete</button></span></div>
    ${d.items.map((it, i) => {
      const e = ex[it.exerciseId];
      const rr = it.repRange || (e ? e.repRange : [0, 0]);
      return `<div class="pitem">
        <div class="prow1"><strong>${esc(e ? e.name : it.exerciseId)}</strong><span>
          <button class="link" data-action="move" data-day="${di}" data-idx="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="move up">↑</button>
          <button class="link" data-action="move" data-day="${di}" data-idx="${i}" data-dir="1" ${i === d.items.length - 1 ? 'disabled' : ''} aria-label="move down">↓</button>
          <button class="link danger" data-action="del-item" data-day="${di}" data-idx="${i}">Remove</button></span></div>
        <div class="prow2">
          <label>Sets <input data-plan="sets" data-day="${di}" data-idx="${i}" inputmode="numeric" value="${it.sets}"></label>
          <label>Reps <input data-plan="lo" data-day="${di}" data-idx="${i}" inputmode="numeric" value="${rr[0]}"> to <input data-plan="hi" data-day="${di}" data-idx="${i}" inputmode="numeric" value="${rr[1]}"></label>
          ${i < d.items.length - 1 ? `<label><input type="checkbox" data-plan="pairNext" data-day="${di}" data-idx="${i}" ${it.pairNext ? 'checked' : ''}> superset with next</label>` : ''}
        </div></div>`;
    }).join('')}
    <div class="row"><select data-sel="add-ex" data-day="${di}" aria-label="exercise to add">${state.exercises.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select><button class="btn small" data-action="add-item" data-day="${di}">Add</button></div>
  </section>`).join('');
  const lib = `<section class="card"><div class="exhead"><h3>Exercise library</h3><button class="btn small" data-action="new-ex">New</button></div>
    ${state.exercises.map(e => `<div class="lrow"><div><strong>${esc(e.name)}</strong>
      <div class="sub">${e.kind === 'bodyweight' ? 'bodyweight + load' : 'weighted'} · ${e.primary.join(', ')}${e.secondary.length ? ' · also ' + e.secondary.join(', ') : ''} · ${e.repRange[0]}–${e.repRange[1]} reps</div></div>
      <button class="link" data-action="edit-ex" data-ex="${e.id}">Edit</button></div>`).join('')}</section>`;
  return `<p class="sub pad">When every set reaches the rep ceiling, the next session adds load. Changes apply from the next session.</p>${days}
    <button class="btn ghost block" data-action="add-day">Add a day</button>${lib}`;
}

function renderSettings() {
  const S = state.settings;
  const sel = (name, val, opts) => `<select data-setting="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<section class="card"><h3>Loads</h3>
    <label>Units ${sel('units', S.units, [['lb', 'lb'], ['kg', 'kg']])}</label>
    <p class="sub">Changing units does not convert numbers already logged.</p>
    <label>Upper-body jump <input data-setting="jumpUpper" inputmode="decimal" value="${S.jumpUpper}"></label>
    <label>Lower-body jump <input data-setting="jumpLower" inputmode="decimal" value="${S.jumpLower}"></label>
    <label>Bodyweight, for dip and pull-up trends <input data-setting="bodyweight" inputmode="decimal" value="${S.bodyweight ?? ''}" placeholder="optional"></label>
  </section>
  <section class="card"><h3>Rest</h3>
    <label>Between barbell sets, seconds <input data-setting="restMain" inputmode="numeric" value="${S.restMain}"></label>
    <label>Inside a superset, seconds <input data-setting="restPair" inputmode="numeric" value="${S.restPair}"></label>
    <p class="sub">The timer beeps only while the app is on screen. iPhone pauses web timers in the background, and the silent switch mutes the beep.</p>
  </section>
  <section class="card"><h3>Deload</h3>
    <label>Suggest one every N training weeks <input data-setting="deloadEveryWeeks" inputmode="numeric" value="${S.deloadEveryWeeks}"></label>
    <p class="sub">Also suggested when two lifts slip two sessions running. A deload week halves the sets at the usual weight.</p>
  </section>
  <section class="card"><h3>Data</h3>
    <div class="row wrap"><button class="btn small" data-action="export-json">Export JSON</button><button class="btn small" data-action="export-csv">Export CSV</button>
      <label class="btn small ghost" style="margin:0">Import JSON<input type="file" accept="application/json,.json" data-action="import-json" hidden></label></div>
    <p class="sub">Everything lives on this phone only. Export now and then; a JSON export restores the whole app.</p>
    <button class="link danger" data-action="reset">Erase everything</button>
  </section>
  <section class="card help"><h3>How it decides</h3>
    <p>Each lift has a rep floor and ceiling. When every working set reaches the ceiling, the next session adds one jump. Under the floor at 0 or 1 reps in reserve twice in a row, it drops one jump. Otherwise it holds the weight and asks for one more rep.</p>
    <p>Volume counts sets at 3 or fewer reps in reserve. Ten to twenty hard sets per muscle per week is a reasonable landmark from the research, not a law. Anywhere from about 5 to 30 reps builds muscle when the set is close to failure. Reps in reserve is a guess, and it gets more honest with practice.</p>
    <p>Rings or bar for dips and pull-ups is your call; log them the same way.</p>
  </section>`;
}

// ---------- events ----------
async function onClick(e) {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  const S = state.settings;

  if (act === 'step') {
    const row = a.closest('.setrow');
    const d = state.drafts[row.dataset.key];
    const field = a.dataset.field;
    const input = row.querySelector(`input[data-field="${field}"]`);
    const ex = exMap()[row.dataset.key.split(':')[0]];
    const step = field === 'weight' ? (jumpFor(ex, S) || 5) : 1;
    const cur = parseFloat(input.value);
    let v = (isNaN(cur) ? 0 : cur) + (+a.dataset.delta) * step;
    if (v < 0) v = 0;
    v = Math.round(v * 100) / 100;
    d[field] = v;
    input.value = v;
    return;
  }
  if (act === 'rir') {
    const row = a.closest('.setrow');
    const d = state.drafts[row.dataset.key];
    d.rir = +a.dataset.val;
    row.querySelectorAll('[data-action="rir"]').forEach(b => b.setAttribute('aria-pressed', b === a));
    return;
  }
  if (act === 'log') return logSet(a.closest('.setrow'));
  if (act === 'edit-set') { state.editing[a.dataset.key] = true; delete state.drafts[a.dataset.key]; return render(); }
  if (act === 'add-set') {
    const card = a.closest('.ex');
    state.extra[a.dataset.ex] = card.querySelectorAll('.setrow').length + 1;
    return render();
  }
  if (act === 'finish') return finishSession();
  if (act === 'discard') return discardSession();
  if (act === 'start-deload') { S.deloadUntil = Date.now() + 7 * DAY; S.lastDeloadEnd = S.deloadUntil; await saveSettings(); return render(); }
  if (act === 'end-deload') { S.deloadUntil = null; S.lastDeloadEnd = Date.now(); await saveSettings(); return render(); }
  if (act === 'dismiss-deload') { S.deloadDismissedAt = Date.now(); await saveSettings(); return render(); }

  if (act === 'toggle') { state.ui.expanded[a.dataset.sid] = !state.ui.expanded[a.dataset.sid]; return render(); }
  if (act === 'hedit') return openSetDialog(a.dataset.sid, a.dataset.ex, +a.dataset.n);
  if (act === 'hdel') {
    const s = state.sessions.find(x => x.id === a.dataset.sid);
    if (!s || !confirm('Delete this set?')) return;
    s.sets = s.sets.filter(x => !(x.exerciseId === a.dataset.ex && x.n === +a.dataset.n));
    await saveSession(s);
    return render();
  }
  if (act === 'hdelsession') {
    if (!confirm('Delete this whole session?')) return;
    await db.del('sessions', a.dataset.sid);
    state.sessions = state.sessions.filter(x => x.id !== a.dataset.sid);
    return render();
  }

  if (act === 'rename-day') {
    const d = state.plan.days[+a.dataset.day];
    const name = prompt('Day name', d.name);
    if (name && name.trim()) { d.name = name.trim(); await savePlan(); render(); }
    return;
  }
  if (act === 'del-day') {
    if (!confirm('Delete this day from the plan?')) return;
    state.plan.days.splice(+a.dataset.day, 1);
    state.plan.nextDay = 0;
    await savePlan();
    return render();
  }
  if (act === 'move') {
    const items = state.plan.days[+a.dataset.day].items;
    const i = +a.dataset.idx, j = i + (+a.dataset.dir);
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    await savePlan();
    return render();
  }
  if (act === 'del-item') {
    state.plan.days[+a.dataset.day].items.splice(+a.dataset.idx, 1);
    await savePlan();
    return render();
  }
  if (act === 'add-item') {
    const sel = a.parentElement.querySelector('select[data-sel="add-ex"]');
    state.plan.days[+a.dataset.day].items.push({ exerciseId: sel.value, sets: 3 });
    await savePlan();
    return render();
  }
  if (act === 'add-day') {
    const name = prompt('Day name', String.fromCharCode(65 + state.plan.days.length));
    if (!name) return;
    state.plan.days.push({ name: name.trim(), items: [] });
    await savePlan();
    return render();
  }
  if (act === 'new-ex') return openExDialog(null);
  if (act === 'edit-ex') return openExDialog(a.dataset.ex);

  if (act === 'export-json') return exportJSON();
  if (act === 'export-csv') return exportCSV();
  if (act === 'reset') {
    if (!confirm('Erase all sessions, plan changes and settings on this device?')) return;
    if (!confirm('Really erase? Export first if you want a copy.')) return;
    await db.clearAll();
    location.reload();
  }
}

function onInput(e) {
  const el = e.target;
  if (el.matches('.setrow input[data-field]')) {
    const d = state.drafts[el.closest('.setrow').dataset.key];
    if (d) d[el.dataset.field] = el.value;
    return;
  }
  if (el.dataset.action === 'notes') {
    const cur = ensureSession();
    cur.notes = el.value;
    clearTimeout(state.notesT);
    state.notesT = setTimeout(() => saveSession(cur), 400);
  }
}

async function onChange(e) {
  const el = e.target;
  if (el.dataset.action === 'pick-day') { state.ui.dayIndex = +el.value; state.drafts = {}; state.extra = {}; return render(); }
  if (el.dataset.action === 'trend-ex') { state.ui.trendEx = el.value; return render(); }
  if (el.dataset.action === 'import-json') { if (el.files[0]) await importJSON(el.files[0]); el.value = ''; return; }

  if (el.dataset.plan) {
    const d = state.plan.days[+el.dataset.day];
    const it = d && d.items[+el.dataset.idx];
    if (!it) return;
    const f = el.dataset.plan;
    if (f === 'pairNext') {
      it.pairNext = el.checked;
    } else {
      const v = parseInt(el.value, 10);
      if (!(v >= 1)) return render();
      if (f === 'sets') it.sets = v;
      else {
        const rr = it.repRange ? [...it.repRange] : [...(exMap()[it.exerciseId]?.repRange || [1, 1])];
        if (f === 'lo') { rr[0] = v; if (rr[1] < v) rr[1] = v; } else { rr[1] = v; if (rr[0] > v) rr[0] = v; }
        it.repRange = rr;
      }
    }
    await savePlan();
    return render();
  }

  if (el.dataset.setting) {
    const k = el.dataset.setting;
    const S = state.settings;
    if (k === 'units') S.units = el.value;
    else if (k === 'bodyweight') { const v = parseFloat(el.value); S.bodyweight = v > 0 ? v : null; }
    else { const v = parseFloat(el.value); if (v > 0) S[k] = v; }
    await saveSettings();
    return render();
  }
}

// ---------- session ----------
function ensureSession() {
  if (!state.current) {
    const di = currentDayIndex();
    state.current = { id: uid(), date: todayISO(), startedAt: Date.now(), finishedAt: null, dayIndex: di, dayName: state.plan.days[di]?.name || '?', notes: '', sets: [] };
    state.sessions.push(state.current);
  }
  return state.current;
}
const saveSession = s => db.put('sessions', s);
const savePlan = () => db.kvPut('plan', state.plan);
const saveSettings = () => db.kvPut('settings', state.settings);

async function logSet(row) {
  const key = row.dataset.key;
  const [exId, nStr] = key.split(':');
  const n = +nStr;
  const ex = exMap()[exId];
  const d = state.drafts[key] || {};
  const wIn = row.querySelector('input[data-field="weight"]');
  const rIn = row.querySelector('input[data-field="reps"]');
  const weight = parseFloat(wIn.value);
  const reps = parseInt(rIn.value, 10);
  if (isNaN(weight) || weight < 0) { wIn.focus(); return; }
  if (!(reps >= 1)) { rIn.focus(); return; }
  unlockAudio();
  const cur = ensureSession();
  const existing = cur.sets.find(s => s.exerciseId === exId && s.n === n);
  if (existing) Object.assign(existing, { weight, reps, rir: d.rir ?? null });
  else cur.sets.push({ exerciseId: exId, n, weight, reps, rir: d.rir ?? null, ts: Date.now() });
  delete state.drafts[key];
  delete state.editing[key];
  for (const k of Object.keys(state.drafts)) {
    if (k.startsWith(exId + ':') && state.drafts[k].rir == null) delete state.drafts[k];
  }
  await saveSession(cur);
  if (!existing) startTimer(ex.rest === 'pair' ? state.settings.restPair : state.settings.restMain, ex.name);
  render();
}

async function finishSession() {
  const cur = state.current;
  if (!cur) return;
  if (!cur.sets.length) return discardSession();
  cur.finishedAt = Date.now();
  await saveSession(cur);
  const n = state.plan.days.length;
  state.plan.nextDay = n ? (cur.dayIndex + 1) % n : 0;
  await savePlan();
  resetSessionUI();
  render();
}

async function discardSession() {
  const cur = state.current;
  if (!cur) return;
  if (cur.sets.length && !confirm('Discard this session and its sets?')) return;
  await db.del('sessions', cur.id);
  state.sessions = state.sessions.filter(s => s.id !== cur.id);
  resetSessionUI();
  render();
}

function resetSessionUI() {
  state.current = null;
  state.drafts = {}; state.editing = {}; state.extra = {};
  state.ui.dayIndex = null;
  stopTimer();
}

// ---------- rest timer ----------
function startTimer(seconds, label) {
  state.timer = { endAt: Date.now() + seconds * 1000, label, fired: false };
  if (!state.timerInt) state.timerInt = setInterval(tickTimer, 500);
  tickTimer();
}
function stopTimer() {
  state.timer = null;
  clearInterval(state.timerInt);
  state.timerInt = null;
  $('#timer').hidden = true;
}
function tickTimer() {
  const t = state.timer;
  if (!t) return;
  const el = $('#timer');
  el.hidden = false;
  const rem = Math.ceil((t.endAt - Date.now()) / 1000);
  if (rem <= 0) {
    if (!t.fired) { t.fired = true; beep(); try { navigator.vibrate?.([200, 100, 200]); } catch {} }
    el.classList.add('done');
    $('#timer-text').textContent = 'Rest done · ' + t.label;
  } else {
    el.classList.remove('done');
    $('#timer-text').textContent = `Rest ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')} · ${t.label}`;
  }
}
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
function beep() {
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    [0, 0.25].forEach(off => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(0.3, t + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.2);
      o.start(t + off); o.stop(t + off + 0.22);
    });
  } catch {}
}

// ---------- dialogs ----------
function openSetDialog(sid, exId, n) {
  const s = state.sessions.find(x => x.id === sid);
  const set = s && s.sets.find(x => x.exerciseId === exId && x.n === n);
  if (!set) return;
  state.ui.editTarget = { sid, exId, n };
  const dlg = $('#setdlg');
  const f = dlg.querySelector('form');
  f.weight.value = set.weight; f.reps.value = set.reps; f.rir.value = set.rir == null ? '' : String(set.rir);
  dlg.returnValue = '';
  dlg.showModal();
}
async function onSetDialogClose() {
  const dlg = $('#setdlg');
  if (dlg.returnValue !== 'save') return;
  const t = state.ui.editTarget;
  const s = state.sessions.find(x => x.id === t.sid);
  const set = s && s.sets.find(x => x.exerciseId === t.exId && x.n === t.n);
  if (!set) return;
  const f = dlg.querySelector('form');
  const w = parseFloat(f.weight.value), r = parseInt(f.reps.value, 10);
  if (isNaN(w) || !(r >= 1)) return;
  set.weight = w; set.reps = r; set.rir = f.rir.value === '' ? null : +f.rir.value;
  await saveSession(s);
  render();
}

function openExDialog(exId) {
  const e = exId ? exMap()[exId] : null;
  const dlg = $('#exdlg');
  const f = dlg.querySelector('form');
  $('#exdlg-title').textContent = e ? 'Edit exercise' : 'New exercise';
  f.id.value = e ? e.id : '';
  f.name.value = e ? e.name : '';
  f.kind.value = e ? e.kind : 'weighted';
  f.jump.value = e ? e.jump : 'upper';
  f.rest.value = e ? e.rest : 'main';
  f.lo.value = e ? e.repRange[0] : 6;
  f.hi.value = e ? e.repRange[1] : 10;
  f.querySelectorAll('[name=primary]').forEach(c => { c.checked = !!e && e.primary.includes(c.value); });
  f.querySelectorAll('[name=secondary]').forEach(c => { c.checked = !!e && e.secondary.includes(c.value); });
  const inUse = !!e && (state.plan.days.some(d => d.items.some(i => i.exerciseId === e.id)) || state.sessions.some(s => s.sets.some(x => x.exerciseId === e.id)));
  const del = f.querySelector('[value=delete]');
  del.hidden = !e;
  del.disabled = inUse;
  del.title = inUse ? 'In the plan or in history; remove it there first' : '';
  dlg.returnValue = '';
  dlg.showModal();
}
async function onExDialogClose() {
  const dlg = $('#exdlg');
  const f = dlg.querySelector('form');
  const rv = dlg.returnValue;
  if (rv === 'delete') {
    const id = f.id.value;
    if (!id || !confirm('Delete this exercise from the library?')) return;
    await db.del('exercises', id);
    state.exercises = state.exercises.filter(x => x.id !== id);
    return render();
  }
  if (rv !== 'save') return;
  const name = f.name.value.trim();
  const lo = parseInt(f.lo.value, 10), hi = parseInt(f.hi.value, 10);
  const primary = [...f.querySelectorAll('[name=primary]:checked')].map(c => c.value);
  const secondary = [...f.querySelectorAll('[name=secondary]:checked')].map(c => c.value).filter(m => !primary.includes(m));
  if (!name || !(lo >= 1) || !(hi >= lo) || !primary.length) { alert('Needs a name, a rep floor and ceiling, and at least one primary muscle.'); return; }
  const id = f.id.value || (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ex') + '-' + uid().slice(-4);
  const e = { id, name, kind: f.kind.value, primary, secondary, jump: f.jump.value, repRange: [lo, hi], rest: f.rest.value };
  await db.put('exercises', e);
  const i = state.exercises.findIndex(x => x.id === id);
  if (i >= 0) state.exercises[i] = e; else state.exercises.push(e);
  render();
}

// ---------- export / import ----------
const csvCell = v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));

async function shareText(name, text, type) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

async function exportJSON() {
  const data = { app: 'hypertrophy', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, plan: state.plan, exercises: state.exercises, sessions: state.sessions };
  await shareText(`hypertrophy-${todayISO()}.json`, JSON.stringify(data, null, 1), 'application/json');
}

async function exportCSV() {
  const ex = exMap();
  const lines = ['date,day,exercise,set,weight,reps,rir'];
  for (const s of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const set of [...s.sets].sort((a, b) => a.ts - b.ts)) {
      lines.push([s.date, csvCell(s.dayName), csvCell(ex[set.exerciseId]?.name || set.exerciseId), set.n, set.weight, set.reps, set.rir ?? ''].join(','));
    }
  }
  await shareText(`hypertrophy-${todayISO()}.csv`, lines.join('\n') + '\n', 'text/csv');
}

async function importJSON(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'hypertrophy' || !Array.isArray(data.sessions) || !Array.isArray(data.exercises) || !data.plan) {
      throw new Error('not a Hypertrophy export');
    }
    if (!confirm(`Replace everything on this device with ${data.sessions.length} sessions from the file?`)) return;
    await db.clearAll();
    await db.kvPut('settings', { ...DEFAULT_SETTINGS, ...(data.settings || {}) });
    await db.kvPut('plan', data.plan);
    for (const e of data.exercises) await db.put('exercises', e);
    for (const s of data.sessions) await db.put('sessions', s);
    location.reload();
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
}

boot().catch(err => {
  $('#view').innerHTML = `<section class="card"><p>Could not start: ${esc(err.message)}</p><p class="sub">Storage may be blocked. Try opening the app outside a private window.</p></section>`;
});
