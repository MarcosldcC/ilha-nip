// Bit — processo principal
const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage, safeStorage, Notification, shell, clipboard, dialog, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const PR = require('./prompts');
const PROFILE = require('./profile');
const prof = () => DATA.profile || PROFILE.normalize({});
const who = () => prof().nome || 'Usuário';
const extras = require('./extras');
let extrasHandle = null;
const tools = require('./tools');
const cc = require('./cc');
const conv = require('./convert');
let toolsHandle = null;
const { jev, jevPing, runClaude, findClaude, runCodex, findCodex, codexLoggedIn } = require('./engine');
const voice = require('./voice');
const VOICE_HOTKEY = 'Control+Alt+V';

// ---------- tamanhos da ilha ----------
const SIZES = {
  collapsed: { w: 420, h: 52 },
  drop: { w: 440, h: 150 },
  expanded: { w: 840, h: 600 },
  bubble: { w: 60, h: 60 },
};
const MARGIN = 10; // espaço em volta da ilha para a sombra do vidro
const HOTKEY = 'Control+Alt+N';
const DEFAULT_SETTINGS = {
  jevModel: 'jev-latest',
  writeModel: 'haiku',
  claudePath: '',
  ai: 'claude',            // IA que escreve: 'claude' (Claude Code) ou 'chatgpt' (Codex CLI)
  codexPath: '',
  codexModels: { haiku: '', sonnet: '', opus: '' }, // nome do modelo do ChatGPT por nível; vazio = padrão da conta
  autostart: true,
  collapseOnBlur: true,
  focusMinutes: 25,
  voiceModel: 'small',
  glassNative: false,
  dragDetect: true,
  voiceAutoSend: true,
};

let win = null;
let tray = null;
let mode = 'collapsed';
let pinned = false;

// ---------- armazenamento local ----------
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'ilha-data.json');
const keyFile = () => path.join(dataDir(), 'ilha-jev.bin');

function loadData() {
  try {
    const d = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
    return { demands: [], chat: [], meta: {}, ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
  } catch {
    return { demands: [], meta: {}, settings: { ...DEFAULT_SETTINGS } };
  }
}
let DATA = null;
function saveData() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(dataFile(), JSON.stringify(DATA, null, 2), 'utf8');
  } catch (e) { console.error('save', e); }
}

function getJevKey() {
  try {
    const buf = fs.readFileSync(keyFile());
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf);
    return buf.toString('utf8');
  } catch { return ''; }
}
function setJevKey(k) {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (!k) { try { fs.unlinkSync(keyFile()); } catch {} return; }
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(k) : Buffer.from(k, 'utf8');
  fs.writeFileSync(keyFile(), buf);
}

// ---------- janela ----------
// posição: o "ponto de ancoragem" é o centro do topo da ilha; o usuário arrasta pelo rostinho do Bit
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function anchor() {
  const a = DATA && DATA.meta && DATA.meta.anchor;
  const pd = screen.getPrimaryDisplay().workArea;
  if (a && screen.getAllDisplays().some(d => a.cx >= d.workArea.x && a.cx <= d.workArea.x + d.workArea.width && a.top >= d.workArea.y - 20 && a.top <= d.workArea.y + d.workArea.height)) return a;
  return { cx: pd.x + pd.width / 2, top: pd.y + 8 };
}
function sizeFor(m, wa) {
  if (m !== 'expanded') return SIZES[m];
  const e = (DATA && DATA.meta && DATA.meta.expSize) || SIZES.expanded;
  return { w: clamp(e.w, 640, wa.width - 2 * MARGIN), h: clamp(e.h, 440, wa.height - 2 * MARGIN) };
}
function boundsFor(m) {
  const a = anchor();
  const wa = screen.getDisplayNearestPoint({ x: Math.round(a.cx), y: Math.round(a.top) }).workArea;
  const s = sizeFor(m, wa);
  const w = s.w + MARGIN * 2, h = s.h + MARGIN * 2;
  const x = clamp(Math.round(a.cx - w / 2), wa.x - MARGIN, wa.x + wa.width - w + MARGIN);
  const y = clamp(Math.round(a.top - MARGIN), wa.y - MARGIN, wa.y + wa.height - h + MARGIN);
  return { x, y, width: w, height: h };
}
// mover e redimensionar: o main segue o cursor enquanto o botão está apertado (o renderer avisa início e fim)
const moving = { kind: null, p0: null, b0: null, t: null };
function stopMove() {
  if (!moving.kind) return;
  clearInterval(moving.t);
  const b = win.getBounds();
  DATA.meta.anchor = { cx: b.x + b.width / 2, top: b.y + MARGIN };
  if (moving.kind === 'resize') DATA.meta.expSize = { w: b.width - 2 * MARGIN, h: b.height - 2 * MARGIN };
  moving.kind = null; saveData();
}
function startMove(kind) {
  if (!win) return;
  stopMove();
  Object.assign(moving, { kind, p0: screen.getCursorScreenPoint(), b0: win.getBounds(), at: Date.now() });
  moving.t = setInterval(() => {
    if (!win || win.isDestroyed() || Date.now() - moving.at > 60000) return stopMove();
    const p = screen.getCursorScreenPoint(), dx = p.x - moving.p0.x, dy = p.y - moving.p0.y, b0 = moving.b0;
    if (moving.kind === 'drag') win.setPosition(b0.x + dx, b0.y + dy);
    else {
      const wa = screen.getDisplayMatching(b0).workArea;
      win.setBounds({ x: b0.x, y: b0.y, width: clamp(b0.width + dx, 640 + 2 * MARGIN, wa.width + MARGIN), height: clamp(b0.height + dy, 440 + 2 * MARGIN, wa.height + MARGIN) });
    }
  }, 16);
}
ipcMain.on('win:dragStart', () => startMove('drag'));
ipcMain.on('win:resizeStart', () => { if (mode === 'expanded') startMove('resize'); });
ipcMain.on('win:moveEnd', () => stopMove());
ipcMain.on('win:bubble', (_e, on) => { DATA.meta.bubble = !!on; saveData(); if (mode === 'collapsed' || mode === 'bubble') setMode('collapsed'); });
ipcMain.on('win:resetPos', () => { delete DATA.meta.anchor; delete DATA.meta.expSize; saveData(); setMode(mode === 'bubble' ? 'collapsed' : mode); });

function createWindow() {
  win = new BrowserWindow({
    ...boundsFor('collapsed'),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); if (DATA.meta && DATA.meta.bubble) setMode('collapsed'); });
  win.on('blur', () => {
    if (mode === 'expanded' && !pinned && DATA.settings.collapseOnBlur) setMode('collapsed');
  });
  // links externos abrem no navegador
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function setMode(m, tab) {
  if (!win) return;
  if (m === 'collapsed' && DATA.meta && DATA.meta.bubble) m = 'bubble';
  mode = m;
  win.setBounds(boundsFor(m), false);
  applyGlass();
  win.webContents.send('win:mode', { mode: m, tab });
  if (m === 'expanded') { win.show(); win.focus(); }
  else win.showInactive();
}
// vidro nativo do Windows 11 (acrylic) só no painel aberto; experimental
function applyGlass() {
  if (process.platform !== 'win32' || !win || typeof win.setBackgroundMaterial !== 'function') return;
  try { win.setBackgroundMaterial(DATA.settings.glassNative && mode === 'expanded' ? 'acrylic' : 'none'); } catch {}
}

