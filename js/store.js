// Persistent learner state, kept in localStorage under one key.

const KEY = 'verbatim:v1';
const HISTORY_CAP = 600;

export const DEFAULT_SETTINGS = {
  theme: 'system',        // system | light | dark
  ignoreCase: false,
  ignorePunctuation: false,
  stopOnError: false,     // wrong keys are rejected instead of shown
  autoIndent: true,       // code packs: skip leading spaces after Enter
  sound: true,            // chimes when an answer lands
  keySound: false,        // a soft tick on every key
  autoAdvance: true,      // clean answers roll straight into the next one
  markPoints: true,       // highlight the phrases that earn marks
  drills: true,           // offer a quick drill of the words you slipped on
  homeLayout: 'type',     // front page: type | set | plan
  textSize: 'm',          // s | m | l
  layout: 'overlay',      // overlay: type over the text | stacked: type on a line below it
  practiceLevel: 'gaps',  // gaps | more | recall
  dailyGoal: 150,
};

function fresh() {
  return {
    version: 1,
    xp: 0,
    settings: { ...DEFAULT_SETTINGS },
    items: {},
    days: {},
    history: [],
    achievements: {},
    chapters: {},           // practice bar per chapter: { level, day, items }
    skill: { keys: {}, pairs: {}, words: {} }, // typing skill model, see skill.js
    totals: { chars: 0, keystrokes: 0, errors: 0, items: 0, ms: 0, hints: 0, perfects: 0, laps: 0, lucky: 0 },
    bestCombo: 0,
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || raw.version !== 1) return fresh();
    const base = fresh();
    return {
      ...base,
      ...raw,
      settings: { ...base.settings, ...raw.settings },
      totals: { ...base.totals, ...raw.totals },
    };
  } catch {
    return fresh();
  }
}

export const state = load();
const listeners = new Set();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save progress', err);
  }
  for (const fn of listeners) fn(state);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function itemKey(packId, itemId) {
  return `${packId}/${itemId}`;
}

export function itemState(packId, itemId) {
  return state.items[itemKey(packId, itemId)] || null;
}

export function ensureItem(packId, itemId) {
  const k = itemKey(packId, itemId);
  state.items[k] ||= { box: 0, due: 0, seen: 0, clears: 0, recallClears: 0, bestWpm: 0, bestAcc: 0, last: 0 };
  return state.items[k];
}

export function pushHistory(entry) {
  state.history.push(entry);
  if (state.history.length > HISTORY_CAP) state.history.splice(0, state.history.length - HISTORY_CAP);
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function exportState() {
  return JSON.stringify(state, null, 2);
}

export function importState(text) {
  const data = JSON.parse(text);
  if (!data || data.version !== 1 || typeof data.items !== 'object') {
    throw new Error('This file is not a Verbatim progress export.');
  }
  const base = fresh();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, base, data, {
    settings: { ...base.settings, ...data.settings },
    totals: { ...base.totals, ...data.totals },
  });
  save();
}

export function resetState() {
  const keepSettings = state.settings;
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh(), { settings: keepSettings });
  save();
}
