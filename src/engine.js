// Motor do Bit: JEV (TypeSafe) classifica e o Claude Code (plano do usuário) escreve.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODELS_URL = 'https://api.typesafe.ai/v1/models';

// ---------------- JEV ----------------
async function jev({ key, model, state, questions }) {
  if (!key) throw Object.assign(new Error('Falta a chave do JEV'), { code: 'NO_JEV' });
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000);
  const res = await fetch(JEV_URL, { signal: ctl.signal,
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'jev-latest', state, questions }),
  }).catch(e => { throw Object.assign(new Error('JEV fora do ar ou sem internet'), { status: 0, net: true }); }).finally(() => clearTimeout(tm));
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j?.error?.message || j?.detail || j?.message || msg; if (typeof msg !== 'string') msg = JSON.stringify(msg); } catch {}
    const credit = res.status === 402 || /credit|cr[eé]dito|saldo|balance|quota|insufficient|billing|payment/i.test(msg);
    const hint = credit ? 'sem créditos' : { 401: 'chave do JEV inválida', 403: 'acesso negado', 422: 'pedido inválido', 429: 'limite do JEV atingido', 529: 'JEV sobrecarregado' }[res.status];
    throw Object.assign(new Error(`JEV: ${hint || msg}`), { status: res.status, credit });
  }
  const j = await res.json();
  return j.answers || {};
}

async function jevPing(key) {
  const res = await fetch(JEV_MODELS_URL, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(res.status === 401 ? 'chave inválida' : `HTTP ${res.status}`);
  const j = await res.json().catch(() => ({}));
  const ids = (j.data || j.models || []).map(m => m.id || m.name || m).filter(Boolean);
  return ids;
}

// ---------------- Claude Code (plano do usuário) ----------------
function findClaude(custom) {
  if (custom && fs.existsSync(custom)) return custom;
  const exists = (p) => { try { return p && fs.statSync(p).isFile(); } catch { return false; } };
  if (process.platform === 'win32') {
    const home = os.homedir();
    const cands = [
      path.join(home, '.local', 'bin', 'claude.exe'),                         // instalador oficial (irm ... | iex)
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),               // npm install -g
    ];
    // tudo que estiver no PATH
    for (const dir of (process.env.PATH || process.env.Path || '').split(';')) {
      if (!dir) continue;
      cands.push(path.join(dir, 'claude.exe'), path.join(dir, 'claude.cmd'));
    }
    for (const c of cands) if (exists(c)) return c;
    return 'claude';
  }
  for (const c of [path.join(os.homedir(), '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude']) if (exists(c)) return c;
  return 'claude';
}

const qWin = (a) => (a === '' ? '""' : /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

/**
 * Roda `claude -p` com o login do Claude Code (limite do plano).
 * onDelta(texto) recebe o streaming; onLimit(info) recebe o status do limite.
 */
function runClaude({ bin, model, system, prompt, workDir, onDelta, onLimit, timeoutMs = 120000, tools = '', allowedTools = '', onTool, rawArgs, cwd, onProc }) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(workDir, { recursive: true });
    const sysFile = rawArgs ? null : path.join(workDir, `sys-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`);
    if (sysFile) fs.writeFileSync(sysFile, system, 'utf8');
    // rawArgs: usado para continuar uma sessão do Claude Code (--resume) na pasta do projeto
    const args = rawArgs ? ['-p', ...rawArgs, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'] : ['-p', '--model', model || 'haiku', '--tools', tools, ...(allowedTools ? ['--allowedTools', allowedTools] : []), '--strict-mcp-config', '--no-session-persistence',
      '--system-prompt-file', sysFile, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    const runDir = cwd || workDir;
    const exe = bin || 'claude';
    const useShell = process.platform === 'win32' && !/\.exe$/i.test(exe);
    let child;
    try {
      child = useShell
        ? spawn(qWin(exe), args.map(qWin), { cwd: runDir, shell: true, windowsHide: true, env: process.env })
        : spawn(exe, args, { cwd: runDir, windowsHide: true, env: process.env });
      onProc && onProc(child);
    } catch (e) { cleanup(); return reject(friendly(e)); }

    let buf = '', full = '', finalText = null, errText = '', done = false;
    const timer = setTimeout(() => { if (!done) { child.kill(); finish(new Error('O Claude demorou demais para responder.')); } }, timeoutMs);
    function cleanup() { if (sysFile) { try { fs.unlinkSync(sysFile); } catch {} } }
    function finish(err) {
      if (done) return; done = true; clearTimeout(timer); cleanup();
      if (err) reject(err); else resolve(finalText ?? full);
    }
    child.on('error', (e) => finish(friendly(e)));
    child.stderr.on('data', (d) => { errText += d.toString(); });
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
          full += ev.event.delta.text; onDelta && onDelta(ev.event.delta.text);
        } else if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
          for (const c of ev.message.content) if (c.type === 'tool_use') onTool && onTool(c.name, c.input || {});
        } else if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
          onLimit && onLimit(ev.rate_limit_info);
        } else if (ev.type === 'result') {
          if (ev.is_error) { finish(new Error(limitMsg(ev.result || ev.error || 'erro do Claude'))); return; }
          if (typeof ev.result === 'string') finalText = ev.result;
        }
      }
    });
    child.on('close', (code) => {
      if (done) return;
      if (code !== 0 && !full && finalText == null) {
        const t = errText.trim();
        if (code === 9009 || /recognized|reconhecido|ENOENT|command not found|not found/i.test(t)) return finish(new Error('NO_CLAUDE'));
        if (/log ?in|auth|credential|\/login/i.test(t)) return finish(new Error('Faça login no Claude Code: abra o terminal e rode "claude", depois /login.'));
        return finish(new Error(limitMsg(t.split('\n').slice(-3).join(' ') || `claude saiu com código ${code}`)));
      }
      finish();
    });
    child.stdin.end(prompt, 'utf8');
  });
}

