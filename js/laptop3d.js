// The home page laptop: a small three.js model you can drag to turn. The screen is a canvas
// texture that types out a definition, highlighting each mark point as it lands, and the
// matching key dips on the keyboard. Loaded lazily on wide screens only; the SVG drawing in
// the page stays put if WebGL is unavailable.

import * as THREE from './vendor/three.module.min.js';

const ANSWER = 'The tesla is one newton per ampere per metre, where the current is perpendicular to the magnetic field.';
const MARKS = ['newton per ampere per metre', 'current is perpendicular to the magnetic field'];
const ROWS = ['1234567890-=', 'qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./'];

const W = 3.2, D = 2.2, T = 0.11;       // base: width, depth, thickness
const LH = 2.06, LT = 0.06;             // lid: height, thickness
const REST = { yaw: -0.42, pitch: 0.12 };

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function slab(w, h, depth, r, bevel) {
  const g = new THREE.ExtrudeGeometry(roundedRect(w, h, r), {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ---- screen ---------------------------------------------------------------------------------

function makeScreen() {
  const cv = document.createElement('canvas');
  cv.width = 1280; cv.height = 800;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const pad = 92, cardX = 64, cardY = 56, cardW = cv.width - 128, cardH = cv.height - 112;
  const ansFont = '700 58px Atkinson, system-ui, sans-serif', lineH = 84, ansTop = 340;
  const markRanges = MARKS.map(m => { const a = ANSWER.indexOf(m); return [a, a + m.length]; });

  // Word-wrap once: each line is [start, end) into ANSWER.
  let lines = null;
  const layout = () => {
    ctx.font = ansFont;
    lines = [];
    const maxW = cardW - pad * 2 + 40;
    let start = 0, lastBreak = -1;
    for (let i = 0; i <= ANSWER.length; i++) {
      if (i === ANSWER.length || ANSWER[i] === ' ') {
        if (ctx.measureText(ANSWER.slice(start, i)).width > maxW && lastBreak > start) {
          lines.push([start, lastBreak]); start = lastBreak + 1;
        }
        lastBreak = i;
      }
    }
    lines.push([start, ANSWER.length]);
  };

  const xAt = (line, i) => cardX + pad + ctx.measureText(ANSWER.slice(line[0], i)).width;

  function draw(typed, popAt) {
    if (!lines) layout();
    ctx.fillStyle = '#2a3fd8'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(cardX, cardY, cardW, cardH, 26); ctx.fill();

    const got = markRanges.filter(([, b]) => typed >= b).length;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 30px Atkinson, system-ui, sans-serif'; ctx.fillStyle = '#4b5588';
    ctx.letterSpacing = '4px'; ctx.fillText('DEFINITION', cardX + pad, cardY + 104); ctx.letterSpacing = '0px';
    ctx.textAlign = 'right'; ctx.fillStyle = '#2a3fd8';
    ctx.fillText(`${got}/${MARKS.length} mark points`, cardX + cardW - pad, cardY + 104);
    ctx.textAlign = 'left';
    ctx.font = '850 118px Anybody, system-ui, sans-serif'; ctx.fillStyle = '#0c1445';
    ctx.fillText('Tesla', cardX + pad - 4, cardY + 222);

    ctx.font = ansFont;
    lines.forEach((ln, li) => {
      const y = ansTop + li * lineH;
      // Highlight and underline any mark point that has been typed in full.
      markRanges.forEach(([a, b]) => {
        if (typed < b) return;
        const s = Math.max(a, ln[0]), e = Math.min(b, ln[1]);
        if (s >= e) return;
        const x0 = xAt(ln, s) - 4, x1 = xAt(ln, e) + 4;
        ctx.fillStyle = '#ffe83d'; ctx.fillRect(x0, y - 52, x1 - x0, 70);
        ctx.fillStyle = '#2a3fd8'; ctx.fillRect(x0, y + 12, x1 - x0, 5);
      });
      const cut = Math.min(Math.max(typed, ln[0]), ln[1]);
      ctx.fillStyle = '#0c1445'; ctx.fillText(ANSWER.slice(ln[0], cut), cardX + pad, y);
      ctx.fillStyle = '#a6acd0'; ctx.fillText(ANSWER.slice(cut, ln[1]), xAt(ln, cut), y);
      if (typed >= ln[0] && (typed < ln[1] || (li === lines.length - 1 && typed <= ln[1]))) {
        ctx.fillStyle = '#2a3fd8'; ctx.fillRect(xAt(ln, typed) - 1, y - 50, 5, 64);
      }
    });

    // "+1" tag that pops beside the mark point just scored.
    if (popAt) {
      const [b, age] = popAt;
      const li = lines.findIndex(l => b > l[0] && b <= l[1]);
      if (li >= 0 && age < 1) {
        const x = xAt(lines[li], b) + 18, y = ansTop + li * lineH - 40 - age * 30;
        ctx.globalAlpha = 1 - age * age;
        ctx.fillStyle = '#2a3fd8'; ctx.beginPath(); ctx.roundRect(x, y, 70, 44, 10); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 30px Atkinson, system-ui, sans-serif'; ctx.fillText('+1', x + 16, y + 32);
        ctx.globalAlpha = 1;
      }
    }
    tex.needsUpdate = true;
  }
  return { tex, draw, markEnds: markRanges.map(r => r[1]) };
}

// ---- model ----------------------------------------------------------------------------------

function buildLaptop(screenTex) {
  const shell = new THREE.MeshStandardMaterial({ color: 0xe4e8f4, roughness: 0.42, metalness: 0.35 });
  const shellDark = new THREE.MeshStandardMaterial({ color: 0xcfd5e8, roughness: 0.5, metalness: 0.3 });
  const bezel = new THREE.MeshStandardMaterial({ color: 0x0c1445, roughness: 0.35, metalness: 0.1 });
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });

  const laptop = new THREE.Group();

  // Base, lying flat: rotate the slab so its face points up.
  const base = new THREE.Mesh(slab(W, D, T, 0.14, 0.025), shell);
  base.rotation.x = -Math.PI / 2; base.position.y = T / 2 + 0.025;
  base.castShadow = true; base.receiveShadow = true;
  laptop.add(base);
  const top = T + 0.05;

  // Keyboard well and keys.
  const well = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W - 0.34, 1.2, 0.05)), shellDark);
  well.rotation.x = -Math.PI / 2; well.position.set(0, top + 0.001, -D / 2 + 0.78);
  laptop.add(well);

  const pitch = 0.218, ksize = 0.182;
  const slots = [];
  ROWS.forEach((row, r) => {
    const n = row.length, x0 = -((n - 1) * pitch) / 2;
    for (let k = 0; k < n; k++) slots.push({ ch: row[k], x: x0 + k * pitch + (r === 0 ? 0 : 0.03 * r), z: -D / 2 + 0.3 + r * 0.22, w: ksize });
  });
  slots.push({ ch: ' ', x: 0, z: -D / 2 + 0.3 + 4 * 0.22, w: 1.25 });
  const keyGeo = new THREE.BoxGeometry(1, 0.035, ksize);
  keyGeo.translate(0, 0.0175, 0);
  const keys = new THREE.InstancedMesh(keyGeo, keyMat, slots.length);
  keys.castShadow = true;
  const base3 = new THREE.Color(0x1b2156), hot = new THREE.Color(0xffd919), tmp = new THREE.Color();
  const m4 = new THREE.Matrix4(), press = new Float32Array(slots.length);
  const placeKeys = () => {
    slots.forEach((s, i) => {
      m4.makeScale(s.w, 1, 1).setPosition(s.x, top - 0.012 * press[i], s.z);
      keys.setMatrixAt(i, m4);
      keys.setColorAt(i, tmp.copy(base3).lerp(hot, press[i]));
    });
    keys.instanceMatrix.needsUpdate = true; keys.instanceColor.needsUpdate = true;
  };
  placeKeys();
  laptop.add(keys);

  const pad = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(1.25, 0.66, 0.06)), shellDark);
  pad.rotation.x = -Math.PI / 2; pad.position.set(0, top + 0.002, D / 2 - 0.5);
  laptop.add(pad);

  // Lid, hinged at the back edge and leaning back a little.
  const hinge = new THREE.Group();
  hinge.position.set(0, top - 0.005, -D / 2 + 0.06);
  hinge.rotation.x = -0.24;
  const lid = new THREE.Mesh(slab(W, LH, LT, 0.14, 0.02), shell);
  lid.position.set(0, LH / 2, -LT / 2 - 0.02);
  lid.castShadow = true;
  hinge.add(lid);
  const face = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W - 0.02, LH - 0.02, 0.13)), bezel);
  face.position.set(0, LH / 2, 0.002);
  hinge.add(face);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.22, (W - 0.22) * 0.625),
    new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  scr.position.set(0, LH / 2 + 0.03, 0.004);
  hinge.add(scr);
  laptop.add(hinge);

  return { laptop, slots, press, placeKeys, dispose: () => [shell, shellDark, bezel, keyMat].forEach(m => m.dispose()) };
}

