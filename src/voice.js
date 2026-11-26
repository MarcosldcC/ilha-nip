// Voz do Bit: Whisper (whisper.cpp) rodando local, grátis e offline.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BIN_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip';
const MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const MODELS = {
  base: { file: 'ggml-base-q5_1.bin', label: 'Base (60 MB, mais rápido)', ram: '~200 MB' },
  small: { file: 'ggml-small-q5_1.bin', label: 'Small (190 MB, recomendado)', ram: '~450 MB' },
  turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', label: 'Turbo (574 MB, o mais preciso)', ram: '~1 GB' },
};
// nomes e termos da pessoa (vêm do perfil) ajudam o Whisper a acertar
const vocabOf = (opts) => String((opts && opts.vocab) || '').slice(0, 400);

function dirs(root) {
  return { root, bin: path.join(root, 'bin'), models: path.join(root, 'models'), tmp: path.join(root, 'tmp') };
}

function findExe(dir) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/^whisper-cli(\.exe)?$/i.test(e.name)) return p;
    }
  }
  // versões antigas chamavam main.exe
  const stack2 = [dir];
  while (stack2.length) {
    const d = stack2.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack2.push(p);
      else if (/^main\.exe$/i.test(e.name)) return p;
    }
  }
  return null;
}

function findServer(dir) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/^whisper-server(\.exe)?$/i.test(e.name)) return p;
    }
  }
  return null;
}

function status(root, modelKey) {
  const D = dirs(root);
  const m = MODELS[modelKey] || MODELS.small;
  const exe = findExe(D.bin);
  const modelPath = path.join(D.models, m.file);
  const hasModel = fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1e6;
  return { ready: !!exe && hasModel, exe, modelPath, hasBin: !!exe, hasModel, model: modelKey, label: m.label };
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download falhou (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  const out = fs.createWriteStream(part);
  let got = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      onProgress && onProgress(got, total);
    }
  } finally { await new Promise(r => out.end(r)); }
  if (total && got < total) throw new Error('download incompleto, tente de novo');
  fs.renameSync(part, dest);
}