function friendly(e) {
  if (e && (e.code === 'ENOENT' || /ENOENT/.test(e.message))) return new Error('NO_CLAUDE');
  return e;
}
function limitMsg(t) {
  if (/usage limit|rate limit|limit reached|limite/i.test(t)) return 'O limite do seu plano foi atingido. Ele volta sozinho, veja o horário em Config.';
  return t;
}

// ---------------- ChatGPT (Codex CLI, login do ChatGPT) ----------------
function findCodex(custom) {
  if (custom && fs.existsSync(custom)) return custom;
  const exists = (p) => { try { return p && fs.statSync(p).isFile(); } catch { return false; } };
  if (process.platform === 'win32') {
    const cands = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'), // instalador oficial (irm ... | iex)
      path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),                                     // npm install -g @openai/codex
    ];
    for (const dir of (process.env.PATH || process.env.Path || '').split(';')) {
      if (!dir) continue;
      cands.push(path.join(dir, 'codex.exe'), path.join(dir, 'codex.cmd'));
    }
    for (const c of cands) if (exists(c)) return c;
    return 'codex';
  }
  for (const c of [path.join(os.homedir(), '.local', 'bin', 'codex'), '/usr/local/bin/codex', '/opt/homebrew/bin/codex']) if (exists(c)) return c;
  return 'codex';
}

// nível do Bit (haiku/sonnet/opus = rápido/equilibrado/forte) → esforço de raciocínio do ChatGPT
const CODEX_EFFORT = { haiku: 'low', sonnet: 'medium', opus: 'high' };
const tomlStr = (s) => `"${String(s).replace(/\\/g, '/').replace(/"/g, '')}"`;

function spawnBin(exe, args, opts) {
  const useShell = process.platform === 'win32' && !/\.exe$/i.test(exe);
  return useShell
    ? spawn(qWin(exe), args.map(qWin), { ...opts, shell: true, windowsHide: true, env: process.env })
    : spawn(exe, args, { ...opts, windowsHide: true, env: process.env });
}

/**
 * Roda `codex exec` com o login do ChatGPT (limite do plano).
 * Mesma interface do runClaude: model = nível do Bit; models = { haiku: 'nome', ... } (vazio = padrão da conta).
 * O Codex não manda o texto aos pedaços: cada mensagem chega inteira em onDelta.
 */
