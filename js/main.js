import { state, save, onChange, itemState, dayKey, pushHistory, exportState, importState, resetState, DEFAULT_SETTINGS } from './store.js';
import { loadPacks, findItem } from './packs.js';
import { Typer, chooseMask } from './engine.js';
import {
  levelFromXp, gradeFor, nextGrade, xpForLevel, STAGES, MODES, stageOf, isDue, suggestedMode, applyResult,
  unitProgress, isUnitUnlocked, UNLOCK_SHARE, streak, ACHIEVEMENTS, checkAchievements,
} from './game.js';

const REPO_URL = 'https://github.com/Michaelihc/verbatim';
const main = document.getElementById('main');
const meEl = document.getElementById('me');
let packs = [];
let session = null;   // active practice round
let cleanup = null;   // teardown for the current view

// ---- helpers ----------------------------------------------------------------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString();
const pct = n => `${Math.round(n * 100)}%`;
const plural = (n, w, p = `${w}s`) => `${fmt(n)} ${n === 1 ? w : p}`;

function toast(html, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
  return el;
}

function applySettings() {
  const s = state.settings;
  const root = document.documentElement;
  if (s.theme === 'system') delete root.dataset.theme; else root.dataset.theme = s.theme;
  root.dataset.size = s.textSize;
}

function allItems() {
  const out = [];
  for (const pack of packs) for (const unit of pack.units) for (const item of unit.items) out.push({ pack, unit, item });
  return out;
}

function dueItems() {
  const now = Date.now();
  return allItems()
    .filter(({ pack, unit, item }) => isDue(pack.id, item.id, now) && isUnitUnlocked(pack, pack.units.indexOf(unit)))
    .sort((a, b) => itemState(a.pack.id, a.item.id).due - itemState(b.pack.id, b.item.id).due);
}

function packStats(pack) {
  let learned = 0, mastered = 0, stageSum = 0;
  for (const u of pack.units) {
    const p = unitProgress(pack, u);
    learned += p.learned; mastered += p.mastered; stageSum += p.share * p.n * 5;
  }
  return { learned, mastered, share: pack.itemCount ? stageSum / (pack.itemCount * 5) : 0 };
}

// Segmented bar: one segment per stage, widths by item count.
function stageBar(pack, items) {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const it of items) counts[stageOf(pack.id, it.id)]++;
  const n = items.length || 1;
  const segs = counts.map((c, i) => c ? `<i class="seg s${i}" style="flex:${c / n}" title="${esc(STAGES[i])}: ${c}"></i>` : '').join('');
  return `<span class="stagebar" role="img" aria-label="${counts.map((c, i) => `${c} ${STAGES[i].toLowerCase()}`).join(', ')}">${segs}</span>`;
}

function marksSvg(marks, outOf = 3) {
  let out = '';
  for (let i = 0; i < outOf; i++) {
    out += i < marks
      ? `<svg class="tick" viewBox="0 0 40 32" aria-hidden="true"><path d="M4 18 C9 21 12 25 14 29 C19 17 27 8 37 3" /></svg>`
      : `<svg class="tick miss" viewBox="0 0 40 32" aria-hidden="true"><path d="M8 6 L32 26 M32 6 L8 26" /></svg>`;
  }
  return `<span class="ticks" role="img" aria-label="${marks} of ${outOf} marks">${out}</span>`;
}

// ---- header -----------------------------------------------------------------

function renderMe() {
  const lv = levelFromXp(state.xp);
  const st = streak();
  const today = state.days[dayKey()] || 0;
  const goal = state.settings.dailyGoal;
  meEl.innerHTML = `
    <a class="me-level" href="#/progress" title="${fmt(lv.toNext)} XP to level ${lv.level + 1}">
      <span class="me-grade">${esc(gradeFor(lv.level))}</span>
      <span class="me-lv">Level ${lv.level}</span>
      <span class="me-bar"><i style="width:${pct(lv.into / lv.span)}"></i></span>
    </a>
    <span class="me-streak ${st.today ? 'lit' : ''}" title="${st.count}-day streak. Today: ${fmt(today)} of ${fmt(goal)} XP">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-4-1-6 1-9.5z"/></svg>
      ${st.count}
    </span>`;
}