// ---- mount ----------------------------------------------------------------------------------

export async function mountLaptop(wrap) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch { return () => {}; }
  try { await Promise.race([Promise.all(['700 30px Atkinson', '400 30px Atkinson', '850 80px Anybody'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 1500))]); } catch {}

  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const cv = renderer.domElement;
  cv.className = 'hero-3d';
  cv.tabIndex = 0;
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'A 3D laptop typing the definition of the tesla. Drag, or use the arrow keys, to turn it.');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1.4, 0.1, 50);
  camera.position.set(0, 2.9, 7.4);
  camera.lookAt(0, 0.86, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3348e0, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-1.2, 8, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  sun.shadow.radius = 6; sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xb8c4ff, 1.1);
  rim.position.set(4, 3, -4);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.26, color: 0x050a3a }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  const screen = makeScreen();
  const model = buildLaptop(screen.tex);
  const pivot = new THREE.Group();
  model.laptop.position.y = 0;
  pivot.add(model.laptop);
  scene.add(pivot);

  // ---- typing loop
  let typed = reduced ? ANSWER.length : 0, nextAt = 0, hold = 0, pop = null;
  screen.draw(typed, null);
  const keyIndex = ch => model.slots.findIndex(s => s.ch === ch.toLowerCase());
  function stepTyping(now, dt) {
    if (reduced) return false;
    let dirty = false;
    if (pop) { pop[1] += dt / 0.9; dirty = true; if (pop[1] >= 1) pop = null; }
    if (typed >= ANSWER.length) {
      hold += dt;
      if (hold > 3) { typed = 0; hold = 0; nextAt = now + 0.6; dirty = true; }
    } else if (now >= nextAt) {
      const ch = ANSWER[typed++];
      const k = keyIndex(ch);
      if (k >= 0) model.press[k] = 1;
      if (screen.markEnds.includes(typed)) pop = [typed, 0];
      nextAt = now + (ch === ' ' ? 0.11 : 0.06) + Math.random() * 0.07 + (/[,.]/.test(ch) ? 0.25 : 0);
      dirty = true;
    }
    if (dirty) screen.draw(typed, pop);
    let pressed = false;
    for (let i = 0; i < model.press.length; i++) if (model.press[i] > 0) { model.press[i] = Math.max(0, model.press[i] - dt * 5); pressed = true; }
    if (pressed) model.placeKeys();
    return true;
  }

  // ---- drag to turn, with a little inertia; it drifts back to rest when left alone
  let yaw = REST.yaw, pitch = REST.pitch, vYaw = 0, vPitch = 0, dragging = false, lastX = 0, lastY = 0, idle = 0, moved = true;
  const clampPitch = p => Math.min(0.75, Math.max(-0.1, p));
  const onDown = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; vYaw = vPitch = 0; cv.setPointerCapture(e.pointerId); cv.classList.add('grabbing'); wrap.classList.add('touched'); };
  const onMove = e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    vYaw = dx * 0.011; vPitch = dy * 0.007;
    yaw += vYaw; pitch = clampPitch(pitch + vPitch); idle = 0; moved = true;
  };
  const onUp = () => { dragging = false; cv.classList.remove('grabbing'); };
  const onKey = e => {
    const step = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[e.key];
    if (!step) return;
    e.preventDefault(); e.stopPropagation();
    yaw += step[0]; pitch = clampPitch(pitch + step[1]); idle = 0; moved = true; wrap.classList.add('touched');
  };
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('keydown', onKey);
  cv.addEventListener('dblclick', () => { yaw = REST.yaw; pitch = REST.pitch; moved = true; });

  function stepPose(dt) {
    if (dragging) return true;
    let active = false;
    if (Math.abs(vYaw) > 1e-4 || Math.abs(vPitch) > 1e-4) {
      const f = Math.pow(0.04, dt);
      yaw += vYaw; pitch = clampPitch(pitch + vPitch); vYaw *= f; vPitch *= f; active = true;
    }
    idle += dt;
    if (idle > 4) {
      // Ease back to the resting angle by the shortest way round.
      const target = REST.yaw + Math.round((yaw - REST.yaw) / (2 * Math.PI)) * 2 * Math.PI;
      const k = 1 - Math.pow(0.25, dt);
      if (Math.abs(target - yaw) > 1e-3 || Math.abs(REST.pitch - pitch) > 1e-3) {
        yaw += (target - yaw) * k; pitch += (REST.pitch - pitch) * k; active = true;
      }
    }
    return active;
  }

  // ---- size, visibility, loop
  const resize = () => {
    const w = wrap.clientWidth || 340, h = Math.round(w * 0.72);
    renderer.setSize(w, h, false);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    moved = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  let visible = true, raf = 0, last = performance.now() / 1000;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); });
  io.observe(wrap);
  function frame() {
    raf = 0;
    if (!visible || document.hidden) return;
    const now = performance.now() / 1000, dt = Math.min(0.05, now - last); last = now;
    const typing = stepTyping(now, dt);
    const posing = stepPose(dt);
    pivot.rotation.set(pitch, yaw, 0, 'YXZ');
    renderer.render(scene, camera);
    if (typing || posing || dragging || moved) { moved = false; raf = requestAnimationFrame(frame); }
  }
  function kick() { if (!raf) { last = performance.now() / 1000; raf = requestAnimationFrame(frame); } }
  ['pointerdown', 'pointermove', 'keydown'].forEach(t => cv.addEventListener(t, kick));
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);

  wrap.replaceChildren(cv);
  const hint = document.createElement('p');
  hint.className = 'hero-3d-hint'; hint.textContent = 'Drag to turn';
  wrap.append(hint);
  wrap.classList.add('is-3d');
  kick();

  return () => {
    cancelAnimationFrame(raf); raf = 0;
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    scene.traverse(o => { o.geometry?.dispose(); if (o.material && o.material.map) o.material.map.dispose(); o.material?.dispose?.(); });
    model.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  };
}
