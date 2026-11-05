import { state, save, onChange, itemState, dayKey, pushHistory, exportState, importState, resetState, DEFAULT_SETTINGS } from './store.js';
import { loadPacks, findItem } from './packs.js';
import { Typer, chooseMask } from './engine.js';
import {
  levelFromXp, titleFor, STAGES, MODES, LEVELS, RATINGS, maskRatio, stageOf, isDue, applyResult,
  unitProgress, streak, ACHIEVEMENTS, checkAchievements, comboMult, practiceLevel, creditPractice, PRACTICE_DECAY,
} from './game.js';
import { sfx, confetti, floatText, countUp } from './fx.js';
import { renderDashboard } from './dash.js';
import { nextUp, examSet, todayPlan, doneToday, setEntries, studyMode } from './plan.js';

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

const playHref = (pack, unit, mode, item, type) =>
  `#/play?pack=${enc(pack.id)}&unit=${enc(unit === '*' ? '*' : unit.id)}&mode=${mode}${item ? `&item=${enc(item.id)}` : ''}${type ? `&type=${type}` : ''}`;

// Items are definitions unless marked as explain questions; a chapter shows them in two groups.
const isExplain = it => it.type === 'explain';
function groupsOf(pack, items) {
  const groups = [
    { type: 'definition', label: kindOf(pack).many, items: items.filter(it => !isExplain(it)) },
    { type: 'explain', label: 'Explain', items: items.filter(isExplain) },
  ];
  return groups.filter(g => g.items.length);
}
function countLabel(pack, items) {
  const one = kindOf(pack).one.toLowerCase().replace('pseudocode', 'answer');
  return groupsOf(pack, items).map(g => g.type === 'explain' ? `${g.items.length} explain` : plural(g.items.length, one)).join(', ');
}

