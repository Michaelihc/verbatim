// Stats dashboard. One filter row (time range, subject) scopes everything below it:
// headline tiles, trends, the mastery and rating splits, what to focus on next, and topics.
//
// Charts are hand-made SVG sized to their card, so text stays crisp at any width. Every chart
// has a hover/focus tooltip and a table view, and colours follow the job they do: one hue for
// magnitude, an ordinal ramp for mastery stages, the app's rating colours for ratings.

import { state, dayKey, save } from './store.js';
import { STAGES, RATINGS, unitProgress, practiceLevel, stageOf } from './game.js';

const DAY = 86400000;
const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']];
const RATING_ORDER = ['perfect', 'great', 'good', 'ok'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString();
const pct = n => `${Math.round(n * 100)}%`;
const day0 = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const shortDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// ---- data -------------------------------------------------------------------------

function buildData(packs, view) {
  const subjects = [...new Set(packs.map(p => p.subject))];
  const inPacks = view.subject === 'all' ? packs : packs.filter(p => p.subject === view.subject);
  const ids = new Set(inPacks.map(p => p.id));
  const H = state.history.filter(e => ids.has(e.p));
  const today = day0(Date.now());
  let n;
  if (view.range === 'all') {
    const first = Math.min(today, ...H.map(e => day0(e.t)), ...Object.keys(state.days).map(k => day0(new Date(`${k}T00:00`))));
    n = Math.min(365, Math.round((today - first) / DAY) + 1);
  } else n = Number(view.range);
  const start = today - (n - 1) * DAY;
  const prevStart = start - n * DAY;
  const cur = H.filter(e => e.t >= start);
  const prev = view.range === 'all' ? [] : H.filter(e => e.t >= prevStart && e.t < start);

  const days = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * DAY;
    const es = cur.filter(e => day0(e.t) === t);
    const xp = view.subject === 'all' ? (state.days[dayKey(t)] || 0) : es.reduce((s, e) => s + e.xp, 0);
    days.push({ t, xp, n: es.length, wpm: es.length ? mean(es.map(e => e.wpm)) : null, acc: es.length ? mean(es.map(e => e.acc)) : null });
  }
  const sumXp = (from, to) => view.subject === 'all'
    ? Object.entries(state.days).filter(([k]) => { const t = day0(new Date(`${k}T00:00`)); return t >= from && t < to; }).reduce((s, [, v]) => s + v, 0)
    : H.filter(e => e.t >= from && e.t < to).reduce((s, e) => s + e.xp, 0);
  const rated = es => es.filter(e => e.r);
  const perfectRate = es => rated(es).length ? rated(es).filter(e => e.r === 'perfect').length / rated(es).length : null;
  const activeDays = es => new Set(es.map(e => day0(e.t))).size;
  const kpis = [
    { label: 'Answers typed', value: cur.length, prev: prev.length, show: v => fmt(v) },
    { label: 'XP earned', value: sumXp(start, today + DAY), prev: sumXp(prevStart, start), show: v => fmt(v) },
    { label: 'Average speed', value: mean(cur.map(e => e.wpm)), prev: mean(prev.map(e => e.wpm)), show: v => `${Math.round(v)}`, unit: 'WPM' },
    { label: 'Accuracy', value: mean(cur.map(e => e.acc)), prev: mean(prev.map(e => e.acc)), show: pct, points: true },
    { label: 'Perfect rate', value: perfectRate(cur), prev: perfectRate(prev), show: pct, points: true },
    { label: 'Active days', value: activeDays(cur), prev: activeDays(prev), show: v => fmt(v), unit: `of ${n}` },
  ];

  // Items in scope, with mastery stage and how often the mark schemes in the pack cite them.
  const items = [];
  for (const pack of inPacks) for (const unit of pack.units) for (const item of unit.items) {
    items.push({ pack, unit, item, stage: stageOf(pack.id, item.id), cites: pack.kind === 'equation' ? 0 : (item.sources || []).length });
  }
  const stageCounts = STAGES.map((_, s) => items.filter(x => x.stage === s).length);
  const ratingCounts = RATING_ORDER.map(r => cur.filter(e => e.r === r).length);
  const focus = items.filter(x => x.cites > 0 && x.stage < 5)
    .sort((a, b) => b.cites - a.cites || a.stage - b.stage).slice(0, 8);

  const topics = inPacks.map(pack => ({
    pack,
    rows: pack.units.map((unit, i) => {
      const itemIds = new Set(unit.items.map(it => it.id));
      return {
        unit, order: i,
        practice: practiceLevel(pack.id, unit.id),
        mastery: unitProgress(pack, unit).share,
        answers: cur.filter(e => e.p === pack.id && itemIds.has(e.i)).length,
        cites: pack.kind === 'equation' ? null : unit.items.reduce((s, it) => s + (it.sources || []).length, 0),
      };
    }),
  }));
  return { subjects, n, start, days, kpis, stageCounts, ratingCounts, focus, topics, hasRatings: cur.some(e => e.r) };
}