// ---- routing ----------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(query) };
}

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const { parts, q } = parseHash();
  const view = parts[0] || 'home';
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === view || (view === 'pack' && a.dataset.nav === 'home') || (view === 'play' && a.dataset.nav === 'home');
    a.toggleAttribute('aria-current', on);
  });
  document.body.dataset.view = view;
  if (view === 'pack') return viewPack(decodeURIComponent(parts[1] || ''));
  if (view === 'play') return viewPlay(q);
  if (view === 'progress') return viewProgress();
  if (view === 'settings') return viewSettings();
  return viewHome();
}

function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

// ---- home -------------------------------------------------------------------

function nextUp() {
  const due = dueItems();
  if (due.length) return { kind: 'review', count: due.length, label: `Review ${plural(due.length, 'answer')} due today`, href: '#/play?review=1' };
  const order = [...packs].sort((a, b) => (a.id === state.lastPack ? -1 : b.id === state.lastPack ? 1 : 0));
  for (const pack of order) {
    for (let i = 0; i < pack.units.length; i++) {
      if (!isUnitUnlocked(pack, i)) break;
      const unit = pack.units[i];
      const fresh = unit.items.filter(it => stageOf(pack.id, it.id) < 2);
      if (fresh.length) return { kind: 'learn', pack, unit, label: `${unit.title}`, sub: pack.title, href: `#/play?pack=${encodeURIComponent(pack.id)}&unit=${encodeURIComponent(unit.id)}` };
    }
  }
  return null;
}

