// Picks what to study next, mixing typing practice with exam priorities. Shared by the home
// page variants and the play view (which rebuilds the same lists from a URL).
//
// "Cites" is how many mark schemes in the pack cite an answer: a rough measure of how often
// it comes up. Equation answers cite the syllabus rather than papers, so they count as 0.

import { state, itemState, dayKey } from './store.js';
import { stageOf, isDue } from './game.js';

export const citesOf = (pack, item) => (pack.kind === 'equation' ? 0 : (item.sources || []).length);

export function entriesFor(packs, subject, { code = false } = {}) {
  const out = [];
  for (const pack of packs) {
    if (subject && subject !== 'all' && pack.subject !== subject) continue;
    if (!code && pack.kind === 'code') continue;
    for (const unit of pack.units) for (const item of unit.items) {
      out.push({ pack, unit, item, stage: stageOf(pack.id, item.id), cites: citesOf(pack, item) });
    }
  }
  return out;
}

// A small deterministic random number per (seed, id), so a day's set stays the same all day.
function rand(seed, id) {
  let h = 2166136261;
  for (const ch of `${seed}|${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** How to study an answer right now: type it out when new, fill gaps while shaky, recall once known. */
export function studyMode(stage) {
  if (stage === 0) return { mode: 'train', level: null, label: 'Type it out' };
  if (stage <= 2) return { mode: 'practice', level: 'gaps', label: 'Fill the gaps' };
  return { mode: 'practice', level: 'recall', label: 'From memory' };
}

function currentUnit(packs, subject) {
  const last = state.lastPlay;
  const pack = last && packs.find(p => p.id === last.pack && (subject === 'all' || p.subject === subject));
  const unit = pack?.units.find(u => u.id === last.unit);
  if (unit && unit.items.some(it => stageOf(pack.id, it.id) === 0)) return { pack, unit };
  for (const p of packs) {
    if ((subject !== 'all' && p.subject !== subject) || p.kind === 'code') continue;
    const u = p.units.find(u => u.items.some(it => stageOf(p.id, it.id) === 0));
    if (u) return { pack: p, unit: u };
  }
  return null;
}

/** The single next answer to study, and why. `skip` holds keys to avoid repeating. */
export function nextUp(packs, subject, skip = new Set()) {
  const key = e => `${e.pack.id}/${e.item.id}`;
  const all = entriesFor(packs, subject).filter(e => !skip.has(key(e)));
  const due = all.filter(e => isDue(e.pack.id, e.item.id)).sort((a, b) => itemState(a.pack.id, a.item.id).due - itemState(b.pack.id, b.item.id).due);
  if (due.length) return { ...due[0], why: 'Due for review' };
  const shaky = all.filter(e => e.stage >= 1 && e.stage < 3 && e.cites > 0).sort((a, b) => b.cites - a.cites || a.stage - b.stage);
  if (shaky.length) return { ...shaky[0], why: `Often examined: in ${shaky[0].cites} mark schemes` };
  const cur = currentUnit(packs, subject);
  const fresh = cur ? all.filter(e => e.pack === cur.pack && e.unit === cur.unit && e.stage === 0) : [];
  if (fresh.length) return { ...fresh[0], why: `New in ${cur.unit.title}` };
  const rest = all.filter(e => e.stage < 5).sort((a, b) => b.cites - a.cites || a.stage - b.stage);
  return rest[0] ? { ...rest[0], why: rest[0].cites ? `Often examined: in ${rest[0].cites} mark schemes` : 'Keep it fresh' } : null;
}

/**
 * Today's exam set: questions that come up most and that you know least, at most two per
 * chapter so it reads like a paper rather than one topic. Same set all day.
 */
export function examSet(packs, subject, n = 10) {
  const seed = `${dayKey()}|${subject}`;
  const scored = entriesFor(packs, subject)
    .filter(e => e.cites > 0)
    .map(e => ({ ...e, score: e.cites * (1.6 - (e.stage / 5) * 1.2) * (0.7 + 0.6 * rand(seed, e.item.id)) }))
    .sort((a, b) => b.score - a.score);
  const perUnit = new Map();
  const out = [];
  for (const e of scored) {
    const k = `${e.pack.id}/${e.unit.id}`;
    if ((perUnit.get(k) || 0) >= 2) continue;
    perUnit.set(k, (perUnit.get(k) || 0) + 1);
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}

/** Today's plan: reviews due, weak spots that are often examined, then new answers. */
export function todayPlan(packs, subject) {
  const all = entriesFor(packs, subject);
  const review = all.filter(e => isDue(e.pack.id, e.item.id)).slice(0, 10);
  const reviewKeys = new Set(review.map(e => e.item.id + e.pack.id));
  const weak = all.filter(e => e.stage >= 1 && e.stage < 4 && e.cites > 0 && !reviewKeys.has(e.item.id + e.pack.id))
    .sort((a, b) => a.stage - b.stage || b.cites - a.cites).slice(0, 6);
  const cur = currentUnit(packs, subject);
  const fresh = cur ? cur.unit.items.filter(it => stageOf(cur.pack.id, it.id) === 0).slice(0, 5)
    .map(item => ({ pack: cur.pack, unit: cur.unit, item, stage: 0, cites: citesOf(cur.pack, item) })) : [];
  return { review, weak, fresh, freshUnit: cur };
}

/** How many of these answers were finished today. */
export function doneToday(entries) {
  const today = dayKey();
  const done = new Set(state.history.filter(h => dayKey(h.t) === today).map(h => `${h.p}/${h.i}`));
  return entries.filter(e => done.has(`${e.pack.id}/${e.item.id}`)).length;
}

/** Rebuild a named list for the play view. */
export function setEntries(packs, name, subject) {
  if (name === 'exam') return examSet(packs, subject);
  const plan = todayPlan(packs, subject);
  if (name === 'weak') return plan.weak;
  if (name === 'new') return plan.fresh;
  if (name === 'review') return plan.review;
  return [];
}
