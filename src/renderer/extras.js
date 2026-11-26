// Bit — Agenda + Lembretes, Histórico do copiar e Reescrever texto.
(function () {
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const sod = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dayLabel = (t) => {
    const k = Math.round((sod(t) - sod()) / DAY), d = new Date(t);
    const base = `${WD[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    return k === 0 ? `Hoje · ${base}` : k === 1 ? `Amanhã · ${base}` : k === -1 ? `Ontem · ${base}` : base[0].toUpperCase() + base.slice(1);
  };
  const whenLabel = (t) => {
    const k = Math.round((sod(t) - sod()) / DAY), d = new Date(t);
    const day = k === 0 ? 'hoje' : k === 1 ? 'amanhã' : k > 1 && k < 7 ? WD[d.getDay()] : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    return `${day} às ${hm(t)}`;
  };
  const inMin = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`; };

  // ============ AGENDA ============
  let AG = { events: [], calendars: [], at: 0, alertMin: 5 };
  let showPast = false;
  const calOf = (id) => AG.calendars.find(c => c.id === id) || {};
  const ICON = {
    join: '<svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="12" height="11" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3"/></svg>',
    rec: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8.5L18 7v13.5H6z"/><path d="M9 11h6M9 14.5h6"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    rep: '<svg viewBox="0 0 24 24"><path d="M17 3.5l3 3-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/></svg>',
  };
  // reunião "encerrada" à mão sai da pílula e do Seu dia (fica como passada)
  const ENDED = () => new Set((S.meta && S.meta.agDone) || []);
  const isOver = (e, now = Date.now()) => e.end <= now || ENDED().has(e.id);
  async function endMeeting(id) {
    const ids = [...ENDED()].filter(x => x !== id).slice(-60); ids.push(id);
    S.meta = await api.setMeta({ agDone: ids });
    renderAgenda(); renderToday(); renderTile(); window.renderBar && window.renderBar();
    setState('seen', 'Reunião encerrada');
  }
  window.endMeeting = endMeeting;
  function nextEvent() {
    const now = Date.now(), done = ENDED();
    const live = AG.events.find(e => !e.allDay && e.start <= now && e.end > now && !done.has(e.id));
    const next = AG.events.find(e => !e.allDay && e.start > now && !done.has(e.id));
    return { live, next };
  }
  function renderAgenda() {
    if (!$('#agList')) return;
    const now = Date.now();
    $('#agToday').textContent = dayLabel(now).replace('Hoje · ', '').replace(/^./, c => c.toUpperCase());
    const today = AG.events.filter(e => !e.allDay && sod(e.start) === sod());
    $('#agInfo').textContent = AG.calendars.length ? (today.length ? `${today.length} reuni${today.length > 1 ? 'ões' : 'ão'} hoje` : 'nenhuma reunião hoje') + (AG.at ? ` · atualizado ${hm(AG.at)}` : '') : '';
    if (!AG.calendars.length) {
      $('#agList').innerHTML = `<div class="ag-empty"><b>Conecte sua agenda</b><span class="muted">Suas reuniões do Outlook ou do Google aparecem aqui, na pílula e com aviso antes de começar. É só colar o link do calendário.</span><button class="btn primary" type="button" id="agStart">Conectar agenda</button></div>`;
      $('#agStart').addEventListener('click', () => { $('#agCfg').hidden = false; renderCfg(); });
      return;
    }
    const from = showPast ? sod() - DAY : sod();
    const evs = AG.events.filter(e => e.end > from && e.start < sod() + 8 * DAY);
    const groups = new Map();
    for (const e of evs) { const k = Math.max(sod(e.start), sod(from)); (groups.get(k) || groups.set(k, []).get(k)).push(e); }
    if (!groups.has(sod())) groups.set(sod(), []);
    const keys = [...groups.keys()].sort((a, b) => a - b);
    $('#agList').innerHTML = keys.map(k => {
      const list = groups.get(k).sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
      const rows = list.map(e => {
        const past = isOver(e, now), live = !e.allDay && e.start <= now && !past, soon = !past && !live && e.start - now < 60 * 60000;
        const c = calOf(e.cal);
        return `<div class="ev${live ? ' live' : ''}${past ? ' past' : ''}" data-id="${esc(e.id)}" style="--c:${esc(c.color || '#5b8cff')}">
          <div class="ev-t">${e.allDay ? '<span class="ev-all">dia todo</span>' : `<b>${hm(e.start)}</b><span>${hm(e.end)}</span>`}</div>
          <div class="ev-b"><div class="ev-title">${esc(e.title)}</div>
            <div class="ev-sub">${live ? '<span class="ev-now">agora</span>' : soon ? `<span class="ev-soon">em ${inMin(e.start - now)}</span>` : ''}${e.via ? `<span>${esc(e.via)}</span>` : e.location ? `<span>${esc(e.location)}</span>` : ''}${AG.calendars.length > 1 ? `<span class="muted">${esc(c.name || '')}</span>` : ''}</div></div>
          <div class="ev-acts">${live ? '<button class="btn sm" data-ea="end" type="button" title="A reunião já acabou: tirar da pílula">Encerrar</button>' : ''}${e.link && !past ? `<button class="btn sm ${live || soon ? 'primary' : ''}" data-ea="join" type="button" title="Abrir ${esc(e.via || 'link')}">${ICON.join}Entrar</button>` : ''}${!e.allDay && !past ? `<button class="icon-btn sm" data-ea="rec" type="button" title="Gravar e transcrever esta reunião">${ICON.rec}</button>` : ''}${!e.allDay ? `<button class="icon-btn sm" data-ea="note" type="button" title="Criar nota da reunião">${ICON.note}</button>` : ''}</div>
        </div>`;
      }).join('');
      return `<div class="ag-day"><div class="ag-dh">${esc(dayLabel(k))}</div>${rows || '<div class="muted ag-none">Nada marcado</div>'}</div>`;
    }).join('') + `<button class="link ag-past" type="button" id="agPast">${showPast ? 'Esconder ontem' : 'Ver ontem'}</button>`;
    $('#agPast').addEventListener('click', () => { showPast = !showPast; renderAgenda(); });
    $$('#agList [data-ea]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const e = AG.events.find(x => x.id === b.closest('.ev').dataset.id); if (!e) return;
      if (b.dataset.ea === 'end') { endMeeting(e.id); return; }
      if (b.dataset.ea === 'join') api.agendaJoin(e.link);
      if (b.dataset.ea === 'rec') { go('t:reuniao'); window.meetStartWith && window.meetStartWith(e.title); }
      if (b.dataset.ea === 'note') {
        const txt = `${e.title} — ${new Date(e.start).toLocaleDateString('pt-BR')}\n\nPauta:\n- \n\nDecisões:\n- \n\nPróximos passos:\n- `;
        api.noteSave({ text: txt }).then((n) => { go('t:notas'); window.openNote && window.openNote(n.id); });
      }
    }));
  }
  function renderCfg() {
    const box = $('#agCfg');
    box.innerHTML = `
      ${AG.calendars.map(c => `<div class="cal" data-id="${c.id}"><span class="cdot" style="background:${esc(c.color)}"></span><input class="cal-n" value="${esc(c.name)}"><label class="sw"><input type="checkbox" ${c.on ? 'checked' : ''} data-cc="on"><span>mostrar</span></label>${c.err ? `<span class="cal-err" title="${esc(c.err)}">⚠ ${esc(c.err.slice(0, 60))}</span>` : ''}<span class="grow"></span><button class="link danger" type="button" data-cc="del">Remover</button></div>`).join('')}
      <div class="cal-add">
        <input id="calName" placeholder="Nome (ex.: Trabalho)" autocomplete="off">
        <input id="calUrl" placeholder="Cole o link ICS do calendário (https://…​.ics)" autocomplete="off" spellcheck="false">
        <button class="btn primary sm" type="button" id="calAdd">Adicionar</button>
      </div>
      <details class="cal-help"><summary>Como pegar o link</summary>
        <p><b>Outlook (novo ou web):</b> Configurações ⚙ → Calendário → Calendários compartilhados → <i>Publicar um calendário</i> → escolha o calendário e <i>Pode exibir todos os detalhes</i> → Publicar → copie o link <b>ICS</b>. <span class="muted">Se a opção não aparecer, a TI da empresa bloqueou a publicação.</span> <button class="link" type="button" data-ext="https://outlook.office.com/calendar/options/calendar/SharedCalendars">Abrir essa tela</button></p>
        <p><b>Google Agenda:</b> Configurações → clique na agenda → <i>Integrar agenda</i> → copie o <b>Endereço secreto no formato iCal</b>. <button class="link" type="button" data-ext="https://calendar.google.com/calendar/r/settings">Abrir configurações</button></p>
        <p class="muted">O link fica guardado criptografado neste PC. Quem tiver esse link vê sua agenda, então não compartilhe.</p>
      </details>
      <div class="row"><span class="muted">Avisar antes da reunião:</span><div class="segm" id="agAlert">${[[0, 'Não'], [1, '1 min'], [5, '5 min'], [10, '10 min'], [15, '15 min']].map(([v, l]) => `<button type="button" data-v="${v}" class="${AG.alertMin === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    box.querySelectorAll('[data-ext]').forEach(b => b.addEventListener('click', () => api.openExternal(b.dataset.ext)));
    box.querySelectorAll('.cal').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.cal-n').addEventListener('change', (e) => api.agendaUpdCal(id, { name: e.target.value }).then(setAG));
      row.querySelector('[data-cc="on"]').addEventListener('change', (e) => api.agendaUpdCal(id, { on: e.target.checked }).then(setAG));
      row.querySelector('[data-cc="del"]').addEventListener('click', (e) => { const b = e.target; if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Confirmar?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Remover'; } }, 3000); return; } api.agendaDelCal(id).then(setAG); });
    });
    $('#calAdd').addEventListener('click', async () => {
      const b = $('#calAdd'); b.disabled = true; b.textContent = 'Testando…';
      try {
        const r = await api.agendaAddCal({ name: $('#calName').value, url: $('#calUrl').value });
        setState('seen', `Agenda conectada (${r.events} eventos)`);
        setAG(await api.agendaGet()); $('#agCfg').hidden = true;
      } catch (e) { setState('error', errText(e)); b.disabled = false; b.textContent = 'Adicionar'; }
    });
    $$('#agAlert button').forEach(b => b.addEventListener('click', () => api.agendaAlert(+b.dataset.v).then(setAG)));
  }
  const errText = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  function setAG(a) { if (a) AG = a; renderAgenda(); if (!$('#agCfg').hidden) renderCfg(); renderTile(); renderToday(); window.renderBar && window.renderBar(); }
  function renderTile() {
    const big = $('#taBig'), sub = $('#taSub'); if (!big) return;
    if (!AG.calendars.length) { big.textContent = 'Conectar'; sub.textContent = 'Outlook ou Google'; return; }
    const { live, next } = nextEvent(), now = Date.now();
    if (live) { big.textContent = 'Agora'; sub.textContent = live.title; }
    else if (next && sod(next.start) === sod()) { big.textContent = hm(next.start); sub.textContent = `${next.title} · em ${inMin(next.start - now)}`; }
    else { big.textContent = 'Livre'; sub.textContent = next ? `Próxima: ${dayLabel(next.start).split(' · ')[0].toLowerCase()} ${hm(next.start)}` : 'sem reuniões'; }
  }
  $('#agRefresh').addEventListener('click', async () => { const b = $('#agRefresh'); b.classList.add('spin'); try { setAG(await api.agendaRefresh()); } finally { b.classList.remove('spin'); } });
  $('#agCfgBtn').addEventListener('click', () => { $('#agCfg').hidden = !$('#agCfg').hidden; if (!$('#agCfg').hidden) renderCfg(); });
  api.onAgenda(setAG);
  api.onAgendaSoon(() => window.renderBar && window.renderBar());

  // ============ LEMBRETES: entende "amanhã às 10h", "em 20 min", "sexta 15h30", "dia 28 às 9" ============
  const WDN = { domingo: 0, segunda: 1, 'segunda-feira': 1, terca: 2, 'terca-feira': 2, quarta: 3, 'quarta-feira': 3, quinta: 4, 'quinta-feira': 4, sexta: 5, 'sexta-feira': 5, sabado: 6 };
  const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, dez: 10, quinze: 15, vinte: 20, trinta: 30, meia: 0.5 };
  function parseWhen(input, base = new Date()) {
    let s = ' ' + input.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + ' ';
    const cut = [];
    const take = (re) => { const m = s.match(re); if (m) { cut.push(m[0]); s = s.replace(m[0], ' '); } return m; };
    let d = new Date(base), hasDay = false, hasTime = false;
    // relativo: em 20 min / daqui a 2 horas / daqui meia hora
    let m = take(/\b(?:em|daqui(?: a)?|dentro de)\s+(\d+(?:[.,]\d+)?|um|uma|dois|duas|tres|quatro|cinco|dez|quinze|vinte|trinta|meia)\s*(min(?:uto)?s?|h(?:ora)?s?|dias?|semanas?)\b(?:\s+e\s+meia)?/);
    if (m) {
      let n = NUM[m[1]] ?? parseFloat(m[1].replace(',', '.'));
      const u = m[2][0] === 'm' ? 60000 : m[2][0] === 'h' ? 3600000 : m[2][0] === 'd' ? DAY : 7 * DAY;
      if (/e meia/.test(m[0]) && u === 3600000) n += 0.5;
      return { at: base.getTime() + n * u, rest: clean(s) };
    }
    if (take(/\bdepois de amanha\b/)) { d.setDate(d.getDate() + 2); hasDay = true; }
    else if (take(/\bamanha\b/)) { d.setDate(d.getDate() + 1); hasDay = true; }
    else if (take(/\bhoje\b/)) hasDay = true;
    if (!hasDay && (m = take(/\b(?:na |no |nesta |neste |proxima |proximo )?(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/))) {
      const w = WDN[m[1]]; let k = (w - d.getDay() + 7) % 7; if (k === 0) k = 7; d.setDate(d.getDate() + k); hasDay = true;
    }
    if (!hasDay && (m = take(/\b(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      d = new Date(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : d.getFullYear(), +m[2] - 1, +m[1], d.getHours(), d.getMinutes()); hasDay = true;
      if (!m[3] && d.getTime() < sod(base.getTime())) d.setFullYear(d.getFullYear() + 1);
    } else if (!hasDay && (m = take(/\bdia\s+(\d{1,2})\b/))) {
      d.setDate(+m[1]); if (d.getTime() < sod(base.getTime())) d.setMonth(d.getMonth() + 1); hasDay = true;
    }
    // hora: às 15h, 15:30, 15h30, as 9, meio-dia, de manhã/tarde
    if ((m = take(/\b(?:as|a|ao|pelas?)?\s*(\d{1,2})(?::|h)(\d{2})?\s*(?:h|hs|horas?)?\b/)) || (m = take(/\b(?:as|pelas?)\s+(\d{1,2})()\b(?:\s*horas?)?/))) {
      let h = +m[1], mi = +(m[2] || 0);
      if (/\b(da tarde|a tarde|de tarde|da noite|a noite|de noite)\b/.test(s) && h < 12) h += 12;
      take(/\b(da|de|a) (manha|tarde|noite)\b/);
      if (h <= 23 && mi <= 59) { d.setHours(h, mi, 0, 0); hasTime = true; }
    } else if (take(/\bmeio[- ]dia\b/)) { d.setHours(12, 0, 0, 0); hasTime = true; }
    else if ((m = take(/\b(?:de |pela |a )(manha|tarde|noite)\b/))) { d.setHours(m[1] === 'manha' ? 9 : m[1] === 'tarde' ? 14 : 19, 0, 0, 0); hasTime = true; }
    if (!hasDay && !hasTime) return null;
    if (!hasTime) d.setHours(9, 0, 0, 0);
    if (!hasDay && d.getTime() <= base.getTime()) d.setDate(d.getDate() + 1);
    return { at: d.getTime(), rest: clean(s) };
  }
  function clean(s) {
    return s.replace(/^\s*(me\s+)?(lembr[ae]r?|avis[ae]r?)(-me)?\s+(de|que|para|pra)?\s*/i, '').replace(/\s+/g, ' ').trim();
  }
  window.parseWhen = parseWhen; // testes
  const WD_RE = '(domingo|segunda|terca|quarta|quinta|sexta|sabado)s?(?:-feiras?)?';
  const WD_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  // tira a repetição do texto ("todo dia", "dias úteis", "toda segunda e quarta", "todo mês", "a cada 2 horas")
  function parseRepeat(input) {
    let s = ' ' + input.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + ' ';
    let rep = null, m;
    const cut = (re, repl = ' ') => { m = s.match(re); if (m) s = s.replace(m[0], repl); return m; };
    if (cut(/\b(?:a cada|de)\s+(\d+|uma|duas|meia)\s*(min(?:uto)?s?|h(?:ora)?s?)\b(?:\s+em\s+\d+\s*\w+)?/) || cut(/\bde hora em hora\b/)) {
      const n = m[1] ? ({ uma: 1, duas: 2, meia: 0.5 }[m[1]] ?? +m[1]) : 1;
      rep = { k: 'cada', every: Math.round(m[2] && m[2][0] === 'm' ? n : n * 60) };
    } else if (cut(/\b(?:todo dia util|todos os dias uteis|em dias uteis|nos dias uteis|dias uteis|de segunda a sexta(?:-feira)?|de seg a sex)\b/)) rep = { k: 'util' };
    else if ((m = s.match(/\btodo dia (\d{1,2})\b/))) { rep = { k: 'mes' }; s = s.replace(m[0], ` dia ${m[1]} `); }
    else if (cut(/\b(?:todo dia|todos os dias|diariamente)\b/)) rep = { k: 'dia' };
    else if (cut(/\b(toda|todo|todas as|todos os)\s+(manha|tarde|noite)s?\b/, ' de $2 ')) { rep = { k: 'dia' }; s = s.replace(/ de (manha|tarde|noite)s? /, ' de $1 '); }
    else if ((m = s.match(new RegExp(`\\b(?:toda|todas as|todo|todos os|as|nas)\\s+${WD_RE}((?:\\s*(?:,|e)\\s*${WD_RE})*)`)))) {
      const days = [...m[0].matchAll(new RegExp(WD_RE, 'g'))].map(x => WDN[x[1]]);
      if (/\b(toda|todas|todo|todos)\b/.test(m[0]) || days.length > 1) { rep = { k: 'semana', days }; s = s.replace(m[0], ' '); }
    } else if (cut(/\b(?:toda semana|todas as semanas|semanalmente|uma vez por semana)\b/)) rep = { k: 'semana' };
    else if (cut(/\b(?:todo mes|todos os meses|mensalmente)\b/)) rep = { k: 'mes' };
    return rep ? { rep, s: s.replace(/\s+/g, ' ').trim() } : null;
  }
  window.parseRepeat = parseRepeat;
  const repLabel = (rep) => !rep ? '' : rep.k === 'dia' ? 'todo dia' : rep.k === 'util' ? 'dias úteis' : rep.k === 'mes' ? 'todo mês' : rep.k === 'cada' ? `a cada ${rep.every >= 60 ? (rep.every / 60) + 'h' : rep.every + ' min'}` : rep.days && rep.days.length ? 'toda ' + rep.days.map(d => WD_SHORT[d]).join(', ') : 'toda semana';
  window.repLabel = repLabel;
  // o que vem da fala: quando + repetição + texto limpo
  function parseRem(text) {
    const pr = parseRepeat(text);
    let base = pr ? pr.s : text;
    let when = parseWhen(base);
    if (!when && pr && pr.rep.k === 'cada') when = { at: Date.now() + pr.rep.every * 60000, rest: clean(base) };
    if (!when && pr) { const d = new Date(); d.setHours(9, 0, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); when = { at: d.getTime(), rest: clean(base), guess: true }; }
    if (!when) return null;
    if (pr && (pr.rep.k === 'util' || (pr.rep.k === 'semana' && pr.rep.days && pr.rep.days.length))) {
      const ok = (t) => { const g = new Date(t).getDay(); return pr.rep.k === 'util' ? g >= 1 && g <= 5 : pr.rep.days.includes(g); };
      let t = when.at, n = 0; while ((!ok(t) || t <= Date.now()) && n++ < 14) t += DAY; when.at = t;
    }
    const words = (when.rest || '').split(' ').filter(Boolean);
    // recupera os acentos do texto original
    const orig = text.split(/\s+/), norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,!?]$/, '');
    const out = []; let i = 0;
    for (const w of orig) if (i < words.length && norm(w) === words[i].replace(/[.,!?]$/, '')) { out.push(w); i++; }
    const t = (out.join(' ').trim() || when.rest || text);
    return { at: when.at, text: t.charAt(0).toUpperCase() + t.slice(1), repeat: pr ? pr.rep : null, guess: !!when.guess };
  }
  // devolve o texto original sem a parte de data (mantendo acentos)
  function stripWhen(text) {
    const words = text.split(/(\s+)/);
    const pr = parseWhen(text); if (!pr) return text;
    const keep = pr.rest.split(' ').filter(Boolean);
    const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const out = []; let i = 0;
    for (const w of words) { if (!w.trim()) continue; if (i < keep.length && norm(w).replace(/[.,!?]$/, '') === keep[i].replace(/[.,!?]$/, '')) { out.push(w); i++; } }
    const r = out.join(' ').trim() || pr.rest;
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  window.remParse = (t) => parseRem(t);
  let REM = [], remAtManual = false, repManual = false, repParsed = null;
  const toLocalInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const repFromSelect = () => { const v = $('#remRep').value; return v === 'custom' ? repParsed : v ? { k: v } : null; };
  function remPreview() {
    const txt = $('#remText').value.trim();
    const pr = txt ? parseRem(txt) : null;
    if (pr && !remAtManual) $('#remAt').value = toLocalInput(pr.at);
    if (!repManual) {
      repParsed = pr && pr.repeat;
      const c = $('#remRep option[value="custom"]');
      if (repParsed && (repParsed.k === 'cada' || (repParsed.days && repParsed.days.length))) { c.hidden = false; c.textContent = repLabel(repParsed).replace(/^./, x => x.toUpperCase()); $('#remRep').value = 'custom'; }
      else { c.hidden = true; $('#remRep').value = repParsed ? repParsed.k : ''; }
    }
    if (!txt) { $('#remPrev').textContent = ''; if (!remAtManual) $('#remAt').value = ''; return; }
    const at = $('#remAt').value ? new Date($('#remAt').value).getTime() : null, rep = repFromSelect();
    $('#remPrev').textContent = at ? `${rep ? `${repLabel(rep)}, começando ` : ''}${whenLabel(at)}` : 'Quando? Escreva (ex.: amanhã 10h) ou escolha ao lado';
    $('#remPrev').classList.toggle('warn', !at);
  }
  async function remSave() {
    const raw = $('#remText').value.trim(); if (!raw) return;
    const at = $('#remAt').value ? new Date($('#remAt').value).getTime() : null;
    if (!at) { $('#remAt').focus(); setState('error', 'Diga quando (ex.: amanhã às 10h)'); return; }
    const pr = parseRem(raw), rep = repFromSelect();
    const text = pr ? pr.text : (clean(raw) || raw);
    REM = await api.remAdd({ text, at, repeat: rep }); renderToday();
    $('#remText').value = ''; $('#remAt').value = ''; remAtManual = false; repManual = false; $('#remRep').value = ''; remPreview(); renderRem();
    setState('seen', rep ? `Lembro ${repLabel(rep)}` : `Lembro ${whenLabel(at)}`);
  }
  function renderRem() {
    const now = Date.now();
    const due = REM.filter(r => !r.done && r.fired).sort((a, b) => a.at - b.at);
    const next = REM.filter(r => !r.done && !r.fired).sort((a, b) => a.at - b.at);
    const done = REM.filter(r => r.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 5);
    const row = (r, kind) => `<div class="rem ${kind}${r.repeat ? ' serie' : ''}" data-id="${r.id}">${r.repeat ? `<span class="rem-rep-ic" title="Repete">${IC.rep}</span>` : `<button class="rem-ck" type="button" data-ra="done" title="${r.done ? 'Desfazer' : 'Feito'}">${r.done ? ICON.check : ''}</button>`}<div class="rem-b"><div>${esc(r.text)}</div><span class="muted">${kind === 'due' ? `era ${whenLabel(r.at)}` : r.repeat ? `${repLabel(r.repeat)} · próximo ${whenLabel(r.at)}` : whenLabel(r.at)}</span>${kind === 'due' ? '<span class="rem-snz"><button class="btn sm" type="button" data-ra="snz">+10 min</button><button class="btn sm" type="button" data-ra="snz60">+1 hora</button></span>' : ''}</div>${kind !== 'done' && !r.from ? `<button class="mini rem-rb${r.repeat ? ' on' : ''}" type="button" data-ra="rep" title="Repetir">${ICON.rep}</button>` : ''}<button class="mini" type="button" data-ra="del" title="${r.repeat ? 'Parar de repetir e apagar' : 'Apagar'}">${ICON.x}</button></div>`;
    $('#remList').innerHTML = (due.map(r => row(r, 'due')).join('') + next.map(r => row(r, 'next')).join('')) || '<div class="muted rem-empty">Nenhum lembrete. Escreva acima do jeito que você falaria.</div>';
    if (done.length) $('#remList').innerHTML += `<div class="rem-dh"><span class="muted">Feitos</span><button class="link" type="button" id="remClr">limpar</button></div>` + done.map(r => row(r, 'done')).join('');
    $$('#remList [data-ra]').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('.rem').dataset.id, r = REM.find(x => x.id === id), a = b.dataset.ra;
      if (a === 'done') REM = await api.remDone(id, !r.done);
      if (a === 'snz' || a === 'snz60') REM = await api.remSnooze(id, a === 'snz' ? 10 : 60);
      if (a === 'del') REM = await api.remDel(id);
      if (a === 'rep') { repMenu(b, r); return; }
      renderRem(); renderToday(); window.renderBar && window.renderBar();
    }));
    const c = $('#remClr'); if (c) c.addEventListener('click', async () => { REM = await api.remClearDone(); renderRem(); });
    $('#agDot').hidden = !due.length;
    void now;
  }
  function repMenu(anchor, r) {
    document.querySelectorAll('.share-pop').forEach(x => x.remove());
    const pop = document.createElement('div'); pop.className = 'share-pop rep-pop';
    const cur = r.repeat ? r.repeat.k : '';
    pop.innerHTML = [['', 'Não repetir'], ['dia', 'Todo dia'], ['util', 'Dias úteis'], ['semana', `Toda ${WD[new Date(r.at).getDay()]}`], ['mes', `Todo dia ${new Date(r.at).getDate()}`]]
      .map(([k, l]) => `<button type="button" data-k="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('');
    document.body.appendChild(pop);
    const b = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(b.right - 170, innerWidth - 180)) + 'px'; pop.style.top = (b.bottom + 6 + 200 > innerHeight ? b.top - 196 : b.bottom + 6) + 'px';
    pop.querySelectorAll('[data-k]').forEach(x => x.addEventListener('click', async () => {
      pop.remove();
      const k = x.dataset.k, rep = k === 'semana' ? { k, days: [new Date(r.at).getDay()] } : k ? { k } : null;
      REM = await api.remRepeat(r.id, rep); renderRem(); renderToday();
      setState('seen', rep ? `Repete ${repLabel(rep)}` : 'Não repete mais');
    }));
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', off); } }), 0);
  }
  $('#remRep').addEventListener('change', () => { repManual = true; remPreview(); });
  $('#remText').addEventListener('input', remPreview);
  $('#remText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); remSave(); } });
  $('#remAt').addEventListener('input', () => { remAtManual = !!$('#remAt').value; remPreview(); });
  $('#remSave').addEventListener('click', remSave);
  api.onRem((r) => { REM = r; renderRem(); renderToday(); window.renderBar && window.renderBar(); });
  window.remPrefill = (t) => { go('t:agenda'); $('#remText').value = t; remAtManual = false; remPreview(); setTimeout(() => { const i = $('#remText'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 50); };

  // ============ HISTÓRICO DO COPIAR ============
  let CL = { items: [], on: true }, pickMode = false, clipSel = 0;
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'agora' : s < 3600 ? `${Math.floor(s / 60)} min` : s < DAY / 1000 ? `${Math.floor(s / 3600)}h` : new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
  function clipFiltered() {
    const q = $('#clipSearch').value.trim().toLowerCase();
    const list = CL.items.filter(c => !q || c.text.toLowerCase().includes(q));
    return [...list.filter(c => c.pinned), ...list.filter(c => !c.pinned)];
  }
  function renderClip() {
    if (!$('#clipList')) return;
    $('#clipOn').checked = CL.on;
    $('#clipTip').innerHTML = pickMode ? '↑ ↓ para escolher · <b>Enter</b> cola no programa onde você estava · Esc fecha' : `Clique para copiar. Atalho <b>Ctrl+Alt+H</b> abre isso e cola direto onde você estava. Não guarda o que vem do Cofre nem de gerenciadores de senha.`;
    const list = clipFiltered();
    clipSel = Math.min(clipSel, Math.max(0, list.length - 1));
    $('#clipList').innerHTML = list.length ? list.map((c, i) => {
      const t = c.text.replace(/\s+/g, ' ').trim();
      const isUrl = /^https?:\/\/\S+$/.test(t);
      return `<div class="clip${c.pinned ? ' pinned' : ''}${pickMode && i === clipSel ? ' sel' : ''}" data-id="${c.id}" data-i="${i}" title="${esc(c.text.slice(0, 600))}"><div class="clip-t${isUrl ? ' url' : ''}">${esc(t.slice(0, 220))}</div><span class="clip-m muted">${c.text.length > 220 ? `${c.text.length} car. · ` : ''}${ago(c.at)}</span><button class="mini" type="button" data-ca="pin" title="${c.pinned ? 'Desafixar' : 'Fixar'}">${ICON.pin}</button><button class="mini" type="button" data-ca="del" title="Apagar">${ICON.x}</button></div>`;
    }).join('') : `<div class="muted rem-empty">${CL.on ? 'Copie qualquer texto (Ctrl+C) e ele aparece aqui.' : 'O histórico está pausado.'}</div>`;
    $$('#clipList .clip').forEach(el => el.addEventListener('click', async (e) => {
      const id = el.dataset.id, a = e.target.closest('[data-ca]');
      if (a) { e.stopPropagation(); CL = a.dataset.ca === 'pin' ? await api.clipPin(id) : await api.clipDel(id); renderClip(); return; }
      useClip(id);
    }));
    const s = $('#clipList .clip.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  async function useClip(id) {
    if (pickMode) { pickMode = false; const r = await api.clipPaste(id); if (!r.pasted) setState('seen', 'Copiado! Cola com Ctrl+V'); return; }
    await api.clipCopy(id); setState('seen', 'Copiado! Cola com Ctrl+V');
    const el = $(`#clipList .clip[data-id="${id}"]`); if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 600); }
  }
  $('#clipSearch').addEventListener('input', () => { clipSel = 0; renderClip(); });
  $('#clipSearch').addEventListener('keydown', (e) => {
    const list = clipFiltered();
    if (e.key === 'ArrowDown') { e.preventDefault(); pickMode = true; clipSel = Math.min(list.length - 1, clipSel + 1); renderClip(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); pickMode = true; clipSel = Math.max(0, clipSel - 1); renderClip(); }
    if (e.key === 'Enter' && list[clipSel]) { e.preventDefault(); useClip(list[clipSel].id); }
  });
  $('#clipOn').addEventListener('change', async (e) => { CL = await api.clipToggle(e.target.checked); renderClip(); });
  $('#clipClear').addEventListener('click', (e) => {
    const b = e.target; if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Apagar tudo (menos fixados)?'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Limpar'; }, 3000); return; }
    delete b.dataset.armed; b.textContent = 'Limpar'; api.clipClear().then(r => { CL = r; renderClip(); });
  });
  api.onClip(async () => { CL = await api.clipList(); if (window.currentTool && window.currentTool() === 'clip') renderClip(); });
  api.onClipPicker(({ canPaste }) => { pickMode = canPaste; clipSel = 0; $('#clipSearch').value = ''; api.clipList().then(r => { CL = r; renderClip(); setTimeout(() => $('#clipSearch').focus(), 60); }); });

  // ============ REESCREVER TEXTO ============
  let TX = { canPaste: false, busy: false, out: '', opts: { canal: '', tom: 'natural', tam: 'igual' } };
  try { Object.assign(TX.opts, (S.meta && S.meta.txOpts) || {}); } catch {}
  function txSegs() { $$('.tx-opts .segm[data-to]').forEach(g => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === (TX.opts[g.dataset.to] ?? '')))); }
  $$('.tx-opts .segm[data-to] button').forEach(b => b.addEventListener('click', () => {
    TX.opts[b.closest('.segm').dataset.to] = b.dataset.v; txSegs();
    api.setMeta({ txOpts: { canal: TX.opts.canal, tom: TX.opts.tom, tam: TX.opts.tam } });
  }));
  txSegs();
  async function txRun(ajuste) {
    if (TX.busy) return;
    const base = ajuste ? TX.out : $('#txIn').value;
    if (!base.trim()) { $('#txIn').focus(); setState('error', 'Cole o texto para reescrever'); return; }
    TX.busy = true; const prev = TX.out; TX.out = '';
    $('#txOut').hidden = false; $('#txOut').innerHTML = '<span class="muted">Reescrevendo…</span>'; $('#txRes').hidden = true;
    setState('working', 'Reescrevendo…');
    try {
      const opts = { ...TX.opts, who: $('#txWho').value.trim(), goal: $('#txGoal').value.trim(), fix: !ajuste && $('#txFix').checked, ajuste: ajuste || '' };
      const r = await api.selRun({ text: base, opts });
      TX.out = String(r || TX.out).trim();
      $('#txOut').innerHTML = md(TX.out);
      $('#txRes').hidden = false; $('#txPaste').hidden = !TX.canPaste;
      setState('seen', 'Pronto!');
    } catch (e) { TX.out = prev; $('#txOut').innerHTML = `<span class="bad">${esc(errText(e))}</span>`; setState('error', 'Não deu certo'); }
    finally { TX.busy = false; }
  }
  api.onSelDelta((t) => { if (!TX.busy) return; TX.out += t; $('#txOut').innerHTML = md(TX.out); });
  $('#txGo').addEventListener('click', () => txRun());
  $('#txIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); txRun(); } });
  $$('#txRes [data-adj]').forEach(b => b.addEventListener('click', () => txRun(b.dataset.adj)));
  $('#txPaste').addEventListener('click', async () => { const r = await api.selPaste(TX.out); if (!r.pasted) setState('seen', 'Copiado! Cola com Ctrl+V'); });
  $('#txCopy').addEventListener('click', async () => { await navigator.clipboard.writeText(TX.out); setState('seen', 'Copiado!'); });
  api.onSelText(({ text, canPaste }) => {
    TX.canPaste = canPaste; TX.out = '';
    $('#txIn').value = text || '';
    $('#txOut').hidden = true; $('#txRes').hidden = true;
    $('#txHint').textContent = text ? `${text.length} caracteres${canPaste ? ' · dá pra colar o resultado de volta no lugar' : ''}` : 'nada selecionado: cole o texto aqui';
    setTimeout(() => (text ? $('#txWho') : $('#txIn')).focus(), 60);
  });

  // ============ card "Seu dia" no início (atualiza sozinho) ============
  function renderToday() {
    const box = $('#todayList'); if (!box) return;
    const now = Date.now(), end = sod() + DAY;
    $('#todayNow').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).replace(/^./, c => c.toUpperCase());
    const rows = [];
    const evs = AG.events.filter(e => !e.allDay && !isOver(e, now) && e.start < end).slice(0, 3);
    for (const e of evs) {
      const live = e.start <= now;
      rows.push(`<div class="td-row ev-r${live ? ' live' : ''}" data-ev="${esc(e.id)}"><span class="td-t">${live ? 'agora' : hm(e.start)}</span><span class="td-x">${esc(e.title)}</span>${live ? `<button class="btn sm" type="button" data-endev="${esc(e.id)}" title="A reunião já acabou">Encerrar</button>` : ''}${e.link && e.start - now < 15 * 60000 ? `<button class="btn sm primary" type="button" data-join="${esc(e.id)}">Entrar</button>` : !live && e.start - now < 60 * 60000 ? `<span class="td-in">em ${inMin(e.start - now)}</span>` : ''}</div>`);
    }
    const rems = REM.filter(r => !r.done && (r.fired || r.at < end)).sort((a, b) => a.at - b.at).slice(0, 3);
    for (const r of rems) rows.push(`<div class="td-row rem-r${r.fired ? ' due' : ''}" data-rem="${r.id}"><span class="td-t">${hm(r.at)}</span><span class="td-ic">${IC.bell}</span><span class="td-x">${esc(r.text)}${r.repeat ? ` <span class="muted rep-ic">${IC.rep}</span>` : ''}</span>${r.fired ? '<button class="btn sm" type="button" data-rdone>Feito</button>' : ''}</div>`);
    const allDay = AG.events.filter(e => e.allDay && e.start < end && e.end > now).slice(0, 1);
    for (const e of allDay) rows.unshift(`<div class="td-row"><span class="td-t">hoje</span><span class="td-x">${esc(e.title)}</span></div>`);
    if (!rows.length) rows.push(`<div class="td-empty muted">${AG.calendars.length ? 'Sem reuniões nem lembretes pelo resto do dia.' : 'Sem lembretes hoje. <button class="link" type="button" data-agc>Conectar agenda</button>'}</div>`);
    const moreEv = AG.events.filter(e => !e.allDay && !isOver(e, now) && e.start < end).length - evs.length;
    box.innerHTML = rows.join('') + (moreEv > 0 ? `<button class="link td-more" type="button" data-ag>+${moreEv} reuniões hoje</button>` : '');
    box.querySelectorAll('[data-endev]').forEach(b => b.addEventListener('click', (ev) => { ev.stopPropagation(); endMeeting(b.dataset.endev); }));
    box.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', (ev) => { ev.stopPropagation(); const e = AG.events.find(x => x.id === b.dataset.join); if (e) api.agendaJoin(e.link); }));
    box.querySelectorAll('[data-rdone]').forEach(b => b.addEventListener('click', async (ev) => { ev.stopPropagation(); REM = await api.remDone(b.closest('[data-rem]').dataset.rem, true); renderRem(); renderToday(); window.renderBar && window.renderBar(); }));
    box.querySelectorAll('.ev-r, .rem-r, [data-ag], [data-agc]').forEach(el => el.addEventListener('click', () => go('t:agenda')));
  }
  window.renderToday = renderToday;

  // ============ pílula e abertura das abas ============
  window.extraChips = () => {
    const c = [], now = Date.now();
    const due = REM.filter(r => !r.done && r.fired);
    if (due.length) c.push(`<span class="pchip rem" data-chip="rem" title="${esc(due.map(r => r.text).join(' · '))}">${IC.bell}${esc(due[0].text.slice(0, 28))}${due.length > 1 ? ` +${due.length - 1}` : ''}</span>`);
    const { live, next } = nextEvent();
    if (live) c.push(`<span class="pchip ag live" data-chip="ag" data-ev="${esc(live.id)}" title="${esc(live.title)}"><i class="lv"></i>${esc(live.title.slice(0, 24))}${live.link ? ' · Entrar' : ''}<b class="pc-x" data-endev="${esc(live.id)}" title="A reunião já acabou: encerrar">×</b></span>`);
    else if (next && next.start - now <= 60 * 60000) c.push(`<span class="pchip ag${next.start - now <= 10 * 60000 ? ' soon' : ''}" data-chip="ag" data-ev="${esc(next.id)}" title="${esc(next.title)} às ${hm(next.start)}">${IC.cal}${esc(next.title.slice(0, 24))} · ${inMin(next.start - now)}</span>`);
    return c;
  };
  $('#barChips').addEventListener('click', (e) => {
    const x = e.target.closest('[data-endev]'); if (x) { e.stopPropagation(); endMeeting(x.dataset.endev); return; }
    const c = e.target.closest('[data-chip="ag"],[data-chip="rem"]'); if (!c) return;
    e.stopPropagation();
    if (c.dataset.chip === 'ag') {
      const ev = AG.events.find(x => x.id === c.dataset.ev);
      if (ev && ev.link && ev.start - Date.now() <= 10 * 60000) { api.agendaJoin(ev.link); return; }
    }
    api.expand('t:agenda'); go('t:agenda');
  }, true);
  const prevShow = window.showTool;
  window.showTool = (t) => {
    prevShow(t);
    if (t === 'agenda') { renderAgenda(); renderRem(); }
    if (t === 'clip') api.clipList().then(r => { CL = r; renderClip(); setTimeout(() => $('#clipSearch').focus(), 40); });
    if (t === 'texto' && !TX.loaded) { TX.loaded = true; Object.assign(TX.opts, (S.meta && S.meta.txOpts) || {}); txSegs(); }
    if (t === 'texto' && !$('#txIn').value) { $('#txHint').textContent = 'dica: selecione um texto em qualquer programa e aperte Ctrl+Alt+X'; }
    if (t !== 'clip') pickMode = false;
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pickMode) pickMode = false; }, true);

  // carga inicial + relógio da pílula
  api.agendaGet().then(setAG);
  api.remList().then(r => { REM = r; renderRem(); renderToday(); window.renderBar && window.renderBar(); });
  setInterval(() => { renderTile(); renderToday(); window.renderBar && window.renderBar(); if (window.currentTool && window.currentTool() === 'agenda' && !$('#agList').closest('.view').hidden) renderAgenda(); }, 30000);
})();
