// Progression rules: XP, levels, ratings, combos, mastery, streaks and achievements.
//
// The reward loop is built on a few well-studied ideas:
// - Immediate, graded feedback on every answer (rating, XP, sound), so effort and reward are
//   tightly coupled.
// - A combo multiplier that grows with each clean answer. It makes the next answer feel worth
//   more, and losing it stings a little (loss aversion), which keeps attention on accuracy.
// - Occasional bonus drops (variable-ratio rewards). Most answers pay a predictable amount; now
//   and then one pays double or five times. Unpredictable rewards hold interest far longer than
//   fixed ones.
// - Visible progress towards near goals (the lap, the daily goal, the next level), which speeds
//   people up as they get close (the goal-gradient effect).

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

const TITLES = [
  [1, 'Rookie'], [3, 'Apprentice'], [6, 'Regular'], [10, 'Sharp'], [15, 'Fluent'],
  [21, 'Expert'], [28, 'Master'], [36, 'Grandmaster'], [45, 'Legend'],
];

export function titleFor(level) {
  let t = TITLES[0][1];
  for (const [min, name] of TITLES) if (level >= min) t = name;
  return t;
}

// ---- Modes and mastery ----------------------------------------------------

// Stage 0 new, 1 typed out in train mode, 2 filled the gaps, 3-5 recalled from memory.
export const STAGES = ['New', 'Trained', 'Gaps', 'Recalled', 'Secure', 'Mastered'];
const INTERVAL_DAYS = [0, 1, 2, 4, 9, 21];

export const MODES = {
  train:    { label: 'Train', blurb: 'The answer is on screen. Type it out, over and over, until your fingers know it.' },
  practice: { label: 'Practice', blurb: 'Words are hidden. Fill them in from memory.' },
};

export const LEVELS = {
  gaps:   { label: 'Some gaps', short: 'Gaps', mask: 0.35, mult: 1.6, cap: 2 },
  more:   { label: 'Most gaps', short: 'More', mask: 0.7, mult: 2, cap: 2 },
  recall: { label: 'From memory', short: 'Memory', mask: 1, mult: 2.5, cap: 5 },
};

export function maskRatio(mode, level) {
  return mode === 'practice' ? (LEVELS[level] || LEVELS.gaps).mask : 0;
}

export function stageOf(packId, itemId) {
  return itemState(packId, itemId)?.box ?? 0;
}

export function isDue(packId, itemId, now = Date.now()) {
  const s = itemState(packId, itemId);
  return !!s && s.box >= 3 && s.due <= now;
}

// ---- Ratings --------------------------------------------------------------

export const RATINGS = {
  perfect: { label: 'Perfect', rank: 4 },
  great:   { label: 'Great', rank: 3 },
  good:    { label: 'Good', rank: 2 },
  ok:      { label: 'Keep going', rank: 1 },
};

// What counts most is the finished text; fixed slips only cost the top rating.
export function rate(answerAcc, keyAcc, hints) {
  if (answerAcc >= 0.999 && keyAcc >= 0.999 && hints === 0) return 'perfect';
  if (answerAcc >= 0.999 && keyAcc >= 0.93 && hints <= 1) return 'great';
  if (answerAcc >= 0.97) return 'good';
  return 'ok';
}

export function comboMult(combo) {
  return 1 + Math.min(combo, 20) * 0.1;
}

function rollBonus(rank) {
  if (rank < 2) return null;
  const r = Math.random();
  if (r < 0.025) return { kind: 'jackpot', mult: 5, label: 'Jackpot ×5' };
  if (r < 0.14) return { kind: 'lucky', mult: 2, label: 'Lucky ×2' };
  return null;
}

/**
 * Apply a finished attempt to the learner's state and return what changed.
 * result: { packId, itemId, mode, level, chars, keystrokes, errors, uncorrected, ms, hints, revealed }
 * `errors` counts every wrong key; `uncorrected` counts the ones still wrong at the end.
 */
