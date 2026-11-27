// Bit — interface
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = window.ilha;

const PRIO = {
  agora:   { label: 'Agora',    c: 'var(--orange)' },
  hoje:    { label: 'Hoje',     c: 'var(--yellow)' },
  semana:  { label: 'Semana',   c: 'var(--blue)' },
  espera:  { label: 'Espera',   c: 'var(--muted)' },
  devolver:{ label: 'Devolver', c: 'var(--purple)' },
};
const FRENTE = new Proxy({}, { get: (_t, k) => k === 'fora' ? 'Fora das frentes' : ((S.profile && S.profile.frentes) || []).find(f => f.id === k)?.nome || '' });
const TIPO = { demanda: 'Demanda', plano_dia: 'Plano do dia', fechamento: 'Fechamento', decisao: 'Decisão', conflito: 'Conflito', dado_estranho: 'Dado estranho', checkpoint: 'Checkpoint', dossie: 'Dossiê', ti: 'Pedido técnico', mensagem: 'Mensagem', conversa: 'Conversa' };

const MODES = [
  // genéricos: valem para qualquer trabalho
  ['Bom dia', 'bom dia\nO que está na minha cabeça e na caixa hoje:\n- '],
  ['Chegou demanda', 'chegou demanda\n[quem]: '],
  ['Conflito', 'conflito\nUma pessoa pediu: \nOutra pessoa pediu: \nTenho tempo para: '],
  ['Decisão', 'decisão\nPreciso decidir: \nOpções: '],
  ['Pedido técnico', 'ti\nProblema: \nOnde: \nImpacto: '],
  ['Mensagem', 'mensagem\nPara: \nAssunto: '],
  ['Fechamento', 'fechamento\nFiz: \nTravou: \nAmanhã: '],
];

let S = { demands: [], sessions: [], settings: {}, meta: {} };
let tab = 'home';
let state = 'idle';          // estado visual atual (derivado do humor do Bit)
let busy = false;            // compat: a voz consulta
let override = null, overrideLabel = '', flashT = null;
let cur = null;              // sessão aberta
const FULL = {};             // id -> mensagens carregadas
const LIVE = {};             // id -> { stage, streaming, text }
let sleeping = false, lastActivity = Date.now();
const NAME = 'Bit';
// IA escolhida (Config > Inteligência / Primeiros passos): os níveis haiku/sonnet/opus viram Rápido/Equilibrado/Forte no ChatGPT
const isGptUI = () => ((typeof S !== 'undefined' && S.settings) || {}).ai === 'chatgpt';
const aiName = () => (isGptUI() ? 'ChatGPT' : 'Claude');
const fastName = () => (isGptUI() ? 'ChatGPT' : 'Haiku');
const LBL = { claude: { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }, chatgpt: { haiku: 'Rápido', sonnet: 'Equilibrado', opus: 'Forte' } };
const MODEL_LABEL = new Proxy({}, { get: (_t, k) => LBL[isGptUI() ? 'chatgpt' : 'claude'][k] });
function applyAiLabels() {
  const g = isGptUI();
  const sub = g ? { haiku: 'Raciocínio leve, gasta pouco', sonnet: 'Bom para quase tudo', opus: 'Pensa mais, gasta mais' } : { haiku: 'Rápido, gasta pouco', sonnet: 'Equilibrado', opus: 'O mais forte, gasta mais' };
  $$('#nsModel button').forEach(b => { b.innerHTML = `<b>${MODEL_LABEL[b.dataset.v]}</b><small>${sub[b.dataset.v]}</small>`; });
  $$('#meetModel option').forEach(o => { o.textContent = MODEL_LABEL[o.value]; });
  const w = { haiku: g ? 'Rápido (gasta pouco)' : 'Haiku (rápido, gasta pouco)', sonnet: g ? 'Equilibrado' : 'Sonnet (mais caprichado)', opus: g ? 'Forte (gasta mais)' : 'Opus (pesado)' };
  $$('#cfgWrite option').forEach(o => { o.textContent = w[o.value]; });
  const eo = $('#cfgEngine'); if (eo) { eo.options[0].textContent = `JEV (o ${fastName()} assume se o JEV faltar)`; eo.options[1].textContent = `Só o ${fastName()} (usa o seu plano)`; }
  const intro = $('#aiIntro'); if (intro) intro.innerHTML = g
    ? 'O Bit usa o <b>ChatGPT</b> pelo Codex instalado neste PC, com o limite do <b>seu</b> plano do ChatGPT (Plus, Pro, Team…). Não precisa de chave da OpenAI. O JEV é opcional: sem ele, o ChatGPT classifica e prioriza.'
    : 'O Bit usa o <b>Claude Code</b> instalado neste PC, com o limite do <b>seu</b> plano do Claude. Não precisa de chave da Anthropic. O JEV é opcional: sem ele, o Claude Haiku classifica e prioriza.';
  syncAiFields();
}
function syncAiFields() { const v = ($('#cfgAi') || {}).value || (isGptUI() ? 'chatgpt' : 'claude'); $$('#cs-ai [data-ai]').forEach(x => { x.hidden = x.dataset.ai !== v; }); }
const STAGE_LABEL = { pesquisando: 'Pesquisando na web…', lendo: 'Lendo uma página…', classificando: 'JEV classificando…', separando: 'Separando demandas…', priorizando: 'JEV priorizando…', escrevendo: 'Escrevendo…' };

// ---------- utilidades ----------
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function md(src) {
  const lines = esc(src).split('\n');
  let html = '', list = null, code = false, buf = [];
  const inline = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const l of lines) {
    if (l.trim().startsWith('```')) { if (code) { html += `<pre>${buf.join('\n')}</pre>`; buf = []; code = false; } else { close(); code = true; } continue; }
    if (code) { buf.push(l); continue; }
    let m;
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
    close();
    if ((m = l.match(/^\s*&gt;\s?(.*)/))) { html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if ((m = l.match(/^#{1,6}\s+(.*)/))) { html += `<h4>${inline(m[1])}</h4>`; continue; }
    if (/^\s*\|/.test(l)) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) html += `<p class="mono" style="font-size:12px">${inline(l)}</p>`; continue; }
    if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  if (code) html += `<pre>${buf.join('\n')}</pre>`;
  close();
  return html;
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = 'Copiado'; setTimeout(() => btn.textContent = o, 1200); } } catch {}
}
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Bit: rosto e humor ----------
const FACE_SVG = `<svg class="bot" viewBox="0 0 48 44">
  <g class="ant"><line x1="24" y1="9.5" x2="24" y2="5"/><circle class="bulb" cx="24" cy="4" r="2.7"/></g>
  <rect class="ear" x="3" y="19" width="4" height="10" rx="2"/><rect class="ear" x="41" y="19" width="4" height="10" rx="2"/>
  <rect class="head" x="6" y="9.5" width="36" height="30" rx="11"/>
  <rect class="visor" x="10" y="14.5" width="28" height="19.5" rx="8"/>
  <g class="eyes">
    <g transform="translate(18.6 22.6)"><g class="look"><rect class="e-open" x="-2.6" y="-3.7" width="5.2" height="7.4" rx="2.6"/><path class="e-happy" d="M-3 1.2 Q0 -3.2 3 1.2"/><path class="e-closed" d="M-3 0.6 Q0 2.2 3 0.6"/><path class="e-x" d="M-2.4 -2.4 L2.4 2.4 M2.4 -2.4 L-2.4 2.4"/></g></g>
    <g transform="translate(29.4 22.6)"><g class="look"><rect class="e-open" x="-2.6" y="-3.7" width="5.2" height="7.4" rx="2.6"/><path class="e-happy" d="M-3 1.2 Q0 -3.2 3 1.2"/><path class="e-closed" d="M-3 0.6 Q0 2.2 3 0.6"/><path class="e-x" d="M-2.4 -2.4 L2.4 2.4 M2.4 -2.4 L-2.4 2.4"/></g></g>
  </g>
  <g class="mouth" transform="translate(24 29.6)">
    <path class="m-smile" d="M-3.2 -0.6 Q0 2.2 3.2 -0.6"/><path class="m-flat" d="M-2.2 0.4 H2.2"/>
    <ellipse class="m-o" cx="0" cy="0.4" rx="1.7" ry="1.9"/><path class="m-big" d="M-4 -1.2 Q0 4 4 -1.2 Z"/><path class="m-sad" d="M-3 1.4 Q0 -1.4 3 1.4"/>
  </g>
  <circle class="blush" cx="13.2" cy="29.8" r="1.9"/><circle class="blush" cx="34.8" cy="29.8" r="1.9"/>
  <g class="zz"><text x="38" y="10">z</text><text x="42" y="5">z</text></g>
</svg>`;
function mountFaces() { $$('[data-face]').forEach(el => { el.innerHTML = FACE_SVG; }); }

function activeOverride() {
  // saudações/avisos rápidos não escondem sessão trabalhando
  if (override === 'done' && (S.sessions || []).some(s => s.status === 'working')) return null;
  return override;
}
function moodNow() {
  const ov = activeOverride();
  if (ov) return ov;
  const ss = S.sessions || [];
  if (ss.some(s => s.status === 'working')) return 'working';
  if (ss.some(s => s.unread && s.status === 'error')) return 'error';
  if (ss.some(s => s.unread)) return 'done';
  return sleeping ? 'sleep' : 'idle';
}
function updateFace() {
  const m = moodNow(), isl = $('#island');
  isl.dataset.mood = m;
  state = { working: 'working', done: 'done', error: 'error', listening: 'listening', transcribing: 'transcribing' }[m] || 'idle';
  isl.dataset.state = state;
  const ss = S.sessions || [];
  const work = ss.filter(s => s.status === 'working'), unread = ss.filter(s => s.unread);
  let label, big, sub;
  const ov = activeOverride();
  if (ov) {
    label = overrideLabel || { listening: 'Ouvindo…', transcribing: 'Transcrevendo…', working: 'Um instante…', error: 'Opa, algo deu errado', done: 'Prontinho!' }[ov];
    big = { listening: 'Ouvindo', transcribing: 'Anotando', working: 'Um instante', error: 'Opa…', done: 'Oi!' }[ov];
    sub = label;
  } else if (work.length) {
    const w = work[0];
    label = work.length > 1 ? `${work.length} sessões trabalhando` : `${STAGE_LABEL[w.stage] || 'Pensando…'} · ${w.title}`;
    big = 'Pensando…'; sub = work.length > 1 ? `${work.length} sessões trabalhando` : w.title;
  } else if (unread.length) {
    const u = unread[0];
    label = u.status === 'error' ? `Deu problema · ${u.title}` : `Respondi! · ${u.title}`;
    big = u.status === 'error' ? 'Deu ruim' : 'Respondi!';
    sub = unread.length > 1 ? `${unread.length} sessões com novidade` : u.title;
  } else {
    label = NAME; big = m === 'sleep' ? 'Cochilando…' : 'Tudo em dia'; sub = 'Manda o que chegou';
  }
  const bl = $('#barLabel'); bl.textContent = label; bl.classList.toggle('name', label === NAME);
  $('#tcBig').textContent = big; $('#tcSub').textContent = sub;
  const tile = $('#tileCopiloto');
  tile.classList.remove('working', 'done', 'seen', 'error', 'listening', 'transcribing');
  if (state !== 'idle') tile.classList.add(state);
}
// compat com a voz/downloads: estados temporários
function setState(s, label) {
  clearTimeout(flashT);
  if (['listening', 'transcribing', 'working'].includes(s)) { override = s; overrideLabel = label || ''; }
  else if (s === 'error' || s === 'seen') {
    override = s === 'error' ? 'error' : 'done'; overrideLabel = label || '';
    flashT = setTimeout(() => { override = null; overrideLabel = ''; updateFace(); }, 4500);
  } else { override = null; overrideLabel = ''; }
  updateFace();
}
function markSeen() {
  if (tab !== 'chat' || !cur || $('#island').classList.contains('collapsed')) return;
  const s = (S.sessions || []).find(x => x.id === cur);
  if (s && s.unread) { s.unread = false; api.updateSession(cur, { unread: false }); updateFace(); renderSessList(); }
}
// olhos seguem o mouse; cochila depois de um tempo parado
api.onEyes(({ dx, dy }) => {
  const d = Math.hypot(dx, dy), k = Math.min(1, d / 260), ang = Math.atan2(dy, dx), isl = $('#island');
  isl.style.setProperty('--lx', (Math.cos(ang) * k * 2.6).toFixed(2));
  isl.style.setProperty('--ly', (Math.sin(ang) * k * 1.9).toFixed(2));
  if (d < 380) wake();
});
function wake() { lastActivity = Date.now(); if (sleeping) { sleeping = false; updateFace(); } }
setInterval(() => { if (!sleeping && Date.now() - lastActivity > 4 * 60 * 1000 && moodNow() === 'idle') { sleeping = true; updateFace(); } }, 15000);
document.addEventListener('pointerdown', wake);