function viewHome() {
  const up = nextUp();
  const lv = levelFromXp(state.xp);
  const today = state.days[dayKey()] || 0;
  const goal = state.settings.dailyGoal;
  const firstVisit = state.totals.items === 0;
  const subjects = {};
  for (const p of packs) (subjects[p.subject] ||= []).push(p);

  main.innerHTML = `
    <section class="home-lead">
      <div class="lead-copy">
        <h1>${firstVisit ? 'Learn the answer the examiner is looking for.' : 'Pick up where you left off.'}</h1>
        <p class="lede">${firstVisit
          ? 'Every answer here is worded as the official Cambridge mark scheme accepts it. Copy it, fill the gaps, then type it from memory.'
          : `Level ${lv.level}, grade ${esc(gradeFor(lv.level))}. ${fmt(lv.toNext)} XP to the next level.`}</p>
      </div>
      <div class="lead-card">
        ${up ? `
          <p class="up-kind">${up.kind === 'review' ? 'Due for review' : 'Up next'}</p>
          <p class="up-title">${esc(up.label)}</p>
          ${up.sub ? `<p class="up-sub">${esc(up.sub)}</p>` : ''}
          <a class="btn primary big" href="${up.href}" id="start">Start practising <kbd>Enter</kbd></a>
        ` : `
          <p class="up-title">Everything unlocked is learned.</p>
          <p class="up-sub">Come back tomorrow for reviews, or switch on “Unlock all units” in settings.</p>
        `}
        <div class="goal">
          <span class="goal-label">Today ${fmt(today)} / ${fmt(goal)} XP</span>
          <span class="goal-bar"><i style="width:${pct(Math.min(1, today / goal))}"></i></span>
        </div>
      </div>
    </section>
    ${Object.entries(subjects).map(([subject, list]) => `
      <section class="subject">
        <h2>${esc(subject)}</h2>
        <ul class="packs">
          ${list.map(p => {
            const s = packStats(p);
            return `<li><a class="pack" href="#/pack/${encodeURIComponent(p.id)}">
              <span class="pack-title">${esc(p.title)}</span>
              <span class="pack-meta">${esc(p.syllabus)}</span>
              <span class="pack-desc">${esc(p.description || '')}</span>
              ${stageBar(p, p.units.flatMap(u => u.items))}
              <span class="pack-count">${s.learned} of ${p.itemCount} started, ${s.mastered} mastered</span>
            </a></li>`;
          }).join('')}
        </ul>
      </section>`).join('')}
    ${packs.length ? '' : `<p class="empty">No content packs loaded. Check <code>packs/index.json</code>.</p>`}
    <p class="contribute">Missing a definition? <a href="${REPO_URL}/blob/main/CONTRIBUTING.md" rel="noopener">Add it to a pack</a> on GitHub.</p>
  `;
  const onKey = e => {
    if (e.key === 'Enter' && up && document.activeElement === document.body) { e.preventDefault(); go(up.href); }
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => document.removeEventListener('keydown', onKey);
}

// ---- pack -------------------------------------------------------------------

function viewPack(packId) {
  const pack = packs.find(p => p.id === packId);
  if (!pack) { main.innerHTML = `<p class="empty">That pack isn’t available. <a href="#/">Back to practice</a></p>`; return; }
  const mode = state.packMode?.[pack.id] || 'smart';
  const modeBtns = [['smart', 'Smart', 'Picks copy, gaps or recall for each answer based on how well you know it.'], ...Object.entries(MODES).map(([k, m]) => [k, m.label, m.blurb])];
  const st = packStats(pack);

  main.innerHTML = `
    <nav class="crumbs"><a href="#/">Practice</a></nav>
    <header class="pack-head">
      <h1>${esc(pack.title)}</h1>
      <p class="pack-meta">${esc(pack.syllabus)}</p>
      <p>${pack.itemCount} answers in ${pack.units.length} units. ${st.learned} started, ${st.mastered} mastered.</p>
    </header>
    <fieldset class="modes">
      <legend>Mode</legend>
      ${modeBtns.map(([k, label, blurb]) => `
        <label class="mode">
          <input type="radio" name="mode" value="${k}" ${k === mode ? 'checked' : ''}>
          <span class="mode-name">${label}</span>
          <span class="mode-blurb">${esc(blurb)}</span>
        </label>`).join('')}
    </fieldset>
    <ol class="units">
      ${pack.units.map((u, i) => {
        const open = isUnitUnlocked(pack, i);
        const p = unitProgress(pack, u);
        const prev = i ? unitProgress(pack, pack.units[i - 1]) : null;
        const need = prev ? Math.max(0, Math.ceil(prev.n * UNLOCK_SHARE) - prev.learned) : 0;
        return `<li class="unit ${open ? '' : 'locked'}">
          <details>
            <summary>
              <span class="unit-title">${esc(u.title)}</span>
              ${stageBar(pack, u.items)}
              <span class="unit-count">${open ? `${p.learned}/${p.n}` : `Locked. Copy ${plural(need, 'more answer')} at 95%+ accuracy in “${esc(pack.units[i - 1].title)}”.`}</span>
              ${open ? `<a class="btn" href="#/play?pack=${encodeURIComponent(pack.id)}&unit=${encodeURIComponent(u.id)}" data-play>Practise</a>` : ''}
            </summary>
            <ul class="items">
              ${u.items.map(it => {
                const b = stageOf(pack.id, it.id);
                const s = itemState(pack.id, it.id);
                return `<li>
                  <span class="pips" title="${esc(STAGES[b])}">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= b ? 'on' : ''}"></i>`).join('')}</span>
                  ${open ? `<a href="#/play?pack=${encodeURIComponent(pack.id)}&item=${encodeURIComponent(it.id)}" data-play>${esc(it.term)}</a>` : `<span>${esc(it.term)}</span>`}
                  ${s?.bestWpm ? `<span class="item-best">${s.bestWpm} WPM best</span>` : ''}
                  ${s && isDue(pack.id, it.id) ? '<span class="due">Due</span>' : ''}
                </li>`;
              }).join('')}
            </ul>
          </details>
        </li>`;
      }).join('')}
    </ol>
  `;
  main.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
    state.packMode = { ...state.packMode, [pack.id]: r.value };
    save();
  }));
  main.querySelectorAll('[data-play]').forEach(a => a.addEventListener('click', e => {
    e.stopPropagation();
    const m = state.packMode?.[pack.id] || 'smart';
    if (m !== 'smart') { e.preventDefault(); go(`${a.getAttribute('href')}&mode=${m}`); }
  }));
}

// ---- practice ---------------------------------------------------------------

function buildQueue(q) {
  const size = state.settings.roundSize;
  const forced = MODES[q.get('mode')] ? q.get('mode') : null;
  const pick = (entries) => entries.map(e => ({ ...e, mode: forced || suggestedMode(e.pack.id, e.item.id) }));

  if (q.get('review')) return { title: 'Review', items: pick(dueItems().slice(0, size)) };

  const pack = packs.find(p => p.id === q.get('pack'));
  if (!pack) return null;
  if (q.get('item')) {
    const f = findItem(packs, pack.id, q.get('item'));
    return f ? { title: f.unit.title, pack, items: pick([f]) } : null;
  }
  const idx = pack.units.findIndex(u => u.id === q.get('unit'));
  if (idx < 0 || !isUnitUnlocked(pack, idx)) return null;
  const unit = pack.units[idx];
  const now = Date.now();
  const entries = unit.items.map((item, order) => ({ pack, unit, item, order }));
  const rank = e => {
    const s = itemState(pack.id, e.item.id);
    if (s && s.box >= 1 && s.due <= now) return 0;      // due reviews first
    if (!s || s.box === 0) return 1;                     // then new, in syllabus order
    if (s.box < 3) return 2;                             // then shaky
    return 3;
  };
  entries.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? a.order - b.order : stageOf(pack.id, a.item.id) - stageOf(pack.id, b.item.id)));
  return { title: unit.title, pack, unit, items: pick(entries.slice(0, size)) };
}

function viewPlay(q) {
  const queue = buildQueue(q);
  if (!queue || !queue.items.length) {
    main.innerHTML = `<div class="empty"><p>${q.get('review') ? 'Nothing is due for review right now.' : 'That unit is locked or empty.'}</p><a class="btn" href="#/">Back to practice</a></div>`;
    return;
  }
  if (queue.pack) { state.lastPack = queue.pack.id; save(); }
  session = { ...queue, index: 0, combo: 0, results: [], xp: 0, levelStart: levelFromXp(state.xp).level };
  const exit = queue.pack ? `#/pack/${encodeURIComponent(queue.pack.id)}` : '#/';

  main.innerHTML = `
    <div class="play">
      <div class="play-bar">
        <a class="btn ghost" href="${exit}" title="Leave this round (Esc)">Leave</a>
        <span class="play-title">${esc(queue.title)}</span>
        <span class="play-count" id="count"></span>
        <span class="play-live" id="live" aria-hidden="true"></span>
      </div>
      <article class="paper" id="paper"></article>
    </div>`;

  const paper = document.getElementById('paper');
  let typer = null;
  let phase = 'typing';

  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); go(exit); return; }
    if (phase === 'result') {
      if (e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); show(session.index); }
    } else if (phase === 'summary' && e.key === 'Enter') {
      e.preventDefault(); go(location.hash.replace(/&?t=\d+/, '') + `&t=${Date.now()}`);
    }
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => { document.removeEventListener('keydown', onKey); typer?.destroy(); session = null; };

  function show(i) {
    phase = 'typing';
    const entry = session.items[i];
    const { pack, item, mode } = entry;
    const m = MODES[mode];
    const stage = stageOf(pack.id, item.id);
    document.getElementById('count').textContent = `${i + 1} of ${session.items.length}`;
    paper.className = `paper mode-${mode}`;
    paper.innerHTML = `
      <header class="q">
        <span class="q-num">${i + 1}</span>
        <div class="q-body">
          <p class="q-text">${esc(item.prompt)}</p>
          <p class="q-meta">${esc(m.label)} mode. ${esc(m.blurb)} ${mode !== 'copy' ? 'Stuck? Press <kbd>Tab</kbd> for the next word.' : ''}</p>
        </div>
        <span class="q-marks">[3]</span>
      </header>
      <div class="answer" id="answer"></div>
      <footer class="paper-foot">
        <span class="stage">${esc(STAGES[stage])}</span>
        ${mode !== 'copy' ? '<button class="btn ghost" id="hint" type="button">Show next word</button>' : ''}
        <span class="hint-key">${pack.kind === 'code' ? 'Indentation fills itself after <kbd>Enter</kbd>.' : ''}</span>
      </footer>`;
    const live = document.getElementById('live');
    typer?.destroy();
    typer = new Typer(document.getElementById('answer'), {
      text: item.answer,
      kind: pack.kind,
      mask: chooseMask(item.answer, m.mask, `${pack.id}/${item.id}`),
      settings: state.settings,
      onProgress: s => {
        live.innerHTML = s.pos ? `<b>${Math.round(s.wpm)}</b> WPM <b>${pct(s.acc)}</b> acc` : '';
        paper.style.setProperty('--done', s.pos / s.total);
      },
      onDone: r => finish(entry, r),
    });
    document.getElementById('hint')?.addEventListener('click', () => { typer.hint(); typer.focus(); });
    typer.focus();
  }

  function finish(entry, r) {
    phase = 'result';
    const res = applyResult({ ...r, packId: entry.pack.id, itemId: entry.item.id, mode: entry.mode }, session.combo);
    session.combo = res.combo;
    session.xp += res.xp;
    session.results.push({ entry, res });
    const summary = { mode: entry.mode, marks: res.marks, hints: r.hints, chars: r.chars, wpm: res.wpm };
    pushHistory({ t: Date.now(), p: entry.pack.id, i: entry.item.id, m: entry.mode, wpm: Math.round(res.wpm), acc: +res.acc.toFixed(3), xp: res.xp });
    const earned = checkAchievements(summary);
    save();

    const it = entry.item;
    const last = session.index === session.items.length - 1;
    const result = document.createElement('section');
    result.className = 'result';
    result.innerHTML = `
      <div class="mark">
        ${marksSvg(res.marks)}
        <span class="mark-score">${res.marks}/3</span>
      </div>
      <dl class="result-stats">
        <div><dt>Speed</dt><dd>${Math.round(res.wpm)} <small>WPM</small></dd></div>
        <div><dt>Accuracy</dt><dd>${pct(res.acc)}</dd></div>
        <div><dt>XP</dt><dd>+${res.xp}</dd></div>
        ${res.combo > 1 ? `<div><dt>Run</dt><dd>${res.combo}</dd></div>` : ''}
      </dl>
      ${res.stageAfter !== res.stageBefore
        ? `<p class="stage-move ${res.stageAfter > res.stageBefore ? 'up' : 'down'}">${esc(STAGES[res.stageBefore])} to ${esc(STAGES[res.stageAfter])}</p>`
        : `<p class="stage-move">${res.marks >= 2 ? `Still “${esc(STAGES[res.stageAfter])}”.` : 'Aim for 95% accuracy to move this answer up a stage.'}${res.stageAfter >= MODES[entry.mode].cap && entry.mode !== 'recall' && res.marks >= 2 ? ` Try ${entry.mode === 'copy' ? 'gaps' : 'recall'} mode next.` : ''}</p>`}
      <details class="xp-parts"><summary>How the XP was worked out</summary>
        <ul>${res.parts.map(([label, v]) => `<li>${esc(label)}${v != null ? ` <b>+${Math.round(v)}</b>` : ''}</li>`).join('')}</ul>
      </details>
      ${it.alt?.length ? `<div class="also"><h3>Also accepted</h3><ul>${it.alt.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      ${it.notes ? `<p class="note"><b>Examiner note.</b> ${esc(it.notes)}</p>` : ''}
      <p class="source">Mark scheme: ${(it.sources || []).map(s => esc([s.paper, s.session, s.question && `Q${s.question}`].filter(Boolean).join(', '))).join('; ')}</p>
      <div class="result-actions">
        <button class="btn primary" id="next">${last ? 'Finish round' : 'Next answer'} <kbd>Enter</kbd></button>
        <button class="btn" id="retry">Try again <kbd>R</kbd></button>
      </div>`;
    paper.append(result);
    result.querySelector('#next').addEventListener('click', next);
    result.querySelector('#retry').addEventListener('click', () => show(session.index));
    result.querySelector('#next').focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    if (res.levelAfter > res.levelBefore) {
      const g = gradeFor(res.levelAfter);
      toast(`<b>Level ${res.levelAfter}</b>${g !== gradeFor(res.levelBefore) ? `. Grade ${esc(g)} reached` : ''}`, 'level');
    }
    if (res.dailyGoalHit) toast('<b>Daily goal reached.</b> Nice work.', 'goal');
    for (const a of earned) toast(`<b>${esc(a.name)}</b> ${esc(a.desc)}`, 'ach');
  }

  function next() {
    if (session.index < session.items.length - 1) {
      session.index++;
      show(session.index);
    } else summary();
  }

  function summary() {
    phase = 'summary';
    typer?.destroy(); typer = null;
    const rs = session.results;
    const avg = k => rs.reduce((s, r) => s + r.res[k], 0) / (rs.length || 1);
    const lv = levelFromXp(state.xp);
    const marks = rs.reduce((s, r) => s + r.res.marks, 0);
    document.getElementById('count').textContent = 'Round complete';
    document.getElementById('live').textContent = '';
    paper.className = 'paper summary';
    paper.innerHTML = `
      <header class="sum-head">
        <p class="sum-total"><span class="mark-score">${marks}/${rs.length * 3}</span></p>
        <h1>${marks === rs.length * 3 ? 'Full marks.' : marks >= rs.length * 2 ? 'Solid round.' : 'Round complete.'}</h1>
        <p>+${fmt(session.xp)} XP. ${Math.round(avg('wpm'))} WPM average, ${pct(avg('acc'))} accuracy.</p>
      </header>
      <div class="sum-level">
        <span>Level ${lv.level}, grade ${esc(gradeFor(lv.level))}</span>
        <span class="goal-bar"><i style="width:${pct(lv.into / lv.span)}"></i></span>
        <span>${fmt(lv.toNext)} XP to level ${lv.level + 1}</span>
      </div>
      <ol class="sum-list">
        ${rs.map(({ entry, res }) => `<li>
          ${marksSvg(res.marks)}
          <span class="sum-term">${esc(entry.item.term)}</span>
          <span class="sum-num">${Math.round(res.wpm)} WPM, ${pct(res.acc)}</span>
          <span class="sum-xp">+${res.xp}</span>
        </li>`).join('')}
      </ol>
      <div class="result-actions">
        <button class="btn primary" id="again">Another round <kbd>Enter</kbd></button>
        <a class="btn" href="${exit}">Done</a>
      </div>`;
    paper.querySelector('#again').addEventListener('click', () => go(location.hash.replace(/&?t=\d+/, '') + `&t=${Date.now()}`));
    paper.querySelector('#again').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  show(0);
}

// ---- progress ---------------------------------------------------------------

function ladder(level) {
  const rungs = [[1, 'U'], [3, 'E'], [5, 'D'], [7, 'C'], [10, 'B'], [13, 'A'], [17, 'A*'], [22, 'Examiner'], [30, 'Principal'], [40, 'Chief']];
  return `<ol class="ladder">${rungs.map(([min, g], i) => {
    const nextMin = rungs[i + 1]?.[0] ?? Infinity;
    const cls = level >= nextMin ? 'past' : level >= min ? 'now' : '';
    return `<li class="${cls}"><span class="rung-grade">${g}</span><span class="rung-xp">${fmt(xpForLevel(min))} XP</span></li>`;
  }).join('')}</ol>`;
}

function wpmChart() {
  const h = state.history.slice(-60);
  if (h.length < 2) return '<p class="muted">Finish a few answers to see your speed over time.</p>';
  const W = 600, H = 160, pad = 24;
  const max = Math.max(40, ...h.map(e => e.wpm)) * 1.1;
  const x = i => pad + (i / (h.length - 1)) * (W - pad * 2);
  const y = v => H - pad - (v / max) * (H - pad * 2);
  // Rolling mean of 5 for the line; raw values as dots.
  const roll = h.map((_, i) => { const s = h.slice(Math.max(0, i - 4), i + 1); return s.reduce((a, e) => a + e.wpm, 0) / s.length; });
  const path = roll.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const grid = [0, 0.5, 1].map(f => Math.round(max * f / 10) * 10).map(v => `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Typing speed over your last ${h.length} answers, latest ${h.at(-1).wpm} WPM">
    <g class="grid">${grid}</g>
    ${h.map((e, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(e.wpm).toFixed(1)}" r="2.5"><title>${e.wpm} WPM, ${pct(e.acc)}</title></circle>`).join('')}
    <path d="${path}"/>
  </svg>`;
}

function calendar() {
  const days = 7 * 15;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  start.setDate(start.getDate() - start.getDay()); // align to Sunday
  const goal = state.settings.dailyGoal;
  let cells = '';
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const v = state.days[dayKey(d)] || 0;
    const lvl = v === 0 ? 0 : v < goal * 0.5 ? 1 : v < goal ? 2 : 3;
    cells += `<i class="c${lvl}" title="${d.toDateString()}: ${fmt(v)} XP"></i>`;
  }
  return `<div class="cal" role="img" aria-label="Daily XP for the last 15 weeks">${cells}</div>`;
}

function viewProgress() {
  const lv = levelFromXp(state.xp);
  const t = state.totals;
  const st = streak();
  const ng = nextGrade(lv.level);
  const mins = t.ms / 60000;
  const items = Object.values(state.items);
  main.innerHTML = `
    <header class="prog-head">
      <h1>Level ${lv.level}, grade ${esc(gradeFor(lv.level))}</h1>
      <p>${fmt(state.xp)} XP in total. ${ng ? `${fmt(xpForLevel(ng[0]) - state.xp)} XP to grade ${esc(ng[1])}.` : 'Top of the ladder.'}</p>
      ${ladder(lv.level)}
    </header>
    <section class="prog-grid">
      <dl class="tallies">
        <div><dt>Answers typed</dt><dd>${fmt(t.items)}</dd></div>
        <div><dt>Average speed</dt><dd>${mins ? Math.round((t.chars / 5) / mins) : 0} <small>WPM</small></dd></div>
        <div><dt>Accuracy</dt><dd>${t.keystrokes ? pct((t.keystrokes - t.errors) / t.keystrokes) : '0%'}</dd></div>
        <div><dt>Time typing</dt><dd>${mins < 60 ? `${Math.round(mins)} <small>min</small>` : `${(mins / 60).toFixed(1)} <small>h</small>`}</dd></div>
        <div><dt>Streak</dt><dd>${st.count} <small>${st.count === 1 ? 'day' : 'days'}</small></dd></div>
        <div><dt>Longest run</dt><dd>${state.bestCombo}</dd></div>
        <div><dt>Mastered</dt><dd>${items.filter(s => s.box >= 5).length}</dd></div>
        <div><dt>Hints used</dt><dd>${fmt(t.hints)}</dd></div>
      </dl>
      <div class="panel"><h2>Speed</h2>${wpmChart()}</div>
      <div class="panel"><h2>Daily XP</h2>${calendar()}</div>
    </section>
    <section class="panel">
      <h2>Achievements <small>${Object.keys(state.achievements).length} of ${ACHIEVEMENTS.length}</small></h2>
      <ul class="achs">
        ${ACHIEVEMENTS.map(a => {
          const got = state.achievements[a.id];
          return `<li class="${got ? 'got' : ''}"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span>${got ? `<time>${new Date(got).toLocaleDateString()}</time>` : ''}</li>`;
        }).join('')}
      </ul>
    </section>
    <section class="panel">
      <h2>Your data</h2>
      <p>Progress is stored in this browser only. Export it to move to another device.</p>
      <div class="row">
        <button class="btn" id="export">Export progress</button>
        <label class="btn">Import progress<input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn danger" id="reset">Reset progress</button>
      </div>
    </section>`;

  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `verbatim-progress-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.getElementById('import').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      importState(await f.text());
      applySettings();
      toast('<b>Progress imported.</b>');
      route();
    } catch (err) {
      toast(`<b>Import failed.</b> ${esc(err.message)}`, 'err');
    }
  });
  document.getElementById('reset').addEventListener('click', () => {
    if (confirm('Reset all XP, levels and mastery? Settings are kept. This cannot be undone.')) {
      resetState();
      toast('<b>Progress reset.</b>');
      route();
    }
  });
}

