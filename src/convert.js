// Conversões que precisam de programas de fora (todos grátis):
// FFmpeg (vídeo, áudio, GIF, HEIC), Microsoft Office via COM ou LibreOffice (documentos),
// e o próprio Chromium do Electron (texto/HTML/Markdown → PDF).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { download, unzip } = require('./voice');

const WIN = process.platform === 'win32';
const FF_URLS = [
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip',
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
];

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 2; i < 1000; i++) { const c = path.join(dir, `${base} (${i})${ext}`); if (!fs.existsSync(c)) return c; }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
  Buffer.from('$ErrorActionPreference = "Stop"\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n' + script, 'utf16le').toString('base64')];
function run(cmd, args, { timeoutMs = 10 * 60 * 1000, onStdout, cwd, onProc } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, cwd });
    onProc && onProc(p);
    let out = '', err = '';
    const t = setTimeout(() => { try { p.kill(); } catch {} reject(new Error('Demorou demais e foi cancelado.')); }, timeoutMs);
    p.stdout.on('data', d => { out += d; onStdout && onStdout(d.toString()); });
    p.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve(out) : reject(Object.assign(new Error((err || out).toString().split('\n').filter(Boolean).slice(-3).join(' ') || `código ${c}`), { code: c })); });
  });
}

// ---------------- FFmpeg ----------------
function findIn(dir, re) {
  if (!fs.existsSync(dir)) return null;
  const st = [dir];
  while (st.length) { const d = st.pop(); for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) st.push(p); else if (re.test(e.name)) return p; } }
  return null;
}
function ffmpegPath(root) {
  const p = findIn(path.join(root, 'ffmpeg'), WIN ? /^ffmpeg\.exe$/i : /^ffmpeg$/);
  if (p) return p;
  if (!WIN) { try { return execFileSync('which', ['ffmpeg']).toString().trim() || null; } catch { return null; } }
  return null;
}
let ffInstalling = null;
function ffInstall(root, onProgress) {
  if (ffInstalling) return ffInstalling;
  ffInstalling = (async () => {
    if (ffmpegPath(root)) return ffmpegPath(root);
    const dir = path.join(root, 'ffmpeg'), zip = path.join(root, 'tmp', 'ffmpeg.zip');
    let lastErr;
    for (const url of FF_URLS) {
      try {
        await download(url, zip, (g, t) => onProgress && onProgress({ got: g, total: t }));
        fs.rmSync(dir, { recursive: true, force: true });
        await unzip(zip, dir);
        fs.rmSync(zip, { force: true });
        const p = ffmpegPath(root); if (p) return p;
        throw new Error('o pacote veio sem o ffmpeg.exe');
      } catch (e) { lastErr = e; }
    }
    throw new Error('Não consegui baixar o conversor de vídeo: ' + (lastErr && lastErr.message));
  })();
  return ffInstalling.finally(() => { ffInstalling = null; });
}

const VPRESET = { leve: { crf: 24, max: 1920, a: '160k', gif: 640 }, medio: { crf: 28, max: 1280, a: '128k', gif: 480 }, forte: { crf: 32, max: 854, a: '96k', gif: 360 } };
const APRESET = { leve: { mp3: '160k', aac: '160k', opus: '96k' }, medio: { mp3: '128k', aac: '128k', opus: '64k' }, forte: { mp3: '96k', aac: '96k', opus: '48k' } };
const scaleTo = (max) => `scale=w='min(iw,${max})':h='min(ih,${max})':force_original_aspect_ratio=decrease:force_divisible_by=2`;

/** Monta os argumentos do FFmpeg: op = mp4|webm|mov|gif|mp3|wav|m4a|ogg|jpg|png ; shrink = leve|medio|forte|null */
function ffArgs(op, shrink) {
  const V = shrink ? VPRESET[shrink] : null, A = shrink ? APRESET[shrink] : null;
  const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(V ? V.crf : 23), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', V ? V.a : '160k', ...(V ? ['-vf', scaleTo(V.max)] : [])];
  switch (op) {
    case 'mp4': return [...h264, '-movflags', '+faststart'];
    case 'mov': return h264;
    case 'webm': return ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', String(V ? V.crf + 8 : 32), '-b:v', '0', '-c:a', 'libopus', '-b:a', V ? '64k' : '96k', ...(V ? ['-vf', scaleTo(V.max)] : [])];
    case 'gif': { const w = V ? V.gif : 480; return ['-vf', `fps=12,scale=${w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`, '-loop', '0']; }
    case 'mp3': return ['-vn', '-c:a', 'libmp3lame', '-b:a', A ? A.mp3 : '192k'];
    case 'm4a': return ['-vn', '-c:a', 'aac', '-b:a', A ? A.aac : '192k'];
    case 'ogg': return ['-vn', '-c:a', 'libopus', '-b:a', A ? A.opus : '128k'];
    case 'wav': return ['-vn', '-c:a', 'pcm_s16le'];
    case 'jpg': return ['-frames:v', '1', '-q:v', '2'];
    case 'png': return ['-frames:v', '1'];
    default: throw new Error('Conversão desconhecida: ' + op);
  }
}
async function ffConvert(root, { input, outDir, name, op, shrink, onProgress, onProc }) {
  const ff = ffmpegPath(root);
  if (!ff) throw Object.assign(new Error('FFMPEG_MISSING'), { code: 'FFMPEG_MISSING' });
  const out = uniquePath(path.join(outDir, `${name}.${op}`));
  // duração para o progresso
  let dur = 0;
  try { dur = spawnSyncDuration(ff, input); } catch {}
  const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', input, ...ffArgs(op, shrink), out];
  await run(ff, args, {
    timeoutMs: 3 * 60 * 60 * 1000, onProc,
    onStdout: (t) => { const m = /out_time_(?:ms|us)=(\d+)/.exec(t); if (m && dur && onProgress) onProgress(Math.min(1, (+m[1]) / 1e6 / dur)); },
  });
  return { path: out, size: fs.statSync(out).size };
}
function spawnSyncDuration(ff, input) {
  const r = require('child_process').spawnSync(ff, ['-hide_banner', '-i', input], { windowsHide: true });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(r.stderr || ''));
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

