// Progression rules: XP, levels, marks, mastery, unlocks, streaks and achievements.

import { state, ensureItem, itemState, dayKey } from './store.js';

const DAY = 86400000;

// ---- Levels ---------------------------------------------------------------

export function xpForLevel(level) {
  // Total XP needed to reach `level` (level 1 needs 0).
  return level <= 1 ? 0 : Math.round(40 * Math.pow(level - 1, 1.6));
}

export function levelFromXp(xp) {
  let lvl = 1;
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  const floor = xpForLevel(lvl);
  const next = xpForLevel(lvl + 1);
  return { level: lvl, into: xp - floor, span: next - floor, toNext: next - xp };
}

const GRADES = [
  [1, 'U'], [3, 'E'], [5, 'D'], [7, 'C'], [10, 'B'], [13, 'A'], [17, 'A*'],
  [22, 'Examiner'], [30, 'Principal examiner'], [40, 'Chief examiner'],
];

export function gradeFor(level) {
  let g = GRADES[0][1];
  for (const [min, name] of GRADES) if (level >= min) g = name;
  return g;
}

export function nextGrade(level) {
  return GRADES.find(([min]) => min > level) || null;
}

// ---- Mastery --------------------------------------------------------------

// Stage 0 new, 1 copied, 2 filled in the gaps, 3-5 recalled from memory.
export const STAGES = ['New', 'Copied', 'Gaps filled', 'Recalled', 'Secure', 'Mastered'];
const INTERVAL_DAYS = [0, 1, 2, 4, 9, 21];
export const MODES = {
  copy:   { label: 'Copy',   mask: 0,   mult: 1,   cap: 1, blurb: 'The full answer is shown. Type it exactly.' },
  gaps:   { label: 'Gaps',   mask: 0.45, mult: 1.6, cap: 2, blurb: 'Key words are hidden. Fill them in as you go.' },
  recall: { label: 'Recall', mask: 1,   mult: 2.5, cap: 5, blurb: 'Only the question is shown. Type the answer from memory.' },
};

export function stageOf(packId, itemId) {
  return itemState(packId, itemId)?.box ?? 0;
}

export function isDue(packId, itemId, now = Date.now()) {
  const s = itemState(packId, itemId);
  return !!s && s.box >= 1 && s.due <= now;
}

// Best mode to practise an item in next, given its stage.
export function suggestedMode(packId, itemId) {
  const box = stageOf(packId, itemId);
  return box === 0 ? 'copy' : box === 1 ? 'gaps' : 'recall';
}

// ---- Scoring --------------------------------------------------------------

// Marked like an exam answer: what counts is the finished text. Mistakes you fixed along the
// way only stop the third tick if there were a lot of them.
export function marksFor(answerAcc, keyAcc, hints) {
  if (answerAcc >= 0.999 && hints === 0 && keyAcc >= 0.97) return 3;
  if (answerAcc >= 0.98) return 2;
  if (answerAcc >= 0.9) return 1;
  return 0;
}

/**
 * Apply a finished attempt to the learner's state and return what changed.
 * result: { packId, itemId, mode, chars, keystrokes, errors, uncorrected, ms, hints, revealed }
 * `errors` counts every wrong key; `uncorrected` counts the ones still wrong at the end.
 */
