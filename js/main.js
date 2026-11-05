import { state, save, onChange, itemState, dayKey, pushHistory, exportState, importState, resetState, DEFAULT_SETTINGS } from './store.js';
import { loadPacks, findItem } from './packs.js';
import { Typer, chooseMask } from './engine.js';
import {
  levelFromXp, titleFor, STAGES, MODES, LEVELS, RATINGS, maskRatio, stageOf, isDue, applyResult,
  unitProgress, streak, ACHIEVEMENTS, checkAchievements, comboMult,
} from './game.js';
import { sfx, confetti, floatText, countUp } from './fx.js';

const REPO_URL = 'https://github.com/Michaelihc/verbatim';
const main = document.getElementById('main');
const meEl = document.getElementById('me');
let packs = [];
let cleanup = null;   // teardown for the current view

// ---- helpers ----------------------------------------------------------------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString();
const pct = n => `${Math.round(n * 100)}%`;
const plural = (n, w, p = `${w}s`) => `${fmt(n)} ${n === 1 ? w : p}`;
const enc = encodeURIComponent;

const KIND = {
  definition: { many: 'Definitions', one: 'Definition', noun: 'definitions' },
  equation: { many: 'Equations', one: 'Equation', noun: 'equations' },
  code: { many: 'Pseudocode', one: 'Pseudocode', noun: 'answers' },
};
const kindOf = pack => KIND[pack.kind] || KIND.definition;
// Formulas are display-only; "I_rms" renders as I with a subscript.
const formula = f => esc(f).replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>');

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-4-1-6 1-9.5z" fill="currentColor"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c4.5 0 6.5 10 11 10H21M3 17h3.5c1.6 0 2.8-1.3 3.8-3M14 10c1-1.7 2.2-3 3.8-3H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" fill="currentColor"/></svg>',
};

function toast(html, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  const box = document.getElementById('toasts');
  box.append(el);
  // Keep it to a few at a time; the oldest make way.
  const live = [...box.children].filter(t => !t.classList.contains('update'));
  for (const old of live.slice(0, -3)) old.remove();
  if (kind === 'update') return el; // stays until the learner acts on it
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4400);
  return el;
}

function achToast(list) {
  if (!list.length) return;
  if (list.length === 1) toast(`<b>★ ${esc(list[0].name)}</b> ${esc(list[0].desc)}`, 'ach');
  else toast(`<b>★ ${list.length} achievements:</b> ${list.map(a => esc(a.name)).join(', ')}`, 'ach');
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
    .filter(({ pack, item }) => isDue(pack.id, item.id, now))
    .sort((a, b) => itemState(a.pack.id, a.item.id).due - itemState(b.pack.id, b.item.id).due);
}

// Each chapter gets its own colour, so the shelf reads at a glance.
const hueOf = (pack, unit) => (pack.units.indexOf(unit) * 47 + (pack.kind === 'equation' ? 190 : pack.kind === 'code' ? 120 : 255)) % 360;

const playHref = (pack, unit, mode, item) =>
  `#/play?pack=${enc(pack.id)}&unit=${enc(unit === '*' ? '*' : unit.id)}&mode=${mode}${item ? `&item=${enc(item.id)}` : ''}`;

function ring(frac, size = 36, stroke = 4) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - Math.min(1, frac))).toFixed(2)}"/>
  </svg>`;
}

const pips = b => `<span class="pips" title="${esc(STAGES[b])}">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= b ? 'on' : ''}"></i>`).join('')}</span>`;

// ---- header -----------------------------------------------------------------

function renderMe() {
  const lv = levelFromXp(state.xp);
  const st = streak();
  const today = state.days[dayKey()] || 0;
  const goal = state.settings.dailyGoal;
  meEl.innerHTML = `
    <a class="me-goal ${today >= goal ? 'met' : ''}" href="#/progress" title="Today: ${fmt(today)} of ${fmt(goal)} XP">
      ${ring(today / goal, 30, 4)}<span>${fmt(today)}<small>/${fmt(goal)}</small></span>
    </a>
    <span class="me-streak ${st.today ? 'lit' : ''}" title="${plural(st.count, 'day')} in a row">${ICON.flame}${st.count}</span>
    <a class="me-level" href="#/progress" title="${fmt(lv.toNext)} XP to level ${lv.level + 1}">
      <span class="me-lv">Lv ${lv.level}</span>
      <span class="me-bar"><i style="width:${pct(lv.into / lv.span)}"></i></span>
    </a>`;
}

// ---- routing ----------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(query) };
}

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const { parts, q } = parseHash();
  let view = parts[0] || 'home';
  if (view === 'pack') { // old links: open the shelf on that pack
    const p = packs.find(x => x.id === parts[1]);
    if (p) state.ui = { ...state.ui, subject: p.subject, pack: p.id };
    view = 'home';
  }
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === view || (['c', 'play'].includes(view) && a.dataset.nav === 'home');
    a.toggleAttribute('aria-current', on);
  });
  document.body.dataset.view = view;
  window.scrollTo(0, 0);
  if (view === 'c') return viewChapter(parts[1], parts[2]);
  if (view === 'play') return viewPlay(q);
  if (view === 'progress') return viewProgress();
  if (view === 'settings') return viewSettings();
  return viewHome();
}