// ---------- Bit percebe arquivo sendo arrastado (Windows) ----------
const DRAG_PS = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public static class IlhaMouse {
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct CI { public int cbSize; public int flags; public IntPtr hCursor; public PT pt; }
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CI ci);
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, int id);
  static IntPtr[] std;
  public static string Fg() { try { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; } }
  // durante um arrastar de ARQUIVO (OLE) o Windows troca o cursor pelo de "copiar/mover";
  // arrastar janela, aba, seleção de texto ou retângulo de seleção mantém um cursor padrão
  public static bool OleCursor() {
    if (std == null) { int[] ids = { 32512, 32513, 32514, 32515, 32516, 32642, 32643, 32644, 32645, 32646, 32648, 32649, 32650, 32651 }; std = new IntPtr[ids.Length]; for (int i = 0; i < ids.Length; i++) std[i] = LoadCursor(IntPtr.Zero, ids[i]); }
    CI ci = new CI(); ci.cbSize = Marshal.SizeOf(typeof(CI));
    if (!GetCursorInfo(ref ci) || ci.hCursor == IntPtr.Zero) return false;
    foreach (IntPtr c in std) if (c == ci.hCursor) return false;
    return true;
  }
}
"@
$down = $false; $t0 = 0; $sent = $false
while ($true) {
  $d = ([IlhaMouse]::GetAsyncKeyState(1) -band 0x8000) -ne 0
  if ($d -ne $down) {
    $down = $d; $sent = $false; $t0 = [Environment]::TickCount
    if ($d) { [Console]::Out.WriteLine("D " + [IlhaMouse]::Fg()) } else { [Console]::Out.WriteLine("U") }
    [Console]::Out.Flush()
  } elseif ($d -and -not $sent -and ([Environment]::TickCount - $t0) -gt 220) {
    if ([IlhaMouse]::OleCursor()) { $sent = $true; [Console]::Out.WriteLine("F"); [Console]::Out.Flush() }
  }
  Start-Sleep -Milliseconds 60
}`;
const drag = { down: false, at: 0, pos: null, proc: '', armed: false, proc_: null };
function startDragWatch() {
  if (process.platform !== 'win32' || drag.proc_ || DATA.settings.dragDetect === false) return;
  const { spawn } = require('child_process');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(DRAG_PS, 'utf16le').toString('base64')];
  const p = spawn('powershell.exe', args, { windowsHide: true });
  drag.proc_ = p;
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('D')) { drag.down = true; drag.at = Date.now(); drag.pos = screen.getCursorScreenPoint(); drag.proc = line.slice(2).toLowerCase(); drag.armed = false; }
      else if (line === 'F') fileDragFromExplorer();
      else if (line === 'U') {
        drag.down = false;
        if (drag.armed && mode === 'drop') setTimeout(() => { if (mode === 'drop') setMode('collapsed'); }, 900);
        drag.armed = false;
      }
    }
  });
  p.on('close', () => { drag.proc_ = null; if (!app.isQuitting) setTimeout(startDragWatch, 20000); });
}
// só abre sozinho quando é ARQUIVO sendo arrastado do Explorer/Área de Trabalho (cursor de copiar/mover do Windows).
// Arrastar janela, aba do navegador, app ou texto não abre. De outros apps, basta passar o arquivo por cima do Bit
// (o próprio Bit só reage a arquivos: dragenter com "Files" em renderer/tools.js).
function fileDragFromExplorer() {
  if (!drag.down || drag.armed || moving.kind || (mode !== 'collapsed' && mode !== 'bubble')) return;
  if (drag.proc !== 'explorer') return;
  drag.armed = true; setMode('drop');
}
function checkDrag() {}
ipcMain.on('win:drop', (_e, on) => {
  if (on && (mode === 'collapsed' || mode === 'bubble')) setMode('drop');
  if (!on && mode === 'drop' && !drag.down) setMode('collapsed');
});

function toggle(tab) {
  if (mode === 'expanded' && !tab) setMode('collapsed');
  else setMode('expanded', tab);
}

// ---------- bandeja ----------
function trayIcon() {
  const p = path.join(__dirname, 'assets', 'tray.png');
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}
function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Bit  ·  Ctrl+Alt+N');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir o Bit', click: () => setMode('expanded') },
    { label: 'Só o rostinho (bolinha)', type: 'checkbox', checked: !!(DATA.meta && DATA.meta.bubble), click: (it) => { DATA.meta.bubble = it.checked; saveData(); if (mode !== 'expanded') setMode('collapsed'); win && win.webContents.send('win:bubbleSet', it.checked); } },
    { label: 'Voltar o Bit para o topo da tela', click: () => { delete DATA.meta.anchor; delete DATA.meta.expSize; saveData(); setMode(mode === 'bubble' ? 'collapsed' : mode); } },
    { label: 'Bom dia (plano do dia)', click: () => setMode('expanded', 'bomdia') },
    { label: 'Fechamento do dia', click: () => setMode('expanded', 'fechamento') },
    { type: 'separator' },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: !!DATA.settings.autostart, click: (it) => { DATA.settings.autostart = it.checked; applyAutostart(); saveData(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => toggle());
}

function applyAutostart() {
  if (!app.isPackaged) return; // em modo dev não registra
  app.setLoginItemSettings({ openAtLogin: !!DATA.settings.autostart, path: process.execPath });
}

// ---------- motor: JEV classifica, Claude Code (plano) escreve ----------
const MOCK = !!process.env.ILHA_MOCK;
let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const workDir = () => path.join(dataDir(), 'claude-work');
let lastLimit = null;

function openDemandsSummary() {
  const open = DATA.demands.filter(d => d.status !== 'feito');
  if (!open.length) return 'Nenhuma demanda aberta registrada.';
  return open.slice(0, 25).map(d => `- [${d.prioridade}] ${d.titulo} (pediu: ${d.quem}${d.responsavel && !PROFILE.isMine(prof(), d.responsavel) ? `; quem faz: ${d.responsavel} (só acompanhar)` : ''}; frente: ${d.frente || '—'}; prazo: ${d.prazo || '—'})${d.descricao ? `\n  o que é: ${d.descricao.slice(0, 200)}` : ''}${d.obs ? `\n  observações: ${d.obs.slice(0, 200)}` : ''}`).join('\n');
}
const pct = (x) => (typeof x === 'number' ? Math.round(x * 100) : null);

const isGpt = () => DATA.settings.ai === 'chatgpt';
const FAST = () => (isGpt() ? 'ChatGPT' : 'Haiku'); // quem classifica quando o JEV não está
function noAiMsg(e) {
  const k = e.code || e.message;
  if (k === 'NO_CLAUDE') return 'Não achei o Claude Code neste PC. Instale (no PowerShell: irm https://claude.ai/install.ps1 | iex), rode "claude" uma vez para fazer login e tente de novo.';
  if (k === 'NO_CODEX') return 'Não achei o ChatGPT (Codex) neste PC. Instale (no PowerShell: irm https://chatgpt.com/codex/install.ps1 | iex), rode "codex login" uma vez para entrar com a sua conta do ChatGPT e tente de novo.';
  return null;
}
// erros de "não instalado" viram texto explicando como instalar (vale para todas as ferramentas)
function claude(opts) {
  return claudeRaw(opts).catch((e) => { const m = noAiMsg(e); throw m ? Object.assign(new Error(m), { code: e.message }) : e; });
}
function claudeRaw(opts) {
  if (MOCK) return mockClaude(opts);
  if (isGpt()) return runCodex({ bin: findCodex(DATA.settings.codexPath), workDir: workDir(), model: DATA.settings.writeModel, models: DATA.settings.codexModels || {}, ...opts });
  return runClaude({ bin: findClaude(DATA.settings.claudePath), workDir: workDir(), model: DATA.settings.writeModel,
    onLimit: (info) => { lastLimit = { ...info, at: Date.now() }; win && win.webContents.send('plan:limit', lastLimit); }, ...opts });
}
async function mockClaude({ prompt, onDelta, system }) {
  await new Promise(r => setTimeout(r, Number(process.env.ILHA_MOCK_DELAY || 300)));
  if (system && system.includes('transcrição automática de uma reunião')) {
    const t = '## Resumo\nAlinhamento do planejamento do trimestre.\n## Decisões\n- Fechar o planejamento até o fim do mês.\n## Tarefas\n- [Eu] Consolidar os números — sexta\n- [Ana] Revisar a apresentação — sem prazo\n## Pendências e dúvidas\n- Confirmar a data da próxima reunião.';
    for (const w of t.split(/(?<= )/)) { onDelta && onDelta(w); await new Promise(r => setTimeout(r, 10)); }
    return t;
  }
  if (system && system.includes('robozinho assistente pessoal')) {
    const t = 'Claro, bora! Aqui vai um **rascunho de e-mail** curto:\n\n> Oi, pessoal! Passando para lembrar da reunião de amanhã às 10h. Tragam os números da semana. Abraço!\n\nQuer que eu deixe mais formal?';
    for (const w of t.split(/(?<= )/)) { onDelta && onDelta(w); await new Promise(r => setTimeout(r, 25)); }
    return t;
  }
  if (prompt.includes('EXTRAIR_DEMANDAS')) return JSON.stringify([
    { responsavel: 'Eu', descricao: 'Levantar o que foi pedido e entregar a análise para quem pediu, no formato combinado.', titulo: 'Listar clientes sem retorno', quem: 'Ana', prazo: 'quinta', proximo_passo: 'Exportar a lista do sistema e cruzar com os contatos', trecho: 'a Ana pediu a lista de clientes sem retorno até quinta' },
    { responsavel: 'Eu', descricao: 'Levantar o que foi pedido e entregar a análise para quem pediu, no formato combinado.', titulo: 'Resumo do projeto para o Bruno', quem: 'Bruno', prazo: 'hoje', proximo_passo: 'Juntar os números da semana', trecho: 'o Bruno quer o resumo do projeto hoje' },
    { responsavel: 'Carla', titulo: 'Enviar planilha de custos', quem: 'Carla', prazo: '', proximo_passo: '', trecho: 'a Carla vai mandar a planilha de custos' }]);
  const t = '**Entraram 2 na lista.**\n\n1. **Agora:** resumo do projeto para o Bruno. É rápido e vence hoje.\n2. **Hoje:** lista de clientes sem retorno para a Ana.\n\n**Próximo passo:** comece pelo resumo do Bruno.';
  for (const w of t.split(/(?<= )/)) { onDelta && onDelta(w); await new Promise(r => setTimeout(r, 15)); }
  lastLimit = { status: 'allowed', rateLimitType: 'five_hour', resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600, at: Date.now() };
  win && win.webContents.send('plan:limit', lastLimit);
  return t;
}
// JEV fica "fora" por um tempo quando falta crédito/chave ou dá erro; aí o Haiku classifica tudo
const JEVST = { downUntil: 0, reason: '' };
function engineStatus() {
  const mode = DATA.settings.engine === 'haiku' ? 'haiku' : 'auto';
  if (MOCK && !process.env.ILHA_JEV_DOWN) return { mode, jev: mode === 'haiku' ? 'off' : 'ok', reason: '' };
  if (mode === 'haiku') return { mode, jev: 'off', reason: `Você escolheu usar só o ${FAST()}.` };
  if (!getJevKey() && !MOCK) return { mode, jev: 'nokey', reason: 'Sem chave do JEV.' };
  if (JEVST.downUntil > Date.now()) return { mode, jev: 'down', reason: JEVST.reason, until: JEVST.downUntil };
  return { mode, jev: 'ok', reason: '' };
}
const sendEngine = () => win && !win.isDestroyed() && win.webContents.send('engine:status', engineStatus());
async function jevCall(state, questions) {
  const st = engineStatus();
  if (st.jev !== 'ok') throw Object.assign(new Error(st.reason || 'JEV indisponível'), { code: 'JEV_SKIP' });
  try { return await jevRaw(state, questions); }
  catch (e) {
    if (e.code === 'NO_JEV') throw Object.assign(e, { code: 'JEV_SKIP' });
    const min = e.credit || e.status === 401 || e.status === 403 ? 60 : e.status === 429 ? 10 : 5;
    JEVST.downUntil = Date.now() + min * 60000;
    JEVST.reason = e.credit ? 'O JEV ficou sem créditos.' : e.message.replace(/^JEV: /, 'JEV: ');
    sendEngine();
    throw Object.assign(new Error(JEVST.reason), { code: 'JEV_SKIP', first: true });
  }
}
async function jevRaw(state, questions) {
  if (MOCK && process.env.ILHA_JEV_DOWN) throw Object.assign(new Error('JEV: sem créditos'), { status: 402, credit: true });
  if (MOCK) {
    if (questions.tipo) return { tipo: { choice: 'demanda', confidence: 0.94 }, tem_demanda: { noul: 0.97 } };
    const ftd = /Bruno/i.test(state); const P0 = prof(); if (!P0.pessoas.length) return { quem: { choice: 'Outra pessoa', confidence: 0.7 }, e_meu: { choice: 'sim', confidence: 0.8 }, esforco: { score: 0.8, confidence: 0.7 }, prioridade: { choice: 'hoje', confidence: 0.8 } };
    return { quem: { choice: ftd ? 'Bruno' : 'Ana', confidence: 0.96 },
      e_meu: { choice: ftd ? 'parcial' : 'sim', confidence: 0.8 }, esforco: { score: ftd ? 0.2 : 1.1, confidence: 0.7 }, prioridade: { choice: ftd ? 'agora' : 'hoje', confidence: 0.83 } };
  }
  return jev({ key: getJevKey(), model: DATA.settings.jevModel, state, questions });
}

const hoje = () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const ctxCurto = () => PROFILE.contextoCurto(prof());

async function extractDemands(text) {
  const p = prof();
  const frentes = p.frentes.length ? p.frentes.map(x => `"${x.id}"`).join('|') + '|"fora"' : '""';
  const pess = p.pessoas.length ? ` Pessoas conhecidas: ${p.pessoas.map(x => `${x.nome}${x.papel ? ` (${x.papel})` : ''}`).join('; ')}.` : '';
  const fr = p.frentes.length ? ` Frentes: ${p.frentes.map(x => `${x.id} = ${x.nome}${x.desc ? ` (${x.desc})` : ''}`).join('; ')}.` : '';
  const g = PROFILE.gestor(p);
  const prompt = `EXTRAIR_DEMANDAS\nHoje é ${hoje()}.\nDemandas que já estão na lista (não repita):\n${openDemandsSummary()}\n\nMensagem de ${who()}:\n"""${text}"""\n\nResponda SOMENTE com um array JSON. Cada item: {"titulo": até 8 palavras no infinitivo, "descricao": 1 a 3 frases explicando o que é a demanda, para que serve e o que precisa ser entregue (só com o que está na mensagem; se algo não foi dito, não invente), "quem": nome de quem pediu ou "Eu", "responsavel": nome de quem vai FAZER a tarefa ("Eu" se for ${who()}), "prazo": prazo como dito ou "", "proximo_passo": ação concreta curta, "trecho": o pedaço da mensagem sobre essa demanda, "frente": ${frentes}, "e_meu": "sim"|"parcial"|"origem", "esforco": "P"|"M"|"G", "prioridade": "agora"|"hoje"|"semana"|"espera"|"devolver"}. Critérios: agora = rápida e urgente hoje ou trava alguém${g ? ` ou veio de ${g}` : ''}; hoje = precisa sair hoje ou ligada a prazo importante; semana = prazo na semana; espera = sem prazo; devolver = deveria ser feita por outra pessoa/área.${p.regras ? ` Regras: ${p.regras}` : ''}${pess}${fr} IMPORTANTE: só entram tarefas que ${who()} precisa fazer, entregar, decidir ou acompanhar. Tarefas que são de outra pessoa (ex.: "a Ana vai mandar o relatório") NÃO entram; se ${who()} precisar cobrar ou esperar algo de alguém, a demanda dele é "Cobrar Ana sobre o relatório" com responsavel "Eu". Se não houver demanda nova, responda [].`;
  const raw = await claude({ system: 'Você extrai tarefas de mensagens de trabalho e responde apenas JSON válido, sem comentários nem cercas de código.', prompt });
  const m = raw.match(/\[[\s\S]*\]/);
  try { const arr = JSON.parse(m ? m[0] : '[]'); return Array.isArray(arr) ? arr.filter(x => x && x.titulo) : []; } catch { return []; }
}

const ESFORCO = (s) => (s == null ? 'M' : s < 0.6 ? 'P' : s < 1.4 ? 'M' : 'G');

// ---------- sessões (várias conversas em paralelo) ----------
const MODEL_OK = ['haiku', 'sonnet', 'opus'];
function ensureSessions() {
  if (Array.isArray(DATA.sessions)) return;
  DATA.sessions = [{ id: uid(), title: 'Copiloto Bit', kind: 'nip', model: MODEL_OK.includes(DATA.settings.writeModel) ? DATA.settings.writeModel : 'haiku',
    createdAt: Date.now(), updatedAt: Date.now(), status: 'idle', unread: false, messages: Array.isArray(DATA.chat) ? DATA.chat : [] }];
  delete DATA.chat;
  saveData();
}
const getS = (id) => DATA.sessions.find(s => s.id === id);
const running = new Map(); // sessionId -> etapa
function pub(s) {
  const last = [...s.messages].reverse().find(m => m.role === 'user' || m.role === 'assistant');
  return { id: s.id, title: s.title, kind: s.kind, model: s.model, status: running.has(s.id) ? 'working' : s.status, stage: running.get(s.id) || null,
    unread: !!s.unread, updatedAt: s.updatedAt, createdAt: s.createdAt, count: s.messages.filter(m => m.role === 'user').length,
    preview: last ? (last.role === 'user' ? 'Você: ' : 'Bit: ') + String(last.text || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) : '' };
}
function emitSessions() { win && !win.isDestroyed() && win.webContents.send('sessions:changed', DATA.sessions.map(pub)); }
function transcript(sess, n = 10) {
  return sess.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-n)
    .map(m => `${m.role === 'user' ? who() : PROFILE.bot(prof())}: ${m.text}`).join('\n\n');
}

ipcMain.handle('sessions:list', () => DATA.sessions.map(pub));
ipcMain.handle('sessions:get', (_e, id) => { const s = getS(id); return s ? { ...pub(s), messages: s.messages } : null; });
ipcMain.handle('sessions:create', (_e, { title, kind, model } = {}) => {
  const k = kind === 'geral' ? 'geral' : 'nip';
  const s = { id: uid(), title: (title || '').trim() || (k === 'nip' ? 'Copiloto Bit' : 'Nova conversa'), autoTitle: !(title || '').trim() && k === 'geral',
    kind: k, model: MODEL_OK.includes(model) ? model : 'haiku', createdAt: Date.now(), updatedAt: Date.now(), status: 'idle', unread: false, messages: [] };
  DATA.sessions.unshift(s); saveData(); emitSessions();
  return pub(s);
});
ipcMain.handle('sessions:update', (_e, { id, patch = {} }) => {
  const s = getS(id); if (!s) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) { s.title = patch.title.trim().slice(0, 60); s.autoTitle = false; }
  if (MODEL_OK.includes(patch.model)) s.model = patch.model;
  if (typeof patch.unread === 'boolean') s.unread = patch.unread;
  if (patch.status === 'idle' && !running.has(id)) s.status = 'idle';
  saveData(); emitSessions(); return pub(s);
});
ipcMain.handle('sessions:delete', (_e, id) => {
  if (running.has(id)) return { ok: false, error: 'Essa sessão ainda está trabalhando.' };
  DATA.sessions = DATA.sessions.filter(s => s.id !== id);
  ensureNip(); saveData(); emitSessions(); return { ok: true };
});
ipcMain.handle('sessions:clear', (_e, id) => { const s = getS(id); if (s && !running.has(id)) { s.messages = []; s.status = 'idle'; s.unread = false; saveData(); emitSessions(); } return true; });
function ensureNip() {
  if (!DATA.sessions.some(s => s.kind === 'nip')) DATA.sessions.push({ id: uid(), title: 'Copiloto Bit', kind: 'nip', model: 'haiku', createdAt: Date.now(), updatedAt: Date.now(), status: 'idle', unread: false, messages: [] });
}

ipcMain.handle('chat:send', async (_e, { sessionId, text }) => {
  const sess = getS(sessionId);
  if (!sess) return { ok: false, error: 'Sessão não encontrada.' };
  if (running.has(sess.id)) return { ok: false, error: 'Essa sessão ainda está trabalhando. Abra outra sessão para mandar em paralelo.' };
  const send = (ch, p) => win && !win.isDestroyed() && win.webContents.send(ch, { sessionId: sess.id, ...p });
  const stage = (st) => { running.set(sess.id, st); send('chat:status', { stage: st }); emitSessions(); };
  sess.messages.push({ id: uid(), role: 'user', text, at: Date.now() });
  if (sess.autoTitle && sess.messages.filter(m => m.role === 'user').length === 1) sess.title = text.replace(/\s+/g, ' ').slice(0, 38) + (text.length > 38 ? '…' : '');
  sess.updatedAt = Date.now(); sess.status = 'working'; saveData();
  try {
    if (sess.kind === 'nip') await runNip(sess, text, send, stage);
    else await runGeral(sess, text, send, stage);
    sess.status = 'done'; sess.unread = true;
    return { ok: true };
  } catch (e) {
    const err = noAiMsg(e) || `Não deu certo: ${e.message}`;
    sess.messages.push({ id: uid(), role: 'error', text: err, at: Date.now() });
    sess.status = 'error'; sess.unread = true;
    send('chat:error', { error: err });
    return { ok: false, error: err };
  } finally {
    running.delete(sess.id); sess.updatedAt = Date.now();
    sess.messages = sess.messages.slice(-300);
    saveData(); emitSessions();
    if (mode !== 'expanded' && Notification.isSupported()) {
      new Notification({ title: `${PROFILE.bot(prof())} · ${sess.title}`, body: sess.status === 'error' ? 'Deu um problema. Abra para ver.' : 'Resposta pronta. Ctrl+Alt+N para abrir.', silent: true }).show();
    }
  }
});

async function runGeral(sess, text, send, stage) {
  stage('escrevendo');
  const replyId = uid();
  send('chat:start', { id: replyId });
  // a mensagem vai pura; o histórico vai nas instruções (o Haiku erra mais quando a pergunta vem embrulhada)
  const prev = sess.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(0, -1).slice(-14)
    .map(m => `${m.role === 'user' ? who() : PROFILE.bot(prof())}: ${m.text}`).join('\n\n');
  const system = `${PR.systemGeral(prof())}\n\nHoje é ${hoje()}.${prev ? `\n\n## Conversa anterior nesta sessão (contexto; responda só à nova mensagem)\n${prev}` : ''}`;
  const full = await claude({ model: sess.model, system, prompt: text, timeoutMs: 300000,
    tools: 'WebSearch,WebFetch', allowedTools: 'WebSearch WebFetch',
    onTool: (name) => stage(name === 'WebFetch' ? 'lendo' : 'pesquisando'),
    onDelta: (t) => { if (running.get(sess.id) !== 'escrevendo') stage('escrevendo'); send('chat:delta', { id: replyId, text: t }); } });
  const msg = { id: replyId, role: 'assistant', text: full, at: Date.now(), model: sess.model };
  sess.messages.push(msg);
  send('chat:done', { msg });
}

// separa e prioriza demandas de um texto (JEV; se ele não estiver disponível, o Haiku decide)
async function addDemands(text, { sessId = null, stage = () => {}, warnings = [] } = {}) {
  stage('separando');
  // só fica o que é do próprio usuário (pelo nome do perfil, aceitando nome parecido)
  const all = await extractDemands(text), P0 = prof();
  const items = all.filter(it => PROFILE.isMine(P0, it.responsavel));
  const outros = all.filter(it => !items.includes(it));
  if (outros.length) warnings.push(`Não criei ${outros.length === 1 ? 'esta tarefa porque é' : 'estas tarefas porque são'} de outra pessoa: ${outros.map(o => `${o.titulo} (${o.responsavel})`).join('; ')}.`);
  if (items.length) stage('priorizando');
  const results = [];
  for (const it of items) { // em série: se o JEV cair na primeira, as outras nem tentam
    try {
      const a = await jevCall(`${ctxCurto()}\nHoje: ${hoje()}\nDemandas já abertas:\n${openDemandsSummary()}\n\nDemanda: ${it.titulo}\nQuem pediu (segundo o texto): ${it.quem || '?'}\nPrazo: ${it.prazo || 'não informado'}\nTrecho original: ${it.trecho || text}`, PROFILE.qDemanda(prof()));
      results.push({ a });
    } catch (e) { results.push({ err: e }); }
  }
  const added = [];
  results.forEach((r, i) => {
    const it = items[i], a = r.a || {};
    const item = {
      id: uid(), status: 'aberta', criadaEm: Date.now(), sessao: sessId,
      titulo: it.titulo, prazo: it.prazo || '', proximo_passo: it.proximo_passo || '', responsavel: 'Eu', descricao: String(it.descricao || '').trim(), origem: String(it.trecho || '').trim().slice(0, 1200),
      quem: a.quem?.choice || it.quem || '—', frente: a.frente?.choice || it.frente || '', e_meu: a.e_meu?.choice || it.e_meu || 'sim',
      esforco: a.esforco ? ESFORCO(a.esforco.score) : (it.esforco || 'M'), prioridade: a.prioridade?.choice || it.prioridade || 'semana',
      confianca: pct(a.prioridade?.confidence), motivo: r.a ? `JEV: ${pct(a.prioridade?.confidence) ?? '?'}% de confiança` : `prioridade definida pelo ${FAST()}`,
    };
    if (item.e_meu === 'origem' && item.prioridade !== 'devolver') item.prioridade = 'devolver';
    DATA.demands.unshift(item); added.push(item);
    if (r.err && r.err.first && !warnings.some(w => w.startsWith(r.err.message))) warnings.push(`${r.err.message} O ${FAST()} assumiu a classificação.`);
    else if (r.err && r.err.code !== 'JEV_SKIP' && !warnings.includes(r.err.message)) warnings.push(r.err.message);
  });
  saveData();
  return added;
}

async function runNip(sess, text, send, stage) {
  const warnings = [];
  // 1) JEV: tipo da mensagem + se tem demanda nova (sem JEV, o Haiku separa direto)
  stage('classificando');
  let tipo = 'conversa', tipoConf = null, temDemanda = null;
  try {
    const a = await jevCall(`${ctxCurto()}\nHoje: ${hoje()}\n\nMensagem de ${who()}:\n${text}`, PROFILE.qMensagem(prof()));
    tipo = a.tipo?.choice || 'conversa'; tipoConf = pct(a.tipo?.confidence); temDemanda = a.tem_demanda?.noul ?? null;
  } catch (e) { if (e.first) warnings.push(`${e.message} O ${FAST()} assumiu a classificação.`); else if (e.code !== 'JEV_SKIP') warnings.push(e.message); }

  // 2) separa e prioriza
  let added = [];
  if (temDemanda == null || temDemanda >= 0.5 || tipo === 'demanda' || tipo === 'plano_dia') added = await addDemands(text, { sessId: sess.id, stage, warnings });
  if (tipoConf == null && added.length && tipo === 'conversa') tipo = 'demanda';
  const cls = { tipo, resumo: tipoConf != null ? `JEV · ${tipoConf}% de certeza` : FAST(), confianca: tipoConf };
  sess.messages.push({ id: uid(), role: 'meta', cls, added, warnings, at: Date.now() });
  saveData();
  send('chat:classified', { cls, added, demands: DATA.demands, warnings });

  // 4) Claude escreve
  stage('escrevendo');
  const replyId = uid();
  send('chat:start', { id: replyId });
  const FR = Object.fromEntries(prof().frentes.map(x => [x.id, x.nome])); FR.fora = 'fora das frentes';
  const novas = added.map(d => `- ${d.titulo} → ${d.prioridade} (quem: ${d.quem}, frente: ${FR[d.frente] || d.frente}, é dele: ${d.e_meu}, esforço ${d.esforco}, prazo: ${d.prazo || '—'}, próximo passo: ${d.proximo_passo})`).join('\n') || 'nenhuma';
  const prev = sess.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(0, -1).slice(-8)
    .map(m => `${m.role === 'user' ? who() : PROFILE.bot(prof())}: ${m.text}`).join('\n\n');
  const system = `${PR.systemCopiloto(prof())}