export function applyResult(result, combo) {
  const { packId, itemId, mode, chars, ms, hints, revealed } = result;
  const level = mode === 'practice' ? (LEVELS[result.level] ? result.level : 'gaps') : null;
  const acc = result.keystrokes ? Math.max(0, (result.keystrokes - result.errors) / result.keystrokes) : 0;
  const uncorrected = result.uncorrected || 0;
  const answerAcc = chars ? Math.max(0, 1 - uncorrected / chars) : 0;
  const corrected = Math.max(0, result.errors - uncorrected);
  const minutes = Math.max(ms, 1) / 60000;
  const wpm = (chars / 5) / minutes;
  const rating = rate(answerAcc, acc, hints);
  const rank = RATINGS[rating].rank;
  const s = ensureItem(packId, itemId);
  const firstClear = s.clears === 0;
  const before = s.box;
  const prevBestWpm = s.bestWpm;

  // Mastery: a clean attempt promotes up to what the mode can prove; a poor recall demotes.
  const hintShare = chars ? revealed / chars : 0;
  if (rank >= 3 && hintShare < 0.25) {
    if (mode === 'train') s.box = Math.max(s.box, 1);
    else if (level === 'recall') s.box = Math.min(5, Math.max(s.box + 1, 3));
    else s.box = Math.max(s.box, Math.min(s.box + 1, LEVELS[level].cap));
  } else if (level === 'recall' && rank === 1 && s.box > 2) {
    s.box -= 1;
  }
  if (mode === 'practice' || s.box !== before) s.due = Date.now() + INTERVAL_DAYS[s.box] * DAY;
  s.seen += 1;
  if (rank >= 2) s.clears += 1;
  if (level === 'recall' && rank >= 3) s.recallClears += 1;
  s.bestWpm = Math.max(s.bestWpm, Math.round(wpm));
  s.bestAcc = Math.max(s.bestAcc, acc);
  s.last = Date.now();
  s.lastRating = rating;

  // Combo: clean answers build it, a "good" holds it, a rough one breaks it.
  const nextCombo = rank >= 3 ? combo + 1 : rank === 2 ? combo : 0;
  const mult = comboMult(nextCombo);

  // XP
  const words = chars / 5;
  const modeMult = mode === 'practice' ? LEVELS[level].mult : 1;
  const base = words * 2 * modeMult;
  const accMult = Math.pow(answerAcc, 3) * (1 - 0.5 * (1 - acc));
  const speedMult = 1 + Math.min(wpm, 120) / 240;
  const hintMult = Math.max(0.3, 1 - hints * 0.1);
  const ratingMult = rating === 'perfect' ? 1.25 : 1;
  let xp = base * accMult * speedMult * hintMult * ratingMult * mult;
  if (firstClear && rank >= 2) xp += 10;
  const gained = Math.max(0, s.box - before);
  xp += gained * 8;
  xp = rank === 1 ? Math.max(1, Math.round(xp * 0.4)) : Math.max(1, Math.round(xp));
  const bonus = rollBonus(rank);
  const baseXp = xp;
  if (bonus) xp *= bonus.mult;

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
  if (rating === 'perfect') state.totals.perfects += 1;
  if (bonus) state.totals.lucky += 1;
  state.bestCombo = Math.max(state.bestCombo, nextCombo);

  return {
    acc, answerAcc, corrected, uncorrected, wpm, rating, rank, xp, baseXp, bonus,
    combo: nextCombo, comboBefore: combo, comboMult: mult,
    bestWpm: prevBestWpm > 0 && Math.round(wpm) > prevBestWpm && rank >= 3 ? Math.round(wpm) : 0,
    stageBefore: before, stageAfter: s.box,
    levelBefore, levelAfter,
    dailyGoalHit: dailyBefore < state.settings.dailyGoal && state.days[today] >= state.settings.dailyGoal,
  };
}

// ---- Chapter progress -----------------------------------------------------

