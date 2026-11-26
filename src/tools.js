// Ferramentas da Ilha (lado do sistema): arquivos, notas, cofre, música e reunião.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WIN = process.platform === 'win32';
let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---------------- utilidades de arquivo ----------------
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 2; i < 1000; i++) { const c = path.join(dir, `${base} (${i})${ext}`); if (!fs.existsSync(c)) return c; }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '', err = '';
    p.stdout && p.stdout.on('data', d => { out += d; });
    p.stderr && p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', c => (c === 0 ? resolve(out) : reject(new Error((err || out).toString().split('\n').filter(Boolean).slice(-2).join(' ') || `código ${c}`))));
  });
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
// roda um script PowerShell sem problema de aspas/acentos (codificado em UTF-16)
const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
  Buffer.from('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n' + script, 'utf16le').toString('base64')];

async function zip(paths) {
  const first = paths[0];
  const base = paths.length === 1 ? path.basename(first, fs.statSync(first).isDirectory() ? '' : path.extname(first)) : 'arquivos';
  const out = uniquePath(path.join(path.dirname(first), `${base}.zip`));
  if (WIN) {
    await run('powershell.exe', psArgs(`Compress-Archive -LiteralPath ${paths.map(psq).join(',')} -DestinationPath ${psq(out)} -CompressionLevel Optimal`));
  } else {
    await run('zip', ['-r', '-q', out, ...paths.map(p => path.basename(p))], { cwd: path.dirname(first) });
  }
  return out;
}
async function unzip(file) {
  const ext = path.extname(file);
  let base = path.basename(file, ext);
  if (/\.tar$/i.test(base)) base = path.basename(base, '.tar');
  const dest = uniquePath(path.join(path.dirname(file), base));
  fs.mkdirSync(dest, { recursive: true });
  try {
    if (WIN) await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', dest]);
    else if (/\.zip$/i.test(file)) await run('unzip', ['-q', file, '-d', dest]);
    else await run('tar', ['-xf', file, '-C', dest]);
  } catch (e) {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    throw new Error(/\.(rar|7z)$/i.test(file)
      ? 'O Windows deste PC não abre esse formato sozinho. Atualize o Windows 11 ou instale o 7-Zip (7-zip.org) e me peça para usar ele.'
      : 'Não consegui descompactar: ' + e.message);
  }
  return dest;
}

