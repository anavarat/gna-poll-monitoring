const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readCsvSimple(filePath) {
  // Minimal CSV reader for simple, unquoted CSV.
  // Good enough for party,password where passwords won't contain commas.
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(s => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (cols[idx] ?? '').trim());
    rows.push(obj);
  }
  return rows;
}

function nowIso() {
  return new Date().toISOString();
}

function safeFilename(s) {
  return String(s).replace(/[^a-z0-9._-]+/gi, '_');
}

module.exports = { ensureDir, readCsvSimple, nowIso, safeFilename };