## Contexto desta mensagem
Hoje é ${hoje()}.
Classificação da nova mensagem: tipo = ${tipo}.
Demandas novas que JÁ entraram na lista, com a prioridade já definida (respeite essas prioridades, não invente outras):
${novas}

Demandas abertas no hub:
${openDemandsSummary()}
${prev ? `\n## Conversa anterior nesta sessão (contexto; responda só à nova mensagem)\n${prev}\n` : ''}
Use nomes legíveis das frentes, nunca códigos internos.`;
  const full = await claude({ model: sess.model, system, prompt: text, onDelta: (t) => send('chat:delta', { id: replyId, text: t }) });
  const msg = { id: replyId, role: 'assistant', text: full, at: Date.now(), model: sess.model, cls: { tipo, n: added.length } };
  sess.messages.push(msg);
  send('chat:done', { msg });
}

// ---------- assistente do início: entende o pedido e faz (lembrete, nota, demanda, foco...) ----------
const pad2 = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
function assistContext() {
  const now = new Date();
  const ag = extrasHandle ? extrasHandle.brief() : { events: [], reminders: [] };
  const evs = ag.events.map(e => `- ${new Date(e.start).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: ${e.title}${e.via ? ` (${e.via})` : ''}`).join('\n') || 'nenhuma';
  const rems = ag.reminders.map(r => `- ${new Date(r.at).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: ${r.text}`).join('\n') || 'nenhum';
  return `Agora: ${isoLocal(now)} (${now.toLocaleDateString('pt-BR', { weekday: 'long' })}).\n\nReuniões dos próximos dias:\n${evs}\n\nLembretes pendentes:\n${rems}\n\nDemandas abertas:\n${openDemandsSummary()}`;
}
function mockRouter(text) {
  const t = text.toLowerCase(), acoes = [];
  const parts = t.split(/\s+e\s+(?=(?:me\s+)?(?:lembr|anot|cri|abr|marc))/);
  for (const p of parts) {
    if (/lembr/.test(p)) { const d = new Date(Date.now() + 30 * 60000); acoes.push({ tipo: 'lembrete', repetir: /todo dia|todos os dias/.test(p) ? 'dia' : /toda semana/.test(p) ? 'semana' : null, texto: p.replace(/.*?lembr\w*\s*(de\s+)?/, '').replace(/\s*(em|daqui)\s+\d+.*$/, '') || 'lembrete', quando: isoLocal(d) }); }
    else if (/anot|nota/.test(p)) acoes.push({ tipo: 'nota', texto: p.replace(/.*?(anota\w*|nota:?)\s*(a[ií]\s*)?(que\s*)?/, '') });
    else if (/demanda|pediu/.test(p)) acoes.push({ tipo: 'demanda', texto: p });
    else if (/o que tenho|agenda|reuni/.test(p)) acoes.push({ tipo: 'responder' });
  }
  return { acoes, resposta: acoes.some(a => a.tipo === 'responder') ? 'Hoje você tem 1 reunião às 14:30.' : 'Feito!' };
}
ipcMain.handle('assist:run', async (_e, text) => {
  text = String(text || '').trim(); if (!text) return { resposta: '', feitos: [] };
  let plan;
  if (MOCK) { await new Promise(r => setTimeout(r, 200)); plan = mockRouter(text); }
  else {
    const raw = await claude({ model: 'haiku', system: `${PR.systemAssist(prof())}\n\n## Situação agora\n${assistContext()}`, prompt: text, timeoutMs: 90000 });
    const m = raw.match(/\{[\s\S]*\}/);
    try { plan = JSON.parse(m ? m[0] : raw); } catch { plan = { acoes: [{ tipo: 'copiloto' }], resposta: '' }; }
  }
  const acoes = Array.isArray(plan.acoes) ? plan.acoes : [];
  const feitos = [], ui = [], warnings = [];
  let resposta = String(plan.resposta || '').trim();
  for (const a of acoes) {
    try {
      if (a.tipo === 'lembrete') {
        const at = a.quando ? new Date(a.quando).getTime() : NaN;
        if (!a.texto) continue;
        if (!isFinite(at)) { ui.push({ tipo: 'lembrete_sem_hora', texto: a.texto }); continue; }
        const REPK = { dia: 'dia', diario: 'dia', util: 'util', dias_uteis: 'util', semana: 'semana', semanal: 'semana', mes: 'mes', mensal: 'mes', cada: 'cada' };
        const rep = a.repetir && REPK[a.repetir] ? { k: REPK[a.repetir], days: a.dias, every: a.a_cada_min } : null;
        const r = extrasHandle.addReminder(a.texto, at, rep);
        feitos.push({ tipo: 'lembrete', id: r.id, texto: r.text, at: r.at, repeat: r.repeat });
      } else if (a.tipo === 'nota') {
        if (!a.texto) continue;
        const n = toolsHandle.addNote(a.texto);
        feitos.push({ tipo: 'nota', id: n.id, texto: a.texto.split('\n')[0].slice(0, 80) });
      } else if (a.tipo === 'demanda') {
        const added = await addDemands(a.texto || text, { warnings });
        for (const d of added) feitos.push({ tipo: 'demanda', id: d.id, texto: d.titulo, prioridade: d.prioridade, quem: d.quem });
        if (!added.length) warnings.push('Não achei uma demanda clara nesse trecho.');
      } else if (['foco', 'abrir', 'gravar', 'copiloto', 'geral', 'lembrete_sem_hora'].includes(a.tipo)) ui.push(a);
    } catch (e) { warnings.push(e.message); }
  }
  if (!acoes.length && !resposta) ui.push({ tipo: 'copiloto' });
  return { resposta, feitos, ui, warnings, demands: DATA.demands, engine: engineStatus() };
});
ipcMain.handle('assist:undo', (_e, { tipo, id }) => {
  if (tipo === 'lembrete') extrasHandle.delReminder(id);
  if (tipo === 'nota') toolsHandle.delNote(id);
  if (tipo === 'demanda') { DATA.demands = DATA.demands.filter(d => d.id !== id); saveData(); }
  return { demands: DATA.demands };
});
ipcMain.handle('engine:get', () => engineStatus());
ipcMain.handle('profile:get', () => prof());
ipcMain.handle('profile:save', (_e, p) => { DATA.profile = PROFILE.normalize({ ...(DATA.profile || {}), ...(p || {}) }); saveData(); return DATA.profile; });

