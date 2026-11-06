// Hand-off to AI agents (see agents.md at the site root).
//
// A snapshot is a JSON file of the learner's typing data that the page downloads to their own
// computer, so an agent running there can read and analyse it. Nothing is sent anywhere.
// An exercise set is JSON an agent writes and hands back as a link (#/load?x=...); the learner
// confirms before it is added, and results are kept on each exercise for the next snapshot.

import { state, save, dayKey } from './store.js';
import { usualWpm, STAGES, PROGRESS } from './game.js';
import { weakest, keyTable } from './skill.js';
import { course, letterStatus } from './course.js';

export const SNAPSHOT_FORMAT = 'verbatim-snapshot/1';
export const EXERCISE_FORMAT = 'verbatim-exercises/1';
export const SITE = 'https://michaelihc.github.io/verbatim/';
export const GUIDE_URL = `${SITE}agents.md`;

const DAY = 86400000;
const r1 = x => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
const r3 = x => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const iso = t => new Date(t).toISOString();

function weekStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d.getTime());
}

/** Answer id -> { term, chapter, subject } for readable output. */
function itemIndex(packs) {
  const idx = new Map();
  for (const p of packs) for (const u of p.units) for (const it of u.items) {
    idx.set(`${p.id}/${it.id}`, { term: it.term, chapter: u.title, subject: p.subject, pack: p.title });
  }
  return idx;
}

const weakRow = r => ({ key: r.k, ...(r.forms ? { forms: Object.keys(r.forms) } : {}), ms: r.ms, vsMedian: r1(r.ratio), errorRate: r3(r.err), samples: r.n });

/** Build the snapshot. `full` adds every answer in the history, the whole skill model and every daily record. */
export function buildSnapshot(packs, { full = false } = {}) {
  const idx = itemIndex(packs);
  const H = state.history || [];
  const now = Date.now();
  const net = H.filter(e => e.v === 2);
  const span = days => net.filter(e => e.t >= now - days * DAY);
  const speedOver = days => {
    const es = span(days);
    return { answers: es.length, wpm: r1(mean(es.map(e => e.wpm))), accuracy: r3(mean(es.map(e => e.acc))) };
  };

  const weeks = new Map();
  for (const e of H) {
    const k = weekStart(e.t);
    const w = weeks.get(k) || { weekOf: k, answers: 0, wpm: [], acc: [] };
    w.answers++;
    if (e.v === 2) { w.wpm.push(e.wpm); w.acc.push(e.acc); }
    weeks.set(k, w);
  }
  const weekly = [...weeks.values()].map(w => ({ weekOf: w.weekOf, answers: w.answers, wpm: r1(mean(w.wpm)), accuracy: r3(mean(w.acc)) }));

  const tests = state.tests || [];
  const bestByLength = {};
  for (const t of tests) {
    const k = `${t.d}s`;
    if (!bestByLength[k] || t.wpm > bestByLength[k].wpm) bestByLength[k] = { wpm: t.wpm, accuracy: t.acc, date: iso(t.t), text: t.src };
  }

  const answers = Object.entries(state.items)
    .filter(([, s]) => s.seen)
    .map(([k, s]) => {
      const info = idx.get(k) || {};
      const stage = s.fl ?? (s.seen ? 1 : 0);
      return {
        id: k, term: info.term, chapter: info.chapter, subject: info.subject,
        stage: STAGES[stage], timesTyped: s.seen, bestWpm: s.bestWpm, bestKeyAccuracy: r3(s.bestAcc),
        lastRating: s.lastRating || null, lastTyped: s.last ? iso(s.last) : null,
        ...(s.flDue && stage >= 3 ? { speedCheckDue: iso(s.flDue) } : {}),
      };
    })
    .sort((a, b) => (b.lastTyped || '').localeCompare(a.lastTyped || ''));
  const stageCounts = {};
  for (const a of answers) stageCounts[a.stage] = (stageCounts[a.stage] || 0) + 1;

  const weakKeys = weakest('keys', 15);
  const weakPairs = weakest('pairs', 25);
  const weakWords = weakest('words', 25);

  // Daily records of key and pair speed, for trends. Compact mode keeps only the weak spots.
  const daily = state.skillDaily || {};
  const series = (kind, keys) => Object.fromEntries(keys.map(k => [k, Object.entries(daily)
    .filter(([, d]) => d[kind]?.[k]).map(([day, d]) => [day, d[kind][k][0], d[kind][k][1] / 1000])]).filter(([, v]) => v.length));

  const c = course();
  const subjects = [...new Set(packs.map(p => p.subject))];
  const lastSubject = packs.find(p => p.id === state.lastPlay?.pack)?.subject || null;

  const history = (full ? H : H.slice(-150)).map(e => {
    const info = idx.get(`${e.p}/${e.i}`) || {};
    return { at: iso(e.t), term: info.term, chapter: info.chapter, mode: e.m, chars: e.c ?? null, wpm: e.wpm, keyAccuracy: e.acc, rating: e.r, netSpeed: e.v === 2 };
  });

  return {
    format: SNAPSHOT_FORMAT,
    guide: GUIDE_URL,
    note: 'Verbatim typing data for an AI agent to analyse. The guide explains every field, how to give feedback and how to hand exercises back.',
    createdAt: iso(now),
    full,
    subjects: { all: subjects, lastTrained: lastSubject },
    profile: {
      usualWpm: r1(usualWpm()),
      answersTyped: state.totals.items,
      minutesTyping: r1(state.totals.ms / 60000),
      keystrokes: state.totals.keystrokes,
      activeDays: Object.keys(state.days).length,
      firstActive: Object.keys(state.days).sort()[0] || null,
      settings: Object.fromEntries(['stopOnError', 'noBackspace', 'showKeyboard', 'ignoreCase', 'ignorePunctuation', 'layout'].map(k => [k, state.settings[k]])),
    },
    speed: { last7Days: speedOver(7), last30Days: speedOver(30), weekly },
    speedTests: { bestByLength, all: tests.map(t => ({ at: iso(t.t), seconds: t.d, text: t.src, ...(t.unit ? { chapter: (idx.get(t.unit) || {}).chapter || t.unit } : {}), wpm: t.wpm, rawWpm: t.raw, accuracy: t.acc, consistency: t.cons })) },
    weakSpots: { keys: weakKeys.map(weakRow), pairs: weakPairs.map(weakRow), words: weakWords.map(weakRow) },
    keyboard: Object.fromEntries(Object.entries(keyTable()).map(([k, e]) => [k, { ms: e.ms, vsMedian: r1(e.ratio), errorRate: r3(e.err), samples: e.n }])),
    trends: full
      ? { days: daily }
      : { keys: series('keys', weakKeys.map(r => r.k)), pairs: series('pairs', weakPairs.map(r => r.k)) },
    fluency: { stages: STAGES, counts: stageCounts, progressName: PROGRESS.name },
    answers,
    keyCourse: { lettersUnlocked: c.n, targetWpm: c.target, letters: letterStatus().map(s => ({ letter: s.l, unlocked: s.unlocked, atTarget: s.ready, wpm: s.ms ? Math.round(12000 / s.ms) : null, errorRate: r3(s.err) })) },
    exercises: (state.exercises || []).map(x => ({ id: x.id, set: x.set, title: x.title, kind: x.kind, seconds: x.seconds || null, from: x.from || null, added: iso(x.added), results: x.results.map(r => ({ at: iso(r.t), wpm: r.wpm, rawWpm: r.raw, keyAccuracy: r.acc })) })),
    history,
    ...(full ? { skillModel: state.skill } : {}),
  };
}