function ring(frac, size = 36, stroke = 4) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - Math.min(1, frac))).toFixed(2)}"/>
  </svg>`;
}

// Two bars per chapter: recent practice (fades daily) and long-term mastery.
function bars(pack, unit, p = unitProgress(pack, unit)) {
  const pr = practiceLevel(pack.id, unit.id);
  return `<span class="chap-bars">
    <span class="bar prac" title="Practice ${pct(pr)}: one lap fills it, and it fades each day you don’t practise"><i style="width:${pct(pr)}"></i></span>
    <span class="bar mast" title="Mastery ${pct(p.share)}"><i style="width:${pct(p.share)}"></i></span>
  </span>`;
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
  let variant = HOME_VARIANTS.some(([k]) => k === state.settings.homeLayout) ? state.settings.homeLayout : 'type';
  const today = state.days[dayKey()] || 0;
  const goal = state.settings.dailyGoal;
  const st = streak();

  main.innerHTML = `
    <section class="hero">
      <div class="hero-top">
        <div>
          <h1>Type it until you know it.</h1>
          <p class="lede">Every answer you type is an exam answer, worded the way the mark scheme accepts it. Build speed and learn the words that score, at the same time.</p>
        </div>
        <div class="variant-switch">
          <span>Front page</span>
          <div class="seg seg-small" role="radiogroup" aria-label="Front page layout">
            ${HOME_VARIANTS.map(([k, l]) => `<button type="button" role="radio" data-variant="${k}" aria-checked="${variant === k}">${l}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="search" role="search">
        ${ICON.search}
        <input id="q" type="search" placeholder="Find a term, like tesla or flux" autocomplete="off" spellcheck="false" aria-label="Search topics and terms">
        <kbd>/</kbd>
      </div>
      <div class="results" id="results" hidden></div>
      <div id="variant"></div>
      <div class="quick">
        ${cont ? `<a class="quick-card go" href="${cont.href}" id="continue">
          <span class="qc-icon">${ICON.play}</span>
          <span class="qc-text"><small>Continue: ${esc(cont.sub)}</small><b>${esc(cont.title)}</b></span>
          <kbd>Enter</kbd>
        </a>` : ''}
        ${due && variant === 'set' ? `<a class="quick-card due" href="#/play?review=1">
          <span class="qc-icon">${ICON.replay}</span>
          <span class="qc-text"><small>Spaced review</small><b>${plural(due, 'answer')} due</b></span>
        </a>` : ''}
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
        <p class="bar-key"><span class="key prac"></span>Practice: one lap fills it, and it fades each day you skip the chapter <span class="key mast"></span>Mastery: rises as answers move from Trained to Mastered</p>
      </div>
      <ol class="chapters">
        ${pack.units.map(u => {
          const p = unitProgress(pack, u);
          return `<li class="chap" style="--h:${hueOf(pack, u)}">
            <a class="chap-top" href="#/c/${enc(pack.id)}/${enc(u.id)}">
              <span class="chap-title">${esc(u.title)}</span>
              <span class="chap-meta">${countLabel(pack, u.items)}${p.mastered ? `, ${p.mastered} mastered` : p.started ? `, ${p.started} started` : ''}</span>
            </a>
            ${bars(pack, u, p)}
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
      renderShelf(); renderVariant(); save();
    }));
    shelf.querySelectorAll('[data-pack]').forEach(b => b.addEventListener('click', () => {
      packId = b.dataset.pack;
      renderShelf(); save();
    }));
  }
  renderShelf();

  // Front-page variants: each one mixes typing practice with exam study.
  const vhost = document.getElementById('variant');
  let vcleanup = null;
  function renderVariant() {
    vcleanup?.(); vcleanup = null;
    if (variant === 'type') vcleanup = typeNow(vhost, subject);
    else if (variant === 'set') examSetCard(vhost, subject);
    else planCard(vhost, subject);
  }
  renderVariant();
  main.querySelectorAll('[data-variant]').forEach(b => b.addEventListener('click', () => {
    variant = b.dataset.variant;
    state.settings.homeLayout = variant;
    save();
    main.querySelectorAll('[data-variant]').forEach(x => x.setAttribute('aria-checked', x.dataset.variant === variant));
    renderVariant();
  }));

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
    if (document.activeElement === input || document.activeElement?.classList.contains('type-input')) return;
    if (e.key === '/' ) { e.preventDefault(); input.focus(); }
    else if (e.key === 'Enter' && cont && variant !== 'type' && document.activeElement === document.body) { e.preventDefault(); go(cont.href); }
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => { document.removeEventListener('keydown', onKey); vcleanup?.(); };
}

const HOME_VARIANTS = [['type', 'Type now'], ['set', 'Exam set'], ['plan', 'Today’s plan']];
const subjectParam = subject => enc(subject === 'all' ? 'all' : subject);

