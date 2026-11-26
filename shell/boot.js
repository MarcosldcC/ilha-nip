// Inicializador fixo do Bit (vai dentro do .exe e não muda).
// Ao abrir: confere o GitHub, baixa a versão nova do código se houver, e carrega a mais recente.
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SHELL_VERSION = 2;
const REPO = 'MarcosldcC/ilha-nip';
const BRANCH = 'main';
const PAYLOAD = 'src'; // pasta do repositório com o código do app

const bundledDir = path.join(__dirname, '..', PAYLOAD);

// Pasta de dados: quem já usava a versão antiga ("Ilha NIP") continua na mesma pasta; instalação nova usa "Bit".
// Cada pessoa tem a sua pasta no próprio PC: nada é compartilhado entre usuários.
try {
  const legacy = path.join(app.getPath('appData'), 'Ilha NIP');
  if (fs.existsSync(path.join(legacy, 'ilha-data.json'))) app.setPath('userData', legacy);
  else app.setPath('userData', path.join(app.getPath('appData'), 'Bit'));
} catch {}
const ud = () => app.getPath('userData');
const liveDir = () => path.join(ud(), 'app');
const tmpDir = () => path.join(ud(), 'app-new');
const oldDir = () => path.join(ud(), 'app-old');
const tokenFile = () => path.join(ud(), 'ilha-gh.bin');

function readManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return null; }
}
function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}
function validDir(dir) {
  const m = readManifest(dir);
  if (!m || !Array.isArray(m.files)) return null;
  for (const f of m.files) if (!fs.existsSync(path.join(dir, f.path))) return null;
  return m;
}
function pickDir() {
  const b = readManifest(bundledDir) || { version: '0.0.0' };
  const l = validDir(liveDir());
  if (l && cmpVer(l.version, b.version) >= 0 && (l.minShell || 1) <= SHELL_VERSION) return { dir: liveDir(), version: l.version, from: 'atualização' };
  return { dir: bundledDir, version: b.version, from: 'instalação' };
}
function readToken() {
  try {
    const buf = fs.readFileSync(tokenFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch { return ''; }
}

async function ghRaw(token, file, signal) {
  if (process.env.ILHA_UPDATE_SRC) return fs.readFileSync(path.join(process.env.ILHA_UPDATE_SRC, file)); // só para teste local
  let res;
  if (token) {
    res = await fetch(`https://api.github.com/repos/${REPO}/contents/${encodeURI(file)}?ref=${BRANCH}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bit-copiloto' },
      signal,
    });
    if (res.status === 401 || res.status === 403) throw new Error('token do GitHub sem acesso ao repositório');
  } else {
    // sem token: funciona quando o repositório é público (sem limite de chamadas da API)
    res = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${encodeURI(file)}`, { headers: { 'User-Agent': 'bit-copiloto' }, signal, cache: 'no-store' });
    if (res.status === 404) { const e = new Error('no-token'); e.noToken = true; throw e; }
  }
  if (res.status === 404) throw new Error('repositório ou arquivo não encontrado');
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let running = null;
async function checkAndDownload({ timeoutMs = 8000 } = {}) {
  if (running) return running;
  running = (async () => {
    const token = readToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const remote = JSON.parse((await ghRaw(token, `${PAYLOAD}/manifest.json`, ctrl.signal)).toString('utf8'));
      const cur = pickDir();
      if (cmpVer(remote.version, cur.version) <= 0) return { status: 'current', version: cur.version };
      if ((remote.minShell || 1) > SHELL_VERSION) return { status: 'needs-reinstall', version: remote.version };
      fs.rmSync(tmpDir(), { recursive: true, force: true });
      for (const f of remote.files) {
        const buf = await ghRaw(token, `${PAYLOAD}/${f.path}`, ctrl.signal);
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        if (sha !== f.sha256) throw new Error(`arquivo corrompido: ${f.path}`);
        const dest = path.join(tmpDir(), f.path);
        if (!dest.startsWith(tmpDir())) throw new Error('caminho inválido no manifesto');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
      }
      fs.writeFileSync(path.join(tmpDir(), 'manifest.json'), JSON.stringify(remote, null, 2));
      fs.rmSync(oldDir(), { recursive: true, force: true });
      if (fs.existsSync(liveDir())) fs.renameSync(liveDir(), oldDir());
      fs.renameSync(tmpDir(), liveDir());
      fs.rmSync(oldDir(), { recursive: true, force: true });
      return { status: 'updated', version: remote.version, from: cur.version, notes: remote.notes || '' };
    } catch (e) {
      fs.rmSync(tmpDir(), { recursive: true, force: true });
      if (e.noToken) return { status: 'no-token' };
      return { status: 'error', error: e.name === 'AbortError' ? 'sem resposta do GitHub (sem internet?)' : e.message };
    } finally { clearTimeout(timer); }
  })();
  try { return await running; } finally { running = null; }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    const result = process.env.ILHA_NO_UPDATE ? { status: 'skipped' } : await checkAndDownload({ timeoutMs: 6000 });
    const pick = pickDir();
    global.__ILHA_BOOT = { shell: SHELL_VERSION, version: pick.version, from: pick.from, update: result, repo: REPO, tokenFile: tokenFile() };
    global.__ILHA_UPDATER = {
      check: (o) => checkAndDownload(o),
      relaunch: () => { app.relaunch(); app.exit(0); },
    };
    try {
      require(path.join(pick.dir, 'main.js'));
    } catch (e) {
      // se a atualização quebrar, volta para a versão da instalação
      if (pick.dir !== bundledDir) {
        fs.rmSync(liveDir(), { recursive: true, force: true });
        global.__ILHA_BOOT.from = 'instalação (a atualização falhou ao abrir)';
        global.__ILHA_BOOT.version = (readManifest(bundledDir) || {}).version;
        require(path.join(bundledDir, 'main.js'));
      } else throw e;
    }
  });
}