// ---------- navegação ----------
function go(t) {
  if (t === 'ciclo') { t = 'demandas'; setTimeout(() => { $('#cicloBox').open = true; }, 0); }
  if (t === 'ferramentas') t = 't:' + (window.currentTool ? window.currentTool() : 'arquivos');
  const sub = t.startsWith('t:') ? t.slice(2) : null;
  const view = sub ? 'ferramentas' : t;
  tab = view;
  $$('.view').forEach(v => v.hidden = v.dataset.view !== view);
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (sub && window.showTool) window.showTool(sub);
  if (t === 'chat') { if (curCC) openCC(curCC, true); else if (!cur || !curSess()) openSession(pickDefault()); else { scrollChat(); setTimeout(() => $('#chatInput').focus(), 30); markSeen(); } }
  if (t === 'home') setTimeout(() => $('#homeInput').focus(), 30);
  if (t === 'demandas') renderDemands();
  if (t === 'foco') renderFocusSelect();
  if (t === 'config') renderSetup();
}
$$('#nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
$$('[data-go]').forEach(b => b.addEventListener('click', (e) => {
  if (b.dataset.go === 'foco' && e.target.closest('#tfPlay')) { toggleFocus(); return; }
  go(b.dataset.go);
}));
// ícones pequenos de linha (no lugar de emoji)
const IC = {
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>',
  rep: '<svg viewBox="0 0 24 24"><path d="M17 3.5l3 3-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8.5L18 7v13.5H6z"/><path d="M9 11h6M9 14.5h6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.9"/></svg>',
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M9.5 3.5h5"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v5.5H4.5V7H10"/></svg>',
};
window.IC = IC;

// ---------- dica flutuante (nome da tela ao passar o mouse nos ícones) ----------
(() => {
  const tip = document.createElement('div'); tip.className = 'tipf'; tip.hidden = true; document.body.appendChild(tip);
  let cur = null, t = null;
  const show = (el) => {
    const r = el.getBoundingClientRect(), side = el.closest('.nav') ? 'right' : 'below';
    tip.textContent = el.dataset.tip; tip.hidden = false; tip.dataset.side = side;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = side === 'right' ? r.right + 10 : r.left + r.width / 2 - w / 2, y = side === 'right' ? r.top + r.height / 2 - h / 2 : r.bottom + 8;
    x = Math.max(6, Math.min(innerWidth - w - 6, x)); y = Math.max(6, Math.min(innerHeight - h - 6, y));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el === cur) return;
    cur = el; clearTimeout(t); tip.hidden = true;
    if (el && el.dataset.tip) t = setTimeout(() => show(el), 250);
  });
  document.addEventListener('mousedown', () => { clearTimeout(t); tip.hidden = true; });
  window.addEventListener('blur', () => { clearTimeout(t); tip.hidden = true; });
})();

// ---------- tema (claro, escuro ou igual ao Windows) ----------
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = (S.settings && S.settings.theme) || 'claro';
  document.documentElement.dataset.theme = t === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : t === 'escuro' ? 'dark' : 'light';
}
darkMQ.addEventListener('change', applyTheme);
$('#cfgTheme').addEventListener('change', () => { S.settings.theme = $('#cfgTheme').value; applyTheme(); });

// ---------- mover (pelo rostinho), redimensionar e modo bolinha ----------
let justMoved = false;
(() => {
  const face = $('#barFace');
  let down = null;
  face.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; down = { x: e.screenX, y: e.screenY, started: false }; face.setPointerCapture(e.pointerId); });
  face.addEventListener('pointermove', (e) => {
    if (!down || down.started) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) { down.started = true; justMoved = true; $('#island').classList.add('moving'); api.dragStart(); }
  });
  const end = () => { if (down && down.started) { api.moveEnd(); setTimeout(() => { justMoved = false; }, 60); } $('#island').classList.remove('moving'); down = null; };
  face.addEventListener('pointerup', end); face.addEventListener('lostpointercapture', end);
  const grip = $('#resizeGrip');
  grip.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; grip.setPointerCapture(e.pointerId); api.resizeStart(); });
  const gend = () => api.moveEnd();
  grip.addEventListener('pointerup', gend); grip.addEventListener('lostpointercapture', gend);
  grip.addEventListener('dblclick', () => api.resetPos());
})();
const setBubblePref = (on) => { S.meta.bubble = !!on; $('#bubbleBtn').classList.toggle('on', !!on); $('#bubbleBtn').title = on ? 'Ao fechar: só o rostinho (clique para voltar à pílula)' : 'Ao fechar, deixar só o rostinho do Bit'; };
$('#bubbleBtn').addEventListener('click', () => { const on = !S.meta.bubble; setBubblePref(on); api.setBubble(on); setState('seen', on ? 'Ao fechar, fico só o rostinho. Arraste por ele.' : 'Ao fechar, volto a ser a pílula'); });
$('#barMin').addEventListener('click', (e) => { e.stopPropagation(); setBubblePref(true); api.setBubble(true); });
api.onBubbleSet((on) => setBubblePref(on));
$('#barMain').addEventListener('click', (e) => { if (justMoved) { e.preventDefault(); return; } api.toggle(); });
$('#collapseBtn').addEventListener('click', () => api.collapse());
$('#cfgBtn').addEventListener('click', () => { if ($('#island').classList.contains('collapsed')) api.expand('config'); else go(tab === 'config' ? 'home' : 'config'); });
let pinned = false;
$('#pinBtn').addEventListener('click', () => { pinned = !pinned; api.pin(pinned); $('#pinBtn').classList.toggle('on', pinned); $('#pinBtn').title = pinned ? 'Desafixar' : 'Fixar aberta'; });
document.addEventListener('keydown', (e) => { wake(); if (e.key === 'Escape') { if (!$('#newSess').hidden) { $('#newSess').hidden = true; return; } api.collapse(); } });

api.onMode(({ mode, tab: t }) => {
  const isl = $('#island');
  isl.classList.toggle('collapsed', mode === 'collapsed' || mode === 'bubble');
  isl.classList.toggle('bubble', mode === 'bubble');
  isl.classList.toggle('dropmode', mode === 'drop');
  $('#dropOver').hidden = mode !== 'drop' && !isl.classList.contains('dragging');
  if (mode === 'drop') { wake(); return; }
  if (mode === 'expanded') {
    if (t === 'bomdia' || t === 'fechamento') { go('chat'); openSession(nipSession().id).then(() => prefill('#chatInput', MODES[t === 'bomdia' ? 0 : 9][1])); }
    else if (t) go(t);
    else if (moodNow() === 'done' || moodNow() === 'error') { const u = (S.sessions || []).find(x => x.unread); go('chat'); if (u) openSession(u.id); }
    else go(tab);
    markSeen();
  }
});

// ---------- barra recolhida ----------
function renderBar() {
  const open = S.demands.filter(d => d.status !== 'feito' && isMineD(d));
  const n = (p) => open.filter(d => d.prioridade === p).length;
  const chips = [];
  if (n('agora')) chips.push(`<span class="pchip agora">${n('agora')} agora</span>`);
  if (n('hoje')) chips.push(`<span class="pchip hoje">${n('hoje')} hoje</span>`);
  if (n('devolver')) chips.push(`<span class="pchip dev">${n('devolver')} devolver</span>`);
  if (window.toolChips) chips.unshift(...window.toolChips());
  if (window.extraChips) chips.unshift(...window.extraChips());
  const ccw = (window.CCLIST || []).filter(x => x.status === 'working').length;
  if (ccw) chips.unshift(`<span class="pchip cc" data-chip="cc" title="Sessões do Claude Code trabalhando"><svg viewBox="0 0 24 24"><path d="M5 7l5 5-5 5M12 17h7"/></svg>${ccw} no Claude Code</span>`);
  if (S.updateReady) chips.unshift(`<span class="pchip upd" id="updChip" title="Clique para reiniciar">v${esc(S.updateReady.version)} pronta · reiniciar</span>`);
  if (S.limitBlocked) chips.unshift(`<span class="pchip limit">${esc(S.limitBlocked)}</span>`);
  $('#barChips').innerHTML = chips.join('');
  $('#island').classList.toggle('has-chips', chips.length > 0);
  const uc = $('#updChip'); if (uc) uc.addEventListener('click', (e) => { e.stopPropagation(); api.relaunch(); });
  $('#tdBig').textContent = open.length;
  $('#tdSub').textContent = n('agora') ? `${n('agora')} para agora · ${n('hoje')} hoje` : n('hoje') ? `${n('hoje')} para hoje` : open.length ? 'nada urgente' : 'lista limpa';
}

// ---------- top do dia ----------
const ORDER = ['agora', 'hoje', 'semana', 'devolver', 'espera'];
function sortDemands(list) { return [...list].sort((a, b) => ORDER.indexOf(a.prioridade) - ORDER.indexOf(b.prioridade) || (b.criadaEm || 0) - (a.criadaEm || 0)); }
function renderTop() {
  const top = sortDemands(S.demands.filter(d => d.status !== 'feito' && d.prioridade !== 'espera' && isMineD(d))).slice(0, 3);
  $('#top3').innerHTML = top.length
    ? top.map(d => `<li><span class="dot ${d.prioridade}"></span><div><div class="t">${esc(d.titulo)}</div><div class="s">${esc(d.quem || '')}${d.prazo ? ' · ' + esc(d.prazo) : ''}${d.proximo_passo ? ' · ' + esc(d.proximo_passo) : ''}</div></div></li>`).join('')
    : `<li class="empty">Nenhuma demanda aberta. Fala pro Bit: "a Ana pediu o relatório até quinta".</li>`;
}

// ---------- sessões ----------
const GERAL_IDEAS = [
  ['Escrever e-mail', 'Escreve um e-mail para '],
  ['Resumir', 'Resume esse texto em tópicos curtos:\n'],
  ['Explicar', 'Me explica de um jeito simples: '],
  ['Revisar código', 'Revisa esse código e aponta problemas:\n'],
  ['Ideias', 'Me dá 5 ideias de '],
  ['Pesquisar', 'Pesquisa na web e me resume: '],
  ['Planejar', 'Me ajuda a planejar '],
];
function renderModes(sel, target, list = MODES) {
  $(sel).innerHTML = list.map(([l], i) => `<button class="chip-btn" data-i="${i}" type="button">${l}</button>`).join('');
  $$(sel + ' button').forEach(b => b.addEventListener('click', () => prefill(target, list[+b.dataset.i][1])));
}
function prefill(sel, text) { const t = $(sel); t.value = text; t.focus(); t.setSelectionRange(text.length, text.length); }

