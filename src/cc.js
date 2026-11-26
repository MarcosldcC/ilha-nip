// Sessões do Claude Code no PC: lê ~/.claude/projects/**/*.jsonl (só leitura).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const root = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const WORKING_MS = 20000;

function readTail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start);
    let s = buf.toString('utf8'); if (start > 0) s = s.slice(s.indexOf('\n') + 1);
    return s;
  } finally { fs.closeSync(fd); }
}
function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try { const buf = Buffer.alloc(bytes); const n = fs.readSync(fd, buf, 0, bytes, 0); const s = buf.slice(0, n).toString('utf8'); return s.slice(0, s.lastIndexOf('\n') + 1); }
  finally { fs.closeSync(fd); }
}
const parse = (s) => s.split('\n').map(l => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
const clean = (t) => String(t || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, '').trim();
function textOf(content) {
  if (typeof content === 'string') return clean(content);
  if (!Array.isArray(content)) return '';
  return clean(content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
}
function isPrompt(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return false;
  const c = e.message?.content;
  if (Array.isArray(c) && c.some(x => x.type === 'tool_result')) return false;
  const t = textOf(c);
  return !!t && !t.startsWith('<') && !t.startsWith('Caveat:');
}
function toolLabel(c) {
  const i = c.input || {};
  const arg = i.description || i.file_path || i.path || i.pattern || i.command || i.url || i.query || '';
  return `${c.name}${arg ? ': ' + String(arg).split(/[\\/]/).slice(-2).join('/').slice(0, 80) : ''}`;
}

const cache = new Map(); // file -> { mtime, data }
function summarize(file) {
  const st = fs.statSync(file);
  const c = cache.get(file);
  const age = Date.now() - st.mtimeMs;
  if (c && c.mtime === st.mtimeMs) return { ...c.data, status: statusOf(c.data, age) };
  const E = parse(readTail(file, 600000));
  let title = '', lastPrompt = '', cwd = '', model = '', branch = '', lastMsg = null, lastReply = '', entry = '';
  for (const e of E) {
    if (e.type === 'ai-title' && e.aiTitle) title = e.aiTitle;
    if (e.type === 'last-prompt' && typeof e.lastPrompt === 'string' && clean(e.lastPrompt)) lastPrompt = clean(e.lastPrompt);
    if (e.type === 'custom-title' && e.customTitle) title = e.customTitle;
    if (e.type === 'summary' && e.summary && !title) title = e.summary;
    if (e.cwd) cwd = e.cwd;
    if (e.gitBranch) branch = e.gitBranch;
    if (e.entrypoint) entry = e.entrypoint;
    if (e.isSidechain) continue;
    if (isPrompt(e)) { lastPrompt = textOf(e.message.content); lastMsg = e; }
    if (e.type === 'assistant' && e.message) {
      lastMsg = e; if (e.message.model) model = e.message.model;
      const t = textOf(e.message.content); if (t) lastReply = t;
    }
    if (e.type === 'user' && !isPrompt(e) && e.message) lastMsg = e; // tool_result
  }
  if (!title) {
    const first = parse(readHead(file, 120000)).find(isPrompt);
    title = first ? textOf(first.message.content).split('\n')[0] : (lastPrompt.split('\n')[0] || 'Sessão sem título');
  }
  const last = lastMsg ? { type: lastMsg.type, stop: lastMsg.message?.stop_reason || null,
    hasText: lastMsg.type === 'assistant' && !!textOf(lastMsg.message.content),
    hasTool: lastMsg.type === 'assistant' && Array.isArray(lastMsg.message.content) && lastMsg.message.content.some(x => x.type === 'tool_use') } : null;
  const data = {
    id: path.basename(file, '.jsonl'), file, cwd, project: cwd ? path.basename(cwd) : path.basename(path.dirname(file)),
    title: title.slice(0, 90), lastPrompt: lastPrompt.slice(0, 300), lastReply: lastReply.slice(0, 300),
    model: model.replace(/^claude-/, ''), branch, entry, updatedAt: st.mtimeMs, last,
  };
  cache.set(file, { mtime: st.mtimeMs, data });
  return { ...data, status: statusOf(data, age) };
}
function statusOf(d, age) {
  const l = d.last;
  const finished = l && l.type === 'assistant' && (l.stop === 'end_turn' || (l.hasText && !l.hasTool));
  if (age < WORKING_MS && !finished) return 'working';
  if (finished) return 'waiting';
  return 'idle';
}

function list(days = 7) {
  const dir = root(), out = [];
  if (!fs.existsSync(dir)) return out;
  const since = Date.now() - days * 864e5;
  for (const p of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!p.isDirectory()) continue;
    const pd = path.join(dir, p.name);
    for (const f of fs.readdirSync(pd, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const fp = path.join(pd, f.name);
      try { if (fs.statSync(fp).mtimeMs >= since) out.push(fp); } catch {}
    }
  }
  return out.map(f => { try { return summarize(f); } catch { return null; } }).filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
}

function messages(file, n = 60) {
  const E = parse(readTail(file, 1500000));
  const out = [];
  for (const e of E) {
    if (e.isSidechain) continue;
    const at = e.timestamp ? Date.parse(e.timestamp) : 0;
    if (isPrompt(e)) out.push({ role: 'user', text: textOf(e.message.content), at });
    else if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) {
        if (c.type === 'text' && clean(c.text)) out.push({ role: 'assistant', text: clean(c.text), at });
        if (c.type === 'tool_use') {
          const prev = out[out.length - 1];
          if (prev && prev.role === 'tool') { prev.items.push(toolLabel(c)); }
          else out.push({ role: 'tool', items: [toolLabel(c)], at });
        }
      }
    }
  }
  return out.slice(-n);
}

function openInTerminal(s, claudeBin) {
  const bin = claudeBin || 'claude';
  const cwd = s.cwd && fs.existsSync(s.cwd) ? s.cwd : os.homedir();
  if (process.platform === 'win32') {
    const wt = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe');
    if (fs.existsSync(wt)) { spawn(wt, ['-d', cwd, bin, '--resume', s.id], { detached: true, stdio: 'ignore' }).unref(); return; }
    spawn('cmd.exe', ['/c', `start "Claude Code" /D "${cwd}" cmd /k ""${bin}" --resume ${s.id}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    return;
  }
  spawn('x-terminal-emulator', ['-e', `bash -lc 'cd "${cwd}" && "${bin}" --resume ${s.id}'`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

module.exports = { list, messages, openInTerminal, root, toolLabel };