function unzip(zip, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dest, { recursive: true });
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dest)} -Force`], { windowsHide: true });
    let err = '';
    ps.stderr.on('data', d => { err += d; });
    ps.on('error', reject);
    ps.on('close', c => (c === 0 ? resolve() : reject(new Error('não consegui extrair o Whisper: ' + err.slice(0, 200)))));
  });
}

let installing = null;
function install(root, modelKey, onProgress) {
  if (installing) return installing;
  installing = (async () => {
    const D = dirs(root);
    const st = status(root, modelKey);
    if (!st.hasBin) {
      const zip = path.join(D.tmp, 'whisper-bin-x64.zip');
      await download(BIN_URL, zip, (g, t) => onProgress && onProgress({ step: 'programa', got: g, total: t }));
      fs.rmSync(D.bin, { recursive: true, force: true });
      await unzip(zip, D.bin);
      fs.rmSync(zip, { force: true });
      if (!findExe(D.bin)) throw new Error('o pacote do Whisper veio sem o whisper-cli.exe');
    }
    if (!st.hasModel) {
      const m = MODELS[modelKey] || MODELS.small;
      await download(MODEL_BASE + m.file, path.join(D.models, m.file), (g, t) => onProgress && onProgress({ step: 'modelo', got: g, total: t }));
    }
    return status(root, modelKey);
  })();
  return installing.finally(() => { installing = null; });
}

function transcribe(root, modelKey, wavBuffer, opts = {}) {
  return new Promise((resolve, reject) => {
    const st = status(root, modelKey);
    if (!st.ready) return reject(new Error('VOICE_NOT_READY'));
    const D = dirs(root);
    fs.mkdirSync(D.tmp, { recursive: true });
    const base = path.join(D.tmp, `fala-${Date.now()}`);
    const wav = base + '.wav';
    fs.writeFileSync(wav, Buffer.from(wavBuffer));
    const threads = String(opts.threads || Math.max(2, Math.min(8, (os.cpus() || []).length - 1)));
    const args = ['-m', st.modelPath, '-f', wav, '-l', 'pt', '-t', threads, '-nt', '-np', '-otxt', '-of', base, ...(vocabOf(opts) ? ['--prompt', vocabOf(opts)] : [])];
    const p = spawn(st.exe, args, { cwd: path.dirname(st.exe), windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); }, 180000);
    p.stdout.on('data', d => { out += d.toString('utf8'); });
    p.stderr.on('data', d => { err += d.toString('utf8'); });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      let text = '';
      try { text = fs.readFileSync(base + '.txt', 'utf8'); } catch { text = out; }
      for (const f of [wav, base + '.txt']) { try { fs.unlinkSync(f); } catch {} }
      text = text.replace(/\[(BLANK_AUDIO|Música|Music|MÚSICA|silêncio)[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();
      if (code !== 0 && !text) return reject(new Error('o Whisper falhou: ' + (err.split('\n').filter(Boolean).slice(-2).join(' ') || `código ${code}`)));
      resolve(text);
    });
  });
}

// ---------- servidor: carrega o modelo UMA vez (transcrição ao vivo) ----------
let srv = null; // { proc, port, model, ready }
const HALLU = /^(\W*(obrigad[oa]( por assistir)?|tchau|legendas? (pela|por) .*|inscreva-se.*|amara\.org.*|\[.*\]|\(.*\)|\.+|sous-titres.*|thank you\.?)\W*)$/i;
function freePort() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
function serverStart(root, modelKey, opts = {}) {
  const st = status(root, modelKey);
  if (!st.ready) return Promise.reject(new Error('VOICE_NOT_READY'));
  if (srv && srv.model === modelKey && srv.proc && srv.proc.exitCode === null) return srv.ready;
  serverStop();
  const exe = findServer(path.dirname(st.exe)) || findServer(dirs(root).bin);
  if (!exe) return Promise.resolve(null); // pacote antigo sem servidor: usa o modo normal
  const me = { proc: null, port: 0, model: modelKey };
  srv = me;
  me.ready = (async () => {
    me.port = await freePort();
    const threads = String(opts.threads || Math.max(2, Math.min(8, (os.cpus() || []).length - 1)));
    me.proc = spawn(exe, ['-m', st.modelPath, '-l', 'pt', '-t', threads, '-nt', '--host', '127.0.0.1', '--port', String(me.port)], { cwd: path.dirname(exe), windowsHide: true });
    let err = '';
    me.proc.stderr.on('data', d => { err = (err + d).slice(-2000); });
    me.proc.on('close', () => { if (srv === me) srv = null; });
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      if (me.proc.exitCode !== null) throw new Error('o servidor do Whisper fechou: ' + err.split('\n').filter(Boolean).slice(-2).join(' '));
      try { const r = await fetch(`http://127.0.0.1:${me.port}/`); if (r.ok) return me; } catch {}
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('o servidor do Whisper demorou demais para abrir');
  })();
  me.ready.catch(() => { if (srv === me) serverStop(); });
  return me.ready;
}
function serverStop() { const s = srv; srv = null; try { s && s.proc && s.proc.kill(); } catch {} }
// fica carregado: sempre (opção "sempre pronta"), durante a reunião (hold) ou até 10 min sem uso
let keep = false, holds = 0, idleT = null;
const IDLE_MS = 10 * 60 * 1000;
function touch() {
  clearTimeout(idleT);
  if (!keep) idleT = setTimeout(() => { if (!keep && holds <= 0) serverStop(); }, IDLE_MS);
}
function hold(on) { holds = Math.max(0, holds + (on ? 1 : -1)); touch(); }
function warm(root, modelKey) { touch(); return serverStart(root, modelKey).catch(() => null); }
function setKeep(v, root, modelKey) { keep = !!v; if (keep) warm(root, modelKey); else touch(); }
const isLoaded = () => !!(srv && srv.proc && srv.proc.exitCode === null);
async function serverTranscribe(root, modelKey, wavBuffer, opts = {}) {
  touch();
  const s = await serverStart(root, modelKey, opts);
  if (!s) return transcribe(root, modelKey, wavBuffer, opts);
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(wavBuffer)], { type: 'audio/wav' }), 'trecho.wav');
  fd.append('language', 'pt');
  fd.append('response_format', 'text');
  fd.append('temperature', '0');
  fd.append('suppress_nst', 'true');
  const pr = ((opts.context ? opts.context.slice(-200) + ' ' : '') + vocabOf(opts)).trim(); if (pr) fd.append('prompt', pr.slice(0, 600));
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 180000);
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/inference`, { method: 'POST', body: fd, signal: ctl.signal });
    if (!r.ok) throw new Error(`o Whisper respondeu ${r.status}`);
    return clean(await r.text());
  } finally { clearTimeout(tm); }
}
function clean(text) {
  text = String(text || '').replace(/\[(BLANK_AUDIO|Música|Music|MÚSICA|silêncio)[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();
  return HALLU.test(text) ? '' : text;
}

module.exports = { MODELS, status, install, transcribe, download, unzip, serverStart, serverStop, serverTranscribe, clean, warm, hold, setKeep, isLoaded };
