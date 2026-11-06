// Key course: learn the keyboard a few letters at a time, the way adaptive touch-typing tutors
// do it, but with the subject's own vocabulary.
//
// It starts with six common letters. Rounds use real syllabus words made only of unlocked
// letters, topped up with made-up words that follow the letter patterns of syllabus words, and
// lean on the letter that needs most work. A new letter unlocks once every unlocked letter is at
// the target speed with few errors (measured by the skill model, see skill.js).

import { state } from './store.js';
import { keyTable } from './skill.js';

export const ORDER = 'enitrlsaoudchmgpyfbvwkxqjz';
export const TARGETS = [25, 35, 45, 60];
const MAX_ERR = 0.06;
const MIN_PRESSES = 15;

export function course() {
  state.course ||= { n: 6, target: 35 };
  return state.course;
}

const msFor = wpm => 12000 / wpm; // one character at this speed

/** Each letter's progress towards the target: share 0-1, ready when at target and accurate. */
export function letterStatus() {
  const c = course();
  const keys = keyTable();
  const target = msFor(c.target);
  return [...ORDER].map((l, i) => {
    const k = keys[l];
    const unlocked = i < c.n;
    const share = k?.ms ? Math.min(1, target / k.ms) * (k.err <= MAX_ERR ? 1 : 0.85) : 0;
    const ready = !!k && k.n >= MIN_PRESSES && k.ms != null && k.ms <= target && k.err <= MAX_ERR;
    return { l, unlocked, share, ready, ms: k?.ms ?? null, err: k?.err ?? null, n: k?.n ?? 0, newest: i === c.n - 1 };
  });
}

/** The unlocked letter to lean on: the newest until it is ready, then the furthest behind. */
export function focusLetter(status = letterStatus()) {
  const open = status.filter(s => s.unlocked);
  const newest = open.at(-1);
  if (newest && !newest.ready) return newest.l;
  return [...open].sort((a, b) => a.share - b.share)[0]?.l;
}

/** Unlock the next letter if every unlocked one is ready. Returns the new letter or null. */
export function maybeUnlock() {
  const c = course();
  if (c.n >= ORDER.length) return null;
  if (!letterStatus().filter(s => s.unlocked).every(s => s.ready)) return null;
  c.n += 1;
  return ORDER[c.n - 1];
}

// ---- words ----------------------------------------------------------------

let chain = null;
let chainFor = null;

/**
 * Letter transition counts from the syllabus words, keyed on the previous two letters, with the
 * previous one letter as a fallback ('^' pads the start, '$' ends a word).
 */
function buildChain(words) {
  const t = { 2: {}, 1: {} };
  for (const { low, n } of words) {
    if (!/^[a-z]+$/.test(low)) continue;
    const w = `^^${low}$`;
    for (let i = 2; i < w.length; i++) {
      for (const k of [2, 1]) {
        const row = t[k][w.slice(i - k, i)] ||= {};
        row[w[i]] = (row[w[i]] || 0) + Math.sqrt(n);
      }
    }
  }
  return t;
}

function fakeWord(allowed, focus, rnd = Math.random) {
  for (let attempt = 0; attempt < 60; attempt++) {
    let ctx = '^^';
    let w = '';
    while (w.length < 9) {
      const fits = row => Object.entries(row || {}).filter(([c]) => c === '$' ? w.length >= 3 : allowed.has(c));
      let opts = fits(chain[2][ctx]);
      if (!opts.length && w.length) opts = fits(chain[1][ctx[1]]);
      if (!opts.length) break;
      const total = opts.reduce((s, [, v]) => s + v, 0);
      let r = rnd() * total;
      let next = opts.at(-1)[0];
      for (const [c, v] of opts) { r -= v; if (r <= 0) { next = c; break; } }
      if (next === '$') break;
      w += next;
      ctx = ctx[1] + next;
    }
    if (w.length >= 3 && (!focus || w.includes(focus)) && !/(.)/.test(w)) return w;
  }
  return null;
}

/**
 * A round of course words: real syllabus words that use only unlocked letters (lower case),
 * topped up with made-up words in the same letter patterns, about half containing the focus.
 */
export function courseRound(vocab, size = 16) {
  if (chainFor !== vocab) { chain = buildChain(vocab); chainFor = vocab; }
  const c = course();
  const allowed = new Set(ORDER.slice(0, c.n));
  const focus = focusLetter();
  const real = vocab.filter(x => /^[a-z]+$/.test(x.low) && [...x.low].every(ch => allowed.has(ch)));
  const realFocus = real.filter(x => x.low.includes(focus));
  const out = [];
  const pick = list => list[(Math.random() * list.length) | 0]?.low;
  let guard = 0;
  while (out.length < size && guard++ < 200) {
    const wantFocus = out.length % 2 === 0;
    const useReal = Math.random() < (real.length > 30 ? 0.7 : 0.4);
    let w = null;
    if (useReal) w = pick(wantFocus && realFocus.length ? realFocus : real);
    if (!w) w = fakeWord(allowed, wantFocus ? focus : null);
    if (w && out.filter(x => x === w).length < 2) out.push(w);
  }
  return { text: out.join(' '), focus, letters: [...allowed] };
}