function demandCard(d) {
  const p = PRIO[d.prioridade] || PRIO.semana;
  return `<div class="dcard" style="--c:${p.c}"><span class="dot ${d.prioridade}"></span><div><div class="t">${esc(d.titulo)}</div><div class="s">${esc(d.quem)} · ${FRENTE[d.frente] ? esc(FRENTE[d.frente]) + ' · ' : ''}esforço ${esc(d.esforco)}${d.prazo ? ' · ' + esc(d.prazo) : ''}</div><div class="s">${esc(d.motivo || '')}</div></div><span class="prio">${p.label}</span></div>`;
}
function msgEl(m) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  if (m.role === 'user') el.textContent = m.text;
  else {
    el.innerHTML = md(m.text) + `<div class="mtools"><button type="button">Copiar</button>${m.model ? `<span class="mmodel">${esc(MODEL_LABEL[m.model] || m.model)}</span>` : ''}</div>`;
    el.querySelector(".mtools button").addEventListener('click', (e) => copy(m.text, e.currentTarget));
  }
  return el;
}
function clsEl(m) {
  const wrap = document.createElement('div');
  wrap.className = 'cls';
  wrap.innerHTML = `<div class="cls-h"><span class="tag">${esc(TIPO[m.cls?.tipo] || m.cls?.tipo || '')}</span><span>${esc(m.cls?.resumo || '')}</span></div>` + (m.added || []).map(demandCard).join('');
  (m.warnings || []).forEach(w => { const e = document.createElement('div'); e.className = 'warn'; e.textContent = '⚠ ' + w; wrap.appendChild(e); });
  return wrap;
}
const curSess = () => (S.sessions || []).find(s => s.id === cur);
function nipSession() { return (S.sessions || []).filter(s => s.kind === 'nip').sort((a, b) => b.updatedAt - a.updatedAt)[0]; }
function pickDefault() { const ss = S.sessions || []; return (ss.find(s => s.unread) || [...ss].sort((a, b) => b.updatedAt - a.updatedAt)[0] || {}).id; }
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'agora'; if (m < 60) return `${m} min`; const h = Math.round(m / 60); if (h < 24) return `${h} h`;
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
// ---------- sessões do Claude Code no PC ----------
let CC = [], curCC = null, ccMsgsSig = '';
window.CCLIST = CC;
const CC_ST = { working: ['working', 'Trabalhando agora…'], waiting: ['done', 'Esperando você'], idle: ['idle', 'Parada'] };
const IC_X = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const IC_HIDE = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.2 3.9M6.6 7.6A16.3 16.3 0 0 0 2.5 12S6 18 12 18a9.5 9.5 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const IC_SHOW = '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
const sessUI = () => { S.meta.sessUI ||= { collapsed: {}, hiddenCC: [] }; S.meta.sessUI.collapsed ||= {}; S.meta.sessUI.hiddenCC ||= []; return S.meta.sessUI; };
const saveSessUI = () => api.setMeta({ sessUI: sessUI() });
let showHiddenCC = false;
function siHTML({ cls, data, dot, title, meta, badge, act, tip }) {
  return `<div class="si ${cls}" ${data} role="button" tabindex="0"><span class="sdot ${dot}"></span><span class="si-b"><div class="t">${title}</div><div class="k">${meta}</div></span>${badge || ''}<button class="si-x" type="button" data-x="${act}" title="${tip}">${act === 'del' ? IC_X : act === 'hide' ? IC_HIDE : IC_SHOW}</button></div>`;
}
function ccItem(x, hidden) {
  const [dot, lbl] = CC_ST[x.status] || CC_ST.idle;
  const st = x.status === 'working' ? `<span class="live-t">${lbl}</span>` : x.status === 'waiting' ? `<span class="wait-t">${lbl}</span>` : ago(x.updatedAt);
  return siHTML({ cls: `cc ${x.id === curCC ? 'on' : ''} ${hidden ? 'hid' : ''}`, data: `data-cc="${x.id}"`, dot, title: hl(x.title),
    meta: `<b class="code">${hl(x.project)}</b> · ${st}`, act: hidden ? 'unhide' : 'hide', tip: hidden ? 'Mostrar de novo' : 'Ocultar esta sessão' });
}
async function openCC(id, keepScroll) {
  const x = CC.find(y => y.id === id); if (!x) return;
  curCC = id; cur = null;
  $('.sess-main').classList.add('ccmode');
  renderSessList();
  const [dot, lbl] = CC_ST[x.status] || CC_ST.idle;
  $('#sessHead').innerHTML = `<span class="ttl" title="${esc(x.cwd)}">${esc(x.title)}</span><span class="kchip code">${esc(x.project)}</span><span class="stchip ${dot}">${lbl}</span><span class="grow"></span>
    <button class="btn primary sm" data-a="term" type="button">Abrir no terminal</button><button class="mini" data-a="dir" title="Abrir a pasta do projeto"><svg viewBox="0 0 24 24"><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg></button><button class="mini" data-a="cmd" title="Copiar o comando para continuar"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>`;
  $('#sessHead [data-a="term"]').addEventListener('click', () => { api.ccOpen(id); setState('seen', 'Abrindo no terminal…'); });
  $('#sessHead [data-a="dir"]').addEventListener('click', () => api.ccFolder(id));
  $('#sessHead [data-a="cmd"]').addEventListener('click', (e) => copy(`cd "${x.cwd}" && claude --resume ${x.id}`, e.currentTarget));
  const msgs = await api.ccMessages(id);
  ccMsgsSig = `${id}:${x.updatedAt}`;
  const box = $('#chat'), atBottom = !keepScroll || box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = '';
  for (const m of msgs) {
    if (m.role === 'tool') {
      const t = document.createElement('div'); t.className = 'toolrow';
      t.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/></svg><span>${m.items.slice(0, 4).map(esc).join(' · ')}${m.items.length > 4 ? ` · +${m.items.length - 4}` : ''}</span>`;
      box.appendChild(t);
    } else box.appendChild(msgEl({ role: m.role, text: m.text }));
  }
  if (x.status === 'working') { const t = document.createElement('div'); t.className = 'msg assistant typing'; box.appendChild(t); }
  const live = document.createElement('div'); live.id = 'cclive'; live.style.display = 'contents'; box.appendChild(live);
  const note = document.createElement('div'); note.className = 'cc-note'; note.id = 'ccNote';
  note.title = x.cwd || ''; note.innerHTML = `Responde nesta mesma sessão (<b>${esc(x.project)}</b>), pelo seu plano. Se ela estiver aberta num terminal, feche lá antes.`;
  box.appendChild(note);
  $('#ccCtl').hidden = false; $('#chatModes').hidden = true;
  $('#chatInput').placeholder = x.status === 'working' && !CCRUN[id] ? 'Essa sessão está trabalhando agora… espere terminar' : 'Mandar mensagem para esta sessão do Claude Code…';
  renderCCLive();
  if (atBottom) box.scrollTop = box.scrollHeight;
}
// ---- mandar mensagem para a sessão do Claude Code ----
const CCRUN = {};
const ccPerm = () => S.meta.ccPerm || 'acceptEdits';
function paintCCCtl() {
  $$('#ccPerm button').forEach(b => b.classList.toggle('on', b.dataset.p === ccPerm()));
  $('#ccModel').value = S.meta.ccModel || '';
  $('#ccStop').hidden = !CCRUN[curCC];
}
$$('#ccPerm button').forEach(b => b.addEventListener('click', async () => {
  if (b.dataset.p === 'bypassPermissions' && !b.dataset.ok) { b.dataset.ok = '1'; setState('error', 'Cuidado: "Tudo" libera até comandos. Clique de novo para confirmar.'); setTimeout(() => delete b.dataset.ok, 4000); return; }
  S.meta = await api.setMeta({ ccPerm: b.dataset.p }); paintCCCtl();
}));
$('#ccModel').addEventListener('change', async (e) => { S.meta = await api.setMeta({ ccModel: e.target.value }); });
$('#ccStop').addEventListener('click', () => curCC && api.ccStop(curCC));
function renderCCLive() {
  const el = $('#cclive'); if (!el) return;
  paintCCCtl();
  const R = CCRUN[curCC]; el.innerHTML = '';
  if (!R) return;
  el.appendChild(msgEl({ role: 'user', text: R.user }));
  if (R.tools.length) { const t = document.createElement('div'); t.className = 'toolrow'; t.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/></svg><span>${R.tools.slice(-4).map(esc).join(' · ')}${R.tools.length > 4 ? ` · +${R.tools.length - 4}` : ''}</span>`; el.appendChild(t); }
  const a = document.createElement('div'); a.className = 'msg assistant typing'; a.innerHTML = md(R.text || ''); el.appendChild(a);
  const box = $('#chat'); box.scrollTop = box.scrollHeight;
}
async function ccSend(text) {
  const id = curCC, x = CC.find(y => y.id === id); if (!x) return;
  if (CCRUN[id]) { setState('error', 'Espere a resposta anterior terminar (ou clique em Parar).'); return; }
  if (x.status === 'working') { setState('error', 'Essa sessão está trabalhando agora. Espere ela terminar.'); return; }
  CCRUN[id] = { user: text, text: '', tools: [] };
  renderCCLive(); setState('working', `Mandando para o Claude Code · ${x.project}`);
  const r = await api.ccSend(id, text, ccPerm(), S.meta.ccModel || '');
  if (!r.ok && CCRUN[id]) { delete CCRUN[id]; renderCCLive(); setState('error', r.error); }
}
api.onCCDelta(({ id, text }) => { const R = CCRUN[id]; if (!R) return; R.text += text; if (id === curCC) renderCCLive(); });
api.onCCTool(({ id, label }) => { const R = CCRUN[id]; if (!R) return; R.tools.push(label); if (id === curCC) renderCCLive(); });
api.onCCDone(({ id }) => { delete CCRUN[id]; setState('seen', 'Claude Code respondeu'); setTimeout(() => { if (curCC === id) openCC(id, true); else renderSessList(); }, 700); });
api.onCCError(({ id, error }) => { delete CCRUN[id]; setState('error', error); if (curCC === id) openCC(id, true); });
api.onCC((l) => {
  CC = l; window.CCLIST = l; renderSessList(); renderBar();
  if (curCC && tab === 'chat' && !CCRUN[curCC]) { const x = CC.find(y => y.id === curCC); if (x && `${x.id}:${x.updatedAt}` !== ccMsgsSig) openCC(curCC, true); }
});
api.onCCFinished((x) => setState('seen', `Claude Code terminou · ${x.project}`));
api.ccList().then((l) => { CC = l; window.CCLIST = l; renderSessList(); renderBar(); });
window.openCC = openCC;

// ---- busca nas sessões ----
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const sessQuery = () => norm(($('#sessQ') && !$('#sessSearch').hidden) ? $('#sessQ').value.trim() : '');
function hl(text) {
  const q = sessQuery(); const t = String(text || '');
  if (!q) return esc(t);
  const i = norm(t).indexOf(q);
  return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
}
function openSessSearch() { $('#sessSearch').hidden = false; $('#sessQ').focus(); $('#sessQ').select(); renderSessList(); }
function closeSessSearch() { $('#sessQ').value = ''; $('#sessSearch').hidden = true; renderSessList(); }
$('#sessSearchBtn').addEventListener('click', () => ($('#sessSearch').hidden ? openSessSearch() : closeSessSearch()));
$('#sessQx').addEventListener('click', closeSessSearch);
$('#sessQ').addEventListener('input', () => renderSessList());
$('#sessQ').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeSessSearch(); }
  if (e.key === 'Enter') { const first = $('#sessList .si'); if (first) first.click(); }
});
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && tab === 'chat') { e.preventDefault(); openSessSearch(); } });