// o que falta configurar (tela "Primeiros passos")
async function gptStatus() {
  if (MOCK) return { st: 'ok', bin: 'codex' };
  const bin = findCodex(DATA.settings.codexPath);
  if (bin === 'codex' || !fs.existsSync(bin)) return { st: 'missing', bin: '' };
  return { st: (await codexLoggedIn(bin)) ? 'ok' : 'login', bin };
}
ipcMain.handle('setup:status', async () => {
  const bin = findClaude(DATA.settings.claudePath);
  const found = MOCK || (bin !== 'claude' && fs.existsSync(bin));
  const home = require('os').homedir();
  const logged = MOCK || fs.existsSync(path.join(home, '.claude', '.credentials.json')) || (() => { try { return !!JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).oauthAccount; } catch { return false; } })();
  const vs = MOCK ? { ready: false } : voice.status(voiceRoot(), DATA.settings.voiceModel);
  const gpt = isGpt() ? await gptStatus() : { st: 'missing', bin: '' };
  const mockAi = MOCK && process.env.ILHA_MOCK_AI; // teste: ILHA_MOCK_AI=missing|login mostra a tela de conectar
  return { profile: !!(DATA.profile && DATA.profile.nome), ai: isGpt() ? 'chatgpt' : 'claude', claude: mockAi || (found ? (logged ? 'ok' : 'login') : 'missing'), claudePath: found ? bin : '', chatgpt: mockAi || gpt.st, chatgptPath: gpt.bin, voice: !!vs.ready, calendars: (DATA.calendars || []).length, jev: !!getJevKey(), engine: engineStatus() };
});
ipcMain.on('data:open', () => shell.openPath(dataDir()));