export function unitProgress(pack, unit) {
  const n = unit.items.length;
  let started = 0, mastered = 0, stageSum = 0;
  for (const it of unit.items) {
    const b = stageOf(pack.id, it.id);
    if (b >= 1) started++;
    if (b >= 5) mastered++;
    stageSum += b;
  }
  return { n, started, mastered, share: n ? stageSum / (n * 5) : 0 };
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
  { id: 'items-100', name: 'In the zone', desc: 'Finish 100 answers.', test: c => c.items >= 100 },
  { id: 'items-500', name: 'Machine', desc: 'Finish 500 answers.', test: c => c.items >= 500 },
  { id: 'perfect', name: 'Flawless', desc: 'Get a Perfect: no mistakes, no hints.', test: c => c.last?.rating === 'perfect' },
  { id: 'perfect-25', name: 'Clean hands', desc: 'Get 25 Perfects.', test: c => c.perfects >= 25 },
  { id: 'recall', name: 'From memory', desc: 'Get Great or better in Practice, from memory.', test: c => c.last?.level === 'recall' && c.last.rank >= 3 },
  { id: 'lap', name: 'Full lap', desc: 'Type every answer in a chapter in one go.', test: c => c.laps >= 1 },
  { id: 'laps-10', name: 'Ten laps', desc: 'Finish 10 chapter laps.', test: c => c.laps >= 10 },
  { id: 'lucky', name: 'Lucky drop', desc: 'Catch a bonus XP drop.', test: c => c.lucky >= 1 },
  { id: 'wpm-40', name: 'Steady hand', desc: 'Type a 60+ character answer at 40 WPM.', test: c => c.last?.chars >= 60 && c.last.wpm >= 40 && c.last.rank >= 2 },
  { id: 'wpm-70', name: 'Exam pace', desc: 'Type a 60+ character answer at 70 WPM.', test: c => c.last?.chars >= 60 && c.last.wpm >= 70 && c.last.rank >= 2 },
  { id: 'wpm-100', name: 'Blur', desc: 'Type a 60+ character answer at 100 WPM.', test: c => c.last?.chars >= 60 && c.last.wpm >= 100 && c.last.rank >= 2 },
  { id: 'combo-10', name: 'On fire', desc: 'Reach a ×10 combo.', test: c => c.bestCombo >= 10 },
  { id: 'combo-20', name: 'Unstoppable', desc: 'Reach a ×20 combo.', test: c => c.bestCombo >= 20 },
  { id: 'streak-3', name: 'Three days', desc: 'Practise three days in a row.', test: c => c.streak >= 3 },
  { id: 'streak-7', name: 'A full week', desc: 'Practise seven days in a row.', test: c => c.streak >= 7 },
  { id: 'streak-30', name: 'Habit', desc: 'Practise thirty days in a row.', test: c => c.streak >= 30 },
  { id: 'goal', name: 'Goal met', desc: 'Reach your daily XP goal.', test: c => c.goalMet },
  { id: 'master-1', name: 'Mastered one', desc: 'Bring any answer to “Mastered”.', test: c => c.mastered >= 1 },
  { id: 'master-25', name: 'Mastered 25', desc: 'Bring 25 answers to “Mastered”.', test: c => c.mastered >= 25 },
  { id: 'grade-c', name: 'Level 7', desc: 'Reach level 7.', test: c => c.level >= 7 },
  { id: 'grade-a', name: 'Level 13', desc: 'Reach level 13.', test: c => c.level >= 13 },
  { id: 'grade-astar', name: 'Level 21', desc: 'Reach level 21.', test: c => c.level >= 21 },
  { id: 'examiner', name: 'Level 30', desc: 'Reach level 30.', test: c => c.level >= 30 },
];

/** Check achievements; returns the newly earned ones. `last` is the latest attempt summary. */
export function checkAchievements(last) {
  const ctx = {
    items: state.totals.items,
    perfects: state.totals.perfects || 0,
    laps: state.totals.laps || 0,
    lucky: state.totals.lucky || 0,
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