function renderSessList() {
  const ui = sessUI(), q = sessQuery();
  const ss = [...(S.sessions || [])].sort((a, b) => (b.status === 'working') - (a.status === 'working') || b.updatedAt - a.updatedAt)
    .filter(s => !q || norm(`${s.title} ${s.preview} ${s.kind === 'nip' ? 'copiloto' : 'geral assistente'} ${s.model}`).includes(q));
  const hid = new Set(ui.hiddenCC);
  const ccMatch = (x) => !q || norm(`${x.title} ${x.project} ${x.lastPrompt} ${x.model}`).includes(q);
  const vis = CC.filter(x => !hid.has(x.id) && ccMatch(x)), hidden = CC.filter(x => hid.has(x.id) && ccMatch(x));

  if (q) {
    // buscando: grupos sempre abertos e as ocultas também entram (marcadas)
    const cc = [...vis.map(x => ccItem(x, false)), ...hidden.map(x => ccItem(x, true))];
    const head = (t, n) => `<div class="sl-h static"><span>${t}</span><span class="cnt">${n}</span></div>`;
    $('#sessList').innerHTML = (ss.length ? `<div class="sl-g">${head('No Bit', ss.length)}<div class="sl-body">${ilhaHTML(ss)}</div></div>` : '')
      + (cc.length ? `<div class="sl-g">${head('Claude Code no PC', cc.length)}<div class="sl-body">${cc.join('')}</div></div>` : '')
      + (ss.length + cc.length ? '' : `<p class="muted sl-empty">Nada encontrado para “${esc($('#sessQ').value.trim())}”.</p>`);
    wireSessList(ui);
    return;
  }

  const ccBody = (vis.length ? vis.map(x => ccItem(x, false)).join('') : `<p class="muted sl-empty">${CC.length ? 'Todas ocultas.' : 'Nenhuma sessão do Claude Code nos últimos 7 dias.'}</p>`)
    + (hidden.length ? `<button class="sl-more" type="button" id="toggleHidden">${showHiddenCC ? 'Esconder' : 'Ver'} ocultas (${hidden.length})</button>` + (showHiddenCC ? hidden.map(x => ccItem(x, true)).join('') : '') : '');
  const group = (key, title, n, live, body) => `<div class="sl-g ${ui.collapsed[key] ? 'closed' : ''}"><button class="sl-h" type="button" data-g="${key}"><svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg><span>${title}</span><span class="cnt">${n}</span>${live ? `<span class="live">${live}</span>` : ''}</button><div class="sl-body">${body}</div></div>`;
  $('#sessList').innerHTML = group('ilha', 'No Bit', ss.length, ss.filter(s => s.status === 'working').length, ilhaHTML(ss))
    + group('cc', 'Claude Code no PC', vis.length, vis.filter(x => x.status === 'working').length, ccBody)
    + `<button class="sl-link" type="button" id="claudeAi">Chats do claude.ai <svg viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8"/></svg></button>`;
  $$('#sessList .sl-h[data-g]').forEach(b => b.addEventListener('click', () => { ui.collapsed[b.dataset.g] = !ui.collapsed[b.dataset.g]; saveSessUI(); renderSessList(); }));
  wireSessList(ui);
}
function ilhaHTML(ss) {
  return ss.map(s => {
    const dot = s.status === 'working' ? 'working' : s.unread ? (s.status === 'error' ? 'error' : 'done') : 'idle';
    const st = s.status === 'working' ? `<span class="live-t">${STAGE_LABEL[s.stage] || 'Pensando…'}</span>` : ago(s.updatedAt);
    return siHTML({ cls: s.id === cur ? 'on' : '', data: `data-id="${s.id}"`, dot, title: hl(s.title),
      meta: `<b class="${s.kind}">${s.kind === 'nip' ? 'Copiloto' : 'Geral'}</b> · ${MODEL_LABEL[s.model] || s.model} · ${st}`,
      badge: s.unread ? '<span class="badge-n">novo</span>' : '', act: 'del', tip: 'Apagar sessão' });
  }).join('');
}
function wireSessList(ui) {
  $$('#sessList .si').forEach(el => {
    const open = () => (el.dataset.cc ? openCC(el.dataset.cc) : openSession(el.dataset.id));
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    el.querySelector('.si-x').addEventListener('click', async (e) => {
      e.stopPropagation();
      const b = e.currentTarget, a = b.dataset.x;
      if (a === 'hide') { ui.hiddenCC.push(el.dataset.cc); saveSessUI(); if (curCC === el.dataset.cc) openSession(pickDefault()); else renderSessList(); return; }
      if (a === 'unhide') { ui.hiddenCC = ui.hiddenCC.filter(i => i !== el.dataset.cc); saveSessUI(); renderSessList(); return; }
      if (a === 'del') {
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.title = 'Clique de novo para apagar'; setTimeout(() => b.classList.remove('armed'), 2500); return; }
        const r = await api.deleteSession(el.dataset.id);
        if (!r.ok) { setState('error', r.error); return; }
        delete FULL[el.dataset.id]; S.sessions = await api.listSessions();
        if (cur === el.dataset.id) { cur = null; openSession(pickDefault()); } else renderSessList();
      }
    });
  });
  const th = $('#toggleHidden'); if (th) th.addEventListener('click', () => { showHiddenCC = !showHiddenCC; renderSessList(); });
  const ca = $('#claudeAi'); if (ca) ca.addEventListener('click', () => api.openExternal('https://claude.ai/recents'));
}
async function openSession(id) {
  if (!id) return;
  cur = id; curCC = null; $('.sess-main').classList.remove('ccmode'); $('#ccCtl').hidden = true; $('#chatModes').hidden = false;
  const full = await api.getSession(id);
  FULL[id] = full ? full.messages : [];
  renderSessList(); renderSessHead(); renderChat(); markSeen();
  setTimeout(() => $('#chatInput').focus(), 30);
}
function renderSessHead() {
  if (curCC) return;
  const s = curSess(), head = $('#sessHead');
  if (!s) { head.innerHTML = ''; return; }
  head.innerHTML = `<span class="ttl" title="Clique para renomear">${esc(s.title)}</span>
    <span class="kchip ${s.kind}">${s.kind === 'nip' ? 'Copiloto Bit' : 'Assistente geral'}</span>
    <select id="sessModel" title="Modelo desta sessão">${['haiku', 'sonnet', 'opus'].map(m => `<option value="${m}" ${m === s.model ? 'selected' : ''}>${MODEL_LABEL[m]}</option>`).join('')}</select>
    <span class="grow"></span>
    <button class="mini" data-a="clear" title="Limpar conversa desta sessão"><svg viewBox="0 0 24 24"><path d="M4 7h16M7 7l1 12h8l1-12"/></svg></button>
    <button class="mini" data-a="del" title="Apagar sessão"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  head.querySelector('.ttl').addEventListener('click', () => {
    const inp = document.createElement('input'); inp.className = 'ttl-in'; inp.value = s.title;
    head.querySelector('.ttl').replaceWith(inp); inp.focus(); inp.select();
    const done = async (ok) => { if (ok && inp.value.trim()) await api.updateSession(s.id, { title: inp.value }); renderSessHead(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    inp.addEventListener('blur', () => done(true));
  });
  head.querySelector('#sessModel').addEventListener('change', (e) => api.updateSession(s.id, { model: e.target.value }));
  head.querySelector('[data-a="clear"]').addEventListener('click', async () => {
    if (s.status === 'working') return;
    await api.clearSession(s.id); FULL[s.id] = []; renderChat();
  });
  const del = head.querySelector('[data-a="del"]');
  del.addEventListener('click', async () => {
    if (!del.classList.contains('armed')) { del.classList.add('armed'); del.style.color = 'var(--red)'; del.title = 'Clique de novo para apagar'; setTimeout(() => { del.classList.remove('armed'); del.style.color = ''; }, 2500); return; }
    const r = await api.deleteSession(s.id);
    if (r.ok) { delete FULL[s.id]; cur = null; S.sessions = await api.listSessions(); openSession(pickDefault()); }
  });
  renderModes('#chatModes', '#chatInput', s.kind === 'nip' ? MODES : GERAL_IDEAS);
  $('#chatInput').placeholder = s.kind === 'nip' ? 'Escreve do jeito que vier…' : 'Pede qualquer coisa pro Bit…';
}
function renderChat() {
  const box = $('#chat'), s = curSess();
  box.innerHTML = '';
  const msgs = FULL[cur] || [];
  if (!msgs.length && !LIVE[cur]) {
    box.innerHTML = s && s.kind === 'geral'
      ? `<div class="chat-empty"><b>Fala comigo!</b>Aqui vale qualquer pedido: e-mail, resumo, explicação, código, pesquisa na web. Usando o ${MODEL_LABEL[s.model]} pelo seu plano.</div>`
      : `<div class="chat-empty"><b>Despeja que eu organizo.</b>O JEV classifica e prioriza cada demanda, e eu separo os pedidos e respondo pelo seu plano.</div>`;
  }
  for (const m of msgs) {
    if (m.role === 'meta') box.appendChild(clsEl(m));
    else if (m.role === 'error') { const e = document.createElement('div'); e.className = 'err'; e.textContent = m.text; box.appendChild(e); }
    else box.appendChild(msgEl(m));
  }
  const live = document.createElement('div'); live.id = 'live'; live.style.display = 'contents';
  box.appendChild(live);
  renderLive(); scrollChat();
}
function renderLive() {
  const el = $('#live'); if (!el) return;
  const L = LIVE[cur], s = curSess();
  el.innerHTML = '';
  if (!L) return;
  if (L.stage && !L.streaming) {
    const stages = s && s.kind === 'nip' ? [['classificando', 'JEV classifica', 'jev'], ['separando', 'Claude separa', 'cl'], ['priorizando', 'JEV prioriza', 'jev'], ['escrevendo', 'Bit responde', 'cl']] : [['escrevendo', 'Bit pensando…', 'cl']];
    const idx = stages.findIndex(x => x[0] === L.stage);
    const bar = document.createElement('div'); bar.className = 'stages';
    bar.innerHTML = stages.map((x, i) => `<span class="stg ${x[2]} ${i === idx ? 'on' : i < idx ? 'ok' : ''}">${i < idx ? '✓ ' : ''}${x[1]}</span>`).join('');
    el.appendChild(bar);
  }
  if (L.streaming && (L.stage === 'pesquisando' || L.stage === 'lendo')) { const b = document.createElement('div'); b.className = 'stages'; b.innerHTML = `<span class="stg jev on">${L.stage === 'lendo' ? '📄 Lendo uma página…' : '🔎 Pesquisando na web…'}</span>`; el.appendChild(b); }
  if (L.streaming) { const t = document.createElement('div'); t.className = 'msg assistant typing'; t.innerHTML = md(L.text || ''); el.appendChild(t); }
  scrollChat();
}
function scrollChat() { const c = $('#chat'); c.scrollTop = c.scrollHeight; }

async function send(text, sid) {
  text = (text || '').trim();
  sid = sid || cur || nipSession()?.id;
  const s = (S.sessions || []).find(x => x.id === sid);
  if (!text || !s) return;
  if (s.status === 'working') { setState('error', 'Essa sessão ainda tá trabalhando. Abre outra!'); return; }
  if (!FULL[sid]) { const full = await api.getSession(sid); FULL[sid] = full ? full.messages : []; }
  FULL[sid].push({ role: 'user', text });
  LIVE[sid] = { stage: s.kind === 'nip' ? 'classificando' : 'escrevendo', streaming: false, text: '' };
  s.status = 'working';
  if (sid === cur) renderChat();
  renderSessList(); updateFace();
  try { await api.send(sid, text); }
  catch (e) { delete LIVE[sid]; showError('Erro interno: ' + e.message); }
}
function wireComposer(inputSel, btnSel, target) {
  const ta = $(inputSel);
  const go_ = async () => {
    const v = ta.value; if (!v.trim()) return; ta.value = '';
    if (!target && curCC) { ccSend(v.trim()); return; }
    const sid = target ? await target() : cur;
    send(v, sid);
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go_(); } });
  $(btnSel).addEventListener('click', go_);
}
wireComposer('#chatInput', '#chatSend');
// ---------- assistente do início: fala e o Bit faz ----------
const FEED = [];
const PRIO_L = { agora: 'agora', hoje: 'hoje', semana: 'semana', espera: 'espera', devolver: 'devolver' };
const ASSIST_IDEAS = [['me lembra de beber água em 30 min', 'me lembra de beber água em 30 min'], ['O que tenho hoje?', 'o que tenho hoje?'], ['Anotar algo', 'anota: '], ['Foco 25 min', 'foco de 25 minutos']];
const whenTxt = (t) => { const d = new Date(t), k = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5); return `${k === 0 ? 'hoje' : k === 1 ? 'amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };
function feedPill(f) {
  const ic = { lembrete: IC.bell, nota: IC.note, demanda: IC.check, foco: IC.timer, ui: IC.out }[f.tipo] || '';
  const sub = f.tipo === 'lembrete' ? (f.repeat && window.repLabel ? `${window.repLabel(f.repeat)} · ` : '') + whenTxt(f.at) : f.tipo === 'demanda' ? `${PRIO_L[f.prioridade] || ''}${f.quem && f.quem !== '—' ? ' · ' + f.quem : ''}` : f.tipo === 'nota' ? 'nota' : f.sub || '';
  return `<span class="as-pill ${f.tipo}${f.undone ? ' undone' : ''}" data-id="${esc(f.id || '')}" data-t="${f.tipo}">${ic}<span>${esc(f.texto || '')}</span>${sub ? `<i>${esc(sub)}</i>` : ''}${f.id && !f.undone ? '<button type="button" class="as-undo" title="Desfazer">desfazer</button>' : f.undone ? '<i>desfeito</i>' : ''}</span>`;
}
function renderFeed() {
  const box = $('#asFeed'); if (!box) return;
  if (!FEED.length) {
    box.innerHTML = `<div class="as-empty"><span class="muted">Fala ou escreve do seu jeito. Eu crio lembretes, notas e demandas, respondo sobre sua agenda e mando pro Copiloto o que precisar de mais cabeça.</span><div class="as-ideas">${ASSIST_IDEAS.map(([l, t], i) => `<button type="button" class="chip-btn" data-idea="${i}">${esc(l)}</button>`).join('')}</div></div>`;
    $$('#asFeed [data-idea]').forEach(b => b.addEventListener('click', () => { const t = ASSIST_IDEAS[+b.dataset.idea][1]; if (t.endsWith(': ')) prefill('#homeInput', t); else assistSend(t); }));
    return;
  }
  box.innerHTML = FEED.slice(-6).map((x, i) => `<div class="as-item${x.pending ? ' pending' : ''}"><div class="as-q">${esc(x.q)}</div>
    <div class="as-a">${x.pending ? '<span class="as-dots"><i></i><i></i><i></i></span>' : ''}${x.r ? `<div class="as-r">${md(x.r)}</div>` : ''}${(x.feitos || []).length ? `<div class="as-pills">${x.feitos.map(feedPill).join('')}</div>` : ''}${(x.warnings || []).map(w => `<div class="as-w">${esc(w)}</div>`).join('')}</div></div>`).join('');
  box.scrollTop = box.scrollHeight;
  $$('#asFeed .as-undo').forEach(b => b.addEventListener('click', async () => {
    const p = b.closest('.as-pill'), t = p.dataset.t, id = p.dataset.id;
    const r = await api.assistUndo(t, id); S.demands = r.demands; refresh();
    for (const x of FEED) for (const f of x.feitos || []) if (f.id === id) f.undone = true;
    renderFeed();
  }));
}
const MODE_PREFIX = MODES.map(([, p]) => p.split('\n')[0].toLowerCase());
const geralSession = async () => (S.sessions || []).filter(x => x.kind === 'geral').sort((a, b) => b.updatedAt - a.updatedAt)[0] || await api.createSession({ title: 'Assistente', kind: 'geral', model: 'haiku' });
async function toCopiloto(text) { const n = nipSession(); go('chat'); await openSession(n.id); send(text, n.id); }
async function assistSend(text) {
  text = String(text || '').trim(); if (!text) return;
  $('#homeInput').value = '';
  // modos do copiloto (bom dia, decisão…) vão direto pro Copiloto
  if (MODE_PREFIX.some(p => text.toLowerCase().startsWith(p))) return toCopiloto(text);
  const item = { q: text, pending: true, feitos: [] }; FEED.push(item); renderFeed();
  try {
    // atalho instantâneo: "me lembra de X às 15h" / "anota: X" (sem gastar o Claude)
    const multi = /\s(e|depois)\s+(me\s+)?(lembr|anot|cri|abr|marc|coloc|adicion)/i.test(text);
    const rm = !multi && /^(me\s+)?(lembr|avis|lembrete)/i.test(text) && window.remParse ? window.remParse(text) : null;
    if (rm) {
      const list = await api.remAdd({ text: rm.text, at: rm.at, repeat: rm.repeat }); const r = list[list.length - 1];
      Object.assign(item, { pending: false, r: rm.guess ? 'Coloquei às 9h. Se quiser outro horário, é só me dizer.' : '', feitos: [{ tipo: 'lembrete', id: r.id, texto: r.text, at: r.at, repeat: r.repeat }] });
    } else if (!multi && /^(anot[ae]|nota\s*:)/i.test(text)) {
      const body = text.replace(/^(anot[ae](\s+a[ií])?|nota\s*:)\s*(que\s+)?:?\s*/i, '').trim();
      const n = await api.noteSave({ text: body.charAt(0).toUpperCase() + body.slice(1) });
      Object.assign(item, { pending: false, feitos: [{ tipo: 'nota', id: n.id, texto: body.split('\n')[0].slice(0, 80) }] });
    } else {
      setState('working', 'Entendendo…');
      const res = await api.assist(text);
      if (res.engine) { S.engine = res.engine; renderEngine(); }
      S.demands = res.demands; refresh();
      Object.assign(item, { pending: false, r: res.resposta, feitos: res.feitos, warnings: res.warnings });
      for (const a of res.ui || []) {
        if (a.tipo === 'foco') { setFocusMinutes(Math.max(5, Math.min(120, +a.minutos || S.settings.focusMinutes || 25))); toggleFocus(); item.feitos.push({ tipo: 'foco', texto: `Foco de ${F.total / 60} min começou` }); }
        if (a.tipo === 'abrir') { const t = ['demandas', 'config', 'foco', 'home', 'chat'].includes(a.aba) ? a.aba : 't:' + a.aba; setTimeout(() => go(t), 400); }
        if (a.tipo === 'gravar') { go('t:reuniao'); window.meetStartWith && window.meetStartWith(a.titulo || ''); }
        if (a.tipo === 'lembrete_sem_hora') { item.r = (item.r ? item.r + '\n\n' : '') + `Para quando é o lembrete "${a.texto}"?`; window.remPrefill && setTimeout(() => window.remPrefill(a.texto + ' '), 600); }
        if (a.tipo === 'copiloto') { item.r = item.r || 'Mandei pro Copiloto.'; setTimeout(() => toCopiloto(text), 300); }
        if (a.tipo === 'geral') { item.r = item.r || 'Abrindo no Assistente.'; const g = await geralSession(); setTimeout(async () => { go('chat'); await openSession(g.id); send(text, g.id); }, 300); }
      }
      setState(item.feitos.length ? 'seen' : 'idle', item.feitos.length ? 'Feito!' : undefined);
    }
  } catch (e) {
    Object.assign(item, { pending: false, r: '', warnings: [String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')] });
    setState('error', 'Não consegui fazer isso');
  }
  renderFeed();
}
window.assistSend = assistSend;
(() => {
  const ta = $('#homeInput');
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); assistSend(ta.value); } });
  $('#homeSend').addEventListener('click', () => assistSend(ta.value));
})();
function renderEngine() {
  const e = S.engine || {}, b = $('#engBadge'); if (!b) return;
  const haiku = e.jev && e.jev !== 'ok';
  b.textContent = haiku ? fastName() : `JEV + ${aiName()}`;
  b.className = 'eng' + (haiku ? ' haiku' : '');
  b.title = haiku ? `${e.reason || ''} Classificação e prioridade estão com o ${fastName()} (seu plano).`.trim() : `O JEV classifica e prioriza; o ${aiName()} escreve.`;
  const st = $('#cfgEngineSt'); if (st) st.textContent = e.jev === 'ok' ? 'JEV funcionando.' : e.jev === 'down' ? `${e.reason} Tento o JEV de novo às ${new Date(e.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` : e.reason || '';
}
api.onEngine((e) => { const was = S.engine && S.engine.jev; S.engine = e; renderEngine(); if (was === 'ok' && e.jev === 'down') setState('error', `${e.reason} Sigo com o ${fastName()}.`); });

api.onSessions((list) => {
  S.sessions = list;
  renderSessList(); updateFace();
  if (cur && !list.find(s => s.id === cur)) { cur = null; openSession(pickDefault()); return; }
  if (tab === 'chat' && !$('.ttl-in') && document.activeElement?.id !== 'sessModel') renderSessHead();
  markSeen();
});
api.onStatus(({ sessionId, stage }) => { (LIVE[sessionId] ||= { text: '' }).stage = stage; if (sessionId === cur) renderLive(); });
api.onClassified(({ sessionId, cls, added, demands, warnings }) => {
  S.demands = demands; renderBar(); renderTop(); if (tab === 'demandas') renderDemands();
  const m = { role: 'meta', cls, added, warnings };
  if (FULL[sessionId]) FULL[sessionId].push(m);
  if (sessionId === cur) { const live = $('#live'); if (live) live.before(clsEl(m)); scrollChat(); }
});
api.onStart(({ sessionId }) => { const L = (LIVE[sessionId] ||= {}); L.streaming = true; L.text = ''; if (sessionId === cur) renderLive(); });
api.onDelta(({ sessionId, text }) => { const L = LIVE[sessionId]; if (!L) return; L.text += text; if (sessionId === cur) renderLive(); });
api.onDone(({ sessionId, msg }) => { delete LIVE[sessionId]; if (FULL[sessionId]) FULL[sessionId].push(msg); if (sessionId === cur) { renderChat(); markSeen(); } });
api.onError(({ sessionId, error }) => { delete LIVE[sessionId]; if (FULL[sessionId]) FULL[sessionId].push({ role: 'error', text: error }); if (sessionId === cur) { renderChat(); markSeen(); } });
document.addEventListener('ilha-err', (e) => showError('Erro interno: ' + e.detail));
function showError(error) {
  const e = document.createElement('div'); e.className = 'err'; e.textContent = error;
  $('#chat').appendChild(e); scrollChat();
  setState('error', 'Opa: veja a mensagem');
}

// nova sessão
const NS = { kind: 'nip', model: 'haiku' };
function segWire(sel, key) { $$(sel + ' button').forEach(b => b.addEventListener('click', () => { NS[key] = b.dataset.v; $$(sel + ' button').forEach(x => x.classList.toggle('on', x === b)); })); }
segWire('#nsKind', 'kind'); segWire('#nsModel', 'model');
function openNewSess(kind) {
  NS.kind = kind || 'geral'; NS.model = 'haiku'; $('#nsTitle').value = '';
  $$('#nsKind button').forEach(x => x.classList.toggle('on', x.dataset.v === NS.kind));
  $$('#nsModel button').forEach(x => x.classList.toggle('on', x.dataset.v === NS.model));
  $('#newSess').hidden = false; setTimeout(() => $('#nsTitle').focus(), 30);
}
$('#newSessBtn').addEventListener('click', () => openNewSess('geral'));
$('#nsCancel').addEventListener('click', () => { $('#newSess').hidden = true; });
$('#newSess').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = await api.createSession({ title: $('#nsTitle').value, kind: NS.kind, model: NS.model });
  $('#newSess').hidden = true;
  S.sessions = await api.listSessions();
  await openSession(s.id);
});