// ---------------- música: "tocando agora" do Windows ----------------
const SMTC_PRELUDE = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
`;
const SMTC_LOOP = SMTC_PRELUDE + `
$last = ''
while ($true) {
  $o = @{ playing = $false }
  try {
    $s = $mgr.GetCurrentSession()
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $i = $s.GetPlaybackInfo()
      $o = @{ title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; app = $s.SourceAppUserModelId; status = $i.PlaybackStatus.ToString(); playing = ($i.PlaybackStatus.ToString() -eq 'Playing') }
    }
  } catch {}
  $j = $o | ConvertTo-Json -Compress
  if ($j -ne $last) { [Console]::Out.WriteLine($j); [Console]::Out.Flush(); $last = $j }
  Start-Sleep -Milliseconds 1500
}`;
function smtcCommand(cmd) {
  const m = { toggle: 'TryTogglePlayPauseAsync', next: 'TrySkipNextAsync', prev: 'TrySkipPreviousAsync' }[cmd];
  if (!m || !WIN) return Promise.resolve(false);
  const script = SMTC_PRELUDE + `$s = $mgr.GetCurrentSession(); if ($s) { [void](Await ($s.${m}()) ([bool])) }`;
  return run('powershell.exe', psArgs(script)).then(() => true, () => false);
}

// ---------------- reunião: áudio em trechos para o Whisper ----------------
function wavFromInt16(int16, rate = 16000) {
  const len = int16.length * 2, buf = Buffer.alloc(44 + len);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + len, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(len, 40);
  Buffer.from(int16.buffer, int16.byteOffset, len).copy(buf, 44);
  return buf;
}
function rms(int16) {
  let s = 0; for (let i = 0; i < int16.length; i += 4) s += int16[i] * int16[i];
  return Math.sqrt(s / Math.max(1, int16.length / 4)) / 32768;
}

function register(ctx) {
  const { ipcMain, shell, clipboard, safeStorage, dialog, getWin, getData, saveData, voice, voiceRoot, getVoiceModel, claudeRun, MOCK, PR, prof, hoje, clipIgnore } = ctx;
  const send = (ch, p) => { const w = getWin(); w && !w.isDestroyed() && w.webContents.send(ch, p); };
  const D = () => { const d = getData(); d.notes ||= []; d.vault ||= []; d.meetings ||= []; d.playlist ||= []; return d; };

  // ----- arquivos -----
  ipcMain.handle('files:stat', (_e, paths) => (paths || []).map(p => {
    try { const st = fs.statSync(p); return { path: p, name: path.basename(p), ext: path.extname(p).slice(1).toLowerCase(), size: st.size, isDir: st.isDirectory() }; }
    catch { return null; }
  }).filter(Boolean));
  ipcMain.handle('files:read', (_e, p) => {
    const st = fs.statSync(p);
    if (st.size > 400 * 1048576) throw new Error('Arquivo grande demais (mais de 400 MB).');
    const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  });
  ipcMain.handle('files:write', (_e, { dir, name, data }) => {
    const out = uniquePath(path.join(dir, name));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(data));
    return { path: out, size: fs.statSync(out).size };
  });
  ipcMain.handle('files:rename', (_e, { from, name }) => {
    const clean = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/[. ]+$/, '');
    if (!clean) throw new Error('Nome inválido.');
    const to = path.join(path.dirname(from), clean);
    if (to === from) return from;
    if (fs.existsSync(to)) throw new Error(`Já existe um arquivo chamado "${clean}" nessa pasta.`);
    fs.renameSync(from, to);
    return to;
  });
  ipcMain.handle('files:pickDir', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Onde salvar?', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('files:mkdir', (_e, p) => { const out = uniquePath(p); fs.mkdirSync(out, { recursive: true }); return out; });
  ipcMain.handle('files:trash', async (_e, paths) => {
    const done = [];
    for (const p of paths) { try { await shell.trashItem(p); done.push(p); } catch (e) { throw new Error(`Não consegui mandar "${path.basename(p)}" para a Lixeira: ${e.message}`); } }
    return done;
  });
  ipcMain.handle('files:zip', (_e, paths) => zip(paths));
  ipcMain.handle('files:unzip', (_e, p) => unzip(p));
  ipcMain.on('files:show', (_e, p) => shell.showItemInFolder(p));
  // copiar o ARQUIVO (não o texto) para colar no Explorer, WhatsApp, e-mail…
  async function copyFiles(paths) {
    if (WIN) { await run('powershell.exe', psArgs(`Set-Clipboard -LiteralPath ${paths.map(psq).join(',')}`)); return true; }
    clipboard.writeText(paths.join('\n')); return true;
  }
  ipcMain.handle('files:copyClip', (_e, paths) => copyFiles(paths));
  ipcMain.handle('files:sendTo', async (_e, paths) => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Enviar para qual pasta?', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const out = [];
    for (const p of paths) { const dest = uniquePath(path.join(r.filePaths[0], path.basename(p))); fs.cpSync(p, dest, { recursive: true }); out.push(dest); }
    return out;
  });
  ipcMain.handle('files:share', async (_e, { paths, via }) => {
    const names = paths.map(p => path.basename(p)).join(', ');
    if (via === 'email' && WIN) {
      // Outlook clássico abre um e-mail novo já com o anexo
      try {
        const reg = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\OUTLOOK.EXE', '/ve']);
        const m = reg.match(/REG_SZ\s+(.+)/); const exe = m && m[1].trim().replace(/"/g, '');
        if (exe && fs.existsSync(exe) && paths.length === 1) { spawn(exe, ['/a', paths[0]], { detached: true, stdio: 'ignore' }).unref(); return { ok: true, how: 'outlook' }; }
      } catch {}
    }
    await copyFiles(paths);
    const target = { email: `mailto:?subject=${encodeURIComponent(names)}`, whatsapp: 'whatsapp://', teams: 'msteams:' }[via];
    if (target) { try { await shell.openExternal(target); } catch {} }
    return { ok: true, how: 'clipboard' };
  });
  ipcMain.handle('files:pick', async (_e, opts = {}) => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile', 'multiSelections'], filters: opts.filters });
    return r.canceled ? [] : r.filePaths;
  });

  // ----- notas -----
  ipcMain.handle('notes:list', () => D().notes);
  ipcMain.handle('notes:save', (_e, n) => {
    const d = D(); let x = d.notes.find(y => y.id === n.id);
    if (!x) { x = { id: uid(), createdAt: Date.now(), pinned: false }; d.notes.unshift(x); }
    Object.assign(x, { text: String(n.text ?? x.text ?? ''), pinned: n.pinned ?? x.pinned, updatedAt: Date.now() });
    saveData(); return x;
  });
  ipcMain.handle('notes:delete', (_e, id) => { const d = D(); d.notes = d.notes.filter(n => n.id !== id); saveData(); return d.notes; });

  // ----- cofre -----
  const enc = (v) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString('base64') : 'plain:' + Buffer.from(v).toString('base64'));
  const dec = (v) => (v.startsWith('plain:') ? Buffer.from(v.slice(6), 'base64').toString() : safeStorage.decryptString(Buffer.from(v, 'base64')));
  const vpub = (x) => ({ id: x.id, kind: x.kind || 'chave', name: x.name, user: x.user || '', url: x.url || '', note: x.note || '', updatedAt: x.updatedAt, hint: x.hint || '' });
  ipcMain.handle('vault:list', () => D().vault.map(vpub));
  ipcMain.handle('vault:save', (_e, { id, kind, name, user, url, value, note }) => {
    const d = D(); let x = id && d.vault.find(y => y.id === id);
    if (!x) { x = { id: uid() }; d.vault.unshift(x); }
    x.kind = kind === 'conta' ? 'conta' : 'chave';
    x.name = String(name || 'Sem nome').slice(0, 80); x.note = String(note || '').slice(0, 300);
    x.user = String(user || '').slice(0, 160); x.url = String(url || '').slice(0, 300);
    if (typeof value === 'string' && value !== '') { x.value = enc(value); x.hint = x.kind === 'chave' && value.length > 8 ? `…${value.slice(-4)}` : ''; }
    x.updatedAt = Date.now(); saveData(); return vpub(x);
  });
  ipcMain.handle('vault:reveal', (_e, id) => { const x = D().vault.find(y => y.id === id); return x ? dec(x.value) : ''; });
  ipcMain.handle('vault:copy', (_e, id) => {
    const x = D().vault.find(y => y.id === id); if (!x) return false;
    const v = dec(x.value); clipIgnore && clipIgnore(v); clipboard.writeText(v);
    setTimeout(() => { try { if (clipboard.readText() === v) clipboard.clear(); } catch {} }, 30000);
    return true;
  });
  ipcMain.on('vault:openUrl', (_e, u) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); else if (u) shell.openExternal('https://' + u); });
  ipcMain.handle('vault:delete', (_e, id) => { const d = D(); d.vault = d.vault.filter(y => y.id !== id); saveData(); return d.vault.map(vpub); });

  // ----- música -----
  let smtc = null, nowPlaying = { playing: false };
  function startSmtc() {
    if (!WIN || smtc) return;
    smtc = spawn('powershell.exe', psArgs(SMTC_LOOP), { windowsHide: true });
    let buf = '';
    smtc.stdout.on('data', (d) => {
      buf += d.toString('utf8'); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        try { nowPlaying = JSON.parse(line); send('music:now', nowPlaying); } catch {}
      }
    });
    smtc.on('close', () => { smtc = null; setTimeout(startSmtc, 15000); });
  }
  if (MOCK) setTimeout(() => { nowPlaying = { title: 'Garota de Ipanema', artist: 'Tom Jobim', app: 'Spotify.exe', status: 'Playing', playing: true }; send('music:now', nowPlaying); }, 1500);
  else startSmtc();
  ipcMain.handle('music:now', () => nowPlaying);
  ipcMain.handle('music:cmd', (_e, cmd) => smtcCommand(cmd));
  ipcMain.handle('music:playlist', (_e, list) => { const d = D(); if (Array.isArray(list)) { d.playlist = list.filter(p => typeof p === 'string'); saveData(); } return d.playlist.filter(p => fs.existsSync(p)); });
  ipcMain.handle('music:pickFolder', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return [];
    const out = [], stack = [r.filePaths[0]];
    while (stack.length && out.length < 2000) {
      const dir = stack.pop();
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p); else if (/\.(mp3|m4a|aac|wav|ogg|opus|flac|webm)$/i.test(e.name)) out.push(p);
      }
    }
    return out.sort();
  });

  // ----- reunião: ao vivo, corta o áudio nas pausas da fala -----
  const LIVE_MIN = 1.8, LIVE_MAX = Number(process.env.ILHA_LIVE_MAX || 9); // segundos
  let M = null; // reunião em andamento
  const queue = []; let working = false;
  const lastText = { mic: '', sys: '' };
  const qInfo = () => {
    const lag = queue.length ? Math.max(0, Math.round((Date.now() - queue[0].tEnd) / 1000)) : 0;
    return { pending: queue.length + (working ? 1 : 0), lag, model: getVoiceModel() };
  };
  async function pump() {
    if (working) return; working = true;
    while (queue.length) {
      const job = queue.shift();
      send('meeting:queue', { ...qInfo(), lag: Math.max(0, Math.round((Date.now() - job.tEnd) / 1000)) });
      try {
        let text;
        if (MOCK) { await new Promise(r => setTimeout(r, 300)); text = job.track === 'mic' ? 'Eu fico com a planilha até sexta.' : 'Ana: precisamos fechar o planejamento até o fim do mês.'; }
        else text = await voice.serverTranscribe(voiceRoot(), getVoiceModel(), job.wav, { vocab: require('./profile').vocab(prof()), context: lastText[job.track], threads: Math.max(2, Math.min(8, (os.cpus() || []).length - 1)) });
        if (text) {
          lastText[job.track] = text;
          const seg = { track: job.track, t: job.t, text };
          const mt = D().meetings.find(x => x.id === job.meetingId);
          if (mt) { mt.segments.push(seg); mt.segments.sort((a, b) => a.t - b.t); saveData(); }
          send('meeting:segment', { meetingId: job.meetingId, seg });
        }
      } catch (e) { send('meeting:warn', { error: e.message === 'VOICE_NOT_READY' ? 'O Whisper ainda não foi baixado (Config > Voz).' : e.message }); }
    }
    working = false; send('meeting:queue', qInfo());
  }
  const newTrack = () => ({ chunks: [], len: 0, t0: Date.now(), done: 0, speechMs: 0, silMs: 0, noise: 0.002 });
  function take(t, n) {
    const pcm = new Int16Array(n); let off = 0;
    while (off < n) { const c = t.chunks[0]; const k = Math.min(c.length, n - off); pcm.set(c.subarray(0, k), off); off += k; if (k === c.length) t.chunks.shift(); else t.chunks[0] = c.subarray(k); }
    t.len -= n; t.done += n / 16000;
    return pcm;
  }
  function cut(track, t) {
    const startT = t.t0 + t.done * 1000;
    const pcm = take(t, t.len);
    t.speechMs = 0; t.silMs = 0;
    queue.push({ meetingId: M.id, track, t: startT, tEnd: startT + pcm.length / 16, wav: wavFromInt16(pcm) });
    pump();
  }
  function analyze(t, a) {
    for (let i = 0; i + 480 <= a.length; i += 480) {
      let sum = 0; for (let j = i; j < i + 480; j++) { const v = a[j] / 32768; sum += v * v; }
      const r = Math.sqrt(sum / 480), thr = Math.max(0.006, t.noise * 2.5);
      if (r > thr) { t.speechMs += 30; t.silMs = 0; } else { t.silMs += 30; t.noise = t.noise * 0.97 + r * 0.03; }
    }
  }
  function feed(track, a) {
    const t = M && M.tracks[track]; if (!t) return;
    t.chunks.push(a); t.len += a.length; analyze(t, a);
    const sec = t.len / 16000;
    if (t.speechMs < 200 && sec >= 1.5 && !MOCK) { if (t.len > 4800) take(t, t.len - 4800); t.speechMs = 0; return; } // só silêncio: descarta, guarda 0,3s
    if ((sec >= LIVE_MIN && t.silMs >= 450 && t.speechMs >= 250) || sec >= LIVE_MAX) cut(track, t);
  }
  ipcMain.handle('meeting:start', (_e, { title }) => {
    const d = D();
    const mt = { id: uid(), title: (title || '').trim() || `Reunião ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      startedAt: Date.now(), endedAt: null, segments: [], notes: '', summary: '', recorded: false };
    d.meetings.unshift(mt); d.meetings = d.meetings.slice(0, 60); saveData();
    return mt;
  });
  ipcMain.handle('meeting:rec', (_e, { id, on }) => {
    if (on) {
      if (!M) voice.hold(true);
      M = { id, tracks: { mic: newTrack(), sys: newTrack() } }; lastText.mic = ''; lastText.sys = '';
      const mt = D().meetings.find(x => x.id === id); if (mt) { mt.recorded = true; saveData(); }
      if (!MOCK) { send('meeting:queue', { ...qInfo(), loading: true }); voice.serverStart(voiceRoot(), getVoiceModel()).then(() => send('meeting:queue', qInfo())).catch(e => send('meeting:warn', { error: e.message === 'VOICE_NOT_READY' ? 'O Whisper ainda não foi baixado (Config > Voz).' : e.message })); }
    } else if (M && M.id === id) {
      for (const k of ['mic', 'sys']) { const t = M.tracks[k]; if (t.len > 8000 && (t.speechMs >= 200 || MOCK)) cut(k, t); }
      M = null; pump(); voice.hold(false);
    }
    return true;
  });
  ipcMain.on('meeting:pcm', (_e, { track, data }) => {
    if (!M || !M.tracks[track]) return;
    feed(track, new Int16Array(data));
  });
  ipcMain.handle('meeting:list', () => D().meetings.map(m => ({ id: m.id, title: m.title, startedAt: m.startedAt, endedAt: m.endedAt, n: m.segments.length, hasSummary: !!m.summary })));
  ipcMain.handle('meeting:get', (_e, id) => D().meetings.find(m => m.id === id) || null);
  ipcMain.handle('meeting:update', (_e, { id, patch }) => {
    const mt = D().meetings.find(m => m.id === id); if (!mt) return null;
    for (const k of ['title', 'notes', 'endedAt']) if (k in patch) mt[k] = patch[k];
    saveData(); return mt;
  });
  ipcMain.handle('meeting:delete', (_e, id) => { const d = D(); d.meetings = d.meetings.filter(m => m.id !== id); saveData(); return true; });
  ipcMain.handle('meeting:summary', async (_e, { id, model }) => {
    const mt = D().meetings.find(m => m.id === id); if (!mt) throw new Error('Reunião não encontrada.');
    const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const eu = prof().nome || 'Eu';
    const tr = mt.segments.map(s => `[${hhmm(s.t)}] ${s.track === 'mic' ? eu : 'Outros'}: ${s.text}`).join('\n');
    if (!tr.trim() && !mt.notes.trim()) throw new Error('Ainda não tem transcrição nem notas nesta reunião.');
    const system = `${PR.systemReuniao(prof())}\n\nHoje é ${hoje()}. Reunião: "${mt.title}", começou às ${hhmm(mt.startedAt)}.`;
    const prompt = `TRANSCRIÇÃO (automática, pode ter erros; "${eu}" é o microfone de quem gravou, "Outros" é o áudio da chamada):\n${tr || '(sem transcrição)'}\n\nNOTAS DE ${eu.toUpperCase()}:\n${mt.notes || '(sem notas)'}`;
    const text = await claudeRun({ model: model || 'sonnet', system, prompt, timeoutMs: 300000, onDelta: (t) => send('meeting:delta', { id, text: t }) });
    mt.summary = text; saveData();
    return text;
  });
  return {
    cleanup: () => { try { smtc && smtc.removeAllListeners('close'); smtc && smtc.kill(); } catch {} voice.serverStop(); },
    addNote: (text) => { const d = D(); const x = { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), pinned: false, text: String(text) }; d.notes.unshift(x); saveData(); send('notes:changed', null); return x; },
    delNote: (id) => { const d = D(); d.notes = d.notes.filter(n => n.id !== id); saveData(); send('notes:changed', null); },
  };
}

module.exports = { register };