export function applyResult(result, combo) {
  const { packId, itemId, mode, chars, ms, hints, revealed } = result;
  const acc = result.keystrokes ? Math.max(0, (result.keystrokes - result.errors) / result.keystrokes) : 0;
  const uncorrected = result.uncorrected || 0;
  const answerAcc = chars ? Math.max(0, 1 - uncorrected / chars) : 0;
  const corrected = Math.max(0, result.errors - uncorrected);
  const minutes = Math.max(ms, 1) / 60000;
  const wpm = (chars / 5) / minutes;
  const marks = marksFor(answerAcc, acc, hints);
  const s = ensureItem(packId, itemId);
  const firstClear = s.clears === 0;
  const before = s.box;
  const cfg = MODES[mode];

  // Mastery: a clean attempt promotes up to the mode's cap; a poor recall demotes.
  const hintShare = chars ? revealed / chars : 0;
  if (marks >= 2 && hintShare < 0.25) {
    if (mode === 'recall') s.box = Math.min(5, Math.max(s.box + 1, 3));
    else s.box = Math.max(s.box, Math.min(s.box + 1, cfg.cap));
  } else if (mode === 'recall' && marks === 0 && s.box > 2) {
    s.box -= 1;
  }
  s.due = Date.now() + INTERVAL_DAYS[s.box] * DAY;
  s.seen += 1;
  if (marks >= 1) s.clears += 1;
  if (mode === 'recall' && marks >= 2 && hints === 0) s.recallClears += 1;
  s.bestWpm = Math.max(s.bestWpm, Math.round(wpm));
  s.bestAcc = Math.max(s.bestAcc, acc);
  s.last = Date.now();

  // XP
  const nextCombo = marks >= 2 ? combo + 1 : 0;
  const words = chars / 5;
  const parts = [];
  const base = words * 2 * cfg.mult;
  parts.push([`${Math.round(words)} words in ${cfg.label.toLowerCase()} mode`, base]);
  // Wrong text left in the answer costs a lot; fixed mistakes cost half their share.
  const answerMult = Math.pow(answerAcc, 3);
  const fixMult = 1 - 0.5 * (1 - acc);
  const accMult = answerMult * fixMult;
  const speedMult = 1 + Math.min(wpm, 100) / 200;
  const comboMult = 1 + Math.min(nextCombo, 10) * 0.05;
  const hintMult = Math.max(0.3, 1 - hints * 0.1);
  let xp = base * accMult * speedMult * comboMult * hintMult;
  if (uncorrected) parts.push([`${uncorrected} wrong in the final answer ×${answerMult.toFixed(2)}`, null]);
  if (corrected) parts.push([`${corrected} fixed mistake${corrected > 1 ? 's' : ''} ×${fixMult.toFixed(2)}`, null]);
  parts.push([`Speed ×${speedMult.toFixed(2)}`, null]);
  if (nextCombo > 1) parts.push([`Streak of ${nextCombo} ×${comboMult.toFixed(2)}`, null]);
  if (hints) parts.push([`${hints} hint${hints > 1 ? 's' : ''} ×${hintMult.toFixed(1)}`, null]);
  if (firstClear && marks >= 1) { xp += 10; parts.push(['First clear', 10]); }
  const gained = Math.max(0, s.box - before);
  if (gained) { xp += gained * 8; parts.push([`Moved to “${STAGES[s.box]}”`, gained * 8]); }
  xp = marks === 0 ? Math.max(1, Math.round(xp * 0.3)) : Math.max(1, Math.round(xp));

  const levelBefore = levelFromXp(state.xp).level;
  state.xp += xp;
  const levelAfter = levelFromXp(state.xp).level;
  const today = dayKey();
  const dailyBefore = state.days[today] || 0;
  state.days[today] = dailyBefore + xp;

  state.totals.chars += chars;
  state.totals.keystrokes += result.keystrokes;
  state.totals.errors += result.errors;
  state.totals.items += 1;
  state.totals.ms += ms;
  state.totals.hints += hints;
  state.bestCombo = Math.max(state.bestCombo, nextCombo);

  return {
    acc, answerAcc, corrected, uncorrected, wpm, marks, xp, parts, combo: nextCombo,
    stageBefore: before, stageAfter: s.box,
    levelBefore, levelAfter,
    dailyGoalHit: dailyBefore < state.settings.dailyGoal && state.days[today] >= state.settings.dailyGoal,
  };
}

// ---- Unlocks --------------------------------------------------------------

export const UNLOCK_SHARE = 0.6;

export function unitProgress(pack, unit) {
  const n = unit.items.length;
  let learned = 0, mastered = 0, stageSum = 0;
  for (const it of unit.items) {
    const b = stageOf(pack.id, it.id);
    if (b >= 1) learned++;
    if (b >= 5) mastered++;
    stageSum += b;
  }
  return { n, learned, mastered, share: n ? stageSum / (n * 5) : 0 };
}

export function isUnitUnlocked(pack, index) {
  if (index === 0 || state.settings.unlockAll) return true;
  const prev = pack.units[index - 1];
  const p = unitProgress(pack, prev);
  return isUnitUnlocked(pack, index - 1) && p.learned >= Math.ceil(p.n * UNLOCK_SHARE);
}

