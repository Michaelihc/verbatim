// Feedback effects: synthesised sounds, confetti and floating text. No audio files to load.

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- sound ------------------------------------------------------------------

let ctx = null;
let master = null;
function audio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.06, to = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const semis = (base, n) => base * Math.pow(2, n / 12);

export const sfx = {
  key() { tone(1700 + Math.random() * 400, { dur: 0.025, type: 'triangle', gain: 0.012 }); },
  miss() { tone(180, { dur: 0.09, type: 'square', gain: 0.025, to: 120 }); },
  /** A chord that climbs with the combo, so a long run literally sounds higher. */
  done(rank, combo = 0) {
    const root = semis(392, Math.min(combo, 12)); // G4 upwards
    const steps = rank >= 4 ? [0, 4, 7, 12] : rank === 3 ? [0, 4, 7] : rank === 2 ? [0, 7] : [0, -5];
    steps.forEach((n, i) => tone(semis(root, n), { at: i * 0.055, dur: 0.22, type: rank >= 3 ? 'triangle' : 'sine', gain: 0.05 }));
    if (rank >= 4) tone(semis(root, 24), { at: 0.24, dur: 0.35, type: 'sine', gain: 0.025 });
  },
  lucky(big) {
    const notes = big ? [0, 4, 7, 12, 16, 19, 24, 28] : [0, 7, 12, 19];
    notes.forEach((n, i) => tone(semis(1046, n), { at: 0.25 + i * 0.045, dur: 0.12, type: 'sine', gain: 0.03 }));
  },
  /** A quick two-note "ding" for each mark scored, a step higher for each one in the answer. */
  mark(n = 1) {
    const root = semis(784, (n - 1) * 3); // G5 upwards
    tone(root, { dur: 0.09, type: 'triangle', gain: 0.04 });
    tone(semis(root, 7), { at: 0.06, dur: 0.16, type: 'sine', gain: 0.035 });
  },
  comboLost() { tone(330, { dur: 0.25, type: 'sine', gain: 0.035, to: 160 }); },
  fanfare() {
    [[0, 0], [4, 0.1], [7, 0.2], [12, 0.3], [7, 0.42], [12, 0.52]].forEach(([n, at]) => tone(semis(523, n), { at, dur: 0.28, type: 'triangle', gain: 0.05 }));
  },
};

// ---- confetti ---------------------------------------------------------------

// Highlighter colours, plus white and biro blue.
const COLORS = ['#ffe83d', '#7cf2a2', '#ff8fc8', '#ffc773', '#ffffff', '#2a3fd8'];
let canvas = null;
let parts = [];
let raf = 0;

function loop() {
  const c = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.clearRect(0, 0, canvas.width, canvas.height);
  parts = parts.filter(p => p.life > 0);
  for (const p of parts) {
    p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 1;
    c.save();
    c.globalAlpha = Math.min(1, p.life / 30);
    c.translate(p.x * dpr, p.y * dpr);
    c.rotate(p.rot);
    c.fillStyle = p.color;
    if (p.round) { c.beginPath(); c.arc(0, 0, p.s * dpr * 0.5, 0, 7); c.fill(); }
    else c.fillRect(-p.s * dpr / 2, -p.s * dpr / 4, p.s * dpr, p.s * dpr / 2);
    c.restore();
  }
  if (parts.length) raf = requestAnimationFrame(loop);
  else { raf = 0; canvas.remove(); canvas = null; }
}

/** Burst of confetti from a point (defaults to the middle of the screen). */
export function confetti({ x = innerWidth / 2, y = innerHeight / 2, count = 80, spread = 1 } = {}) {
  if (reduceMotion()) return;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    document.body.append(canvas);
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * spread;
    const v = 6 + Math.random() * 9;
    parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      s: 6 + Math.random() * 7, round: Math.random() < 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      life: 70 + Math.random() * 50,
    });
  }
  if (!raf) raf = requestAnimationFrame(loop);
}

/** Text that floats up from an element and fades, like "+24 XP". */
export function floatText(el, text, cls = '') {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = `fx-float ${cls}`;
  f.textContent = text;
  f.style.left = `${r.left + r.width / 2}px`;
  f.style.top = `${r.top + r.height / 2}px`;
  document.body.append(f);
  setTimeout(() => f.remove(), 1200);
}

/** Animate a number in an element from `from` to `to`. */
export function countUp(el, from, to, ms = 600) {
  if (!el) return;
  if (reduceMotion() || to === from) { el.textContent = Math.round(to).toLocaleString(); return; }
  const t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