// HEIC (foto de iPhone): primeiro o decodificador do Windows (WIC), depois FFmpeg
async function heic(root, { input, outDir, name, to }) {
  const out = uniquePath(path.join(outDir, `${name}.${to}`));
  if (WIN) {
    try {
      const enc = to === 'png' ? 'PngBitmapEncoder' : 'JpegBitmapEncoder';
      await run('powershell.exe', psArgs(`Add-Type -AssemblyName PresentationCore
$s = [IO.File]::OpenRead(${psq(input)})
try {
  $d = [Windows.Media.Imaging.BitmapDecoder]::Create($s, [Windows.Media.Imaging.BitmapCreateOptions]::None, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
  $e = New-Object Windows.Media.Imaging.${enc}
  ${to === 'png' ? '' : '$e.QualityLevel = 92'}
  $e.Frames.Add($d.Frames[0])
  $o = [IO.File]::Create(${psq(out)}); $e.Save($o); $o.Close()
} finally { $s.Close() }`), { timeoutMs: 60000 });
      if (fs.existsSync(out) && fs.statSync(out).size > 0) return { path: out, size: fs.statSync(out).size };
    } catch {}
  }
  const r = await ffConvert(root, { input, outDir, name, op: to });
  return r;
}

// ---------------- Office / LibreOffice ----------------
function regHas(key) { if (!WIN) return false; try { execFileSync('reg', ['query', key], { windowsHide: true, stdio: 'ignore' }); return true; } catch { return false; } }
function libreOffice() {
  const c = WIN ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')]
    : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/opt/libreoffice/program/soffice'];
  return c.find(p => fs.existsSync(p)) || null;
}
let officeCache = null;
function officeStatus() {
  if (!officeCache) officeCache = { word: regHas('HKCR\\Word.Application'), excel: regHas('HKCR\\Excel.Application'), powerpoint: regHas('HKCR\\PowerPoint.Application'), libre: libreOffice() };
  return officeCache;
}
const WORD = ['doc', 'docx', 'rtf', 'odt', 'txt', 'wpd'], EXCEL = ['xls', 'xlsx', 'xlsm', 'ods', 'csv'], PPT = ['ppt', 'pptx', 'pps', 'ppsx', 'odp'];
async function office({ input, outDir, name, to }) {
  const ext = path.extname(input).slice(1).toLowerCase();
  const out = uniquePath(path.join(outDir, `${name}.${to}`));
  const st = officeStatus();
  const app = ext === 'pdf' || WORD.includes(ext) ? 'word' : EXCEL.includes(ext) ? 'excel' : PPT.includes(ext) ? 'powerpoint' : null;
  if (!app) throw new Error('Esse tipo de documento não é suportado.');
  if (st[app]) {
    const scripts = {
      word: `$w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0
try { $d = $w.Documents.Open(${psq(input)}, $false, $true, $false); $d.SaveAs2(${psq(out)}, ${to === 'pdf' ? 17 : 16}); $d.Close(0) } finally { $w.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($w) }`,
      excel: `$x = New-Object -ComObject Excel.Application; $x.Visible = $false; $x.DisplayAlerts = $false
try { $b = $x.Workbooks.Open(${psq(input)}, 0, $true); $b.ExportAsFixedFormat(0, ${psq(out)}); $b.Close($false) } finally { $x.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($x) }`,
      powerpoint: `$p = New-Object -ComObject PowerPoint.Application
try { $r = $p.Presentations.Open(${psq(input)}, -1, 0, 0); $r.SaveAs(${psq(out)}, 32); $r.Close() } finally { $p.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($p) }`,
    };
    await run('powershell.exe', psArgs(scripts[app]), { timeoutMs: 5 * 60 * 1000 });
  } else if (st.libre) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ilha-lo-'));
    const args = ['--headless', '--norestore', ...(ext === 'pdf' ? ['--infilter=writer_pdf_import'] : []), '--convert-to', to, '--outdir', tmp, input];
    await run(st.libre, args, { timeoutMs: 5 * 60 * 1000 });
    const made = fs.readdirSync(tmp).find(f => f.toLowerCase().endsWith('.' + to));
    if (!made) throw new Error('O LibreOffice não gerou o arquivo.');
    fs.copyFileSync(path.join(tmp, made), out); fs.rmSync(tmp, { recursive: true, force: true });
  } else {
    throw Object.assign(new Error('OFFICE_MISSING'), { code: 'OFFICE_MISSING' });
  }
  if (!fs.existsSync(out)) throw new Error('A conversão não gerou o arquivo.');
  return { path: out, size: fs.statSync(out).size };
}

// ---------------- texto / HTML / Markdown → PDF (Chromium do Electron) ----------------
async function htmlToPdf(BrowserWindow, { html, file, outDir, name }) {
  const out = uniquePath(path.join(outDir, `${name}.pdf`));
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    if (file) await w.loadFile(file); else await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    fs.writeFileSync(out, pdf);
  } finally { w.destroy(); }
  return { path: out, size: fs.statSync(out).size };
}

module.exports = { ffmpegPath, ffInstall, ffConvert, heic, office, officeStatus, htmlToPdf, uniquePath };