function runCodex({ bin, model, models, system, prompt, workDir, onDelta, timeoutMs = 120000, tools = '', onTool, onProc }) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(workDir, { recursive: true });
    const sysFile = path.join(workDir, `sys-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`);
    fs.writeFileSync(sysFile, system || '', 'utf8');
    const tier = CODEX_EFFORT[model] ? model : 'haiku';
    const name = String((models && models[tier]) || '').trim();
    const web = /WebSearch|WebFetch/.test(tools);
    const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--sandbox', 'read-only', '-c', 'approval_policy="never"',
      '-c', `model_instructions_file=${tomlStr(sysFile)}`,
      '-c', `model_reasoning_effort="${CODEX_EFFORT[tier]}"`,
      '-c', `web_search="${web ? 'live' : 'disabled'}"`,
      ...(name ? ['-m', name] : []), '-'];
    let child;
    try { child = spawnBin(bin || 'codex', args, { cwd: workDir }); onProc && onProc(child); }
    catch (e) { cleanup(); return reject(friendlyCodex(e)); }

    let buf = '', last = '', errText = '', failMsg = '', done = false;
    const sent = {}; // quanto de cada mensagem já foi mostrado
    const timer = setTimeout(() => { if (!done) { child.kill(); finish(new Error('O ChatGPT demorou demais para responder.')); } }, timeoutMs);
    function cleanup() { try { fs.unlinkSync(sysFile); } catch {} }
    function finish(err) {
      if (done) return; done = true; clearTimeout(timer); cleanup();
      if (err) reject(err); else resolve(last);
    }
    function showMsg(it) {
      const t = it.text || ''; const had = sent[it.id];
      if (had == null && last) onDelta && onDelta('\n\n');
      const from = had || 0;
      if (t.length > from) { onDelta && onDelta(t.slice(from)); sent[it.id] = t.length; }
      last = t;
    }
    child.on('error', (e) => finish(friendlyCodex(e)));
    child.stderr.on('data', (d) => { errText += d.toString(); });
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const it = ev.item;
        if ((ev.type === 'item.updated' || ev.type === 'item.completed') && it && it.type === 'agent_message') showMsg(it);
        else if (ev.type === 'item.started' && it && it.type === 'web_search') onTool && onTool('WebSearch', {});
        else if (ev.type === 'turn.failed') failMsg = (ev.error && ev.error.message) || 'erro do ChatGPT';
        else if (ev.type === 'error' && ev.message) failMsg = ev.message;
      }
    });
    child.on('close', (code) => {
      if (done) return;
      if (failMsg && !last) return finish(new Error(codexMsg(failMsg)));
      if (code !== 0 && !last) {
        const t = errText.trim();
        if (code === 9009 || /recognized|reconhecido|ENOENT|command not found|not found/i.test(t) && !/model/i.test(t)) return finish(new Error('NO_CODEX'));
        return finish(new Error(codexMsg(t.split('\n').slice(-3).join(' ') || `codex saiu com código ${code}`)));
      }
      finish();
    });
    child.stdin.end(prompt, 'utf8');
  });
}

function friendlyCodex(e) {
  if (e && (e.code === 'ENOENT' || /ENOENT/.test(e.message))) return new Error('NO_CODEX');
  return e;
}
function codexMsg(t) {
  if (/usage limit|rate limit|limit reached|hit your|limite/i.test(t)) return 'O limite do seu plano do ChatGPT foi atingido. Ele volta sozinho; tente mais tarde.';
  if (/not logged|log ?in|unauthorized|401|auth/i.test(t)) return 'Faça login no ChatGPT: abra o PowerShell, rode "codex login" e entre com a sua conta.';
  if (/model/i.test(t) && /not (found|supported|available)|does not exist|unknown/i.test(t)) return 'Esse modelo do ChatGPT não está disponível na sua conta. Em Config > Inteligência, deixe o nome do modelo em branco para usar o padrão.';
  return t;
}

/** Login do ChatGPT no Codex: 'ok' | 'login'. Usa `codex login status` (sai com 0 quando está logado). */
function codexLoggedIn(bin) {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  if (fs.existsSync(path.join(home, 'auth.json'))) return Promise.resolve(true);
  return new Promise((resolve) => {
    let child; try { child = spawnBin(bin, ['login', 'status'], {}); } catch { return resolve(false); }
    const t = setTimeout(() => { try { child.kill(); } catch {} resolve(false); }, 8000);
    child.on('error', () => { clearTimeout(t); resolve(false); });
    child.on('close', (code) => { clearTimeout(t); resolve(code === 0); });
  });
}

// perguntas do JEV: montadas a partir do perfil em profile.js

module.exports = { jev, jevPing, runClaude, findClaude, runCodex, findCodex, codexLoggedIn };
