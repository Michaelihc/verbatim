// The typing surface: renders an answer, takes keystrokes, reports stats.
//
// Input arrives through a hidden textarea so phone keyboards and IMEs work. Its value mirrors
// what the learner has typed; each `input` event is diffed against the previous value.

const STOP_WORDS = new Set(['that', 'this', 'with', 'from', 'which', 'when', 'where', 'there', 'their', 'than', 'then', 'they', 'have', 'into', 'each', 'also', 'such', 'between']);

function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const isWordChar = c => /[A-Za-z0-9_]/.test(c);
const isPunct = c => !/[A-Za-z0-9\s]/.test(c);

/** Returns a Set of character indexes to hide. */
export function chooseMask(text, ratio, seed) {
  const hidden = new Set();
  if (ratio <= 0) return hidden;
  const words = [...text.matchAll(/[A-Za-z0-9_]+/g)].map(m => ({ start: m.index, len: m[0].length, word: m[0] }));
  let pick;
  if (ratio >= 1) {
    pick = words;
  } else {
    const rnd = seeded(seed);
    const pool = words.filter(w => w.len >= 4 && !STOP_WORDS.has(w.word.toLowerCase()));
    pool.forEach(w => { w.score = w.len + rnd() * 6; });
    pool.sort((a, b) => b.score - a.score);
    pick = pool.slice(0, Math.max(1, Math.round(pool.length * ratio)));
  }
  for (const w of pick) for (let i = 0; i < w.len; i++) hidden.add(w.start + i);
  return hidden;
}

let audioCtx = null;
function click(bad) {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = bad ? 'square' : 'triangle';
    o.frequency.value = bad ? 140 : 900 + Math.random() * 200;
    g.gain.setValueAtTime(bad ? 0.04 : 0.025, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.06);
  } catch {}
}

export class Typer {
  constructor(host, { text, kind, mask, settings, onProgress, onDone }) {
    this.host = host;
    this.text = text;
    this.kind = kind;
    this.mask = mask;
    this.settings = settings;
    this.onProgress = onProgress || (() => {});
    this.onDone = onDone || (() => {});
    this.typed = [];        // per position: { c, ok, auto }
    this.revealed = new Set();
    this.hints = 0;
    this.keystrokes = 0;
    this.errors = 0;
    this.startedAt = 0;
    this.finished = false;
    this.render();
    this.bind();
    this.autoAdvance();
    this.paint();
  }

  // ---- rendering ----------------------------------------------------------

  render() {
    const sheet = document.createElement('div');
    this.stacked = this.settings.layout === 'stacked';
    sheet.className = `sheet ${this.kind === 'code' ? 'is-code' : 'is-prose'}${this.stacked ? ' stacked' : ''}`;
    sheet.setAttribute('aria-hidden', 'true');
    this.spans = [];
    const mk = (ch, i) => {
      const s = document.createElement('span');
      s.className = 'ch';
      if (ch === '\n') { s.classList.add('nl'); s.textContent = '↵'; }
      else if (ch === ' ') { s.classList.add('sp'); s.textContent = ' '; }
      else s.textContent = ch;
      if (this.mask.has(i)) s.classList.add('m');
      this.spans[i] = s;
      return s;
    };
    if (this.kind === 'code') {
      let line = document.createElement('div');
      line.className = 'line';
      sheet.append(line);
      [...this.text].forEach((ch, i) => {
        line.append(mk(ch, i));
        if (ch === '\n') {
          line = document.createElement('div');
          line.className = 'line';
          sheet.append(line);
        }
      });
    } else {
      // Keep words unbroken; spaces between them are the wrap points.
      let word = null;
      [...this.text].forEach((ch, i) => {
        if (ch === ' ') {
          word = null;
          sheet.append(mk(ch, i));
          // Stacked cells are inline-blocks, which don't wrap on their own.
          if (this.stacked) sheet.append(document.createElement('wbr'));
          return;
        }
        if (!word) { word = document.createElement('span'); word.className = 'w'; sheet.append(word); }
        word.append(mk(ch, i));
      });
    }

    const input = document.createElement('textarea');
    input.className = 'type-input';
    input.setAttribute('aria-label', 'Type the answer here');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('enterkeyhint', this.kind === 'code' ? 'enter' : 'done');

    this.host.replaceChildren(sheet, input);
    this.sheet = sheet;
    this.input = input;
  }