// ---- Streaks --------------------------------------------------------------

export function streak() {
  let count = 0;
  let t = Date.now();
  if (!state.days[dayKey(t)]) t -= DAY; // today not started yet: count up to yesterday
  while (state.days[dayKey(t)]) { count++; t -= DAY; }
  return { count, today: !!state.days[dayKey()] };
}

// ---- Achievements ---------------------------------------------------------

export const ACHIEVEMENTS = [
  { id: 'first', name: 'First answer', desc: 'Finish your first answer.', test: c => c.items >= 1 },
  { id: 'items-25', name: 'Warmed up', desc: 'Finish 25 answers.', test: c => c.items >= 25 },
  { id: 'items-100', name: 'Revision mode', desc: 'Finish 100 answers.', test: c => c.items >= 100 },
  { id: 'items-500', name: 'Past paper machine', desc: 'Finish 500 answers.', test: c => c.items >= 500 },
  { id: 'perfect', name: 'Full marks', desc: 'Finish an answer with 100% accuracy.', test: c => c.last?.marks === 3 },
  { id: 'recall', name: 'From memory', desc: 'Recall an answer with no hints and at least 95% accuracy.', test: c => c.last?.mode === 'recall' && c.last.marks >= 2 && c.last.hints === 0 },
  { id: 'wpm-40', name: 'Steady hand', desc: 'Type a 60+ character answer at 40 WPM.', test: c => c.last?.chars >= 60 && c.last.wpm >= 40 && c.last.marks >= 1 },
  { id: 'wpm-70', name: 'Exam pace', desc: 'Type a 60+ character answer at 70 WPM.', test: c => c.last?.chars >= 60 && c.last.wpm >= 70 && c.last.marks >= 1 },
  { id: 'wpm-100', name: 'Out of time? Never.', desc: 'Type a 60+ character answer at 100 WPM.', test: c => c.last?.chars >= 60 && c.last.wpm >= 100 && c.last.marks >= 1 },
  { id: 'combo-10', name: 'On a roll', desc: 'Get 10 answers in a row at 95%+ accuracy.', test: c => c.bestCombo >= 10 },
  { id: 'streak-3', name: 'Three days', desc: 'Practise three days in a row.', test: c => c.streak >= 3 },
  { id: 'streak-7', name: 'A full week', desc: 'Practise seven days in a row.', test: c => c.streak >= 7 },
  { id: 'streak-30', name: 'Term-long habit', desc: 'Practise thirty days in a row.', test: c => c.streak >= 30 },
  { id: 'goal', name: 'Goal met', desc: 'Reach your daily XP goal.', test: c => c.goalMet },
  { id: 'master-1', name: 'Mastered one', desc: 'Bring any answer to “Mastered”.', test: c => c.mastered >= 1 },
  { id: 'master-25', name: 'Mastered 25', desc: 'Bring 25 answers to “Mastered”.', test: c => c.mastered >= 25 },
  { id: 'grade-c', name: 'Grade C', desc: 'Reach grade C.', test: c => c.level >= 7 },
  { id: 'grade-a', name: 'Grade A', desc: 'Reach grade A.', test: c => c.level >= 13 },
  { id: 'grade-astar', name: 'A*', desc: 'Reach grade A*.', test: c => c.level >= 17 },
  { id: 'examiner', name: 'Examiner', desc: 'Reach the examiner levels.', test: c => c.level >= 22 },
];

/** Check achievements; returns the newly earned ones. `last` is the latest attempt summary. */
export function checkAchievements(last) {
  const ctx = {
    items: state.totals.items,
    bestCombo: state.bestCombo,
    streak: streak().count,
    goalMet: Object.values(state.days).some(v => v >= state.settings.dailyGoal),
    mastered: Object.values(state.items).filter(s => s.box >= 5).length,
    level: levelFromXp(state.xp).level,
    last,
  };
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    if (!state.achievements[a.id] && a.test(ctx)) {
      state.achievements[a.id] = Date.now();
      earned.push(a);
    }
  }
  return earned;
}