function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

// ---- home -------------------------------------------------------------------

function searchItems(query) {
  const t = query.trim().toLowerCase();
  if (t.length < 2) return { chapters: [], items: [] };
  const words = t.split(/\s+/);
  const has = (s, w) => s.includes(w);
  const chapters = [];
  for (const pack of packs) for (const unit of pack.units) {
    const title = unit.title.toLowerCase();
    if (words.every(w => has(title, w))) chapters.push({ pack, unit, score: title.startsWith(t) ? 2 : 1 });
  }
  const items = [];
  for (const e of allItems()) {
    const term = e.item.term.toLowerCase();
    const rest = `${e.item.answer} ${e.item.formula || ''} ${e.item.prompt}`.toLowerCase();
    let score = 0;
    if (term === t) score = 100;
    else if (term.startsWith(t)) score = 80;
    else if (has(term, t)) score = 60;
    else if (words.every(w => has(term, w))) score = 50;
    else if (words.every(w => has(rest, w))) score = 10;
    if (score) items.push({ ...e, score });
  }
  chapters.sort((a, b) => b.score - a.score);
  items.sort((a, b) => b.score - a.score);
  return { chapters: chapters.slice(0, 4), items: items.slice(0, 8) };
}

function viewHome() {
  const subjects = [...new Set(packs.map(p => p.subject))];
  const ui = state.ui || {};
  let subject = subjects.includes(ui.subject) ? ui.subject : subjects[0];
  const packIn = s => packs.filter(p => p.subject === s);
  let packId = packIn(subject).some(p => p.id === ui.pack) ? ui.pack : packIn(subject)[0]?.id;

  const last = state.lastPlay;
  const lastPack = last && packs.find(p => p.id === last.pack);
  const lastUnit = lastPack && (last.unit === '*' ? '*' : lastPack.units.find(u => u.id === last.unit));
  const cont = lastUnit ? {
    href: playHref(lastPack, lastUnit, last.mode === 'practice' ? 'practice' : 'train'),
    title: lastUnit === '*' ? `All ${kindOf(lastPack).noun}` : lastUnit.title,
    sub: `${MODES[last.mode]?.label || 'Train'}, ${lastPack.title}`,
  } : null;
  const due = dueItems().length;
  const today = state.days[dayKey()] || 0;
  const goal = state.settings.dailyGoal;
  const st = streak();

  main.innerHTML = `
    <section class="hero">
      <h1>Type it until you know it.</h1>
      <p class="lede">Train with the answer in front of you. Practise with words hidden. Every answer is worded the way the mark scheme accepts it.</p>
      <div class="search" role="search">
        ${ICON.search}
        <input id="q" type="search" placeholder="Find a term, like tesla or flux" autocomplete="off" spellcheck="false" aria-label="Search topics and terms">
        <kbd>/</kbd>
      </div>
      <div class="results" id="results" hidden></div>
      <div class="quick">
        ${cont ? `<a class="quick-card go" href="${cont.href}" id="continue">
          <span class="qc-icon">${ICON.play}</span>
          <span class="qc-text"><small>Continue: ${esc(cont.sub)}</small><b>${esc(cont.title)}</b></span>
          <kbd>Enter</kbd>
        </a>` : ''}
        ${due ? `<a class="quick-card due" href="#/play?review=1">
          <span class="qc-icon">${ICON.replay}</span>
          <span class="qc-text"><small>Spaced review</small><b>${plural(due, 'answer')} due</b></span>
        </a>` : ''}
        <a class="quick-card stat" href="#/progress">
          ${ring(today / goal, 44, 5)}
          <span class="qc-text"><small>Today</small><b>${fmt(today)} / ${fmt(goal)} XP</b></span>
          <span class="qc-streak ${st.today ? 'lit' : ''}">${ICON.flame}${st.count}</span>
        </a>
      </div>
    </section>
    <section class="shelf" id="shelf"></section>
    ${packs.length ? '' : `<p class="empty">No content packs loaded. Check <code>packs/index.json</code>.</p>`}
    <p class="contribute">Missing something? <a href="${REPO_URL}/blob/main/CONTRIBUTING.md" rel="noopener">Add it to a pack</a> on GitHub.</p>
  `;

  const shelf = document.getElementById('shelf');
  function renderShelf() {
    const pack = packs.find(p => p.id === packId);
    if (!pack) { shelf.innerHTML = ''; return; }
    state.ui = { subject, pack: packId };
    shelf.innerHTML = `
      <div class="tabs" role="tablist" aria-label="Subject">
        ${subjects.map(s => `<button role="tab" class="tab" data-subject="${esc(s)}" aria-selected="${s === subject}">${esc(s)}</button>`).join('')}
      </div>
      <div class="shelf-head">
        <div class="chips" role="tablist" aria-label="Pack">
          ${packIn(subject).map(p => `<button role="tab" class="chip-btn" data-pack="${esc(p.id)}" aria-selected="${p.id === packId}">${esc(kindOf(p).many)}<span>${p.itemCount}</span></button>`).join('')}
        </div>
        <div class="row">
          <a class="btn small" href="${playHref(pack, '*', 'train')}">${ICON.shuffle} Shuffle all</a>
        </div>
        <p class="shelf-desc">${esc(pack.description || '')}</p>
      </div>
      <ol class="chapters">
        ${pack.units.map(u => {
          const p = unitProgress(pack, u);
          return `<li class="chap" style="--h:${hueOf(pack, u)}">
            <a class="chap-top" href="#/c/${enc(pack.id)}/${enc(u.id)}">
              <span class="chap-title">${esc(u.title)}</span>
              <span class="chap-meta">${plural(p.n, kindOf(pack).one.toLowerCase().replace('pseudocode', 'answer'))}${p.mastered ? `, ${p.mastered} mastered` : p.started ? `, ${p.started} started` : ''}</span>
            </a>
            <span class="chap-bar" title="${pct(p.share)} mastered"><i style="width:${pct(p.share)}"></i></span>
            <div class="chap-actions">
              <a class="btn train" href="${playHref(pack, u, 'train')}">${ICON.play} Train</a>
              <a class="btn practice" href="${playHref(pack, u, 'practice')}">${ICON.pen} Practice</a>
            </div>
          </li>`;
        }).join('')}
      </ol>`;
    shelf.querySelectorAll('[data-subject]').forEach(b => b.addEventListener('click', () => {
      subject = b.dataset.subject;
      packId = packIn(subject)[0]?.id;
      renderShelf(); save();
    }));
    shelf.querySelectorAll('[data-pack]').forEach(b => b.addEventListener('click', () => {
      packId = b.dataset.pack;
      renderShelf(); save();
    }));
  }
  renderShelf();

  // Search
  const input = document.getElementById('q');
  const results = document.getElementById('results');
  let first = null;
  input.addEventListener('input', () => {
    const { chapters, items } = searchItems(input.value);
    first = items[0] ? playHref(items[0].pack, items[0].unit, 'train', items[0].item) : chapters[0] ? playHref(chapters[0].pack, chapters[0].unit, 'train') : null;
    results.hidden = !input.value.trim() || input.value.trim().length < 2;
    if (results.hidden) return;
    results.innerHTML = (chapters.length || items.length) ? `
      ${chapters.map(({ pack, unit }) => `<div class="res res-chap" style="--h:${hueOf(pack, unit)}">
        <a class="res-main" href="#/c/${enc(pack.id)}/${enc(unit.id)}"><b>${esc(unit.title)}</b><small>Chapter in ${esc(pack.title)}</small></a>
        <a class="btn small train" href="${playHref(pack, unit, 'train')}">${ICON.play} Train</a>
        <a class="btn small practice" href="${playHref(pack, unit, 'practice')}">${ICON.pen} Practice</a>
      </div>`).join('')}
      ${items.map(({ pack, unit, item }) => `<div class="res" style="--h:${hueOf(pack, unit)}">
        <a class="res-main" href="${playHref(pack, unit, 'train', item)}"><b>${esc(item.term)}</b><small>${esc(unit.title)}</small></a>
        ${item.formula && item.formula !== item.term ? `<span class="res-formula">${formula(item.formula)}</span>` : ''}
        <a class="btn small train" href="${playHref(pack, unit, 'train', item)}">${ICON.play} Train</a>
        <a class="btn small practice" href="${playHref(pack, unit, 'practice', item)}">${ICON.pen} Practice</a>
      </div>`).join('')}`
      : `<p class="res-none">Nothing matches “${esc(input.value.trim())}”.</p>`;
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && first) { e.preventDefault(); go(first); }
    if (e.key === 'Escape') { input.value = ''; results.hidden = true; input.blur(); }
  });

  const onKey = e => {
    if (document.activeElement === input) return;
    if (e.key === '/' ) { e.preventDefault(); input.focus(); }
    else if (e.key === 'Enter' && cont && document.activeElement === document.body) { e.preventDefault(); go(cont.href); }
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => document.removeEventListener('keydown', onKey);
}