/** Variant A: a live typing card on the front page. Start typing straight away. */
function typeNow(host, subject) {
  const skip = new Set();
  let typer = null, timer = 0, combo = 0, count = 0, earnedXp = 0;

  function load() {
    clearTimeout(timer);
    const e = nextUp(packs, subject, skip);
    if (!e) {
      typer?.destroy(); typer = null;
      host.innerHTML = `<section class="variant v-type"><p class="v-empty">Everything here is mastered. Pick a chapter below to keep it fresh.</p></section>`;
      return;
    }
    const { pack, unit, item } = e;
    const how = studyMode(e.stage);
    host.innerHTML = `
      <section class="variant v-type" aria-label="Type now">
        <div class="v-type-meta">
          <span class="why">${esc(e.why)}</span>
          <span class="how">${how.mode === 'train' ? ICON.play : ICON.pen}${esc(how.label)}</span>
          ${count ? `<span class="tally">${plural(count, 'answer')} here, +${fmt(earnedXp)} XP</span>` : ''}
        </div>
        <article class="card mode-${how.mode} home-card" style="--h:${hueOf(pack, unit)}">
          <div class="card-progress"><i></i></div>
          <header class="card-head">
            <div class="tags">
              <span class="tag">${esc(unit.title)}</span>
              ${e.cites ? `<span class="tag stage-tag">In ${plural(e.cites, 'mark scheme')}</span>` : ''}
              ${item.points?.length ? `<span class="tag">${plural(item.points.length, 'mark point')}</span>` : ''}
            </div>
            <h2 class="card-term">${esc(item.term)}</h2>
            <p class="card-q">${esc(item.prompt)}</p>
            ${item.formula && item.formula !== item.term ? `<p class="formula">${formula(item.formula)}</p>` : ''}
          </header>
          <div class="answer" id="home-answer"></div>
          <footer class="card-foot">
            <button class="btn small ghost" id="skip" type="button">Skip</button>
            <a class="btn small ghost" href="${playHref(pack, unit, how.mode, item)}">Keep going full screen</a>
            <span class="live" id="home-live"></span>
          </footer>
        </article>
      </section>`;
    const card = host.querySelector('.home-card');
    const live = host.querySelector('#home-live');
    const bar = card.querySelector('.card-progress i');
    typer?.destroy();
    typer = new Typer(host.querySelector('#home-answer'), {
      text: item.answer,
      kind: pack.kind === 'code' ? 'code' : 'prose',
      mask: chooseMask(item.answer, maskRatio(how.mode, how.level), `${pack.id}/${item.id}`),
      settings: { ...state.settings, practiceLevel: how.level || state.settings.practiceLevel },
      points: state.settings.markPoints ? item.points : null,
      showKeys: how.mode === 'train',
      onPoint: n => { if (state.settings.sound) sfx.mark(n); },
      onKey: ok => { if (!state.settings.sound) return; if (!ok) sfx.miss(); else if (state.settings.keySound) sfx.key(); },
      onProgress: st => {
        live.innerHTML = st.pos ? `<span><b>${Math.round(st.wpm)}</b> wpm</span><span><b>${pct(st.acc)}</b> right</span>` : '<span>Start typing</span>';
        bar.style.width = pct(st.pos / st.total);
      },
      onDone: r => done(e, how, r),
    });
    host.querySelector('#skip').addEventListener('click', () => { skip.add(`${pack.id}/${item.id}`); load(); });
    typer.focus();
  }

  function done(e, how, r) {
    const res = applyResult({ ...r, packId: e.pack.id, itemId: e.item.id, mode: how.mode, level: how.level }, combo);
    combo = res.combo; count++; earnedXp += res.xp;
    creditPractice(e.pack, e.unit, e.item.id);
    pushHistory({ t: Date.now(), p: e.pack.id, i: e.item.id, m: how.mode, wpm: Math.round(res.wpm), acc: +res.acc.toFixed(3), xp: res.xp, r: res.rating });
    const earned = checkAchievements({ mode: how.mode, level: how.level, rating: res.rating, rank: res.rank, hints: r.hints, chars: r.chars, wpm: res.wpm });
    save();
    skip.add(`${e.pack.id}/${e.item.id}`);
    const card = host.querySelector('.home-card');
    card.classList.add('done', `r-${res.rating}`);
    const out = document.createElement('section');
    out.className = `result compact r-${res.rating}`;
    out.innerHTML = `
      <div class="verdict"><span class="verdict-word">${esc(RATINGS[res.rating].label)}</span><span class="verdict-xp">+<b>${res.xp}</b> XP</span></div>
      <div class="chips-row">
        ${r.points?.total ? `<span class="pill marks ${r.points.earned === r.points.total ? 'full' : ''}">${r.points.earned}/${r.points.total} mark points</span>` : ''}
        ${res.combo >= 2 ? `<span class="pill combo-pill">${ICON.flame} ${res.combo} in a row</span>` : ''}
        ${res.bonus ? `<span class="pill bonus ${res.bonus.kind}">${ICON.bolt} ${esc(res.bonus.label)}</span>` : ''}
        ${res.stageAfter > res.stageBefore ? `<span class="pill up">↑ ${esc(STAGES[res.stageAfter])}</span>` : ''}
      </div>
      ${r.points?.missed?.length ? `<p class="tip missed">Missed: ${r.points.missed.map(m => `<q>${esc(m)}</q>`).join(', ')}</p>` : ''}
      <div class="result-actions"><button class="btn primary" id="hnext" type="button">Next <kbd>Enter</kbd></button></div>`;
    card.append(out);
    if (state.settings.sound) { sfx.done(res.rank, res.combo); if (res.bonus) sfx.lucky(res.bonus.kind === 'jackpot'); }
    const vr = out.querySelector('.verdict-word').getBoundingClientRect();
    if (res.bonus || res.rating === 'perfect') confetti({ x: vr.left + vr.width / 2, y: vr.top + vr.height / 2, count: res.bonus ? 110 : 40, spread: 1 });
    if (res.levelAfter > res.levelBefore) toast(`<b>Level ${res.levelAfter}!</b>`, 'level');
    if (res.dailyGoalHit) toast('<b>Daily goal reached.</b> Streak safe for today.', 'goal');
    achToast(earned.filter(a => !(a.id === 'goal' && res.dailyGoalHit)));
    const next = out.querySelector('#hnext');
    next.addEventListener('click', load);
    next.focus({ preventScroll: true });
    out.addEventListener('pointerdown', () => clearTimeout(timer));
    if (state.settings.autoAdvance && res.rank >= 3) timer = setTimeout(load, 1800);
  }

  load();
  return () => { clearTimeout(timer); typer?.destroy(); };
}