// ---------- demandas ----------
// é minha? (mesma regra do main/profile.js: nome do perfil, aceitando nome parecido)
const _n = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function _lev(a, b) { let p = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[b.length]; }
function isMineD(d) {
  const w = _n(d.responsavel); if (!w || ['eu', 'mim', 'me', 'eu mesmo', 'eu mesma'].includes(w)) return true;
  const mine = _n(S.profile && S.profile.nome); if (!mine) return true;
  const A = w.split(' ').filter(t => t.length >= 3), B = mine.split(' ').filter(t => t.length >= 3);
  return A.some(a => B.some(b => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) || 1 - _lev(a, b) / Math.max(a.length, b.length) >= 0.66));
}
window.isMineD = isMineD;
const OPEN_DEM = new Set();
let showOthers = false;
function renderDemands() {
  const box = $('#demList');
  if (!S.demands.length) { box.innerHTML = `<div class="dem-empty">Lista vazia. As demandas aparecem aqui quando você manda algo no Copiloto, ou adicione à mão aí em cima.</div>`; return; }
  const groups = [...ORDER, 'feito'];
  box.innerHTML = groups.map(g => {
    const items = sortDemands(S.demands.filter(d => isMineD(d) && (g === 'feito' ? d.status === 'feito' : d.status !== 'feito' && d.prioridade === g)));
    if (!items.length) return '';
    const p = PRIO[g] || { label: 'Feitas', c: 'var(--green)' };
    return `<div><div class="grp-h" style="--c:${p.c}">${p.label} <span class="n">${items.length}</span></div>${items.map(itemHTML).join('')}</div>`;
  }).join('');
  const others = sortDemands(S.demands.filter(d => !isMineD(d) && d.status !== 'feito'));
  if (others.length) box.innerHTML += `<div class="others"><button type="button" class="grp-h others-h" id="othersTgl" style="--c:var(--faint)"><svg class="dchev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>De outras pessoas (só acompanhar) <span class="n">${others.length}</span></button>${showOthers ? others.map(itemHTML).join('') : ''}</div>`;
  const ot = $('#othersTgl'); if (ot) { ot.classList.toggle('open', showOthers); ot.addEventListener('click', () => { showOthers = !showOthers; renderDemands(); }); }
  $$('.ditem', box).forEach(el => {
    const id = el.dataset.id; const d = S.demands.find(x => x.id === id);
    el.querySelector('.check').addEventListener('click', async () => { S.demands = await api.updateDemand(id, { status: d.status === 'feito' ? 'aberta' : 'feito' }); refresh(); });
    el.querySelector('select').addEventListener('change', async (e) => { S.demands = await api.updateDemand(id, { prioridade: e.target.value }); refresh(); });
    el.querySelector('[data-a="ask"]').addEventListener('click', async () => { go('chat'); await openSession(nipSession().id); prefill('#chatInput', `Sobre a demanda "${d.titulo}" (${d.quem})${d.descricao ? ` — ${d.descricao}` : ''}${d.obs ? `\nObservações: ${d.obs}` : ''}\n`); });
    el.querySelector('[data-a="focus"]').addEventListener('click', () => { go('foco'); $('#focusDemand').value = id; });
    el.querySelector('[data-a="del"]').addEventListener('click', async () => { S.demands = await api.removeDemand(id); refresh(); });
    const box2 = el.querySelector('.ddesc');
    el.querySelector('.dtoggle').addEventListener('click', () => { box2.hidden = !box2.hidden; el.classList.toggle('open', !box2.hidden); OPEN_DEM[box2.hidden ? 'delete' : 'add'](id); });
    if (OPEN_DEM.has(id)) { box2.hidden = false; el.classList.add('open'); }
    const save = async (patch) => { S.demands = await api.updateDemand(id, patch); renderTop(); };
    el.querySelectorAll('.df').forEach(f => f.addEventListener('change', async () => {
      await save({ [f.dataset.f]: f.value.trim() });
      const m = el.querySelector('.dsaved'); m.textContent = 'Salvo'; setTimeout(() => { m.textContent = ''; }, 1500);
      if (['titulo', 'quem', 'prazo', 'proximo_passo', 'responsavel'].includes(f.dataset.f)) { renderDemands(); renderTop(); renderBar(); }
    }));
  });
}
function itemHTML(d) {
  const p = PRIO[d.prioridade] || PRIO.semana;
  const opts = Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${k === d.prioridade ? 'selected' : ''}>${v.label}</option>`).join('');
  return `<div class="ditem ${d.status === 'feito' ? 'done' : ''}" data-id="${d.id}">
    <button class="check" title="Marcar como feita"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button>
    <div class="dmain"><button type="button" class="t dtoggle" title="Ver o que é esta demanda">${esc(d.titulo)}<svg class="dchev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
      <div class="meta"><span class="tag" style="color:${p.c}">${p.label}</span>${d.quem ? `<span class="tag">${esc(d.quem)}</span>` : ''}${FRENTE[d.frente] ? `<span class="tag">${esc(FRENTE[d.frente])}</span>` : ''}${d.esforco ? `<span class="tag">${esc(d.esforco)}</span>` : ''}${d.prazo ? `<span class="tag">prazo: ${esc(d.prazo)}</span>` : ''}${d.e_meu === 'origem' ? `<span class="tag" style="color:var(--purple)">de outra pessoa/área</span>` : ''}</div>
      ${d.descricao ? `<div class="dsum">${esc(d.descricao)}</div>` : ''}${d.obs ? `<div class="dobs">${IC.note}<span>${esc(d.obs)}</span></div>` : ''}
      ${d.proximo_passo ? `<div class="nx">→ ${esc(d.proximo_passo)}</div>` : ''}
      <div class="ddesc" hidden>
        <div class="dgrid"><div><label class="lbl">Título</label><input class="df" data-f="titulo" value="${esc(d.titulo || '')}"></div>
          <div><label class="lbl">Quem pediu</label><input class="df" data-f="quem" value="${esc(d.quem || '')}"></div>
          <div><label class="lbl">Quem faz</label><input class="df" data-f="responsavel" value="${esc(d.responsavel || 'Eu')}" title="Se não for você, a demanda vai para 'De outras pessoas'"></div>
          <div><label class="lbl">Prazo</label><input class="df" data-f="prazo" value="${esc(d.prazo || '')}" placeholder="ex.: sexta, 10/12"></div></div>
        <label class="lbl">O que é</label>
        <textarea class="df" data-f="descricao" rows="3" placeholder="Explique o que é esta demanda, para que serve e o que precisa entregar…">${esc(d.descricao || '')}</textarea>
        ${d.origem ? `<label class="lbl">Pedido original</label><blockquote class="dorig">${esc(d.origem)}</blockquote>` : ''}
        <div class="row"><label class="lbl">Próximo passo</label><input class="df" data-f="proximo_passo" value="${esc(d.proximo_passo || '')}" placeholder="O que fazer primeiro"></div>
        <label class="lbl">Observações <span class="muted">suas anotações, links, combinados…</span></label>
        <textarea class="df" data-f="obs" rows="3" placeholder="Ex.: falei com a Ana, ela quer em PDF; o arquivo está na pasta X">${esc(d.obs || '')}</textarea>
        <span class="muted dsaved"></span>
      </div>
    </div>
    <div class="act"><select title="Prioridade">${opts}</select>
      <button class="mini" data-a="ask" title="Perguntar ao Copiloto"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg></button>
      <button class="mini" data-a="focus" title="Focar nisso"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l2 2"/></svg></button>
      <button class="mini" data-a="del" title="Remover"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
    </div></div>`;
}
$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('#addTitle').value.trim(); if (!t) return;
  S.demands = await api.addDemand({ titulo: t, prioridade: $('#addPrio').value, quem: 'Eu', esforco: 'M' });
  $('#addTitle').value = ''; refresh();
});
$('#clearDone').addEventListener('click', async () => { S.demands = await api.clearDone(); refresh(); });
function refresh() { renderBar(); renderTop(); if (tab === 'demandas') renderDemands(); renderFocusSelect(); }

// ---------- foco ----------
const F = { total: 25 * 60, left: 25 * 60, running: false, t: null };
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
function renderFocus() {
  $('#focusTime').textContent = fmt(F.left);
  $('#tfBig').textContent = fmt(F.left);
  $('#focusPrg').style.strokeDashoffset = String(326.7 * (1 - F.left / F.total));
  $('#focusState').textContent = F.running ? 'focando' : F.left < F.total ? 'pausado' : 'pronto';
  $('#focusStart').textContent = F.running ? 'Pausar' : F.left < F.total ? 'Continuar' : 'Começar';
  const dsel = S.demands.find(d => d.id === $('#focusDemand').value);
  $('#tfSub').textContent = F.running ? (dsel ? dsel.titulo : `${Math.ceil(F.left / 60)} min restantes`) : 'Um toque e começa';
  $('.t-foco').classList.toggle('running', F.running);
  $('#tfPlay').innerHTML = F.running ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const bt = $('#barTimer'); bt.hidden = !F.running && F.left === F.total; bt.textContent = fmt(F.left);
  const c = (S.meta.focusDay === today() ? S.meta.focusCount : 0) || 0;
  $('#focusCount').textContent = `${c} bloco${c === 1 ? '' : 's'} de foco hoje`;
}
function toggleFocus() {
  if (F.running) { clearInterval(F.t); F.running = false; renderFocus(); return; }
  F.running = true;
  F.t = setInterval(async () => {
    F.left--;
    if (F.left <= 0) {
      clearInterval(F.t); F.running = false; F.left = F.total;
      const c = (S.meta.focusDay === today() ? S.meta.focusCount : 0) + 1;
      S.meta = await api.setMeta({ focusDay: today(), focusCount: c });
      api.notify('Bloco de foco concluído', 'Levanta, toma uma água. Depois marca o que avançou.');
    }
    renderFocus();
  }, 1000);
  renderFocus();
}
function setFocusMinutes(m) { clearInterval(F.t); F.running = false; F.total = F.left = m * 60; renderFocus(); }
$('#focusStart').addEventListener('click', toggleFocus);
$('#focusReset').addEventListener('click', () => setFocusMinutes(F.total / 60));
$$('.presets .chip-btn').forEach(b => b.addEventListener('click', () => setFocusMinutes(+b.dataset.min)));
$('#focusDemand').addEventListener('change', renderFocus);
function renderFocusSelect() {
  const sel = $('#focusDemand'); const cur = sel.value;
  sel.innerHTML = '<option value="">Nada específico</option>' + sortDemands(S.demands.filter(d => d.status !== 'feito')).map(d => `<option value="${d.id}">${esc(d.titulo)}</option>`).join('');
  sel.value = cur;
}

// ---------- prazos importantes (vêm do perfil) ----------
const fmtD = (iso) => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
function renderCiclo() {
  const p = S.profile || {}, now = new Date(); now.setHours(0, 0, 0, 0);
  const list = (p.prazos || []).map(x => ({ ...x, d: new Date(x.data + 'T00:00:00') })).filter(x => !isNaN(x.d)).sort((a, b) => a.d - b.d);
  const fut = list.filter(x => x.d >= now);
  $('#cicloBox').hidden = !list.length && !p.regras;
  $('#timeline').innerHTML = list.map(x => { const dias = Math.ceil((x.d - now) / 864e5); return `<div class="tlc ${dias >= 0 && dias <= 30 ? 'hot' : ''}" style="--c:${dias < 0 ? 'var(--muted)' : dias <= 30 ? 'var(--orange)' : 'var(--blue)'}"><span class="q">${dias < 0 ? 'passou' : dias === 0 ? 'hoje' : `em ${dias} dias`}</span><span class="m">${fmtD(x.data)}</span><p>${esc(x.titulo)}</p></div>`; }).join('');
  $('#ruleCard').hidden = !p.regras; $('#ruleCard').innerHTML = p.regras ? `<strong>Regras e combinados.</strong> ${esc(p.regras)}` : '';
  const prox = fut[0];
  $('#cicloSum').textContent = prox ? `${Math.ceil((prox.d - now) / 864e5)} dias até: ${prox.titulo}` : '';
  if ($('#tcyBig')) { $('#tcyBig').textContent = prox ? `${Math.ceil((prox.d - now) / 864e5)} dias` : '—'; $('#tcySub').textContent = prox ? prox.titulo : ''; }
}

// ---------- perfil ----------
function fillProfile() {
  const p = S.profile || {};
  $('#pfNome').value = p.nome || ''; $('#pfCargo').value = p.cargo || ''; $('#pfEmpresa').value = p.empresa || ''; $('#pfTermos').value = p.termos || '';
  $('#pfSobre').value = p.sobre || ''; $('#pfRegras').value = p.regras || '';
  $('#pfPessoas').value = (p.pessoas || []).map(x => x.papel ? `${x.nome} — ${x.papel}` : x.nome).join('\n');
  $('#pfFrentes').value = (p.frentes || []).map(x => x.desc ? `${x.nome} — ${x.desc}` : x.nome).join('\n');
  $('#pfPrazos').value = (p.prazos || []).map(x => `${fmtD(x.data)} — ${x.titulo}`).join('\n');
}
const splitLine = (l) => { const m = l.split(/\s+[—–-]\s+|\s*:\s+/); return [m[0].trim(), m.slice(1).join(' — ').trim()]; };
async function saveProfile() {
  const old = S.profile || {};
  const frentes = $('#pfFrentes').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [nome, desc] = splitLine(l); const prev = (old.frentes || []).find(f => f.nome.toLowerCase() === nome.toLowerCase());
    return { id: prev ? prev.id : undefined, nome, desc };
  });
  const prazos = $('#pfPrazos').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[—–:-]?\s*(.*)$/); if (!m) return null;
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear());
    return { data: `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, titulo: m[4] || 'Prazo' };
  }).filter(Boolean);
  S.profile = await api.profileSave({
    nome: $('#pfNome').value, cargo: $('#pfCargo').value, empresa: $('#pfEmpresa').value, termos: $('#pfTermos').value, sobre: $('#pfSobre').value, regras: $('#pfRegras').value,
    pessoas: $('#pfPessoas').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [nome, papel] = splitLine(l); return { nome, papel }; }),
    frentes, prazos,
  });
  fillProfile(); renderCiclo(); renderModes('#homeModes', '#homeInput');
  renderSetup();
  $('#pfMsg').textContent = 'Perfil salvo.'; setTimeout(() => { $('#pfMsg').textContent = ''; }, 3000);
}
$('#pfSave').addEventListener('click', saveProfile);

