// The typing skill model: how quickly and accurately you type each key, letter pair and word.
//
// The engine logs the first press at each position of an answer. Each press updates a running
// average of its error rate and its time since the previous key, kept per physical key (with
// Shift counted as its own key), per letter pair and per word. Averages lean on recent typing,
// so a weakness you fix fades out of the list. Everything is judged against your own medians,
// so "slow" means slow for you, at any speed.

import { state } from './store.js';

export const PAUSE_CAP = 2000;   // longer gaps count as thinking, not typing
const MIN_N = 6;                 // samples before a key, pair or word is judged
const RECENT = 0.08;             // weight of each new sample once the average has settled
const WORD_CAP = 2500;

const SHIFTED = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };

/** The key a character is typed on, and whether it needs Shift. */
export function physical(ch) {
  if (ch === ' ') return { key: 'space', shift: false };
  if (ch === '\n') return { key: 'enter', shift: false };
  if (SHIFTED[ch]) return { key: SHIFTED[ch], shift: true };
  if (/[A-Z]/.test(ch)) return { key: ch.toLowerCase(), shift: true };
  return { key: ch, shift: false };
}

const isLetter = c => /[A-Za-z]/.test(c);

function model() {
  state.skill ||= {};
  for (const k of ['keys', 'pairs', 'words']) state.skill[k] ||= {};
  return state.skill;
}

// e: n samples, err running error rate, t timed samples, ms running time
function bump(map, k, ok, ms) {
  const e = map[k] ||= { n: 0, err: 0, t: 0, ms: 0 };
  e.n++;
  e.err = +(e.err + Math.max(1 / e.n, RECENT) * ((ok ? 0 : 1) - e.err)).toFixed(3);
  if (ms != null) {
    e.t++;
    e.ms = Math.round(e.ms + Math.max(1 / e.t, RECENT) * (ms - e.ms));
  }
}

let version = 0;

/**
 * Fold one finished attempt into the model.
 * log: first press per position, { i, c, ok, dt, flow }. `flow` is true when the press followed a
 * correct press of the previous character, so its time is a clean transition.
 */
export function recordAttempt(text, log) {
  if (!log?.length) return;
  const m = model();
  const at = new Map(log.map(k => [k.i, k]));
  for (const k of log) {
    const ms = k.ok && k.flow && k.dt != null && k.dt >= 15 && k.dt <= PAUSE_CAP ? k.dt : null;
    const { key, shift } = physical(k.c);
    bump(m.keys, key, k.ok, ms);
    if (shift) bump(m.keys, 'shift', k.ok, ms);
    const prev = text[k.i - 1];
    if (prev && prev !== '\n' && (isLetter(prev) || isLetter(k.c))) bump(m.pairs, (prev + k.c).toLowerCase(), k.ok, ms);
  }
  for (const w of text.matchAll(/[A-Za-z]{3,}/g)) {
    const presses = [];
    for (let i = w.index; i < w.index + w[0].length; i++) presses.push(at.get(i));
    if (presses.some(p => !p)) continue;
    const timed = presses.slice(1).filter(p => p.ok && p.flow && p.dt != null && p.dt >= 15 && p.dt <= PAUSE_CAP);
    const ms = timed.length >= (w[0].length - 1) / 2 ? timed.reduce((s, p) => s + p.dt, 0) / timed.length : null;
    const key = w[0].toLowerCase();
    bump(m.words, key, presses.every(p => p.ok), ms);
    (m.words[key].forms ||= {})[w[0]] = 1;
  }
  const words = Object.entries(m.words);
  if (words.length > WORD_CAP) {
    words.sort((a, b) => a[1].n - b[1].n);
    for (const [k] of words.slice(0, words.length - WORD_CAP)) delete m.words[k];
  }
  version++;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

const medians = {};
function medianMs(kind) {
  const c = medians[kind];
  if (c && c.v === version) return c.ms;
  const ms = median(Object.values(model()[kind]).filter(e => e.t >= MIN_N).map(e => e.ms));
  medians[kind] = { v: version, ms };
  return ms;
}

/** How much a key, pair or word holds you back: extra time over your median plus errors. */
function cost(e, med) {
  const slow = med && e.t >= MIN_N ? Math.max(0, e.ms / med - 1) : 0;
  return slow + e.err * 4;
}

/**
 * The weakest keys, pairs or words, worst first.
 * Each row: { k, n, err, ms, ratio (time against your median), cost }.
 */
export function weakest(kind, n = 8, keep = () => true) {
  const med = medianMs(kind);
  return Object.entries(model()[kind])
    .filter(([k, e]) => e.n >= MIN_N && keep(k, e))
    .map(([k, e]) => ({ k, n: e.n, err: e.err, ms: e.t >= MIN_N ? e.ms : null, ratio: med && e.t >= MIN_N ? e.ms / med : null, cost: cost(e, med), forms: e.forms }))
    .filter(r => r.cost > 0.15)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, n);
}

/** Every key with enough samples, for the keyboard heatmap. */
export function keyTable() {
  const med = medianMs('keys');
  const out = {};
  for (const [k, e] of Object.entries(model().keys)) {
    if (e.n < MIN_N) continue;
    out[k] = { n: e.n, err: e.err, ms: e.t >= MIN_N ? e.ms : null, ratio: med && e.t >= MIN_N ? e.ms / med : null, cost: cost(e, med) };
  }
  return out;
}