/** Variant B: today's exam set, a short paper of the questions that matter most. */
function examSetCard(host, subject) {
  const set = examSet(packs, subject);
  if (!set.length) { host.innerHTML = `<section class="variant v-set"><p class="v-empty">No exam questions for this subject yet.</p></section>`; return; }
  const marks = set.reduce((n, e) => n + (e.item.points?.length || 0), 0);
  const done = doneToday(set);
  const sp = subjectParam(subject);
  host.innerHTML = `
    <section class="variant v-set" aria-label="Today's exam set">
      <header class="v-head">
        <div>
          <h2>Today’s exam set</h2>
          <p>${set.length} questions worth ${marks} mark points, from what comes up most in the mark schemes and what you know least. A new set every day.</p>
        </div>
        <div class="v-ring">${ring(done / set.length, 52, 6)}<span><b>${done}</b>/${set.length}</span></div>
      </header>
      <ol class="set-list">
        ${set.map(e => `<li><a href="${playHref(e.pack, e.unit, 'train', e.item)}">
          <span class="q-main"><b>${esc(e.item.term)}</b><small>${esc(e.unit.title)}, in ${plural(e.cites, 'mark scheme')}</small></span>
          ${e.item.points?.length ? `<span class="q-marks">${plural(e.item.points.length, 'point')}</span>` : ''}
          ${pips(e.stage)}
        </a></li>`).join('')}
      </ol>
      <div class="row v-actions">
        <a class="btn big primary" href="#/play?set=exam&subject=${sp}&mode=practice">${ICON.pen} Answer from memory</a>
        <a class="btn big" href="#/play?set=exam&subject=${sp}&mode=train">${ICON.play} Type them out first</a>
      </div>
    </section>`;
}