// "Instalar e entrar" do passo a passo: abre uma janela do PowerShell que instala a IA (se faltar) e abre o login.
// O login é sempre da própria pessoa (navegador oficial do Claude ou do ChatGPT); o Bit só confere depois se deu certo.
ipcMain.handle('ai:connect', (_e, ai) => {
  if (MOCK) return { ok: true, mock: true };
  if (process.platform !== 'win32') return { ok: false, error: 'Só no Windows por enquanto.' };
  const gpt = ai === 'chatgpt';
  const bin = gpt ? findCodex(DATA.settings.codexPath) : findClaude(DATA.settings.claudePath);
  const have = bin !== (gpt ? 'codex' : 'claude') && fs.existsSync(bin);
  const say = (t) => `Write-Host "${t}" -ForegroundColor Cyan`;
  const ps = gpt ? [
    say('Bit: conectando o ChatGPT (Codex).'),
    ...(have ? [] : [say('Instalando o Codex... (leva 1 ou 2 minutos)'), 'irm https://chatgpt.com/codex/install.ps1 | iex']),
    `$c = "${have ? bin : ''}"; if (-not $c -or -not (Test-Path $c)) { $c = Join-Path $env:LOCALAPPDATA 'Programs/OpenAI/Codex/bin/codex.exe' }; if (-not (Test-Path $c)) { $c = 'codex' }`,
    say('Agora o navegador vai abrir: entre com a sua conta do ChatGPT.'),
    '& $c login',
    say('Pronto! Pode fechar esta janela e voltar para o Bit.'),
  ] : [
    say('Bit: conectando o Claude (Claude Code).'),
    ...(have ? [] : [say('Instalando o Claude Code... (leva 1 ou 2 minutos)'), 'irm https://claude.ai/install.ps1 | iex']),
    `$c = "${have ? bin : ''}"; if (-not $c -or -not (Test-Path $c)) { $c = Join-Path $env:USERPROFILE '.local/bin/claude.exe' }; if (-not (Test-Path $c)) { $c = 'claude' }`,
    say('O Claude vai abrir aqui: aperte Enter nas perguntas e escolha entrar com a sua conta do Claude (abre o navegador).'),
    say('Quando aparecer a tela de conversa do Claude, o login está feito: pode fechar esta janela.'),
    '& $c',
  ];
  const { spawn } = require('child_process');
  const enc = Buffer.from(ps.join('\n'), 'utf16le').toString('base64');
  try {
    const ch = spawn('powershell.exe', ['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { detached: true, stdio: 'ignore', windowsHide: false });
    ch.unref();
    return { ok: true, installing: !have };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('engine:test', async () => {
  const out = { claude: null, jev: null };
  try {
    const bin = isGpt() ? findCodex(DATA.settings.codexPath) : findClaude(DATA.settings.claudePath);
    const t0 = Date.now();
    const r = await claude({ system: 'Responda apenas: OK', prompt: 'teste', timeoutMs: 60000 });
    out.claude = { ok: true, msg: `respondeu "${r.trim().slice(0, 20)}" em ${((Date.now() - t0) / 1000).toFixed(1)}s`, bin };
  } catch (e) { out.claude = { ok: false, msg: e.message }; }
  out.ai = isGpt() ? 'ChatGPT (Codex)' : 'Claude Code';
  try {
    if (MOCK) out.jev = { ok: true, msg: 'modo teste' };
    else if (!getJevKey()) out.jev = { ok: false, msg: 'sem chave' };
    else { const ids = await jevPing(getJevKey()); out.jev = { ok: true, msg: ids.length ? `ok · ${ids.slice(0, 3).join(', ')}` : 'ok' }; }
  } catch (e) { out.jev = { ok: false, msg: e.message }; }
  return { ...out, limit: lastLimit };
});

const BOOT = () => global.__ILHA_BOOT || { version: (() => { try { return require('./manifest.json').version; } catch { return 'dev'; } })(), from: 'desenvolvimento', update: { status: 'skipped' } };
const ghFile = () => path.join(dataDir(), 'ilha-gh.bin');
function hasGh() { try { return fs.statSync(ghFile()).size > 0; } catch { return false; } }
function setGh(t) {
  if (!t) { try { fs.unlinkSync(ghFile()); } catch {} return; }
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(ghFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t, 'utf8'));
}
let updateReady = null;
async function bgCheck(manual) {
  const U = global.__ILHA_UPDATER;
  if (!U) return { status: 'skipped' };
  const r = await U.check({ timeoutMs: manual ? 30000 : 20000 });
  if (r.status === 'updated') { updateReady = r; win && win.webContents.send('update:ready', r); }
  return r;
}
ipcMain.handle('update:check', () => bgCheck(true));

// ---------- conversões (FFmpeg, Office/LibreOffice, PDF do Chromium) ----------
const convRoot = () => path.join(dataDir(), 'tools');
const convSend = (p) => win && !win.isDestroyed() && win.webContents.send('conv:progress', p);
const convErr = (e) => e.code === 'FFMPEG_MISSING' ? 'FFMPEG_MISSING' : e.code === 'OFFICE_MISSING' ? 'OFFICE_MISSING' : e.message;
ipcMain.handle('conv:status', () => ({ ffmpeg: !!conv.ffmpegPath(convRoot()), office: conv.officeStatus() }));
ipcMain.handle('conv:ffInstall', async () => {
  try { await conv.ffInstall(convRoot(), (p) => convSend({ what: 'install', ...p })); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
const convWrap = (fn) => async (_e, o) => { try { return { ok: true, ...(await fn(o)) }; } catch (e) { return { ok: false, error: convErr(e) }; } };
ipcMain.handle('conv:ff', convWrap((o) => conv.ffConvert(convRoot(), { ...o, outDir: o.outDir || path.dirname(o.input), onProgress: (p) => convSend({ what: 'file', p }) })));
ipcMain.handle('conv:heic', convWrap((o) => conv.heic(convRoot(), { ...o, outDir: o.outDir || path.dirname(o.input) })));
ipcMain.handle('conv:office', convWrap((o) => conv.office({ ...o, outDir: o.outDir || path.dirname(o.input) })));
ipcMain.handle('conv:html', convWrap((o) => conv.htmlToPdf(BrowserWindow, o)));

// ---------- sessões do Claude Code no PC ----------
let ccList = [], ccSig = '';
function ccScan() {
  let l = [];
  try { l = cc.list(7); } catch { l = []; }
  const sig = l.map(x => `${x.id}:${x.status}:${Math.round(x.updatedAt / 1000)}`).join('|');
  if (sig === ccSig) return;
  const prev = new Map(ccList.map(x => [x.id, x.status]));
  ccSig = sig; ccList = l;
  win && !win.isDestroyed() && win.webContents.send('cc:changed', l);
  for (const x of l) {
    if (prev.get(x.id) === 'working' && x.status === 'waiting') {
      win && win.webContents.send('cc:finished', { id: x.id, title: x.title, project: x.project });
      if (mode !== 'expanded' && Notification.isSupported()) new Notification({ title: `Claude Code · ${x.project}`, body: `Terminou: ${x.title}`, silent: true }).show();
    }
  }
}
ipcMain.handle('cc:list', () => { ccScan(); return ccList; });
ipcMain.handle('cc:messages', (_e, id) => { const x = ccList.find(y => y.id === id); return x ? cc.messages(x.file) : []; });
ipcMain.handle('cc:open', (_e, id) => { const x = ccList.find(y => y.id === id); if (x) cc.openInTerminal(x, findClaude(DATA.settings.claudePath)); return !!x; });
// mandar mensagem para uma sessão do Claude Code sem abrir o terminal (claude -p --resume)
const ccRun = new Map();
ipcMain.handle('cc:send', async (_e, { id, text, perm, model }) => {
  let x = ccList.find(y => y.id === id);
  if (!x) { ccScan(); x = ccList.find(y => y.id === id); }
  if (!x) return { ok: false, error: 'Sessão não encontrada.' };
  if (ccRun.has(id)) return { ok: false, error: 'Ainda estou mandando a mensagem anterior para essa sessão.' };
  if (x.status === 'working') return { ok: false, error: 'Essa sessão está trabalhando agora (provavelmente num terminal). Espere ela terminar.' };
  if (!MOCK && (!x.cwd || !fs.existsSync(x.cwd))) return { ok: false, error: 'A pasta do projeto dessa sessão não existe mais neste PC.' };
  const send = (ch, p) => win && !win.isDestroyed() && win.webContents.send(ch, { id, ...p });
  const mode_ = ['plan', 'acceptEdits', 'auto', 'bypassPermissions'].includes(perm) ? perm : 'acceptEdits';
  const args = ['--resume', id, '--permission-mode', mode_, ...(MODEL_OK.includes(model) ? ['--model', model] : [])];
  try {
    let full;
    if (MOCK) {
      ccRun.set(id, { kill() {} });
      await new Promise(r => setTimeout(r, 400)); send('cc:tool', { label: 'Read: src/app.js' });
      await new Promise(r => setTimeout(r, 400)); send('cc:tool', { label: 'Edit: src/app.js' });
      full = 'Pronto! Ajustei o **app.js** como você pediu e rodei a checagem de sintaxe.';
      for (const w of full.split(/(?<= )/)) { send('cc:delta', { text: w }); await new Promise(r => setTimeout(r, 30)); }
    } else {
      full = await runClaude({ bin: findClaude(DATA.settings.claudePath), workDir: workDir(), cwd: x.cwd, rawArgs: args, prompt: text, timeoutMs: 30 * 60 * 1000,
        onProc: (c) => ccRun.set(id, c),
        onDelta: (t) => send('cc:delta', { text: t }),
        onTool: (name, input) => send('cc:tool', { label: cc.toolLabel({ name, input }) }),
        onLimit: (info) => { lastLimit = { ...info, at: Date.now() }; win && win.webContents.send('plan:limit', lastLimit); } });
    }
    send('cc:done', { text: full });
    return { ok: true };
  } catch (e) {
    const err = (e.code || e.message) === 'NO_CLAUDE' ? 'Não achei o Claude Code neste PC (veja Config > Testar conexões).' : e.killed ? 'Parado.' : e.message;
    send('cc:error', { error: err });
    return { ok: false, error: err };
  } finally {
    ccRun.delete(id);
    setTimeout(() => { ccSig = ''; ccScan(); }, 400);
  }
});
ipcMain.handle('cc:stop', (_e, id) => {
  const c = ccRun.get(id); if (!c) return false;
  try { if (process.platform === 'win32' && c.pid) require('child_process').spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { windowsHide: true }); else c.kill(); } catch {}
  return true;
});
ipcMain.handle('cc:folder', (_e, id) => { const x = ccList.find(y => y.id === id); if (x && x.cwd) shell.openPath(x.cwd); return !!x; });

// ---------- voz (Whisper local) ----------
const voiceRoot = () => path.join(dataDir(), 'whisper');
ipcMain.handle('voice:status', () => MOCK ? { ready: true, label: 'modo teste', model: 'small' } : voice.status(voiceRoot(), DATA.settings.voiceModel));
ipcMain.handle('voice:install', async () => {
  if (MOCK) return { ready: true };
  try {
    return await voice.install(voiceRoot(), DATA.settings.voiceModel, (p) => win && win.webContents.send('voice:progress', p));
  } catch (e) { return { ready: false, error: e.message }; }
});
ipcMain.handle('voice:transcribe', async (_e, wav) => {
  if (MOCK) { await new Promise(r => setTimeout(r, 600)); return { text: 'me lembra de mandar o relatório amanhã às 9h' }; }
  try { return { text: await voice.serverTranscribe(voiceRoot(), DATA.settings.voiceModel, wav, { vocab: PROFILE.vocab(prof()) }) }; }
  catch (e) { return { error: e.message === 'VOICE_NOT_READY' ? 'O Whisper ainda não foi baixado. Vá em Config > Voz.' : e.message }; }
});
ipcMain.on('voice:warm', () => { if (!MOCK) voice.warm(voiceRoot(), DATA.settings.voiceModel); });
ipcMain.handle('voice:loaded', () => MOCK || voice.isLoaded());
ipcMain.on('update:relaunch', () => { const U = global.__ILHA_UPDATER; if (U) U.relaunch(); else { app.relaunch(); app.exit(0); } });
ipcMain.handle('state:get', () => ({ ...DATA, sessions: DATA.sessions.map(pub), voiceModels: voice.MODELS, voiceHotkey: VOICE_HOTKEY, hasJev: MOCK || !!getJevKey(), engine: engineStatus(), hasGh: hasGh(), hotkey: HOTKEY, boot: BOOT(), updateReady, limit: lastLimit }));
ipcMain.handle('demands:update', (_e, { id, patch }) => {
  const d = DATA.demands.find(x => x.id === id);
  if (d) Object.assign(d, patch, patch.status === 'feito' ? { feitaEm: Date.now() } : {});
  saveData(); return DATA.demands;
});
ipcMain.handle('demands:add', (_e, item) => {
  DATA.demands.unshift({ id: uid(), status: 'aberta', criadaEm: Date.now(), prioridade: 'semana', quem: 'eu', frente: '', ...item });
  saveData(); return DATA.demands;
});
ipcMain.handle('demands:remove', (_e, id) => { DATA.demands = DATA.demands.filter(x => x.id !== id); saveData(); return DATA.demands; });
ipcMain.handle('demands:clearDone', () => { DATA.demands = DATA.demands.filter(x => x.status !== 'feito'); saveData(); return DATA.demands; });
ipcMain.handle('settings:save', (_e, s) => {
  const { jevKey, ghToken, ...rest } = s || {};
  if (typeof ghToken === 'string' && ghToken.trim() !== '' && ghToken !== '••••') setGh(ghToken.trim());
  if (ghToken === '') setGh('');
  if (typeof jevKey === 'string' && jevKey.trim() !== '' && jevKey !== '••••') setJevKey(jevKey.trim());
  if (jevKey === '') setJevKey('');
  const prevVoice = `${!!DATA.settings.voiceKeep}|${DATA.settings.voiceModel}`;
  DATA.settings = { ...DATA.settings, ...rest };
  applyAutostart(); saveData(); applyGlass();
  if (!MOCK && prevVoice !== `${!!DATA.settings.voiceKeep}|${DATA.settings.voiceModel}`) voice.setKeep(!!DATA.settings.voiceKeep, voiceRoot(), DATA.settings.voiceModel);
  if (DATA.settings.dragDetect === false && drag.proc_) { try { drag.proc_.removeAllListeners('close'); drag.proc_.kill(); } catch {} drag.proc_ = null; } else startDragWatch();
  if (typeof jevKey === 'string' && jevKey.trim() && jevKey !== '••••') JEVST.downUntil = 0; // chave nova: tenta o JEV de novo
  sendEngine();
  return { settings: DATA.settings, hasJev: !!getJevKey(), hasGh: hasGh(), engine: engineStatus() };
});
ipcMain.handle('meta:set', (_e, patch) => { DATA.meta = { ...DATA.meta, ...patch }; saveData(); return DATA.meta; });
ipcMain.on('win:toggle', (_e, tab) => toggle(tab));
ipcMain.on('win:collapse', () => setMode('collapsed'));
ipcMain.on('win:expand', (_e, tab) => setMode('expanded', tab));
ipcMain.on('win:pin', (_e, v) => { pinned = !!v; });
ipcMain.on('notify', (_e, { title, body }) => { if (Notification.isSupported()) new Notification({ title, body }).show(); });
ipcMain.on('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.on('app:quit', () => { app.isQuitting = true; app.quit(); });

// ---------- ciclo de vida ----------
if (!global.__ILHA_BOOT && !app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => setMode('expanded'));
  app.setAppUserModelId('app.bit.copiloto');
  app.whenReady().then(() => {
    DATA = loadData();
    if (PROFILE.migrate(DATA)) saveData();
    ensureSessions(); ensureNip();
    DATA.sessions.forEach(x => { if (x.status === 'working') x.status = 'idle'; });
    createWindow();
    createTray();
    applyAutostart();
    globalShortcut.register(HOTKEY, () => toggle());
    setInterval(ccScan, 5000); setTimeout(ccScan, 1500);
    startDragWatch();
    let lastEye = '';
    setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      const p = screen.getCursorScreenPoint(), b = win.getBounds();
      const cx = b.x + MARGIN + (mode === 'bubble' ? 30 : mode === 'collapsed' ? 27 : 30), cy = b.y + MARGIN + (mode === 'bubble' ? 30 : 25);
      const k = `${Math.round((p.x - cx) / 6)},${Math.round((p.y - cy) / 6)}`;
      if (k !== lastEye) { lastEye = k; win.webContents.send('eyes', { dx: p.x - cx, dy: p.y - cy }); }
      checkDrag(p);
    }, 90);
    globalShortcut.register(VOICE_HOTKEY, () => { if (!MOCK) voice.warm(voiceRoot(), DATA.settings.voiceModel); win && win.webContents.send('voice:toggle'); });
    if (DATA.settings.voiceKeep && !MOCK) setTimeout(() => voice.setKeep(true, voiceRoot(), DATA.settings.voiceModel), 8000);
    toolsHandle = tools.register({ ipcMain, shell, clipboard, safeStorage, dialog, getWin: () => win, getData: () => DATA, saveData,
      voice, voiceRoot: () => path.join(dataDir(), 'whisper'), getVoiceModel: () => DATA.settings.voiceModel, claudeRun: (o) => claude(o), MOCK, PR, prof, hoje, clipIgnore: (t) => extrasHandle && extrasHandle.clipIgnore(t) });
    extrasHandle = extras.register({ ipcMain, clipboard, shell, net: require('electron').net, Notification, globalShortcut, safeStorage, getWin: () => win, getData: () => DATA, saveData, setMode, getMode: () => mode, dataDir,
      claudeRun: (o) => claude(o), MOCK, PR, prof, uid, warmVoice: () => { if (!MOCK) voice.warm(voiceRoot(), DATA.settings.voiceModel); } });
    // áudio do PC (loopback) para gravar reuniões, sem janela de escolha
    require('electron').session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
      desktopCapturer.getSources({ types: ['screen'] }).then(src => cb(src[0] ? { video: src[0], audio: 'loopback' } : {})).catch(() => cb({}));
    });
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write'].includes(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'display-capture', 'notifications', 'clipboard-sanitized-write'].includes(perm));
    setInterval(() => bgCheck(false), 4 * 60 * 60 * 1000);
    if (process.env.ILHA_EXPAND) setTimeout(() => setMode('expanded', process.env.ILHA_EXPAND), 800);
    screen.on('display-metrics-changed', () => win && win.setBounds(boundsFor(mode)));
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); toolsHandle && toolsHandle.cleanup(); extrasHandle && extrasHandle.cleanup(); try { drag.proc_ && drag.proc_.kill(); } catch {} });
  app.on('window-all-closed', () => { /* fica na bandeja */ });
}
