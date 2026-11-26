// Gera src/manifest.json (versão + hash de cada arquivo). Uso: node scripts/manifest.js 1.2.0 "o que mudou"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const src = path.join(__dirname, '..', 'src');
const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')); } catch { return {}; } })();
const version = process.argv[2] || prev.version || '1.0.0';
const notes = process.argv[3] || '';

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) return walk(path.join(dir, e.name), rel);
    if (rel === 'manifest.json') return [];
    return [rel];
  });
}
const files = walk(src).sort().map(p => ({ path: p, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(src, p))).digest('hex') }));
const manifest = { version, minShell: 1, date: new Date().toISOString(), notes, files };
fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest ${version}: ${files.length} arquivos`);
