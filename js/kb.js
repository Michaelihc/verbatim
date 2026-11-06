// On-screen keyboard: lights up the next key and the finger that should press it, so learners
// can type without looking down. Standard touch-typing finger zones on a QWERTY layout.

import { physical } from './skill.js';

const ROWS = ['1234567890-=', 'qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./'];

// Finger for each key: lp/lr/lm/li left pinky..index, ri/rm/rr/rp right index..pinky, th thumbs.
const FINGER = {};
const zone = (keys, f) => { for (const k of keys) FINGER[k] = f; };
zone('1qaz`', 'lp'); zone('2wsx', 'lr'); zone('3edc', 'lm'); zone('45rtfgvb', 'li');
zone('67yuhjnm', 'ri'); zone('8ik,', 'rm'); zone('9ol.', 'rr'); zone("0-=p[];'/\\", 'rp');
FINGER.space = 'th'; FINGER.enter = 'rp';

export const FINGER_NAMES = {
  lp: 'left little finger', lr: 'left ring finger', lm: 'left middle finger', li: 'left index finger',
  ri: 'right index finger', rm: 'right middle finger', rr: 'right ring finger', rp: 'right little finger', th: 'thumb',
};

/** Which finger types a character, in words: "left ring finger + right Shift". */
export function fingerFor(ch) {
  const { key, shift } = physical(ch);
  const f = FINGER[key];
  if (!f) return '';
  return FINGER_NAMES[f] + (shift ? ` + ${f.startsWith('l') ? 'right' : 'left'} Shift` : '');
}

const LEGEND = [['p', 'Little'], ['r', 'Ring'], ['m', 'Middle'], ['i', 'Index'], ['th', 'Thumbs']];
const HOME = new Set([...'asdfjkl;']);

export function createKeyboard({ legend = false } = {}) {
  const el = document.createElement('div');
  el.className = 'okb';
  el.setAttribute('aria-hidden', 'true');
  const keyEl = {};
  const mk = (k, label, cls = '') => {
    const s = document.createElement('span');
    s.className = `okb-key f-${FINGER[k] || 'lp'} ${cls} ${HOME.has(k) ? 'home' : ''} ${k === 'f' || k === 'j' ? 'bump' : ''}`;
    s.textContent = label;
    keyEl[k] = s;
    return s;
  };
  ROWS.forEach((row, i) => {
    const r = document.createElement('div');
    r.className = `okb-row r${i}`;
    if (i === 3) { const ls = mk('lshift', 'Shift', 'wide'); ls.classList.replace('f-lp', 'f-lp'); r.append(ls); }
    for (const k of row) r.append(mk(k, k));
    if (i === 2) r.append(mk('enter', 'Enter', 'wide'));
    if (i === 3) { const rs = mk('rshift', 'Shift', 'wide'); rs.classList.replace('f-lp', 'f-rp'); r.append(rs); }
    el.append(r);
  });
  const sp = document.createElement('div');
  sp.className = 'okb-row r4';
  sp.append(mk('space', 'Space', 'space'));
  el.append(sp);
  const hint = document.createElement('p');
  hint.className = 'okb-hint';
  el.append(hint);
  if (legend) {
    const lg = document.createElement('p');
    lg.className = 'okb-legend';
    lg.innerHTML = LEGEND.map(([f, name]) => `<span><i class="okb-sw f-${f === 'th' ? 'th' : `l${f}`}"></i>${name}</span>`).join('')
      + '<span class="okb-home-note">Home row underlined; feel for the bumps on F and J</span>';
    el.append(lg);
  }

  let lit = [];
  function show(ch) {
    for (const k of lit) k.classList.remove('next');
    lit = [];
    if (ch == null) { hint.textContent = ''; return; }
    const { key, shift } = physical(ch);
    const target = keyEl[key];
    if (!target) { hint.textContent = ''; return; }
    lit.push(target);
    const finger = FINGER[key];
    let text = FINGER_NAMES[finger] || '';
    if (shift) {
      // Shift with the other hand from the key.
      const s = keyEl[finger?.startsWith('l') ? 'rshift' : 'lshift'];
      lit.push(s);
      text += ` + ${finger?.startsWith('l') ? 'right' : 'left'} Shift`;
    }
    for (const k of lit) k.classList.add('next');
    hint.textContent = text;
  }
  return { el, show };
}