export function hasEnoughData() {
  return Object.values(model().pairs).filter(e => e.n >= MIN_N).length >= 20;
}

const textCosts = new Map();
/** How many of your weak pairs and words a text contains, per character. Used to order laps. */
export function textCost(text) {
  const c = textCosts.get(text);
  if (c && c.v === version) return c.cost;
  const m = model();
  const pm = medianMs('pairs'), wm = medianMs('words');
  let sum = 0;
  const low = text.toLowerCase();
  for (let i = 1; i < low.length; i++) {
    const e = m.pairs[low[i - 1] + low[i]];
    if (e && e.n >= MIN_N) sum += cost(e, pm);
  }
  for (const w of low.matchAll(/[a-z]{3,}/g)) {
    const e = m.words[w[0]];
    if (e && e.n >= MIN_N) sum += cost(e, wm) * w[0].length;
  }
  const out = sum / Math.max(1, text.length);
  textCosts.set(text, { v: version, cost: out });
  return out;
}

/** Words in this attempt worth a quick drill: slipped on, or typed far slower than usual. */
export function troubleWords(text, log, max = 3) {
  const at = new Map(log.map(k => [k.i, k]));
  const med = medianMs('words') || medianMs('keys');
  const seen = new Set();
  const rows = [];
  for (const w of text.matchAll(/[A-Za-z]{3,}/g)) {
    if (seen.has(w[0])) continue;
    const presses = [];
    for (let i = w.index; i < w.index + w[0].length; i++) presses.push(at.get(i));
    if (presses.some(p => !p)) continue;
    const errs = presses.filter(p => !p.ok).length;
    const timed = presses.slice(1).filter(p => p.ok && p.flow && p.dt != null && p.dt <= PAUSE_CAP);
    const ms = timed.length ? timed.reduce((s, p) => s + p.dt, 0) / timed.length : null;
    const slow = med && ms ? ms / med : 0;
    if (errs || slow >= 1.8) { seen.add(w[0]); rows.push({ w: w[0], score: errs * 2 + slow }); }
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, max).map(r => r.w);
}

/** Build the vocabulary drills draw on: every word in the given answers, by how often it appears. */
export function vocabulary(texts) {
  const words = new Map();
  for (const t of texts) for (const m of t.matchAll(/[A-Za-z]{3,}/g)) words.set(m[0], (words.get(m[0]) || 0) + 1);
  return [...words].map(([w, n]) => ({ w, low: w.toLowerCase(), n }));
}

function pickWeighted(list, rnd = Math.random) {
  const total = list.reduce((s, x) => s + Math.sqrt(x.n), 0);
  let r = rnd() * total;
  for (const x of list) { r -= Math.sqrt(x.n); if (r <= 0) return x; }
  return list.at(-1);
}

/**
 * A drill round: real words from the syllabus that contain your weakest pairs and keys, plus the
 * words you trip on. Returns { text, targets } or null when there isn't enough data yet.
 */
export function drillRound(vocab, size = 14) {
  if (!vocab.length) return null;
  const pairs = weakest('pairs', 3, k => /^[a-z]{2}$/.test(k));
  const keys = weakest('keys', 2, k => /^[a-z]$/.test(k) || k === 'shift');
  const words = weakest('words', 3);
  if (!pairs.length && !keys.length && !words.length) return null;
  const targets = [
    ...pairs.map(p => ({ kind: 'pair', k: p.k, label: p.k })),
    ...keys.map(p => ({ kind: 'key', k: p.k, label: p.k === 'shift' ? 'Shift' : p.k })),
    ...words.map(p => ({ kind: 'word', k: p.k, label: Object.keys(p.forms || {})[0] || p.k })),
  ];
  const out = [];
  const used = new Map();
  const add = w => { if (!w) return; out.push(w); used.set(w, (used.get(w) || 0) + 1); };
  const fresh = list => list.filter(x => (used.get(x.w) || 0) < 2);
  for (const t of words.slice(0, 3)) add(Object.keys(t.forms || {})[0]);
  let guard = 0;
  while (out.length < size && guard++ < 200) {
    const t = targets[guard % targets.length];
    let pool;
    if (t.kind === 'pair') pool = vocab.filter(x => x.low.includes(t.k));
    else if (t.k === 'shift') pool = vocab.filter(x => /[A-Z]/.test(x.w));
    else if (t.kind === 'key') pool = vocab.filter(x => x.low.includes(t.k));
    else continue; // weak words went in up front
    pool = fresh(pool);
    if (pool.length) add(pickWeighted(pool).w);
  }
  if (!out.length) return null;
  for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  return { text: out.join(' '), targets };
}

/** A short drill from a handful of words: each one three times, mixed up. */
export function wordDrill(words) {
  const out = words.flatMap(w => [w, w, w]);
  for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) { const j = out.findIndex((w, k) => k > i && w !== out[i] && w !== out[i - 2]); if (j > 0) [out[i], out[j]] = [out[j], out[i]]; }
  return out.join(' ');
}
