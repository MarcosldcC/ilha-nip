// Bit — Agenda (ICS do Outlook/Google), Lembretes, Histórico do copiar e Atalho de texto selecionado.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------- agenda ----------------
let ICAL = null;
const ical = () => (ICAL ||= require('./vendor/ical'));
const LINK_RE = [
  /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>)\]]+/i,
  /https:\/\/teams\.live\.com\/meet\/[^\s"<>)\]]+/i,
  /https:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}/i,
  /https:\/\/[\w.-]*zoom\.us\/j\/[^\s"<>)\]]+/i,
  /https:\/\/[\w.-]*webex\.com\/[^\s"<>)\]]+/i,
];
function findLink(...txt) {
  const all = txt.filter(Boolean).join('\n');
  for (const re of LINK_RE) { const m = all.match(re); if (m) return m[0].replace(/[.,;]+$/, ''); }
  return '';
}
const linkKind = (u) => (/teams\./i.test(u) ? 'Teams' : /meet\.google/i.test(u) ? 'Meet' : /zoom\.us/i.test(u) ? 'Zoom' : /webex/i.test(u) ? 'Webex' : '');

function parseIcs(text, calId, from, to) {
  const I = ical();
  const comp = new I.Component(I.parse(text));
  for (const tz of comp.getAllSubcomponents('vtimezone')) { try { I.TimezoneService.register(tz); } catch {} }
  const masters = new Map(), excs = [];
  for (const v of comp.getAllSubcomponents('vevent')) {
    const e = new I.Event(v);
    if (e.isRecurrenceException()) excs.push(e);
    else { const arr = masters.get(e.uid) || []; arr.push(e); masters.set(e.uid, arr); }
  }
  for (const x of excs) { const m = (masters.get(x.uid) || [])[0]; if (m) { try { m.relateException(x); } catch {} } else masters.set(x.uid + '#' + x.recurrenceId, [x]); }
  const out = [];
  const push = (ev, start, end, item) => {
    const s = start.toJSDate().getTime(), en = end ? end.toJSDate().getTime() : s + 30 * 60000;
    if (en < from || s > to) return;
    const c = item.component;
    if (String(c.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const title = String(item.summary || '(sem título)').trim();
    if (/^(cancelad[oa]|canceled|cancelled)\s*:/i.test(title)) return;
    const desc = String(item.description || '');
    const linkOf = (cc, it) => findLink(cc.getFirstPropertyValue('x-microsoft-skypeteamsmeetingurl'), cc.getFirstPropertyValue('x-google-conference'), it.location, it.description, cc.getFirstPropertyValue('url'));
    const link = linkOf(c, item) || (ev !== item ? linkOf(ev.component, ev) : '');
    const org = c.getFirstPropertyValue('organizer');
    out.push({
      id: `${calId}:${item.uid}:${s}`, cal: calId, title, start: s, end: en, allDay: start.isDate,
      location: String(item.location || '').replace(/Reuni[aã]o do Microsoft Teams|Microsoft Teams Meeting/gi, 'Teams').trim().slice(0, 140),
      link, via: linkKind(link), org: org ? String(org).replace(/^mailto:/i, '') : '',
      desc: desc.replace(/_{5,}[\s\S]*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 400),
    });
  };
  for (const arr of masters.values()) for (const e of arr) {
    try {
      if (e.isRecurring()) {
        const it = e.iterator(); let t, n = 0;
        while ((t = it.next()) && n++ < 3000) {
          if (t.toJSDate().getTime() > to) break;
          const d = e.getOccurrenceDetails(t);
          push(e, d.startDate, d.endDate, d.item);
        }
      } else push(e, e.startDate, e.endDate, e);
    } catch {}
  }
  return out;
}

// ---------------- lembretes: o texto já chega com a hora (o renderer interpreta) ----------------

// ---------------- teclas no Windows (copiar seleção / colar de volta) ----------------
const KEYS_PS = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Threading;
public static class IlhaKeys {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  static bool Down(int k) { return (GetAsyncKeyState(k) & 0x8000) != 0; }
  public static void WaitMods() { for (int i = 0; i < 60; i++) { if (!Down(0x11) && !Down(0x12) && !Down(0x10) && !Down(0x5B) && !Down(0x5C)) return; Thread.Sleep(25); } }
  public static void Combo(byte k) { keybd_event(0x11,0,0,UIntPtr.Zero); keybd_event(k,0,0,UIntPtr.Zero); Thread.Sleep(15); keybd_event(k,0,2,UIntPtr.Zero); keybd_event(0x11,0,2,UIntPtr.Zero); }
  public static void Focus(long h) { IntPtr p = new IntPtr(h); keybd_event(0x12,0,0,UIntPtr.Zero); keybd_event(0x12,0,2,UIntPtr.Zero); if (IsIconic(p)) ShowWindow(p, 9); SetForegroundWindow(p); }
}
"@
while ($true) {
  $l = [Console]::In.ReadLine(); if ($l -eq $null) { break }
  $a = $l.Split(' ')
  try {
    if ($a[0] -eq 'F') { [Console]::Out.WriteLine("R " + [IlhaKeys]::GetForegroundWindow().ToInt64()) }
    elseif ($a[0] -eq 'C') { [IlhaKeys]::WaitMods(); $h = [IlhaKeys]::GetForegroundWindow().ToInt64(); [IlhaKeys]::Combo(0x43); [Console]::Out.WriteLine("R " + $h) }
    elseif ($a[0] -eq 'P') { [IlhaKeys]::Focus([long]$a[1]); Start-Sleep -Milliseconds 200; [IlhaKeys]::WaitMods(); [IlhaKeys]::Combo(0x56); [Console]::Out.WriteLine("R ok") }
    else { [Console]::Out.WriteLine("R ?") }
  } catch { [Console]::Out.WriteLine("R err") }
  [Console]::Out.Flush()
}`;
const keys = { proc: null, q: [], buf: '' };
function keysStart() {
  if (!WIN || keys.proc) return;
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(KEYS_PS, 'utf16le').toString('base64')], { windowsHide: true });
  keys.proc = p;
  p.stdout.on('data', (d) => {
    keys.buf += d.toString(); let i;
    while ((i = keys.buf.indexOf('\n')) >= 0) {
      const line = keys.buf.slice(0, i).trim(); keys.buf = keys.buf.slice(i + 1);
      if (line.startsWith('R ')) { const r = keys.q.shift(); r && r(line.slice(2)); }
    }
  });
  p.on('close', () => { keys.proc = null; keys.q.splice(0).forEach(r => r('')); });
  p.on('error', () => { keys.proc = null; });
}
function keysCmd(cmd, timeout = 4000) {
  if (!WIN) return Promise.resolve('');
  keysStart();
  if (!keys.proc) return Promise.resolve('');
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    keys.q.push(fin);
    keys.proc.stdin.write(cmd + '\n');
    setTimeout(() => { if (!done) { const i = keys.q.indexOf(fin); if (i >= 0) keys.q.splice(i, 1); fin(''); } }, timeout);
  });
}

// ---------------- registro ----------------
function register(ctx) {
  const { ipcMain, clipboard, shell, net, Notification, globalShortcut, safeStorage, getWin, getData, saveData, setMode, getMode, dataDir, claudeRun, MOCK, PR, prof, uid, warmVoice } = ctx;
  const D = () => getData();
  const send = (ch, p) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, p); };
  const notify = (title, body, onClick) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    if (onClick) n.on('click', onClick);
    n.show();
  };
  const enc = (s) => (safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(s).toString('base64') : 'p:' + s);
  const dec = (s) => { try { return s.startsWith('e:') ? safeStorage.decryptString(Buffer.from(s.slice(2), 'base64')) : s.replace(/^p:/, ''); } catch { return ''; } };

  // ===== agenda =====
  D().calendars ||= [];
  D().agenda ||= { events: [], at: 0, errors: {} };
  D().reminders ||= [];
  const COLORS = ['#5b8cff', '#34c38f', '#f5a524', '#e25c8e', '#9b7bff'];
  const calPub = () => D().calendars.map(c => ({ id: c.id, name: c.name, color: c.color, on: c.on !== false, kind: c.kind, err: D().agenda.errors[c.id] || '' }));
  async function fetchIcs(url) {
    url = url.trim().replace(/^webcal:\/\//i, 'https://');
    if (/^file:\/\//i.test(url)) return fs.readFileSync(require('url').fileURLToPath(url), 'utf8');
    if (!/^https:\/\//i.test(url)) throw new Error('O link precisa começar com https://');
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Bit/1.0', Accept: 'text/calendar,*/*' } });
    if (!r.ok) throw new Error(r.status === 404 ? 'Link não encontrado (404). Ele pode ter sido desativado.' : r.status === 401 || r.status === 403 ? 'Sem permissão para esse link. A empresa pode ter bloqueado a publicação da agenda.' : `Erro HTTP ${r.status}`);
    const t = await r.text();
    if (!/BEGIN:VCALENDAR/i.test(t)) throw new Error('Esse link não é de calendário (.ics). Copie o link "ICS" ou "endereço secreto em formato iCal".');
    return t;
  }
  let refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const now = Date.now(), d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const from = d0.getTime() - 86400000, to = d0.getTime() + 22 * 86400000;
      const events = [], errors = {};
      for (const c of D().calendars) {
        if (c.on === false) continue;
        try { events.push(...parseIcs(await fetchIcs(dec(c.url)), c.id, from, to)); }
        catch (e) { errors[c.id] = e.message; events.push(...D().agenda.events.filter(x => x.cal === c.id)); }
      }
      events.sort((a, b) => a.start - b.start || a.end - b.end);
      // tira duplicados (mesma reunião em dois calendários)
      const seen = new Set();
      D().agenda = { events: events.filter(e => { const k = `${e.title}|${e.start}`; if (seen.has(k)) return false; seen.add(k); return true; }), at: now, errors };
      saveData(); send('agenda:changed', agendaPub());
      return agendaPub();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  const agendaPub = () => ({ events: D().agenda.events, at: D().agenda.at, calendars: calPub(), alertMin: D().settings.agendaAlert ?? 5 });
  ipcMain.handle('agenda:get', () => agendaPub());
  ipcMain.handle('agenda:refresh', () => refresh());
  ipcMain.handle('agenda:addCal', async (_e, { name, url }) => {
    url = String(url || '').trim();
    if (!url) throw new Error('Cole o link do calendário.');
    const text = await fetchIcs(url); // valida antes de salvar
    const n = (text.match(/BEGIN:VEVENT/g) || []).length;
    const kind = /google\.com/i.test(url) ? 'google' : /outlook|office|live\.com/i.test(url) ? 'outlook' : 'ics';
    const c = { id: uid(), name: String(name || '').trim() || (kind === 'google' ? 'Google' : kind === 'outlook' ? 'Outlook' : 'Agenda'), url: enc(url), kind, color: COLORS[D().calendars.length % COLORS.length], on: true };
    D().calendars.push(c); saveData();
    await refresh();
    return { calendars: calPub(), events: n };
  });
  ipcMain.handle('agenda:updCal', (_e, { id, patch }) => { const c = D().calendars.find(x => x.id === id); if (c) Object.assign(c, { name: patch.name ?? c.name, on: patch.on ?? c.on, color: patch.color ?? c.color }); saveData(); return refresh(); });
  ipcMain.handle('agenda:delCal', (_e, id) => { D().calendars = D().calendars.filter(x => x.id !== id); D().agenda.events = D().agenda.events.filter(e => e.cal !== id); saveData(); return refresh(); });
  ipcMain.handle('agenda:alert', (_e, m) => { D().settings.agendaAlert = Number(m) || 0; saveData(); return agendaPub(); });
  ipcMain.on('agenda:join', (_e, url) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); });

  const alerted = new Set(), warmed = new Set();
  function tickAgenda() {
    const min = D().settings.agendaAlert ?? 5;
    const now = Date.now();
    // deixa a voz carregada uns minutos antes de reunião com link (para gravar sem esperar)
    for (const e of D().agenda.events) {
      if (e.allDay || !e.link || warmed.has(e.id)) continue;
      const dt = e.start - now;
      if (dt > -5 * 60000 && dt <= 4 * 60000) { warmed.add(e.id); warmVoice && warmVoice(); }
    }
    if (!min) return;
    for (const e of D().agenda.events) {
      if (e.allDay || alerted.has(e.id)) continue;
      const dt = e.start - now;
      if (dt > 0 && dt <= min * 60000 + 15000) {
        alerted.add(e.id);
        const m = Math.max(1, Math.round(dt / 60000));
        notify(`Em ${m} min: ${e.title}`, e.link ? `Clique para entrar no ${e.via || 'link'}` : (e.location || 'Abra a Ilha para ver'), () => { if (e.link) shell.openExternal(e.link); else setMode('expanded', 't:agenda'); });
        send('agenda:soon', e);
      }
    }
  }

  // ===== lembretes (com repetição) =====
  // repeat: { k: 'dia' | 'util' | 'semana' | 'mes' | 'cada', days?: [0..6], every?: minutos }
  const okDay = (t, rep) => { const g = new Date(t).getDay(); if (rep.k === 'util') return g >= 1 && g <= 5; if (rep.k === 'semana' && rep.days && rep.days.length) return rep.days.includes(g); return true; };
  function step(t, rep, firstDate) {
    const d = new Date(t);
    if (rep.k === 'cada') return t + Math.max(5, rep.every || 60) * 60000;
    if (rep.k === 'mes') { const want = firstDate || d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(want, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return d.getTime(); }
    if (rep.k === 'semana' && !(rep.days && rep.days.length)) { d.setDate(d.getDate() + 7); return d.getTime(); }
    d.setDate(d.getDate() + 1); return d.getTime();
  }
  function nextOcc(t, rep, after = Date.now(), firstDate) {
    let n = 0;
    while ((t <= after || !okDay(t, rep)) && n++ < 2000) t = step(t, rep, firstDate);
    return t;
  }
  const cleanRep = (rep) => {
    if (!rep || !['dia', 'util', 'semana', 'mes', 'cada'].includes(rep.k)) return null;
    const out = { k: rep.k };
    if (rep.k === 'semana' && Array.isArray(rep.days)) out.days = [...new Set(rep.days.map(Number).filter(x => x >= 0 && x <= 6))].sort();
    if (rep.k === 'cada') out.every = Math.max(5, Math.min(1440, Number(rep.every) || 60));
    if (rep.k === 'mes') out.date = rep.date;
    return out;
  };
  function makeRem(text, at, repeat) {
    const rep = cleanRep(repeat);
    let t = Number(at);
    if (rep) { if (rep.k === 'mes') rep.date = new Date(t).getDate(); if (t <= Date.now() - 60000 || !okDay(t, rep)) t = nextOcc(t, rep, Date.now(), rep.date); }
    const r = { id: uid(), text: String(text).slice(0, 300), at: t, fired: false, done: false, createdAt: Date.now() };
    if (rep) r.repeat = rep;
    D().reminders.push(r); return r;
  }
  const remPub = () => D().reminders;
  const remSave = () => { saveData(); send('rem:changed', remPub()); return remPub(); };
  ipcMain.handle('rem:list', () => remPub());
  ipcMain.handle('rem:add', (_e, { text, at, repeat }) => {
    if (!text || !at) throw new Error('Falta o texto ou a hora.');
    makeRem(text, at, repeat);
    return remSave();
  });
  ipcMain.handle('rem:repeat', (_e, { id, repeat }) => {
    const r = D().reminders.find(x => x.id === id); if (!r) return remSave();
    const rep = cleanRep(repeat);
    if (rep) { if (rep.k === 'mes') rep.date = new Date(r.at).getDate(); r.repeat = rep; if (r.fired || r.at <= Date.now() || !okDay(r.at, rep)) { r.at = nextOcc(r.at, rep, Date.now(), rep.date); r.fired = false; } r.done = false; }
    else delete r.repeat;
    return remSave();
  });
  ipcMain.handle('rem:snooze', (_e, { id, min }) => { const r = D().reminders.find(x => x.id === id); if (r) Object.assign(r, { at: Date.now() + (min || 10) * 60000, fired: false }); return remSave(); });
  ipcMain.handle('rem:done', (_e, { id, done }) => { const r = D().reminders.find(x => x.id === id); if (r) Object.assign(r, { done: done !== false, doneAt: Date.now() }); return remSave(); });
  ipcMain.handle('rem:del', (_e, id) => { D().reminders = D().reminders.filter(x => x.id !== id); return remSave(); });
  ipcMain.handle('rem:clearDone', () => { D().reminders = D().reminders.filter(x => !x.done); return remSave(); });
  function tickRem() {
    const now = Date.now(); let ch = false;
    for (const r of [...D().reminders]) {
      if (r.done || r.fired || r.at > now) continue;
      ch = true;
      const late = now - r.at > 5 * 60000 ? ' (atrasado)' : '';
      notify(`⏰ Lembrete${late}`, r.text, () => setMode('expanded', 't:agenda'));
      if (r.repeat) {
        // a série continua: vira um aviso desta vez (com Feito/Adiar) e a série pula para a próxima
        D().reminders = D().reminders.filter(x => !(x.from === r.id && !x.done)); // só um aviso pendente por série
        D().reminders.push({ id: uid(), text: r.text, at: r.at, fired: true, done: false, createdAt: now, from: r.id });
        r.at = nextOcc(r.at, r.repeat, now, r.repeat.date);
      } else r.fired = true;
    }
    // limpa feitos com mais de 7 dias
    const n0 = D().reminders.length;
    D().reminders = D().reminders.filter(r => !(r.done && now - (r.doneAt || 0) > 7 * 86400000));
    if (ch || n0 !== D().reminders.length) remSave();
  }

  // ===== histórico do copiar =====
  const clipFile = () => path.join(dataDir(), 'ilha-clips.bin');
  let CLIPS = [];
  try { CLIPS = JSON.parse(dec(fs.readFileSync(clipFile(), 'utf8'))) || []; } catch { CLIPS = []; }
  let clipSaveT = null;
  const clipSave = () => { clearTimeout(clipSaveT); clipSaveT = setTimeout(() => { try { fs.writeFileSync(clipFile(), enc(JSON.stringify(CLIPS))); } catch {} }, 1500); };
  const ignore = new Set();
  let lastClip = (() => { try { return clipboard.readText(); } catch { return ''; } })();
  let clipPause = false;
  const clipOn = () => D().settings.clipHistory !== false;
  function concealed() {
    try { return clipboard.has('ExcludeClipboardContentFromMonitorProcessing'); } catch { return false; }
  }
  function tickClip() {
    if (clipPause) return;
    let t; try { t = clipboard.readText(); } catch { return; }
    if (t === lastClip) return;
    lastClip = t;
    if (!clipOn() || !t || !t.trim() || t.length > 50000 || ignore.has(t) || concealed()) return;
    const i = CLIPS.findIndex(c => c.text === t);
    let item;
    if (i >= 0) { item = CLIPS.splice(i, 1)[0]; item.at = Date.now(); } else item = { id: uid(), text: t, at: Date.now(), pinned: false };
    CLIPS.unshift(item);
    const pinned = CLIPS.filter(c => c.pinned), rest = CLIPS.filter(c => !c.pinned).slice(0, 200);
    CLIPS = [...pinned, ...rest].sort((a, b) => b.at - a.at);
    clipSave(); send('clip:changed', null);
  }
  const clipIgnore = (t) => { ignore.add(t); setTimeout(() => ignore.delete(t), 60000); };
  ipcMain.handle('clip:list', () => ({ items: CLIPS, on: clipOn() }));
  ipcMain.handle('clip:toggle', (_e, on) => { D().settings.clipHistory = !!on; saveData(); return { items: CLIPS, on: clipOn() }; });
  ipcMain.handle('clip:copy', (_e, id) => { const c = CLIPS.find(x => x.id === id); if (!c) return false; clipboard.writeText(c.text); return true; });
  ipcMain.handle('clip:pin', (_e, id) => { const c = CLIPS.find(x => x.id === id); if (c) c.pinned = !c.pinned; clipSave(); return { items: CLIPS, on: clipOn() }; });
  ipcMain.handle('clip:del', (_e, id) => { CLIPS = CLIPS.filter(x => x.id !== id); clipSave(); return { items: CLIPS, on: clipOn() }; });
  ipcMain.handle('clip:clear', () => { CLIPS = CLIPS.filter(x => x.pinned); clipSave(); return { items: CLIPS, on: clipOn() }; });

  // ===== atalho de texto selecionado =====
  let target = 0; // janela de onde veio o texto (para colar de volta)
  async function pasteBack(text) {
    clipboard.writeText(text); lastClip = text;
    if (!WIN || !target) return { pasted: false };
    setMode('collapsed');
    await sleep(120);
    const r = await keysCmd('P ' + target);
    return { pasted: r === 'ok' };
  }
  async function captureSelection() {
    let text = '';
    clipPause = true;
    try {
      if (WIN) {
        const prev = clipboard.readText();
        clipboard.clear();
        const h = await keysCmd('C');
        target = Number(h) || 0;
        for (let i = 0; i < 16 && !text; i++) { await sleep(50); text = clipboard.readText(); }
        if (prev) clipboard.writeText(prev); else if (text) clipboard.clear();
      } else text = clipboard.readText();
    } catch {} finally { lastClip = clipboard.readText(); clipPause = false; }
    setMode('expanded', 't:texto');
    setTimeout(() => send('sel:text', { text, canPaste: WIN && !!target }), 150);
  }
  async function openClipPicker() {
    if (WIN) target = Number(await keysCmd('F')) || 0;
    setMode('expanded', 't:clip');
    setTimeout(() => send('clip:picker', { canPaste: WIN && !!target }), 150);
  }
  const SEL_HOTKEY = 'Control+Alt+X', CLIP_HOTKEY = 'Control+Alt+H';
  const hk = {};
  for (const [k, fn] of [[SEL_HOTKEY, captureSelection], [CLIP_HOTKEY, openClipPicker]]) { try { hk[k] = globalShortcut.register(k, fn); } catch { hk[k] = false; } }
  ipcMain.handle('sel:hotkeys', () => ({ sel: SEL_HOTKEY, clip: CLIP_HOTKEY, ok: hk }));
  ipcMain.handle('sel:paste', (_e, text) => pasteBack(String(text || '')));
  ipcMain.handle('clip:paste', async (_e, id) => { const c = CLIPS.find(x => x.id === id); if (!c) return { pasted: false }; const r = await pasteBack(c.text); c.at = Date.now(); clipSave(); return r; });
  ipcMain.handle('sel:run', async (_e, { text, opts }) => {
    if (!String(text || '').trim()) throw new Error('Cole ou selecione um texto para reescrever.');
    const task = PR.tarefaTexto(opts || {});
    if (MOCK) {
      await sleep(250);
      const o = opts || {};
      const t = o.fix ? 'Oi, pessoal, conseguem me mandar o relatório até sexta? Valeu!' : o.canal === 'email' ? 'Olá, pessoal!\n\nPoderiam me enviar o relatório até sexta-feira?\n\nObrigado!' : o.ajuste === 'curto' ? 'Podem me mandar o relatório até sexta? Obrigado!' : 'Oi, pessoal! Poderiam me enviar o relatório até sexta-feira? Obrigado!';
      for (const w of t.split(/(?<= )/)) { send('sel:delta', w); await sleep(12); }
      return t;
    }
    return claudeRun({ model: D().settings.textModel || 'haiku', system: `${PR.systemTexto(prof())}\n\nTarefa: ${task}`, prompt: String(text).slice(0, 30000), timeoutMs: 180000, onDelta: (t) => send('sel:delta', t) });
  });

  // ===== relógios =====
  const timers = [
    setInterval(tickClip, 700),
    setInterval(() => { tickRem(); tickAgenda(); }, 15000),
    setInterval(() => refresh().catch(() => {}), 10 * 60 * 1000),
  ];
  setTimeout(() => { tickRem(); if (D().calendars.length) refresh().catch(() => {}); }, 4000);
  if (WIN) setTimeout(keysStart, 6000);

  return {
    addReminder: (text, at, repeat) => { const r = makeRem(text, at, repeat); remSave(); return r; },
    delReminder: (id) => { D().reminders = D().reminders.filter(x => x.id !== id); remSave(); },
    brief: () => {
      const now = Date.now();
      return { events: D().agenda.events.filter(e => e.end > now && e.start < now + 3 * 86400000).slice(0, 15), reminders: D().reminders.filter(r => !r.done).sort((a, b) => a.at - b.at).slice(0, 15) };
    },
    clipIgnore,
    cleanup: () => { timers.forEach(clearInterval); try { keys.proc && keys.proc.kill(); } catch {} try { fs.writeFileSync(clipFile(), enc(JSON.stringify(CLIPS))); } catch {} },
  };
}

module.exports = { register, parseIcs, findLink };
