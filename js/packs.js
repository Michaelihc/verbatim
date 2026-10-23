// Loads content packs listed in packs/index.json.

let cache = null;

function check(pack, file) {
  const problems = [];
  if (!pack.id || !Array.isArray(pack.units)) problems.push('missing id or units');
  for (const u of pack.units || []) {
    for (const it of u.items || []) {
      if (!it.id || typeof it.answer !== 'string' || !it.answer.length) problems.push(`item ${it.id || '?'} has no answer`);
    }
  }
  if (problems.length) console.warn(`Pack ${file}:`, problems.join('; '));
  return problems.length === 0 || pack.units?.length > 0;
}

export async function loadPacks() {
  if (cache) return cache;
  const res = await fetch('packs/index.json');
  if (!res.ok) throw new Error(`Could not load the pack list (HTTP ${res.status}).`);
  const index = await res.json();
  const loaded = await Promise.all(index.packs.map(async entry => {
    try {
      const r = await fetch(`packs/${entry.file}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const pack = await r.json();
      if (!check(pack, entry.file)) return null;
      for (const u of pack.units) {
        u.items = (u.items || []).filter(it => it.id && it.answer);
        for (const it of u.items) {
          it.answer = normalise(it.answer, pack.kind);
          it.unitId = u.id;
        }
      }
      pack.units = pack.units.filter(u => u.items.length);
      pack.itemCount = pack.units.reduce((n, u) => n + u.items.length, 0);
      return pack;
    } catch (err) {
      console.warn(`Skipping pack ${entry.file}:`, err);
      return null;
    }
  }));
  cache = loaded.filter(Boolean);
  return cache;
}

// Make answers typable: straight quotes, ASCII arrows, no tabs or stray whitespace.
function normalise(text, kind) {
  let t = text
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/←/g, '<-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ');
  if (kind === 'code') {
    t = t.replace(/\t/g, '    ').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
  } else {
    t = t.replace(/\s+/g, ' ').trim();
  }
  return t;
}

export function findItem(packs, packId, itemId) {
  const pack = packs.find(p => p.id === packId);
  if (!pack) return null;
  for (const unit of pack.units) {
    const item = unit.items.find(i => i.id === itemId);
    if (item) return { pack, unit, item };
  }
  return null;
}