// ---- small pieces ---------------------------------------------------------------------

function card(id, title, sub, body, table, { wide, tableToggle = true } = {}) {
  return `<section class="viz-card ${wide ? 'wide' : ''}" id="${id}">
    <header class="viz-head">
      <div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      ${tableToggle && table ? `<button type="button" class="viz-toggle" aria-pressed="false">Table</button>` : ''}
    </header>
    <div class="viz-chart">${body}</div>
    ${table ? `<div class="viz-table" hidden>${table}</div>` : ''}
    <div class="viz-tip" hidden></div>
  </section>`;
}

const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function tile(k, view) {
  const has = k.value != null;
  let delta = '';
  if (has && k.prev != null && view.range !== 'all') {
    const d = k.points ? (k.value - k.prev) * 100 : k.prev ? (k.value - k.prev) / k.prev * 100 : null;
    if (d != null && isFinite(d)) {
      const dir = Math.abs(d) < 0.5 ? 'flat' : d > 0 ? 'up' : 'down';
      const txt = `${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'} ${Math.abs(Math.round(d))}${k.points ? ' pts' : '%'}`;
      delta = `<span class="kpi-delta ${dir}">${txt} <span>vs previous ${view.range} days</span></span>`;
    }
  }
  return `<div class="kpi"><span class="kpi-label">${esc(k.label)}</span>
    <span class="kpi-value">${has ? esc(k.show(k.value)) : '–'}${has && k.unit ? ` <small>${esc(k.unit)}</small>` : ''}</span>${delta}</div>`;
}

// ---- charts -------------------------------------------------------------------------

const PAD = { l: 40, r: 14, t: 14, b: 26 };

function xTicks(days, x) {
  const idx = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];
  return idx.map(i => `<text class="viz-x" x="${x(i)}" y="${0}" text-anchor="${i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}">${esc(shortDate(days[i].t))}</text>`);
}