/** Variant C: today's plan, three short sessions in order. */
function planCard(host, subject) {
  const plan = todayPlan(packs, subject);
  const sp = subjectParam(subject);
  const steps = [
    { key: 'review', items: plan.review, title: 'Spaced review', mode: 'practice', desc: plan.review.length ? 'Answers you recalled before, due again so they stick.' : 'Nothing is due today.' },
    { key: 'weak', items: plan.weak, title: 'Weak spots', mode: 'practice', desc: plan.weak.length ? 'Often-examined answers you haven’t secured yet. Fill the gaps from memory.' : 'No weak spots yet. Train some answers first.' },
    { key: 'new', items: plan.fresh, title: plan.freshUnit ? `New in ${plan.freshUnit.unit.title}` : 'New answers', mode: 'train', desc: plan.fresh.length ? 'Type them out with the answer in front of you.' : 'Nothing new left here.' },
  ];
  const firstOpen = steps.findIndex(s => s.items.length && doneToday(s.items) < s.items.length);
  host.innerHTML = `
    <section class="variant v-plan" aria-label="Today's plan">
      <header class="v-head"><div><h2>Today’s plan</h2><p>Three short sessions. Each one trains your typing and revises for the exam at the same time.</p></div></header>
      <ol class="plan-steps">
        ${steps.map((st, i) => {
          const total = st.items.length;
          const d = doneToday(st.items);
          const complete = total > 0 && d >= total;
          return `<li class="${complete ? 'complete' : ''} ${total ? '' : 'is-empty'}">
            <span class="step-n">${complete ? '✓' : i + 1}</span>
            <div class="step-main">
              <b>${esc(st.title)}</b>
              <p>${esc(st.desc)}</p>
              ${total ? `<span class="step-bar"><i style="width:${pct(d / total)}"></i></span><small>${d} of ${total} done today, about ${Math.max(1, Math.round(total * 0.75))} min</small>` : ''}
            </div>
            ${total ? `<a class="btn ${i === firstOpen ? 'primary' : ''}" href="#/play?set=${st.key}&subject=${sp}&mode=${st.mode}">${complete ? 'Again' : 'Start'}</a>` : ''}
          </li>`;
        }).join('')}
      </ol>
    </section>`;
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
      <p class="muted">${esc(pack.title)}. ${countLabel(pack, unit.items)}. ${p.started} started, ${p.mastered} mastered.</p>
      <div class="head-bars">
        <div><span>Practice <b>${pct(practiceLevel(pack.id, unit.id))}</b></span><span class="bar prac"><i style="width:${pct(practiceLevel(pack.id, unit.id))}"></i></span><small>A full lap fills it. It drops by ${Math.round(PRACTICE_DECAY * 100)}% for each day you don’t practise this chapter.</small></div>
        <div><span>Mastery <b>${pct(p.share)}</b></span><span class="bar mast"><i style="width:${pct(p.share)}"></i></span><small>Grows as answers go from Trained to Gaps, Recalled, Secure and Mastered.</small></div>
      </div>
      <div class="row big-actions">
        <a class="btn big train" href="${playHref(pack, unit, 'train')}">${ICON.play} Train</a>
        <a class="btn big practice" href="${playHref(pack, unit, 'practice')}">${ICON.pen} Practice</a>
      </div>
    </header>
    ${groupsOf(pack, unit.items).map((g, _, all) => `
    ${all.length > 1 ? `<div class="group-head">
      <h2>${esc(g.label)}</h2>
      <a class="btn small train" href="${playHref(pack, unit, 'train', null, g.type)}">${ICON.play} Train</a>
      <a class="btn small practice" href="${playHref(pack, unit, 'practice', null, g.type)}">${ICON.pen} Practice</a>
    </div>` : ''}
    <ol class="terms">
      ${g.items.map(it => {
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
    </ol>`).join('')}`;
}

// ---- play -------------------------------------------------------------------

const SETS = {
  exam: { title: 'Exam set', done: 'Exam set done.' },
  weak: { title: 'Weak spots', done: 'Weak spots done.' },
  new: { title: 'New answers', done: 'New answers done.' },
  review: { title: 'Spaced review', done: 'Every due answer reviewed.' },
};

function buildSession(q) {
  if (SETS[q.get('set')]) {
    const subject = q.get('subject') || 'all';
    const items = setEntries(packs, q.get('set'), subject).map(({ pack, unit, item }) => ({ pack, unit, item }));
    const marks = items.reduce((n, e) => n + (e.item.points?.length || 0), 0);
    return items.length ? {
      title: SETS[q.get('set')].title, review: true, set: q.get('set'), doneText: SETS[q.get('set')].done,
      sub: `${plural(items.length, 'question')}${marks ? `, ${marks} mark points` : ''}${subject !== 'all' ? `, ${subject}` : ''}`, items,
    } : null;
  }
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
  const type = ['definition', 'explain'].includes(q.get('type')) ? q.get('type') : null;
  const items = unit.items.filter(it => !type || (type === 'explain') === isExplain(it));
  const sub = type === 'explain' ? `${pack.title}, explain questions` : type ? `${pack.title}, ${kindOf(pack).noun} only` : pack.title;
  return { title: unit.title, sub, pack, unit, unitId: unit.id, items: items.map(item => ({ pack, unit, item })) };
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
    mode: q.get('mode') === 'practice' || (setup.review && !setup.set) ? 'practice' : 'train',
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
    lapEl.innerHTML = `<span class="lap-label">${S.set ? esc(S.title) : S.review ? 'Review' : `Lap ${S.lap}`}</span><span class="lap-count">${Math.min(done, n)}/${n}</span>${dots}`;
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
          <span class="tag">${esc(isExplain(item) ? 'Explain' : kindOf(pack).one)}</span>
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
    creditPractice(entry.pack, entry.unit, entry.item.id);
    const comboBroke = S.combo >= 3 && res.combo === 0;
    const xpBefore = S.xp;
    S.combo = res.combo;
    S.xp += res.xp;
    S.lapXp += res.xp;
    S.lapResults.set(keyOf(entry), res.rating);
    if (r.points?.total) S.lapPts = [(S.lapPts?.[0] || 0) + r.points.earned, (S.lapPts?.[1] || 0) + r.points.total];
    pushHistory({ t: Date.now(), p: entry.pack.id, i: entry.item.id, m: mode, wpm: Math.round(res.wpm), acc: +res.acc.toFixed(3), xp: res.xp, r: res.rating });
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
      ${it.formula && it.formula !== it.term ? `
      <div class="symbols">
        <span class="symbols-label">In symbols</span>
        <p class="symbols-eq"><span>${formula(it.formula)}</span></p>
        <p class="symbols-words">${esc(it.answer)}</p>
      </div>` : ''}
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
      <p class="muted">${S.review ? esc(S.doneText || 'Every due answer reviewed.') : `Lap ${S.lap} of ${esc(S.title)} is done.`}</p>
      ${S.lapPts?.[1] ? `<p class="lap-marks"><b>${S.lapPts[0]}</b> of ${S.lapPts[1]} mark points scored</p>` : ''}
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
    S.lap++; S.pos = 0; S.lapXp = 0; S.lapResults = new Map(); S.lapPts = null;
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

function viewProgress() {
  const lv = levelFromXp(state.xp);
  const st = streak();
  main.innerHTML = `
    <header class="prog-head">
      <div class="lvl-badge"><span>Lv</span><b>${lv.level}</b></div>
      <div>
        <h1>${fmt(state.xp)} XP</h1>
        <p class="rank">${esc(titleFor(lv.level))}, ${st.count}-day streak, best combo ×${comboMult(state.bestCombo).toFixed(1)}</p>
        <div class="xpbar"><i style="width:${pct(lv.into / lv.span)}"></i></div>
        <p class="muted">${fmt(lv.toNext)} XP to level ${lv.level + 1}</p>
      </div>
    </header>
    <div class="dash" id="dash"></div>
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

  cleanup = renderDashboard(document.getElementById('dash'), {
    packs,
    chapterHref: (pack, unit) => `#/c/${enc(pack.id)}/${enc(unit.id)}`,
    playItemHref: (pack, unit, item) => playHref(pack, unit, 'train', item),
  });

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
      ${choice('homeLayout', 'Front page', HOME_VARIANTS)}
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