// ---- chapter ----------------------------------------------------------------

function viewChapter(packId, unitId) {
  const pack = packs.find(p => p.id === packId);
  const unit = pack?.units.find(u => u.id === unitId);
  if (!unit) { main.innerHTML = `<p class="empty">That chapter isn’t available. <a href="#/">Back</a></p>`; return; }
  const p = unitProgress(pack, unit);
  main.innerHTML = `
    <a class="back" href="#/">← All chapters</a>
    <header class="chap-head" style="--h:${hueOf(pack, unit)}">
      <h1>${esc(unit.title)}</h1>
      <p class="muted">${esc(pack.title)}. ${plural(p.n, kindOf(pack).one.toLowerCase().replace('pseudocode', 'answer'))}, ${p.started} started, ${p.mastered} mastered.</p>
      <div class="row big-actions">
        <a class="btn big train" href="${playHref(pack, unit, 'train')}">${ICON.play} Train</a>
        <a class="btn big practice" href="${playHref(pack, unit, 'practice')}">${ICON.pen} Practice</a>
      </div>
    </header>
    <ol class="terms">
      ${unit.items.map(it => {
        const b = stageOf(pack.id, it.id);
        const s = itemState(pack.id, it.id);
        return `<li>
          <a class="term" href="${playHref(pack, unit, 'train', it)}">
            ${pips(b)}
            <span class="term-main">
              <span class="term-name">${esc(it.term)}</span>
              ${it.formula && it.formula !== it.term ? `<span class="term-formula">${formula(it.formula)}</span>` : ''}
            </span>
            ${s?.lastRating ? `<span class="term-rating r-${s.lastRating}">${esc(RATINGS[s.lastRating].label)}</span>` : ''}
            ${s?.bestWpm ? `<span class="term-best">${s.bestWpm} WPM</span>` : ''}
            ${isDue(pack.id, it.id) ? '<span class="term-due">Due</span>' : ''}
          </a>
        </li>`;
      }).join('')}
    </ol>`;
}