// ---- settings ---------------------------------------------------------------

function viewSettings() {
  const s = state.settings;
  const toggle = (key, label, help) => `
    <label class="setting">
      <input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}>
      <span><b>${label}</b><small>${help}</small></span>
    </label>`;
  const choice = (key, label, opts) => `
    <fieldset class="setting choice"><legend>${label}</legend>
      ${opts.map(([v, l]) => `<label><input type="radio" name="${key}" data-key="${key}" value="${v}" ${String(s[key]) === String(v) ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </fieldset>`;
  main.innerHTML = `
    <h1>Settings</h1>
    <section class="panel settings">
      <h2>Look</h2>
      ${choice('theme', 'Theme', [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']])}
      ${choice('textSize', 'Text size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']])}
    </section>
    <section class="panel settings">
      <h2>Typing</h2>
      ${toggle('stopOnError', 'Stop on mistakes', 'A wrong key is rejected, so you must type the right one before moving on.')}
      ${toggle('ignoreCase', 'Ignore capital letters', 'Accept “a” for “A”. Examiners don’t mind case, but pseudocode keywords should be in capitals.')}
      ${toggle('ignorePunctuation', 'Skip punctuation', 'Commas, full stops and brackets are typed for you.')}
      ${toggle('autoIndent', 'Fill indentation in code', 'After Enter, leading spaces are typed for you.')}
      ${toggle('sound', 'Key sounds', 'A quiet click on each key, and a low tone on mistakes.')}
    </section>
    <section class="panel settings">
      <h2>Goals</h2>
      ${choice('dailyGoal', 'Daily XP goal', [[75, 'Light (75)'], [150, 'Regular (150)'], [300, 'Serious (300)'], [600, 'Exam season (600)']])}
      ${choice('roundSize', 'Answers per round', [[4, '4'], [6, '6'], [10, '10'], [15, '15']])}
      ${toggle('unlockAll', 'Unlock all units', `Normally a unit opens once you’ve copied ${Math.round(UNLOCK_SHARE * 100)}% of the one before at 95%+ accuracy.`)}
    </section>
    <section class="panel">
      <h2>About</h2>
      <p>Verbatim is open source. Answers are quoted from Cambridge International mark schemes for revision; each one cites its paper so you can check it. Cambridge International is not affiliated with this project.</p>
      <p><a href="${REPO_URL}" rel="noopener">Source on GitHub</a>. <a href="${REPO_URL}/blob/main/CONTRIBUTING.md" rel="noopener">How to add a pack</a>.</p>
      <p class="muted" id="offline">Checking offline support…</p>
    </section>`;
  main.querySelectorAll('[data-key]').forEach(el => el.addEventListener('change', () => {
    const key = el.dataset.key;
    const def = DEFAULT_SETTINGS[key];
    state.settings[key] = el.type === 'checkbox' ? el.checked : typeof def === 'number' ? Number(el.value) : el.value;
    save();
    applySettings();
  }));
  const off = document.getElementById('offline');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(r => {
      off.textContent = r?.active ? 'Saved for offline use. Verbatim works without a connection once loaded.' : 'Offline copy not installed yet. Reload once while online.';
    });
  } else off.textContent = 'This browser can’t keep an offline copy.';
}

// ---- boot -------------------------------------------------------------------

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const prompt = worker => {
      const el = toast('<b>An update is ready.</b> <button class="btn small">Reload</button>', 'update');
      el.querySelector('button').addEventListener('click', () => worker.postMessage('skipWaiting'));
    };
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
      });
    });
  }).catch(err => console.warn('Service worker registration failed', err));
  // Reload only when an update replaces an existing worker, not when the first one takes control.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });
}

async function boot() {
  applySettings();
  renderMe();
  onChange(renderMe);
  main.innerHTML = '<p class="loading">Loading packs…</p>';
  try {
    packs = await loadPacks();
  } catch (err) {
    main.innerHTML = `<p class="empty">Couldn’t load content. ${esc(err.message)} If you’re offline, open Verbatim once while online so it can save a copy.</p>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  registerSW();
}

boot();