  paint() {
    const pos = this.typed.length;
    for (let i = 0; i < this.spans.length; i++) {
      const s = this.spans[i];
      const t = this.typed[i];
      s.classList.toggle('ok', !!t && t.ok);
      s.classList.toggle('bad', !!t && !t.ok);
      s.classList.toggle('auto', !!t && t.auto);
      // Stacked layout: what was typed sits under the text, so show the learner's own key.
      if (this.stacked) s.dataset.t = !t ? '' : t.c === '\n' ? '↵' : t.c === ' ' && !t.ok ? '·' : t.c;
      s.classList.toggle('cur', i === pos && !this.finished);
      s.classList.toggle('shown', this.revealed.has(i));
    }
    const cur = this.spans[pos];
    if (cur) {
      const r = cur.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 40 || r.top < 80) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    this.onProgress(this.stats());
  }

  // ---- input --------------------------------------------------------------

  bind() {
    const input = this.input;
    this.prev = '';
    const keepCaretAtEnd = () => {
      const n = input.value.length;
      if (input.selectionStart !== n || input.selectionEnd !== n) input.setSelectionRange(n, n);
    };
    input.addEventListener('keydown', e => this.onKey(e));
    input.addEventListener('input', () => this.onInput());
    input.addEventListener('select', keepCaretAtEnd);
    input.addEventListener('click', keepCaretAtEnd);
    input.addEventListener('focus', () => this.host.classList.add('focused'));
    input.addEventListener('blur', () => this.host.classList.remove('focused'));
    input.addEventListener('paste', e => e.preventDefault());
    input.addEventListener('drop', e => e.preventDefault());
    this.host.addEventListener('pointerdown', e => {
      if (e.target !== input) { e.preventDefault(); this.focus(); }
    });
  }

  focus() {
    this.input.focus({ preventScroll: true });
  }