// ---- play -------------------------------------------------------------------

function buildSession(q) {
  if (q.get('review')) {
    const items = dueItems();
    return items.length ? { title: 'Spaced review', sub: `${plural(items.length, 'answer')} due`, items, review: true } : null;
  }
  const pack = packs.find(p => p.id === q.get('pack'));
  if (!pack) return null;
  if (q.get('unit') === '*') {
    return {
      title: `All ${kindOf(pack).noun}`, sub: pack.title, pack, unitId: '*', shuffle: true,
      items: pack.units.flatMap(unit => unit.items.map(item => ({ pack, unit, item }))),
    };
  }
  let unit = pack.units.find(u => u.id === q.get('unit'));
  if (!unit && q.get('item')) unit = findItem(packs, pack.id, q.get('item'))?.unit;
  if (!unit) return null;
  return { title: unit.title, sub: pack.title, pack, unit, unitId: unit.id, items: unit.items.map(item => ({ pack, unit, item })) };
}

const keyOf = e => `${e.pack.id}/${e.item.id}`;

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function viewPlay(q) {
  const setup = buildSession(q);
  if (!setup || !setup.items.length) {
    main.innerHTML = `<div class="empty"><p>${q.get('review') ? 'Nothing is due for review right now. Nice.' : 'That chapter isn’t available.'}</p><a class="btn" href="#/">Back to chapters</a></div>`;
    return;
  }
  const S = {
    ...setup,
    mode: q.get('mode') === 'practice' || setup.review ? 'practice' : 'train',
    lap: 1, order: [], pos: 0, combo: 0, xp: 0, lapXp: 0, lapResults: new Map(),
  };
  // Lap 1 goes in syllabus order (from the chosen answer), so every answer comes round once.
  {
    let order = S.shuffle ? shuffled(S.items) : [...S.items];
    const start = order.findIndex(e => e.item.id === q.get('item'));
    if (start > 0) order = [...order.slice(start), ...order.slice(0, start)];
    S.order = order;
  }
  const remember = () => {
    if (S.pack) { state.lastPlay = { pack: S.pack.id, unit: S.unitId, mode: S.mode }; save(); }
  };
  remember();
  const exit = '#/';

  main.innerHTML = `
    <div class="play">
      <div class="play-top">
        <a class="icon-btn" href="${exit}" title="Leave (Esc)" aria-label="Leave">${ICON.x}</a>
        <div class="play-where"><b>${esc(S.title)}</b><span>${esc(S.sub)}</span></div>
        <div class="hud">
          <span class="combo" id="combo" title="Combo multiplier">${ICON.flame}<b>×1.0</b></span>
          <span class="sxp" title="XP this session">${ICON.bolt}<b id="sxp">0</b></span>
        </div>
        <button class="icon-btn" id="mute" type="button" aria-label="Sound"></button>
      </div>
      <div class="play-controls">
        <div class="seg" role="radiogroup" aria-label="Mode">
          ${Object.entries(MODES).map(([k, m]) => `<button type="button" role="radio" data-mode="${k}" title="${esc(m.blurb)}">${k === 'train' ? ICON.play : ICON.pen}${m.label}</button>`).join('')}
        </div>
        <div class="seg seg-small" role="radiogroup" aria-label="How much is hidden" id="levels">
          ${Object.entries(LEVELS).map(([k, l]) => `<button type="button" role="radio" data-level="${k}">${l.label}</button>`).join('')}
        </div>
      </div>
      <div class="lap" id="lap"></div>
      <div class="stage" id="stage"></div>
      <p class="play-help" id="help"></p>
    </div>`;

  const stage = document.getElementById('stage');
  const lapEl = document.getElementById('lap');
  const comboEl = document.getElementById('combo');
  const sxpEl = document.getElementById('sxp');
  const muteBtn = document.getElementById('mute');
  const help = document.getElementById('help');
  let typer = null;
  let phase = 'typing';
  let autoTimer = 0;
  let card = null;

  const sound = () => state.settings.sound;

  function paintControls() {
    main.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === S.mode));
    main.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-checked', b.dataset.level === state.settings.practiceLevel));
    document.getElementById('levels').hidden = S.mode !== 'practice';
    muteBtn.innerHTML = sound() ? ICON.sound : ICON.mute;
    muteBtn.title = sound() ? 'Sound on' : 'Sound off';
    help.innerHTML = S.mode === 'practice'
      ? 'Stuck? <kbd>Tab</kbd> shows the next word. <kbd>Esc</kbd> leaves.'
      : 'Type what you see. Mistakes turn red; backspace to fix them. <kbd>Esc</kbd> leaves.';
  }

  function paintHud(bump) {
    const tier = S.combo >= 10 ? 3 : S.combo >= 5 ? 2 : S.combo >= 1 ? 1 : 0;
    comboEl.className = `combo heat-${tier}${bump ? ' bump' : ''}`;
    comboEl.querySelector('b').textContent = `×${comboMult(S.combo).toFixed(1)}`;
    comboEl.title = S.combo ? `${S.combo} clean in a row` : 'Get Great or Perfect to build a combo';
  }

  function paintLap() {
    const n = S.order.length;
    const done = phase === 'lap' ? n : S.pos + (phase === 'result' ? 1 : 0);
    const dots = n <= 40
      ? `<span class="lap-dots">${S.order.map((e, i) => {
          const r = S.lapResults.get(keyOf(e));
          return `<i class="${i === S.pos && phase !== 'lap' ? 'now' : ''} ${r && i < done ? `r-${r}` : ''}"></i>`;
        }).join('')}</span>`
      : `<span class="lap-bar"><i style="width:${pct(done / n)}"></i></span>`;
    lapEl.innerHTML = `<span class="lap-label">${S.review ? 'Review' : `Lap ${S.lap}`}</span><span class="lap-count">${Math.min(done, n)}/${n}</span>${dots}`;
  }

  function clearAuto() { clearTimeout(autoTimer); autoTimer = 0; card?.querySelector('.auto')?.remove(); }

  function show() {
    clearAuto();
    phase = 'typing';
    const entry = S.order[S.pos];
    const { pack, item } = entry;
    const level = state.settings.practiceLevel;
    const stageNo = stageOf(pack.id, item.id);
    typer?.destroy();
    card = document.createElement('article');
    card.className = `card mode-${S.mode}`;
    card.style.setProperty('--h', hueOf(pack, entry.unit));
    const showFormula = item.formula && item.formula !== item.term;
    card.innerHTML = `
      <div class="card-progress"><i></i></div>
      <header class="card-head">
        <div class="tags">
          <span class="tag">${esc(kindOf(pack).one)}</span>
          <span class="tag stage-tag s${stageNo}">${esc(STAGES[stageNo])}</span>
          ${S.review || S.shuffle ? `<span class="tag">${esc(entry.unit.title)}</span>` : ''}
          ${item.given ? '<span class="tag given" title="Printed on the 9702 data and formulae list">On the formulae sheet</span>' : ''}
        </div>
        <h2 class="card-term">${esc(item.term)}</h2>
        <p class="card-q">${esc(item.prompt)}</p>
        ${showFormula ? `<p class="formula">${formula(item.formula)}</p>` : ''}
      </header>
      <div class="answer" id="answer"></div>
      <footer class="card-foot">
        ${S.mode === 'practice' ? '<button class="btn small ghost" id="hint" type="button">Show next word <kbd>Tab</kbd></button>' : ''}
        <span class="live" id="live"></span>
        ${pack.kind === 'code' ? '<span class="foot-note">Indentation fills itself after <kbd>Enter</kbd>.</span>' : ''}
      </footer>`;
    stage.replaceChildren(card);
    const live = card.querySelector('#live');
    const bar = card.querySelector('.card-progress i');
    typer = new Typer(card.querySelector('#answer'), {
      text: item.answer,
      kind: pack.kind === 'code' ? 'code' : 'prose',
      mask: chooseMask(item.answer, maskRatio(S.mode, level), `${pack.id}/${item.id}`),
      settings: state.settings,
      onKey: ok => {
        if (!sound()) return;
        if (!ok) sfx.miss();
        else if (state.settings.keySound) sfx.key();
      },
      points: state.settings.markPoints ? item.points : null,
      showKeys: S.mode === 'train',
      onPoint: n => { if (sound()) sfx.mark(n); },
      onProgress: s => {
        live.innerHTML = s.pos ? `<span><b>${Math.round(s.wpm)}</b> wpm</span><span><b>${pct(s.acc)}</b> right</span>` : '';
        bar.style.width = pct(s.pos / s.total);
      },
      onDone: r => finish(entry, r, level),
    });
    card.querySelector('#hint')?.addEventListener('click', () => { typer.hint(); typer.focus(); });
    typer.focus();
    paintLap();
  }

  function finish(entry, r, level) {
    phase = 'result';
    const mode = S.mode;
    const res = applyResult({ ...r, packId: entry.pack.id, itemId: entry.item.id, mode, level }, S.combo);
    const comboBroke = S.combo >= 3 && res.combo === 0;
    const xpBefore = S.xp;
    S.combo = res.combo;
    S.xp += res.xp;
    S.lapXp += res.xp;
    S.lapResults.set(keyOf(entry), res.rating);
    pushHistory({ t: Date.now(), p: entry.pack.id, i: entry.item.id, m: mode, wpm: Math.round(res.wpm), acc: +res.acc.toFixed(3), xp: res.xp });
    const earned = checkAchievements({ mode, level: mode === 'practice' ? level : null, rating: res.rating, rank: res.rank, hints: r.hints, chars: r.chars, wpm: res.wpm });
    save();

    const it = entry.item;
    const auto = state.settings.autoAdvance && res.rank >= 3;
    const extra = (it.alt?.length || it.notes || it.sources?.length) ? `
      <details class="more"><summary>Mark scheme notes</summary>
        ${it.alt?.length ? `<p><b>Also accepted:</b> ${it.alt.map(esc).join('; ')}</p>` : ''}
        ${it.notes ? `<p><b>Note:</b> ${esc(it.notes)}</p>` : ''}
        <p class="source">Source: ${(it.sources || []).map(s => esc([s.paper, s.session, s.question && `Q${s.question}`, s.section].filter(Boolean).join(', '))).join('; ')}</p>
      </details>` : '';
    const result = document.createElement('section');
    result.className = `result r-${res.rating}`;
    result.innerHTML = `
      <div class="verdict">
        <span class="verdict-word">${esc(RATINGS[res.rating].label)}${res.rating === 'perfect' ? '!' : ''}</span>
        <span class="verdict-xp">+<b>0</b> XP</span>
      </div>
      <div class="chips-row">
        ${res.combo >= 2 ? `<span class="pill combo-pill">${ICON.flame} ${res.combo} in a row, ×${res.comboMult.toFixed(1)}</span>` : ''}
        ${res.bonus ? `<span class="pill bonus ${res.bonus.kind}">${ICON.bolt} ${esc(res.bonus.label)}</span>` : ''}
        ${res.bestWpm ? `<span class="pill pb">New best: ${res.bestWpm} WPM</span>` : ''}
        ${r.points?.total ? `<span class="pill marks ${r.points.earned === r.points.total ? 'full' : ''}">${r.points.earned}/${r.points.total} ${r.points.total === 1 ? 'mark point' : 'mark points'}</span>` : ''}
        ${res.stageAfter > res.stageBefore ? `<span class="pill up">↑ ${esc(STAGES[res.stageAfter])}</span>` : ''}
        ${res.stageAfter < res.stageBefore ? `<span class="pill down">↓ ${esc(STAGES[res.stageAfter])}</span>` : ''}
        ${comboBroke ? `<span class="pill lost">Combo lost</span>` : ''}
      </div>
      <p class="rstats"><span><b>${Math.round(res.wpm)}</b> WPM</span><span><b>${pct(res.acc)}</b> keys right</span>${res.corrected ? `<span><b>${res.corrected}</b> fixed</span>` : ''}${res.uncorrected ? `<span class="bad"><b>${res.uncorrected}</b> left wrong</span>` : ''}${r.hints ? `<span><b>${r.hints}</b> ${r.hints === 1 ? 'hint' : 'hints'}</span>` : ''}</p>
      ${r.points?.missed?.length ? `<p class="tip missed">Missed ${r.points.missed.length === 1 ? 'mark point' : 'mark points'}: ${r.points.missed.map(m => `<q>${esc(m)}</q>`).join(', ')}</p>` : ''}
      ${res.uncorrected ? '<p class="tip">Red letters show what the answer should say. Press <kbd>R</kbd> to nail it.</p>' : ''}
      ${extra}
      <div class="result-actions">
        <button class="btn primary" id="next" type="button">Next <kbd>Enter</kbd></button>
        <button class="btn" id="retry" type="button">${ICON.replay} Again <kbd>R</kbd></button>
      </div>
      ${auto ? `<div class="auto" style="--t:${res.rating === 'perfect' ? 1300 : 1700}ms"><i></i></div>` : ''}`;
    card.append(result);
    card.classList.add('done', `r-${res.rating}`);
    result.querySelector('#next').addEventListener('click', next);
    result.querySelector('#retry').addEventListener('click', show);
    result.querySelector('#next').focus({ preventScroll: true });
    result.addEventListener('pointerdown', clearAuto);
    result.querySelector('.more')?.addEventListener('toggle', clearAuto);
    if (auto) autoTimer = setTimeout(next, res.rating === 'perfect' ? 1300 : 1700);
    const rect = result.getBoundingClientRect();
    if (rect.bottom > innerHeight) result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    // Juice
    countUp(result.querySelector('.verdict-xp b'), 0, res.xp, 650);
    countUp(sxpEl, xpBefore, S.xp, 650);
    paintHud(res.combo > res.comboBefore);
    paintLap();
    if (sound()) {
      sfx.done(res.rank, res.combo);
      if (res.bonus) sfx.lucky(res.bonus.kind === 'jackpot');
      if (comboBroke) sfx.comboLost();
    }
    const vr = result.querySelector('.verdict-word').getBoundingClientRect();
    const origin = { x: vr.left + vr.width / 2, y: vr.top + vr.height / 2 };
    if (res.bonus) confetti({ ...origin, count: res.bonus.kind === 'jackpot' ? 220 : 110, spread: 1.4 });
    else if (res.rating === 'perfect') confetti({ ...origin, count: 45, spread: 0.9 });
    if (res.combo > 0 && res.combo % 5 === 0) floatText(comboEl, `${res.combo} combo!`, 'hot');
    if (comboBroke) comboEl.classList.add('shake');

    if (res.levelAfter > res.levelBefore) {
      const t = titleFor(res.levelAfter);
      toast(`<b>Level ${res.levelAfter}!</b>${t !== titleFor(res.levelBefore) ? ` You’re now ${esc(t)}.` : ''}`, 'level');
      confetti({ count: 160, spread: 2 });
      if (sound()) setTimeout(() => sfx.fanfare(), 300);
    }
    if (res.dailyGoalHit) { toast('<b>Daily goal reached.</b> Streak safe for today.', 'goal'); confetti({ y: innerHeight * 0.3, count: 120, spread: 2 }); }
    achToast(earned.filter(a => !(a.id === 'goal' && res.dailyGoalHit)));
  }

  function next() {
    clearAuto();
    if (phase !== 'result') return;
    if (S.pos < S.order.length - 1) { S.pos++; show(); }
    else lapDone();
  }

  function lapDone() {
    phase = 'lap';
    typer?.destroy(); typer = null;
    state.totals.laps = (state.totals.laps || 0) + 1;
    const earned = checkAchievements(null);
    save();
    const counts = { perfect: 0, great: 0, good: 0, ok: 0 };
    for (const r of S.lapResults.values()) counts[r]++;
    const n = S.order.length;
    const clean = counts.perfect + counts.great;
    const other = S.mode === 'train' ? 'practice' : 'train';
    card = document.createElement('article');
    card.className = 'card lap-card';
    card.innerHTML = `
      <h2>${clean === n ? 'Clean sweep' : clean >= n * 0.7 ? 'Strong lap' : 'Lap done'}</h2>
      <p class="muted">${S.review ? 'Every due answer reviewed.' : `Lap ${S.lap} of ${esc(S.title)} is done.`}</p>
      <p class="lap-xp">+<b>${fmt(S.lapXp)}</b> XP</p>
      <ul class="lap-counts">
        ${Object.entries(counts).filter(([, c]) => c).map(([k, c]) => `<li class="r-${k}"><b>${c}</b>${esc(RATINGS[k].label)}</li>`).join('')}
      </ul>
      <div class="result-actions">
        ${S.review
          ? `<a class="btn primary" href="#/" id="again">Back to chapters <kbd>Enter</kbd></a>`
          : `<button class="btn primary" id="again" type="button">Keep going <kbd>Enter</kbd></button>
             <button class="btn" id="switch" type="button">${other === 'train' ? ICON.play : ICON.pen} Switch to ${MODES[other].label}</button>`}
        <a class="btn ghost" href="${exit}">Done</a>
      </div>
      ${!S.review ? `<p class="muted small">${S.mode === 'train' ? 'Next lap starts with the ones you slipped on.' : 'Weakest answers come first next lap.'}</p>` : ''}`;
    stage.replaceChildren(card);
    paintLap();
    confetti({ y: innerHeight * 0.35, count: clean === n ? 160 : 70, spread: 1.8 });
    if (sound()) sfx.fanfare();
    achToast(earned);
    card.querySelector('#again').focus({ preventScroll: true });
    if (S.review) return;
    card.querySelector('#again').addEventListener('click', newLap);
    card.querySelector('#switch').addEventListener('click', () => { setMode(other); newLap(); });
  }

  function newLap() {
    // Answers that weren't clean come first, then the rest in a fresh order.
    const prevLast = S.order[S.order.length - 1];
    const weak = S.order.filter(e => (RATINGS[S.lapResults.get(keyOf(e))]?.rank ?? 0) < 3);
    const rest = S.order.filter(e => !weak.includes(e));
    let order = [...weak, ...shuffled(rest)];
    if (order.length > 1 && order[0] === prevLast) order.push(order.shift());
    S.order = order;
    S.lap++; S.pos = 0; S.lapXp = 0; S.lapResults = new Map();
    show();
  }

  function setMode(m) {
    if (!MODES[m] || m === S.mode) return;
    S.mode = m;
    const u = new URLSearchParams(location.hash.split('?')[1] || '');
    u.set('mode', m);
    history.replaceState(null, '', `#/play?${u}`);
    remember();
    paintControls();
  }

  main.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    const was = S.mode;
    setMode(b.dataset.mode);
    if (S.mode !== was && phase !== 'lap') show();
  }));
  main.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => {
    if (state.settings.practiceLevel === b.dataset.level) return;
    state.settings.practiceLevel = b.dataset.level;
    save();
    paintControls();
    if (phase !== 'lap') show();
  }));
  muteBtn.addEventListener('click', () => {
    state.settings.sound = !state.settings.sound;
    save();
    paintControls();
    typer?.focus();
  });

  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); go(exit); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (phase === 'result') {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key.toLowerCase() === 'r') { e.preventDefault(); show(); }
      else clearAuto();
    } else if (phase === 'lap' && e.key === 'Enter' && document.activeElement?.id !== 'switch') {
      e.preventDefault();
      if (S.review) go('#/'); else newLap();
    }
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => { clearAuto(); document.removeEventListener('keydown', onKey); typer?.destroy(); };

  paintControls();
  paintHud(false);
  show();
}

