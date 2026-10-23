#!/usr/bin/env node
// Checks every pack in packs/index.json against CONTRIBUTING.md, and that sw.js precaches
// every shipped app file. Exits non-zero on problems.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const errors = [];
const warnings = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);

const index = JSON.parse(readFileSync(join(root, 'packs', 'index.json'), 'utf8'));
const packIds = new Set();
let total = 0;

for (const entry of index.packs) {
  const where = `packs/${entry.file}`;
  if (!existsSync(join(root, 'packs', entry.file))) { err(`${where}: listed in index.json but missing`); continue; }
  let pack;
  try { pack = JSON.parse(readFileSync(join(root, 'packs', entry.file), 'utf8')); }
  catch (e) { err(`${where}: invalid JSON (${e.message})`); continue; }
  if (pack.id !== entry.id) err(`${where}: id "${pack.id}" does not match index entry "${entry.id}"`);
  if (packIds.has(pack.id)) err(`${where}: duplicate pack id ${pack.id}`);
  packIds.add(pack.id);
  for (const f of ['title', 'subject', 'syllabus', 'kind']) if (!pack[f]) err(`${where}: missing "${f}"`);
  if (!['definition', 'code'].includes(pack.kind)) err(`${where}: kind must be "definition" or "code"`);
  if (!Array.isArray(pack.units) || !pack.units.length) { err(`${where}: no units`); continue; }

  const unitIds = new Set();
  const itemIds = new Set();
  for (const unit of pack.units) {
    if (!unit.id || !unit.title) err(`${where}: unit without id/title`);
    if (unitIds.has(unit.id)) err(`${where}: duplicate unit id ${unit.id}`);
    unitIds.add(unit.id);
    for (const it of unit.items || []) {
      const at = `${where} ${it.id || '(no id)'}`;
      total++;
      for (const f of ['id', 'term', 'prompt', 'answer']) if (typeof it[f] !== 'string' || !it[f].trim()) err(`${at}: missing "${f}"`);
      if (itemIds.has(it.id)) err(`${at}: duplicate item id`);
      itemIds.add(it.id);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.id || '')) warn(`${at}: id should be kebab-case`);
      if (!Array.isArray(it.sources) || !it.sources.length) err(`${at}: needs at least one source`);
      for (const s of it.sources || []) if (!s.paper || !s.session) err(`${at}: source needs paper and session`);
      const a = it.answer || '';
      if (/[^\x20-\x7E\n]/.test(a)) err(`${at}: answer has non-ASCII characters: ${[...new Set(a.match(/[^\x20-\x7E\n]/g))].join(' ')}`);
      if (pack.kind === 'definition' && a.includes('\n')) err(`${at}: definition answers must be one line`);
      if (pack.kind === 'code') {
        a.split('\n').forEach((line, n) => {
          if (/\s$/.test(line)) err(`${at}: trailing space on line ${n + 1}`);
          if (line.includes('\t')) err(`${at}: tab on line ${n + 1}`);
          const lead = line.match(/^ */)[0].length;
          if (lead % 4) warn(`${at}: indentation on line ${n + 1} is not a multiple of 4`);
        });
      }
      if (a.length > 800) warn(`${at}: answer is ${a.length} characters; consider splitting`);
    }
  }
}

// Service worker shell list must cover every app file.
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const listed = new Set([...sw.matchAll(/^\s*'([^']+)',?$/gm)].map(m => m[1]));
const walk = dir => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [relative(root, p).split(sep).join('/')];
});
const shipped = ['index.html', 'manifest.webmanifest', ...['css', 'js', 'fonts', 'icons'].flatMap(d => walk(join(root, d)))];
for (const f of shipped) if (!listed.has(f)) err(`sw.js: SHELL does not list ${f}`);
for (const f of listed) if (f !== './' && !existsSync(join(root, f))) err(`sw.js: SHELL lists missing file ${f}`);

for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
console.log(`${index.packs.length} packs, ${total} items, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