  onKey(e) {
    if (this.finished) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const pos = this.typed.length;
      if (this.text[pos] === ' ') this.fillWhile(c => c === ' ');
      else this.hint();
    } else if (e.key === 'Enter' && this.kind !== 'code') {
      e.preventDefault();
    }
  }

  onInput() {
    if (this.finished) return;
    const val = this.input.value;
    const prev = this.prev;
    let p = 0;
    while (p < prev.length && p < val.length && prev[p] === val[p]) p++;
    // Deletions: drop typed characters, along with any auto-filled ones just before them.
    if (val.length < prev.length || p < prev.length) {
      this.truncate(p);
    }
    const added = val.slice(p);
    for (const c of added) {
      if (this.typed.length >= this.text.length) break;
      this.press(c);
    }
    this.syncInput();
    this.paint();
    this.maybeFinish();
  }

  /** Keep only the first `n` characters of the mirror. */
  truncate(n) {
    // The mirror and `typed` are the same length; auto-filled characters are mirrored too.
    const firstRemoved = this.typed[n];
    this.typed.length = Math.min(this.typed.length, n);
    // Backspacing over an auto-filled run removes the run plus the real key before it,
    // otherwise autoAdvance would refill it and the learner could never get past it.
    if (firstRemoved?.auto) {
      while (this.typed.length && this.typed[this.typed.length - 1].auto) this.typed.pop();
      this.typed.pop();
    }
    this.autoAdvance();
  }

  press(c) {
    const pos = this.typed.length;
    const want = this.text[pos];
    if (!this.startedAt) this.startedAt = performance.now();
    let got = c === '\r' ? '\n' : c;
    if (this.kind !== 'code' && got === '\n') return;
    const ok = this.same(got, want);
    this.keystrokes++;
    if (!ok) this.errors++;
    if (this.settings.sound) click(!ok);
    if (!ok && this.settings.stopOnError) {
      this.flash();
      return;
    }
    this.typed.push({ c: got, ok, auto: false });
    this.autoAdvance();
  }

  same(a, b) {
    if (a === b) return true;
    if (this.settings.ignoreCase && a.toLowerCase() === b.toLowerCase()) return true;
    return false;
  }

  /** Fill characters the learner shouldn't have to type (indentation, punctuation if ignored). */
  autoAdvance() {
    for (;;) {
      const pos = this.typed.length;
      if (pos >= this.text.length) return;
      const want = this.text[pos];
      const prevCh = this.text[pos - 1];
      const atIndent = this.kind === 'code' && this.settings.autoIndent && want === ' ' &&
        (pos === 0 || prevCh === '\n' || (this.typed[pos - 1]?.auto && prevCh === ' '));
      const skipPunct = this.settings.ignorePunctuation && isPunct(want) && want !== '\n';
      if (atIndent || skipPunct) this.typed.push({ c: want, ok: true, auto: true });
      else return;
    }
  }

  fillWhile(pred) {
    while (this.typed.length < this.text.length && pred(this.text[this.typed.length])) {
      this.typed.push({ c: this.text[this.typed.length], ok: true, auto: true });
    }
    this.syncInput();
    this.paint();
    this.maybeFinish();
  }

  syncInput() {
    const v = this.typed.map(t => t.c).join('');
    if (this.input.value !== v) this.input.value = v;
    this.prev = v;
  }

  /** Reveal the rest of the current word. */
  hint() {
    let i = this.typed.length;
    if (i >= this.text.length) return;
    let any = false;
    const reveal = j => { if (this.mask.has(j) && !this.revealed.has(j)) { this.revealed.add(j); any = true; } };
    if (isWordChar(this.text[i])) {
      while (i > 0 && isWordChar(this.text[i - 1])) i--;
      for (let j = i; j < this.text.length && isWordChar(this.text[j]); j++) reveal(j);
    } else {
      for (let j = i; j < this.text.length && !isWordChar(this.text[j]); j++) reveal(j);
      for (let j = i; j < this.text.length && j < i + 40; j++) {
        if (isWordChar(this.text[j])) { for (let k = j; k < this.text.length && isWordChar(this.text[k]); k++) reveal(k); break; }
      }
    }
    if (any) this.hints++;
    this.paint();
  }

  flash() {
    this.host.classList.remove('nudge');
    void this.host.offsetWidth;
    this.host.classList.add('nudge');
  }

  // ---- results ------------------------------------------------------------

  elapsed() {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  stats() {
    const ms = this.elapsed();
    const correct = this.typed.filter(t => t.ok).length;
    const wpm = ms > 1500 ? (correct / 5) / (ms / 60000) : 0;
    const acc = this.keystrokes ? (this.keystrokes - this.errors) / this.keystrokes : 1;
    return {
      pos: this.typed.length,
      total: this.text.length,
      wpm,
      acc,
      errors: this.errors,
      hints: this.hints,
      ms,
    };
  }

  maybeFinish() {
    if (this.finished || this.typed.length < this.text.length) return;
    this.finished = true;
    this.input.blur();
    this.input.disabled = true;
    const left = this.typed.filter(t => !t.ok).length;
    const auto = this.typed.filter(t => t.auto).length;
    this.paint();
    this.onDone({
      chars: this.text.length - auto,
      keystrokes: this.keystrokes,
      errors: this.errors,
      uncorrected: left,
      ms: Math.max(this.elapsed(), 300),
      hints: this.hints,
      revealed: this.revealed.size,
    });
  }

  destroy() {
    this.finished = true;
    this.host.replaceChildren();
  }
}