/** Daily XP columns with the daily goal as a reference line. */
function xpColumns(days, w, goal) {
  const h = 190;
  const PR = 64; // room on the right for the goal label
  const iw = w - PAD.l - PR, ih = h - PAD.t - PAD.b;
  const max = niceMax(Math.max(goal, ...days.map(d => d.xp)));
  const band = iw / days.length;
  const bw = Math.max(2, Math.min(24, band - 2));
  const x = i => PAD.l + band * i + band / 2;
  const y = v => PAD.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const r = Math.min(4, bw / 2);
  const bars = days.map((d, i) => {
    if (!d.xp) return '';
    const top = y(d.xp), left = x(i) - bw / 2, base = PAD.t + ih;
    const rr = Math.min(r, base - top);
    return `<path class="viz-col" d="M${left},${base}V${top + rr}Q${left},${top} ${left + rr},${top}H${left + bw - rr}Q${left + bw},${top} ${left + bw},${top + rr}V${base}Z"/>`;
  }).join('');
  const hits = days.map((d, i) => `<rect class="viz-hit" x="${PAD.l + band * i}" y="${PAD.t}" width="${band}" height="${ih}" tabindex="-1" data-i="${i}"/>`).join('');
  const gy = y(goal);
  return `<svg class="viz-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily XP for the selected range; see table view for values">
    ${ticks.map(v => `<line class="viz-grid" x1="${PAD.l}" x2="${PAD.l + iw}" y1="${y(v)}" y2="${y(v)}"/><text class="viz-y" x="${PAD.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join('')}
    ${bars}
    <line class="viz-goal" x1="${PAD.l}" x2="${PAD.l + iw + 4}" y1="${gy}" y2="${gy}"/>
    <text class="viz-goal-label" x="${PAD.l + iw + 8}" y="${gy + 4}">Goal ${fmt(goal)}</text>
    <g transform="translate(0 ${h - 6})">${xTicks(days, x).join('')}</g>
    <g class="viz-hits">${hits}</g>
  </svg>`;
}

/** A single-series line over the days, with gaps on days without data. */
function lineChart(days, key, w, { min = 0, max, show, label }) {
  const h = 160;
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
  const vals = days.map(d => d[key]);
  const present = vals.filter(v => v != null);
  const top = max ?? niceMax(Math.max(...present, 1));
  const lo = typeof min === 'function' ? min(present) : min;
  const x = i => PAD.l + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = v => PAD.t + ih - ((v - lo) / (top - lo)) * ih;
  let path = '', area = '', run = [];
  const flush = () => {
    if (!run.length) return;
    path += run.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    area += `M${run[0][0].toFixed(1)},${PAD.t + ih}` + run.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + `L${run.at(-1)[0].toFixed(1)},${PAD.t + ih}Z`;
    run = [];
  };
  vals.forEach((v, i) => { if (v == null) flush(); else run.push([x(i), y(v)]); });
  flush();
  const lastI = vals.findLastIndex(v => v != null);
  // Isolated days (no neighbour either side) get a dot so they don't vanish; the latest day always does.
  const dots = vals.map((v, i) => v != null && (i === lastI || (vals[i - 1] == null && vals[i + 1] == null)) ? `<circle class="viz-dot" cx="${x(i)}" cy="${y(v)}" r="4"/>` : '').join('');
  const ticks = [lo, (lo + top) / 2, top];
  return `<svg class="viz-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}; see table view for values">
    ${ticks.map(v => `<line class="viz-grid" x1="${PAD.l}" x2="${w - PAD.r}" y1="${y(v)}" y2="${y(v)}"/><text class="viz-y" x="${PAD.l - 8}" y="${y(v) + 4}" text-anchor="end">${esc(show(v))}</text>`).join('')}
    <path class="viz-area" d="${area}"/>
    <path class="viz-line" d="${path}"/>
    ${dots}
    ${lastI >= 0 ? `<text class="viz-end" x="${Math.min(x(lastI), w - PAD.r)}" y="${y(vals[lastI]) - 10}" text-anchor="end">${esc(show(vals[lastI]))}</text>` : ''}
    <line class="viz-cross" x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" hidden/>
    <g transform="translate(0 ${h - 6})">${xTicks(days, x).join('')}</g>
    <rect class="viz-overlay" x="${PAD.l}" y="${PAD.t}" width="${iw}" height="${ih}" data-n="${days.length}" data-l="${PAD.l}" data-w="${iw}"/>
  </svg>`;
}

/** Tall segmented bar: one whole split into ordered parts, shares printed where they fit. */
function segmented(parts, total, cls) {
  if (!total) return '<p class="viz-empty">Nothing to show yet.</p>';
  return `<div class="seg-bar ${cls}" role="img" aria-label="${esc(parts.map(p => `${p.name}: ${p.value}`).join(', '))}">
    ${parts.map((p, i) => p.value ? `<span class="seg-part p${p.key}" style="flex:${p.value}" tabindex="0" data-i="${i}">${p.value / total >= 0.09 ? `<b>${pct(p.value / total)}</b>` : ''}</span>` : '').join('')}
  </div>
  <ul class="viz-legend">${parts.map(p => `<li><i class="sw p${p.key}"></i>${esc(p.name)}</li>`).join('')}</ul>`;
}

// ---- render -------------------------------------------------------------------------

export function renderDashboard(host, { packs, playHref, chapterHref, playItemHref }) {
  const view = { range: '30', subject: 'all', sort: 'syllabus', ...(state.ui?.dash || {}) };

  function draw() {
    const D = buildData(packs, view);
    const w = Math.max(260, (host.querySelector('.viz-card')?.clientWidth || host.clientWidth || 700) - 40);
    const wHalf = window.innerWidth > 820 ? Math.max(260, (host.clientWidth - 16) / 2 - 40) : w;
    const goal = state.settings.dailyGoal;
    const rangeName = view.range === 'all' ? 'all time' : `the last ${view.range} days`;

    const stageParts = STAGES.map((name, s) => ({ key: s, name, value: D.stageCounts[s] }));
    const ratingParts = RATING_ORDER.map((r, i) => ({ key: r, name: RATINGS[r].label, value: D.ratingCounts[i] }));
    const totalItems = D.stageCounts.reduce((a, b) => a + b, 0);
    const totalRated = D.ratingCounts.reduce((a, b) => a + b, 0);
    const sorters = {
      syllabus: (a, b) => a.order - b.order,
      practice: (a, b) => a.practice - b.practice || a.order - b.order,
      mastery: (a, b) => a.mastery - b.mastery || a.order - b.order,
      examined: (a, b) => (b.cites ?? -1) - (a.cites ?? -1) || a.order - b.order,
    };
    const dayRows = D.days.map(d => [shortDate(d.t), fmt(d.xp), String(d.n), d.wpm == null ? '–' : String(Math.round(d.wpm)), d.acc == null ? '–' : pct(d.acc)]);
    const maxCites = Math.max(1, ...D.focus.map(f => f.cites));

    host.innerHTML = `
      <div class="dash-filters" role="group" aria-label="Filters">
        <div class="seg" role="radiogroup" aria-label="Time range">${RANGES.map(([k, l]) => `<button type="button" role="radio" data-range="${k}" aria-checked="${view.range === k}">${l}</button>`).join('')}</div>
        <div class="seg" role="radiogroup" aria-label="Subject">${[['all', 'All subjects'], ...D.subjects.map(s => [s, s])].map(([k, l]) => `<button type="button" role="radio" data-subject="${esc(k)}" aria-checked="${view.subject === k}">${esc(l)}</button>`).join('')}</div>
      </div>

      <section class="kpis" aria-label="Headline numbers">${D.kpis.map(k => tile(k, view)).join('')}</section>

      <div class="viz-grid-2">
        ${card('c-xp', 'Daily XP', `Each column is one day in ${rangeName}. The line is your daily goal.`, xpColumns(D.days, w, goal),
          table(['Day', 'XP', 'Answers', 'WPM', 'Accuracy'], dayRows), { wide: true })}
        ${card('c-wpm', 'Typing speed', 'Average words per minute on the days you practised.',
          D.days.some(d => d.wpm != null) ? lineChart(D.days, 'wpm', wHalf, { show: v => `${Math.round(v)}`, label: 'Average typing speed per day' }) : '<p class="viz-empty">Finish a few answers to see your speed.</p>',
          table(['Day', 'WPM'], D.days.filter(d => d.wpm != null).map(d => [shortDate(d.t), String(Math.round(d.wpm))])))}
        ${card('c-acc', 'Accuracy', 'Share of keys typed right, averaged per day.',
          D.days.some(d => d.acc != null) ? lineChart(D.days, 'acc', wHalf, { min: p => Math.max(0, Math.floor(Math.min(...p) * 10) / 10 - 0.1), max: 1, show: pct, label: 'Average accuracy per day' }) : '<p class="viz-empty">Finish a few answers to see your accuracy.</p>',
          table(['Day', 'Accuracy'], D.days.filter(d => d.acc != null).map(d => [shortDate(d.t), pct(d.acc)])))}
        ${card('c-stage', 'Mastery split', `Where all ${fmt(totalItems)} answers sit, from New to Mastered.`, segmented(stageParts, totalItems, 'stages'),
          table(['Stage', 'Answers', 'Share'], stageParts.map(p => [p.name, String(p.value), totalItems ? pct(p.value / totalItems) : '0%'])))}
        ${card('c-rating', 'Ratings', `How your answers in ${rangeName} were rated.`,
          D.hasRatings ? segmented(ratingParts, totalRated, 'ratings') : '<p class="viz-empty">Ratings are recorded from now on. Finish an answer to start the chart.</p>',
          D.hasRatings ? table(['Rating', 'Answers', 'Share'], ratingParts.map(p => [p.name, String(p.value), pct(p.value / totalRated)])) : '')}
        ${card('c-focus', 'Focus next', 'The answers cited by the most mark schemes that you haven’t mastered yet.',
          D.focus.length ? `<ol class="rank-bars">${D.focus.map(f => `<li>
              <a class="rank-name" href="${playItemHref(f.pack, f.unit, f.item)}"><b>${esc(f.item.term)}</b><small>${esc(f.unit.title)}, ${esc(STAGES[f.stage].toLowerCase())}</small></a>
              <span class="rank-track"><i style="width:${(f.cites / maxCites) * 100}%"></i></span>
              <span class="rank-val">${f.cites}</span>
            </li>`).join('')}</ol>` : '<p class="viz-empty">Everything cited by the mark schemes is mastered. Impressive.</p>',
          D.focus.length ? table(['Answer', 'Chapter', 'Stage', 'Mark schemes'], D.focus.map(f => [f.item.term, f.unit.title, STAGES[f.stage], String(f.cites)])) : '')}
        ${card('c-cal', 'Practice calendar', 'Daily XP over the last 15 weeks, all subjects. Darker is more.', calendarGrid(goal), '', { tableToggle: false })}
      </div>

      <section class="viz-card wide topics" id="c-topics">
        <header class="viz-head">
          <div><h2>Topics</h2><p>Practice fills with a lap and fades daily. Mastery grows with each stage. Answers are from ${esc(rangeName)}.</p></div>
          <label class="sort">Sort by <select id="sort">
            ${[['syllabus', 'Syllabus order'], ['practice', 'Least practised'], ['mastery', 'Least mastered'], ['examined', 'Most examined']].map(([k, l]) => `<option value="${k}" ${view.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
        </header>
        ${D.topics.map(({ pack, rows }, pi) => {
          const max = Math.max(1, ...rows.map(r => r.cites || 0));
          const avg = k => rows.reduce((a, r) => a + r[k], 0) / (rows.length || 1);
          const open = view.open ? view.open.includes(pack.id) : pi === 0;
          return `<details class="topic-pack" data-pack="${esc(pack.id)}" ${open ? 'open' : ''}>
            <summary><b>${esc(pack.title)}</b><span>${rows.length} chapters</span>
              <span class="cell-bar"><span class="bar prac"><i style="width:${pct(avg('practice'))}"></i></span><span class="cell-num">${pct(avg('practice'))}</span></span>
              <span class="cell-bar"><span class="bar mast"><i style="width:${pct(avg('mastery'))}"></i></span><span class="cell-num">${pct(avg('mastery'))}</span></span>
            </summary>
            <div class="topic-scroll"><table class="topic-table">
            <thead><tr><th>Chapter</th><th><i class="sw prac"></i>Practice</th><th><i class="sw mast"></i>Mastery</th><th class="num">Answers</th><th>Mark schemes citing it</th></tr></thead>
            <tbody>
                ${[...rows].sort(sorters[view.sort]).map(r => `<tr>
                  <td><a href="${chapterHref(pack, r.unit)}">${esc(r.unit.title)}</a></td>
                  <td><span class="cell-bar"><span class="bar prac"><i style="width:${pct(r.practice)}"></i></span><span class="cell-num">${pct(r.practice)}</span></span></td>
                  <td><span class="cell-bar"><span class="bar mast"><i style="width:${pct(r.mastery)}"></i></span><span class="cell-num">${pct(r.mastery)}</span></span></td>
                  <td class="num">${fmt(r.answers)}</td>
                  <td>${r.cites == null ? '<span class="muted-cell">Syllabus</span>' : `<span class="cell-bar"><span class="bar cite"><i style="width:${(r.cites / max) * 100}%"></i></span><span class="cell-num">${fmt(r.cites)}</span></span>`}</td>
                </tr>`).join('')}</tbody>
            </table></div>
          </details>`;
        }).join('')}
      </section>`;

    bind(D);
  }

  function setView(patch) {
    Object.assign(view, patch);
    state.ui = { ...state.ui, dash: { range: view.range, subject: view.subject, sort: view.sort } };
    save();
    draw();
  }

  function bind(D) {
    host.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => setView({ range: b.dataset.range })));
    host.querySelectorAll('[data-subject]').forEach(b => b.addEventListener('click', () => setView({ subject: b.dataset.subject })));
    host.querySelector('#sort')?.addEventListener('change', e => setView({ sort: e.target.value }));
    host.querySelectorAll('.topic-pack').forEach(d => d.addEventListener('toggle', () => {
      view.open = [...host.querySelectorAll('.topic-pack[open]')].map(x => x.dataset.pack);
    }));
    host.querySelectorAll('.viz-toggle').forEach(btn => btn.addEventListener('click', () => {
      const c = btn.closest('.viz-card');
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on);
      btn.textContent = on ? 'Chart' : 'Table';
      c.querySelector('.viz-chart').hidden = on;
      c.querySelector('.viz-table').hidden = !on;
    }));

    // Tooltips: value first, label second, built with textContent.
    const tip = (c, x, y, rows) => {
      const t = c.querySelector('.viz-tip');
      t.replaceChildren(...rows.map(([v, l]) => { const r = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = l; r.append(b, s); return r; }));
      t.hidden = false;
      const cr = c.getBoundingClientRect();
      t.style.left = `${Math.min(Math.max(8, x - cr.left + 12), cr.width - t.offsetWidth - 8)}px`;
      t.style.top = `${Math.max(8, y - cr.top - t.offsetHeight - 10)}px`;
    };
    const untip = c => { c.querySelector('.viz-tip').hidden = true; };

    const xp = host.querySelector('#c-xp');
    xp?.querySelectorAll('.viz-hit').forEach(h => {
      const show = e => { const d = D.days[h.dataset.i]; const r = h.getBoundingClientRect(); tip(xp, e?.clientX ?? r.left + r.width / 2, r.top + 40, [[`${fmt(d.xp)} XP`, shortDate(d.t)], [`${d.n} answers`, d.xp >= state.settings.dailyGoal ? 'goal met' : '']]); h.classList.add('on'); };
      h.addEventListener('pointermove', show);
      h.addEventListener('pointerleave', () => { untip(xp); h.classList.remove('on'); });
    });

    for (const [id, key, f] of [['#c-wpm', 'wpm', v => `${Math.round(v)} WPM`], ['#c-acc', 'acc', v => pct(v)]]) {
      const c = host.querySelector(id);
      const ov = c?.querySelector('.viz-overlay');
      if (!ov) continue;
      const cross = c.querySelector('.viz-cross');
      ov.addEventListener('pointermove', e => {
        const r = ov.getBoundingClientRect();
        const n = Number(ov.dataset.n);
        const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
        const d = D.days[Math.max(0, Math.min(n - 1, i))];
        const px = Number(ov.dataset.l) + (n === 1 ? Number(ov.dataset.w) / 2 : (i / (n - 1)) * Number(ov.dataset.w));
        cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.removeAttribute('hidden');
        tip(c, e.clientX, r.top + 20, [[d[key] == null ? 'No practice' : f(d[key]), shortDate(d.t)]]);
      });
      ov.addEventListener('pointerleave', () => { untip(c); cross.setAttribute('hidden', ''); });
    }

    for (const [id, parts, total] of [['#c-stage', STAGES.map((n, s) => [n, D.stageCounts[s]]), D.stageCounts.reduce((a, b) => a + b, 0)], ['#c-rating', RATING_ORDER.map((r, i) => [RATINGS[r].label, D.ratingCounts[i]]), D.ratingCounts.reduce((a, b) => a + b, 0)]]) {
      const c = host.querySelector(id);
      c?.querySelectorAll('.seg-part').forEach(p => {
        const [name, v] = parts[p.dataset.i];
        const show = e => { const r = p.getBoundingClientRect(); tip(c, e?.clientX ?? r.left + r.width / 2, r.top, [[`${fmt(v)} (${pct(v / total)})`, name]]); };
        p.addEventListener('pointermove', show);
        p.addEventListener('focus', () => show());
        p.addEventListener('pointerleave', () => untip(c));
        p.addEventListener('blur', () => untip(c));
      });
    }
  }

  draw();
  let raf = 0;
  const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

function calendarGrid(goal) {
  const days = 7 * 15;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  start.setDate(start.getDate() - start.getDay());
  let cells = '';
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const v = state.days[dayKey(d)] || 0;
    const lvl = v === 0 ? 0 : v < goal * 0.5 ? 1 : v < goal ? 2 : 3;
    cells += `<i class="c${lvl}" title="${esc(d.toDateString())}: ${fmt(v)} XP"></i>`;
  }
  return `<div class="cal" role="img" aria-label="Daily XP for the last 15 weeks">${cells}</div>
    <ul class="viz-legend cal-key"><li><i class="sw c0"></i>None</li><li><i class="sw c1"></i>Under half the goal</li><li><i class="sw c2"></i>Over half</li><li><i class="sw c3"></i>Goal met</li></ul>`;
}