// ---- progress ---------------------------------------------------------------

function wpmChart() {
  const h = state.history.slice(-60);
  if (h.length < 2) return '<p class="muted">Finish a few answers to see your speed over time.</p>';
  const W = 600, H = 160, pad = 24;
  const max = Math.max(40, ...h.map(e => e.wpm)) * 1.1;
  const x = i => pad + (i / (h.length - 1)) * (W - pad * 2);
  const y = v => H - pad - (v / max) * (H - pad * 2);
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
  const mins = t.ms / 60000;
  const items = Object.values(state.items);
  main.innerHTML = `
    <header class="prog-head">
      <div class="lvl-badge"><span>Lv</span><b>${lv.level}</b></div>
      <div>
        <h1>${fmt(state.xp)} XP</h1>
        <p class="rank">${esc(titleFor(lv.level))}</p>
        <div class="xpbar"><i style="width:${pct(lv.into / lv.span)}"></i></div>
        <p class="muted">${fmt(lv.toNext)} XP to level ${lv.level + 1}</p>
      </div>
    </header>
    <section class="prog-grid">
      <dl class="tallies">
        <div><dt>Answers typed</dt><dd>${fmt(t.items)}</dd></div>
        <div><dt>Perfects</dt><dd>${fmt(t.perfects || 0)}</dd></div>
        <div><dt>Average speed</dt><dd>${mins ? Math.round((t.chars / 5) / mins) : 0} <small>WPM</small></dd></div>
        <div><dt>Accuracy</dt><dd>${t.keystrokes ? pct((t.keystrokes - t.errors) / t.keystrokes) : '0%'}</dd></div>
        <div><dt>Streak</dt><dd>${st.count} <small>${st.count === 1 ? 'day' : 'days'}</small></dd></div>
        <div><dt>Best combo</dt><dd>×${comboMult(state.bestCombo).toFixed(1)} <small>${state.bestCombo} in a row</small></dd></div>
        <div><dt>Mastered</dt><dd>${items.filter(s => s.box >= 5).length}</dd></div>
        <div><dt>Time typing</dt><dd>${mins < 60 ? `${Math.round(mins)} <small>min</small>` : `${(mins / 60).toFixed(1)} <small>h</small>`}</dd></div>
      </dl>
      <div class="panel"><h2>Speed</h2>${wpmChart()}</div>
      <div class="panel"><h2>Daily XP</h2>${calendar()}</div>
    </section>
    <section class="panel">
      <h2>Achievements <small>${Object.keys(state.achievements).filter(id => ACHIEVEMENTS.some(a => a.id === id)).length} of ${ACHIEVEMENTS.length}</small></h2>
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
      ${choice('layout', 'Where you type', [['overlay', 'Over the text'], ['stacked', 'On a line below the text']])}
    </section>
    <section class="panel settings">
      <h2>Feel</h2>
      ${toggle('sound', 'Sounds', 'A chime when an answer lands. It climbs in pitch as your combo grows.')}
      ${toggle('keySound', 'Key ticks', 'A soft tick on every correct key.')}
      ${toggle('autoAdvance', 'Roll straight on', 'After a Great or Perfect, the next answer starts by itself.')}
    </section>
    <section class="panel settings">
      <h2>Typing</h2>
      ${choice('practiceLevel', 'Practice mode hides', Object.entries(LEVELS).map(([k, l]) => [k, l.label]))}
      ${toggle('markPoints', 'Show mark points', 'The phrases that earn marks in the mark scheme are underlined, and light up with +1 as you type each one correctly. Physics and Computer Science definitions.')}
      ${toggle('stopOnError', 'Stop on mistakes', 'A wrong key is rejected, so you must type the right one before moving on.')}
      ${toggle('ignoreCase', 'Ignore capital letters', 'Accept “a” for “A”. Pseudocode keywords should still be in capitals in the exam.')}
      ${toggle('ignorePunctuation', 'Skip punctuation', 'Commas, full stops and brackets are typed for you.')}
      ${toggle('autoIndent', 'Fill indentation in code', 'After Enter, leading spaces are typed for you.')}
    </section>
    <section class="panel settings">
      <h2>Goal</h2>
      ${choice('dailyGoal', 'Daily XP goal', [[75, 'Light (75)'], [150, 'Regular (150)'], [300, 'Serious (300)'], [600, 'Exam season (600)']])}
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
  main.innerHTML = '<p class="loading">Loading…</p>';
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