export function snapshotFileName(full) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `verbatim-snapshot-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${full ? '-full' : ''}.json`;
}

export function downloadJson(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return blob.size;
}

// ---- exercises --------------------------------------------------------------

const LIMITS = { exercises: 20, text: 2400, title: 80, note: 400 };
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function decodeBase64Url(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
}

/**
 * Read an exercise set from a #/load link: x = base64url of UTF-8 JSON, or j = the JSON itself.
 * Returns { title, from, note, exercises } or throws an Error with a readable message.
 */
export function readExerciseSet(q) {
  let raw;
  try {
    raw = q.get('x') ? decodeBase64Url(q.get('x')) : q.get('j');
  } catch {
    throw new Error('The link is damaged: its exercise data could not be decoded.');
  }
  if (!raw) throw new Error('This link has no exercises in it.');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('The link is damaged: its exercises are not valid JSON.'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.exercises)) throw new Error('This link is not a Verbatim exercise set.');
  const exercises = data.exercises.slice(0, LIMITS.exercises).map((x, i) => {
    let text = clean(x?.text, LIMITS.text);
    const repeat = Math.max(1, Math.min(5, Math.round(Number(x?.repeat) || 1)));
    if (repeat > 1) text = Array(repeat).fill(text).join(' ').slice(0, LIMITS.text * 2);
    const seconds = Number(x?.seconds);
    const kind = x?.kind === 'test' || (seconds > 0 && x?.kind !== 'drill') ? 'test' : 'drill';
    return {
      title: clean(x?.title, LIMITS.title) || `Exercise ${i + 1}`,
      kind,
      seconds: kind === 'test' ? Math.max(10, Math.min(300, Math.round(seconds) || 60)) : null,
      text,
      note: clean(x?.note, LIMITS.note),
    };
  }).filter(x => x.text.length >= 3);
  if (!exercises.length) throw new Error('This exercise set has no exercises with text to type.');
  return { title: clean(data.title, LIMITS.title) || 'Exercises', from: clean(data.from, 40), note: clean(data.note, LIMITS.note), exercises };
}

/** Add a confirmed set. Exercises already loaded (same set, title and text) are skipped. */
export function addExerciseSet(set) {
  state.exercises ||= [];
  const setId = `set-${Date.now().toString(36)}`;
  let added = 0;
  for (const x of set.exercises) {
    if (state.exercises.some(e => e.set === set.title && e.title === x.title && e.text === x.text)) continue;
    state.exercises.push({ id: `ex-${Date.now().toString(36)}-${added}`, setId, set: set.title, from: set.from, setNote: set.note, ...x, added: Date.now(), results: [] });
    added++;
  }
  save();
  return added;
}

export function exercisesPending() {
  return (state.exercises || []).filter(x => !x.results.length);
}

export function recordExercise(id, result) {
  const x = (state.exercises || []).find(e => e.id === id);
  if (!x) return;
  x.results.push(result);
  if (x.results.length > 20) x.results.splice(0, x.results.length - 20);
}

export function removeExercise(id) {
  state.exercises = (state.exercises || []).filter(e => e.id !== id);
  save();
}