// ---------- config ----------
function fillCfg() {
  const s = S.settings;
  $('#cfgJev').value = S.hasJev ? '••••' : '';
  $('#cfgGh').value = S.hasGh ? '••••' : '';
  renderVersion();
  $('#cfgJevModel').value = s.jevModel || 'jev-latest';
  $('#cfgEngine').value = s.engine === 'haiku' ? 'haiku' : 'auto';
  $('#cfgWrite').value = ['haiku', 'sonnet', 'opus'].includes(s.writeModel) ? s.writeModel : 'haiku';
  $('#cfgClaudePath').value = s.claudePath || '';
  $('#cfgAi').value = s.ai === 'chatgpt' ? 'chatgpt' : 'claude';
  $('#cfgCodexPath').value = s.codexPath || '';
  const cm = s.codexModels || {}; $('#cfgGptFast').value = cm.haiku || ''; $('#cfgGptMid').value = cm.sonnet || ''; $('#cfgGptStrong').value = cm.opus || '';
  applyAiLabels();
  $('#cfgAuto').checked = !!s.autostart; $('#cfgBlur').checked = !!s.collapseOnBlur;
  $('#cfgDrag').checked = s.dragDetect !== false; $('#cfgGlass').checked = !!s.glassNative;
  $('#cfgTheme').value = s.theme || 'claro';
  document.body.classList.toggle('acrylic', !!s.glassNative);
  $('#cfgFocus').value = s.focusMinutes || 25;
  const vm = S.voiceModels || {};
  $('#cfgVoiceModel').innerHTML = Object.entries(vm).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#cfgVoiceModel').value = s.voiceModel || 'small';
  $('#cfgVoiceSend').checked = s.voiceAutoSend !== false;
  fillProfile();
  $('#cfgVoiceKeep').checked = !!s.voiceKeep;
  const ram = () => { const m = vm[$('#cfgVoiceModel').value] || {}; $('#cfgVoiceRam').textContent = m.ram ? `(usa ${m.ram} de memória o tempo todo)` : ''; };
  ram(); $('#cfgVoiceModel').onchange = null; $('#cfgVoiceModel').addEventListener('input', ram);
  refreshVoice();
}
$('#cfgForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api.saveSettings({
    jevKey: $('#cfgJev').value, ghToken: $('#cfgGh').value, jevModel: $('#cfgJevModel').value.trim() || 'jev-latest', engine: $('#cfgEngine').value, writeModel: $('#cfgWrite').value,
    claudePath: $('#cfgClaudePath').value.trim(), ai: $('#cfgAi').value, codexPath: $('#cfgCodexPath').value.trim(),
    codexModels: { haiku: $('#cfgGptFast').value.trim(), sonnet: $('#cfgGptMid').value.trim(), opus: $('#cfgGptStrong').value.trim() },
    voiceModel: $('#cfgVoiceModel').value || 'small', voiceAutoSend: $('#cfgVoiceSend').checked, voiceKeep: $('#cfgVoiceKeep').checked,
    autostart: $('#cfgAuto').checked, collapseOnBlur: $('#cfgBlur').checked, dragDetect: $('#cfgDrag').checked, glassNative: $('#cfgGlass').checked, theme: $('#cfgTheme').value, focusMinutes: Math.max(5, Math.min(120, +$('#cfgFocus').value || 25)),
  });
  S.settings = r.settings; S.hasJev = r.hasJev; S.hasGh = r.hasGh; if (r.engine) S.engine = r.engine; fillCfg(); renderEngine(); applyTheme();
  if (!F.running) setFocusMinutes(S.settings.focusMinutes);
  $('#cfgMsg').textContent = r.hasJev ? 'Salvo.' : `Salvo. Sem a chave do JEV, o ${fastName()} classifica e prioriza.`; renderSetup(); renderSessHead();
  if (state === 'error') setState('idle');
  setTimeout(() => $('#cfgMsg').textContent = '', 3500);
});
$('#testBtn').addEventListener('click', async () => {
  const out = $('#testOut'); out.hidden = false; out.innerHTML = `<span class="muted">Testando… o ${aiName()} pode levar alguns segundos.</span>`;
  $('#testBtn').disabled = true;
  const r = await api.testEngine();
  $('#testBtn').disabled = false;
  const line = (n, x) => `<div><strong>${n}:</strong> <span class="${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '✗'} ${esc(x.msg)}</span>${x.bin ? ` <span class="muted">(${esc(x.bin)})</span>` : ''}</div>`;
  out.innerHTML = line(r.ai || 'Claude Code', r.claude) + line('JEV', r.jev);
  if (r.limit) renderLimit(r.limit);
});
function renderLimit(l) {
  if (!l) return;
  const when = l.resetsAt ? new Date(l.resetsAt * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const janela = { five_hour: 'janela de 5h', seven_day: 'semana', seven_day_opus: 'semana (Opus)' }[l.rateLimitType] || 'plano';
  const ok = l.status === 'allowed' || l.status === 'allowed_warning';
  $('#limitTxt').innerHTML = ok
    ? `Limite do plano: <span class="ok">${l.status === 'allowed_warning' ? 'perto do fim' : 'ok'}</span> · ${janela}${when ? ' · renova ' + when : ''}`
    : `Limite do plano: <span class="bad">atingido</span> · volta ${when}`;
  S.limitBlocked = ok ? null : `Limite até ${when}`;
  renderBar();
}
api.onLimit(renderLimit);
$('#openConsole').addEventListener('click', () => api.openExternal('https://console.typesafe.ai/keys'));
$('#openGh').addEventListener('click', () => api.openExternal('https://github.com/settings/personal-access-tokens/new'));
function renderVersion() {
  const b = S.boot || {}; const u = b.update || {};
  const st = { updated: `atualizou agora (era ${u.from})`, current: 'em dia', 'no-token': 'repositório privado: cole um token do GitHub abaixo para receber atualizações', error: `não conferiu: ${u.error}`, 'needs-reinstall': `a v${u.version} exige baixar o instalador de novo`, skipped: '' }[u.status] || '';
  $('#verTxt').textContent = `v${b.version || '?'}${st ? ' · ' + st : ''}`;
}
$('#updBtn').addEventListener('click', async () => {
  const bt = $('#updBtn'); bt.disabled = true; bt.textContent = 'Procurando…';
  const r = await api.checkUpdate();
  bt.disabled = false;
  if (r.status === 'updated') { bt.textContent = 'Reiniciar agora'; bt.onclick = () => api.relaunch(); bt.classList.add('primary'); }
  else { bt.textContent = 'Procurar atualização'; S.boot = { ...S.boot, update: r.status === 'current' ? { status: 'current' } : r }; renderVersion(); }
});
function showUpdateChip(r) { S.updateReady = r; renderBar(); }
api.onUpdateReady(showUpdateChip);
$('#clearChat').addEventListener('click', async () => { if (cur) { await api.clearSession(cur); FULL[cur] = []; renderChat(); } });
$('#quitApp').addEventListener('click', () => api.quit());
$('#openData').addEventListener('click', () => api.openData());

// ---------- configurações: submenu + primeiros passos ----------
let cfgLock = 0;
const cfgMark = (id) => $$('#cfgNav [data-sec]').forEach(b => { const on = b.dataset.sec === id; b.classList.toggle('on', on); if (on && b.parentElement.scrollWidth > b.parentElement.clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
$$('#cfgNav [data-sec]').forEach(b => b.addEventListener('click', () => { cfgLock = Date.now() + 900; cfgMark(b.dataset.sec); document.getElementById(b.dataset.sec).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
(() => {
  const body = $('#cfgBody');
  const spy = () => {
    if (Date.now() < cfgLock) return;
    const secs = $$('.cfg-sec', body); let on = secs[0];
    for (const x of secs) if (x.offsetTop - body.offsetTop - body.scrollTop <= 40) on = x;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) on = secs[secs.length - 1];
    if (!on.classList.contains('_on')) { $$('.cfg-sec', body).forEach(x => x.classList.toggle('_on', x === on)); cfgMark(on.id); }
  };
  body.addEventListener('scroll', spy, { passive: true });
})();
const INSTALL_CMD = 'irm https://claude.ai/install.ps1 | iex';
const GPT_INSTALL_CMD = 'irm https://chatgpt.com/codex/install.ps1 | iex';
$('#cfgAi').addEventListener('input', syncAiFields);
// escolher a IA nos Primeiros passos salva na hora
async function pickAi(v) {
  const r = await api.saveSettings({ ai: v });
  S.settings = r.settings; if (r.engine) S.engine = r.engine; fillCfg(); renderEngine(); renderSessHead(); renderSetup();
}
async function renderSetup() {
  const box = $('#setupList'); if (!box) return;
  let st; try { st = await api.setupStatus(); } catch { return; }
  const ok = (b) => b ? '<span class="st ok">✓</span>' : '<span class="st todo"></span>';
  const items = [
    { done: st.profile, t: 'Diga quem você é', d: 'Seu nome e com quem trabalha. É assim que o Bit sabe quais demandas são suas.', a: '<button class="btn sm" type="button" data-go-sec="cs-prof">Preencher</button>' },
    aiStep(st),
    { skip: true, done: st.claude === 'ok', t: 'Conectar o Claude', d: st.claude === 'missing' ? `Instale o Claude Code: abra o <b>PowerShell</b>, cole <code>${INSTALL_CMD}</code> e aperte Enter. Depois digite <code>claude</code> e entre com a sua conta do Claude.` : st.claude === 'login' ? 'O Claude Code está instalado. Abra o PowerShell, digite <code>claude</code> e entre com a sua conta do Claude (uma vez só).' : 'Pronto: o Bit usa o seu plano do Claude.', a: st.claude === 'missing' ? `<button class="btn sm" type="button" data-copy="${esc(INSTALL_CMD)}">Copiar comando</button>` : st.claude === 'login' ? '<button class="btn sm" type="button" data-copy="claude">Copiar "claude"</button>' : '<button class="btn sm" type="button" data-test>Testar</button>' },
    { done: st.voice, opt: true, t: 'Falar com o Bit (voz)', d: 'Baixa o Whisper (grátis, roda no seu PC) para ditar e transcrever reuniões.', a: '<button class="btn sm" type="button" data-go-sec="cs-voice">Configurar</button>' },
    { done: st.calendars > 0, opt: true, t: 'Conectar sua agenda', d: 'Reuniões do Outlook ou do Google no Bit, com aviso antes de começar.', a: '<button class="btn sm" type="button" data-agenda>Conectar</button>' },
    { done: st.jev, opt: true, t: 'Chave do JEV', d: `Classificação extra das demandas. Sem ela, o ${fastName()} faz esse trabalho.`, a: '<button class="btn sm" type="button" data-go-sec="cs-ai">Colocar chave</button>' },
  ];
  const list = items.filter(i => !i.skip);
  const need = list.filter(i => !i.opt && !i.done).length;
  box.innerHTML = `<div class="setup-sum ${need ? '' : 'ok'}">${need ? `${need > 1 ? `Faltam <b>${need}</b> passos obrigatórios.` : 'Falta <b>1</b> passo obrigatório.'}` : 'Tudo pronto para usar. Os opcionais você faz quando quiser.'}</div>` +
    list.map(i => `<div class="setup-it ${i.done ? 'done' : ''}">${ok(i.done)}<div class="si-b"><b>${i.t}${i.opt ? ' <small>opcional</small>' : ''}</b><span>${i.d}</span></div>${i.done && i.opt ? '' : i.a}</div>`).join('');
  box.querySelectorAll('[data-go-sec]').forEach(b => b.addEventListener('click', () => document.getElementById(b.dataset.goSec).scrollIntoView({ behavior: 'smooth' })));
  box.querySelectorAll('[data-pick-ai]').forEach(b => b.addEventListener('click', () => pickAi(b.dataset.pickAi)));
  box.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', (e) => copy(b.dataset.copy, e.currentTarget)));
  box.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', () => { $('#testBtn').click(); document.getElementById('cs-ai').scrollIntoView({ behavior: 'smooth' }); }));
  box.querySelectorAll('[data-agenda]').forEach(b => b.addEventListener('click', () => { go('t:agenda'); setTimeout(() => { const c = $('#agCfg'); if (c && c.hidden) $('#agCfgBtn').click(); }, 150); }));
  const nb = $('#cfgBtn'); if (nb) nb.classList.toggle('needs', need > 0);
}
window.renderSetup = renderSetup;
// passo "Escolha a sua IA": Claude ou ChatGPT, e como conectar a escolhida
function aiStep(st) {
  const g = st.ai === 'chatgpt';
  const pick = `<span class="ai-pick"><button class="btn sm ${g ? '' : 'primary'}" type="button" data-pick-ai="claude">Claude</button><button class="btn sm ${g ? 'primary' : ''}" type="button" data-pick-ai="chatgpt">ChatGPT</button></span>`;
  const s = g ? st.chatgpt : st.claude;
  const d = g
    ? (s === 'missing' ? `Instale o Codex (o ChatGPT no PC): abra o <b>PowerShell</b>, cole <code>${GPT_INSTALL_CMD}</code> e aperte Enter. Depois feche e abra o PowerShell, digite <code>codex login</code> e entre com a sua conta do ChatGPT.`
      : s === 'login' ? 'O Codex está instalado. Abra o PowerShell, digite <code>codex login</code> e entre com a sua conta do ChatGPT (uma vez só).' : 'Pronto: o Bit usa o seu plano do ChatGPT.')
    : (s === 'missing' ? `Instale o Claude Code: abra o <b>PowerShell</b>, cole <code>${INSTALL_CMD}</code> e aperte Enter. Depois digite <code>claude</code> e entre com a sua conta do Claude.`
      : s === 'login' ? 'O Claude Code está instalado. Abra o PowerShell, digite <code>claude</code> e entre com a sua conta do Claude (uma vez só).' : 'Pronto: o Bit usa o seu plano do Claude.');
  const act = s === 'missing' ? `<button class="btn sm" type="button" data-copy="${esc(g ? GPT_INSTALL_CMD : INSTALL_CMD)}">Copiar comando</button>`
    : s === 'login' ? `<button class="btn sm" type="button" data-copy="${g ? 'codex login' : 'claude'}">Copiar "${g ? 'codex login' : 'claude'}"</button>`
    : '<button class="btn sm" type="button" data-test>Testar</button>';
  return { done: s === 'ok', t: 'Escolha a sua IA e conecte', d: `Use o plano que você já assina. ${pick}<br>${d}`, a: act };
}

// ---------- voz ----------
const V = { rec: null, stream: null, chunks: [], t0: 0, tick: null, target: null, installing: false };
async function refreshVoice() {
  const st = await api.voiceStatus();
  V.ready = !!st.ready;
  $('#voiceTxt').textContent = st.ready ? `✓ pronto · Ctrl+Alt+V para falar` : st.hasBin ? 'falta baixar o modelo' : 'ainda não baixado';
  $('#voiceBtn').hidden = !!st.ready;
  return st;
}
api.onVoiceProgress(({ step, got, total }) => {
  const pc = total ? Math.round((got / total) * 100) : 0;
  $('#voiceBar').hidden = false; $('#voiceFill').style.width = pc + '%';
  const mb = (got / 1048576).toFixed(0);
  const txt = `Baixando ${step === 'modelo' ? 'o modelo de voz' : 'o Whisper'}… ${total ? pc + '%' : mb + ' MB'}`;
  $('#voiceTxt').textContent = txt;
  if (state === 'idle' || state === 'seen' || state === 'working') { $('#barLabel').textContent = txt; }
});
async function installVoice() {
  if (V.installing) return;
  V.installing = true; $('#voiceBtn').disabled = true;
  setState('working', 'Baixando a voz (só 1x)…');
  const r = await api.voiceInstall();
  V.installing = false; $('#voiceBtn').disabled = false; $('#voiceBar').hidden = true;
  if (r.ready) { setState('seen'); $('#barLabel').textContent = 'Voz pronta! Ctrl+Alt+V para falar'; api.notify('Bit', 'Voz pronta! Aperte Ctrl+Alt+V e fale.'); }
  else { setState('error', 'Não baixou a voz'); $('#voiceTxt').textContent = r.error || 'falhou'; }
  refreshVoice();
}
$('#voiceBtn').addEventListener('click', installVoice);
$('#cfgVoiceModel').addEventListener('change', async () => { await api.saveSettings({ voiceModel: $('#cfgVoiceModel').value }); S.settings.voiceModel = $('#cfgVoiceModel').value; refreshVoice(); });

function wavFrom(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2); const v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return buf;
}
async function toWav16k(blob) {
  const ab = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(ab);
  ctx.close();
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const r = await off.startRendering();
  return wavFrom(r.getChannelData(0), 16000);
}
const micBtns = () => $$('.mic');
async function startVoice(target) {
  api.voiceWarm();
  if (V.rec || busy) return;
  const st = await refreshVoice();
  if (!st.ready) { api.expand('config'); go('config'); installVoice(); return; }
  try {
    V.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    setState('error', 'Sem acesso ao microfone');
    showError('O Windows bloqueou o microfone. Abra Configurações > Privacidade > Microfone e libere "Permitir que aplicativos da área de trabalho acessem o microfone".');
    return;
  }
  V.chunks = []; V.target = target || null;
  V.rec = new MediaRecorder(V.stream);
  V.rec.ondataavailable = (e) => e.data.size && V.chunks.push(e.data);
  V.rec.start(250);
  V.t0 = Date.now();
  setState('listening');
  micBtns().forEach(b => b.classList.add('rec'));
  const upd = () => {
    const sec = Math.floor((Date.now() - V.t0) / 1000);
    $('#barLabel').textContent = `Ouvindo… ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · Ctrl+Alt+V para parar`;
    if (sec >= 180) stopVoice();
  };
  upd(); V.tick = setInterval(upd, 500);
}
async function stopVoice() {
  if (!V.rec) return;
  clearInterval(V.tick);
  const rec = V.rec; V.rec = null;
  await new Promise(r => { rec.onstop = r; rec.stop(); });
  V.stream.getTracks().forEach(t => t.stop());
  micBtns().forEach(b => b.classList.remove('rec'));
  const dur = (Date.now() - V.t0) / 1000;
  if (dur < 0.8) { setState('idle'); return; }
  setState('transcribing');
  $('#barLabel').textContent = 'Transcrevendo sua fala…';
  try {
    const wav = await toWav16k(new Blob(V.chunks, { type: V.chunks[0]?.type || 'audio/webm' }));
    const r = await api.transcribe(wav);
    if (r.error) { setState('error', 'Erro na voz'); showError('Voz: ' + r.error); return; }
    const text = (r.text || '').trim();
    if (!text) { setState('idle'); $('#barLabel').textContent = 'Não ouvi nada, tenta de novo'; return; }
    setState('idle');
    const collapsed = $('#island').classList.contains('collapsed');
    if (S.settings.voiceAutoSend !== false) {
      if (!collapsed && tab === 'chat' && V.target !== '#homeInput') { if (curCC) ccSend(text); else send(text, cur || nipSession()?.id); return; }
      // fora do chat (ou com a ilha fechada): o Bit entende e faz
      if (collapsed) api.expand('home'); go('home');
      assistSend(text);
    } else {
      const sel = V.target || (tab === 'chat' ? '#chatInput' : '#homeInput');
      if (collapsed) api.expand(sel === '#chatInput' ? 'chat' : 'home');
      if (sel === '#chatInput') { go('chat'); if (!cur) await openSession(nipSession().id); } else go('home');
      const t = $(sel); t.value = (t.value ? t.value + ' ' : '') + text; t.focus();
    }
  } catch (e) { setState('error', 'Erro na voz'); showError('Voz: ' + e.message); }
}
function toggleVoice(target) { V.rec ? stopVoice() : startVoice(target); }
api.onVoiceToggle(() => toggleVoice());
$$('.mic').forEach(b => b.addEventListener('click', () => toggleVoice(b.closest('.composer').querySelector('textarea').id === 'homeInput' ? '#homeInput' : '#chatInput')));

// ---------- início ----------
(async function init() {
  S = await api.getState();
  mountFaces();
  renderModes('#homeModes', '#homeInput'); renderFeed(); renderEngine();
  F.total = F.left = (S.settings.focusMinutes || 25) * 60;
  setBubblePref(S.meta && S.meta.bubble); applyTheme();
  renderBar(); renderTop(); renderCiclo(); renderFocus(); renderFocusSelect(); fillCfg(); renderSessList(); updateFace();
  cur = pickDefault();
  if (cur) { const full = await api.getSession(cur); FULL[cur] = full ? full.messages : []; renderSessHead(); renderChat(); renderSessList(); }
  if (S.limit) renderLimit(S.limit);
  const h = new Date().getHours();
  const oi = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  if (S.boot?.update?.status === 'updated') setState('seen', `Fui atualizado para v${S.boot.version}!`);
  else setState('seen', S.profile && S.profile.nome ? `${oi}, ${S.profile.nome}!` : `${oi}!`);
  if (!S.settings.setupDone || !(S.profile && S.profile.nome)) { setState('seen', 'Oi! Eu sou o Bit. Me conta quem é você'); go('config'); setTimeout(() => $('#pfNome').focus(), 200); if (!S.settings.setupDone) { const r = await api.saveSettings({ setupDone: true }); S.settings = r.settings; } }
  else {
    if (S.meta.lastMorning !== today() && h >= 6 && h < 12) { setState('seen', 'Bom dia! Despeja o dia aqui'); S.meta = await api.setMeta({ lastMorning: today() }); }
    go('home');
  }
  setInterval(renderCiclo, 60 * 60 * 1000);
  setInterval(renderSessList, 60 * 1000);
})();
