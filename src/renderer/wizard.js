// Bit — passo a passo de boas-vindas (aparece na 1ª vez; dá para refazer em Config > Primeiros passos).
// 1 assinatura (Claude ou ChatGPT) → 2 conectar a conta → 3 sobre você → 4 agenda → 5 downloads → 6 personalizar → pronto.
(function () {
  // cores do copiloto: mudam o destaque do app e os olhos do robô ('' = padrão)
  const ACCENTS = [['', 'Azul (padrão)', '#0A84FF'], ['#7C4DDB', 'Roxo'], ['#D63384', 'Rosa'], ['#E5383B', 'Vermelho'], ['#E8590C', 'Laranja'], ['#D69E00', 'Amarelo'], ['#1F9D55', 'Verde'], ['#0E8A93', 'Turquesa'], ['#4B5563', 'Grafite']];
  function applyAccent() {
    const c = (S.settings && S.settings.accent) || '', r = document.documentElement.style;
    const keys = ['--accent', '--accent-ink', '--accent-soft', '--bit-eye', '--bit-bulb'];
    if (!c) { keys.forEach(k => r.removeProperty(k)); return; }
    const dark = document.documentElement.dataset.theme === 'dark';
    r.setProperty('--accent', c);
    r.setProperty('--accent-ink', `color-mix(in srgb, ${c} ${dark ? '62%, white' : '78%, black'})`);
    r.setProperty('--accent-soft', `color-mix(in srgb, ${c} ${dark ? 22 : 12}%, transparent)`);
    r.setProperty('--bit-eye', `color-mix(in srgb, ${c} 55%, white)`);
    r.setProperty('--bit-bulb', `color-mix(in srgb, ${c} 55%, white)`);
  }
  window.applyAccent = applyAccent; // applyTheme (app.js) chama depois de trocar o tema
  applyAccent();

  async function saveAccent(c) { const r = await api.saveSettings({ accent: c }); S.settings = r.settings; applyAccent(); paintSwatches(); }
  let botSaving = null;
  function saveBotName(n) {
    n = String(n || '').replace(/\s+/g, ' ').trim();
    if (n === ((S.profile && S.profile.bot) || '') && !botSaving) return Promise.resolve();
    botSaving = api.profileSave({ bot: n }).then((p) => { S.profile = p; botSaving = null; window.renderBar && window.renderBar(); setState('seen', `Pronto! Agora eu sou o ${botName()}.`); });
    return botSaving;
  }
  window.saveBotPending = () => botSaving || Promise.resolve();
  const swatchesHtml = (id) => `<div class="swatches" id="${id}" role="radiogroup" aria-label="Cor do copiloto">${ACCENTS.map(([v, l, show]) => `<button type="button" role="radio" class="sw-c" data-c="${v}" title="${l}" aria-label="${l}" style="--c:${v || show}"></button>`).join('')}</div>`;
  function paintSwatches() { const cur = (S.settings && S.settings.accent) || ''; $$('.sw-c').forEach(b => { const on = b.dataset.c === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
  function wireSwatches(root) { root.querySelectorAll('.sw-c').forEach(b => b.addEventListener('click', () => saveAccent(b.dataset.c))); paintSwatches(); }

  // ---------- Config > Aparência: nome e cor também ficam lá ----------
  (function cfgLook() {
    const sec = $('#cs-app .fgrid'); if (!sec) return;
    const box = document.createElement('div'); box.className = 'fgrid look-box';
    box.innerHTML = `<div class="f"><label for="cfgBotName">Nome do copiloto</label><input id="cfgBotName" maxlength="24" placeholder="Bit" autocomplete="off"></div>
      <div class="f"><span class="lbl2">Cor</span>${swatchesHtml('cfgSwatches')}</div>`;
    sec.after(box);
    const inp = $('#cfgBotName');
    inp.value = (S.profile && S.profile.bot) || '';
    let t = null;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => saveBotName(inp.value), 700); });
    inp.addEventListener('change', () => { clearTimeout(t); saveBotName(inp.value); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); saveBotName(inp.value); } });
    wireSwatches(box);
    // não troca o texto enquanto a pessoa digita ou enquanto ainda está salvando
    window.fillLook = () => { if (document.activeElement !== inp && !botSaving) inp.value = (S.profile && S.profile.bot) || ''; paintSwatches(); };
  })();

  // ---------- passo a passo ----------
  const STEPS = ['oi', 'ia', 'login', 'voce', 'agenda', 'baixar', 'jeito', 'fim'];
  const W = { i: 0, st: null, poll: null, agTab: 'outlook', busy: false };
  const box = $('#wiz');
  const island = () => $('#island');

  async function status() { try { W.st = await api.setupStatus(); } catch { W.st = W.st || {}; } return W.st; }
  function stopPoll() { clearInterval(W.poll); W.poll = null; }
  function open(at) {
    island().classList.add('wizard'); box.hidden = false;
    api.expand && api.expand();
    W.i = Math.max(0, STEPS.indexOf(at || 'oi')); render();
  }
  async function close() {
    stopPoll(); box.hidden = true; island().classList.remove('wizard');
    if (!S.settings.setupDone) { const r = await api.saveSettings({ setupDone: true }); S.settings = r.settings; }
    fillCfg(); window.fillLook && window.fillLook(); renderSetup(); renderEngine(); window.renderBar && window.renderBar();
    go('home'); setState('seen', `Prontinho! Eu sou o ${botName()}.`);
  }
  window.wizardOpen = open;
  const next = () => { W.i = Math.min(STEPS.length - 1, W.i + 1); render(); };
  const back = () => { W.i = Math.max(0, W.i - 1); render(); };

  const dots = () => `<div class="wz-dots" aria-hidden="true">${STEPS.slice(1, -1).map((_, k) => `<i class="${k + 1 < W.i ? 'done' : k + 1 === W.i ? 'on' : ''}"></i>`).join('')}</div>`;
  const nav = ({ next: nl = 'Continuar', can = true, skip = false } = {}) => `<div class="wz-nav">
      ${W.i > 0 ? '<button class="btn" type="button" data-w="back">Voltar</button>' : ''}<span class="grow"></span>
      ${skip ? '<button class="link" type="button" data-w="skip">Fazer depois</button>' : ''}
      <button class="btn primary" type="button" data-w="next" ${can ? '' : 'disabled'}>${nl}</button></div>`;
  const gpt = () => (S.settings && S.settings.ai) === 'chatgpt';
  const aiLabel = () => (gpt() ? 'ChatGPT' : 'Claude');

  function render() {
    stopPoll();
    const s = STEPS[W.i];
    const body = VIEWS[s]();
    box.innerHTML = `<div class="wz-card" data-step="${s}"><button class="wz-x" type="button" data-w="close" title="Sair do passo a passo (dá para refazer em Config)" aria-label="Sair do passo a passo"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${s !== 'oi' && s !== 'fim' ? dots() : ''}${body}</div>`;
    box.querySelectorAll('[data-w="close"]').forEach(b => b.addEventListener('click', close));
    box.querySelectorAll('[data-w="next"]').forEach(b => b.addEventListener('click', () => (ON_NEXT[s] ? ON_NEXT[s](b) : next())));
    box.querySelectorAll('[data-w="back"]').forEach(b => b.addEventListener('click', back));
    box.querySelectorAll('[data-w="skip"]').forEach(b => b.addEventListener('click', next));
    box.querySelectorAll('[data-face]').forEach(el => { el.innerHTML = FACE_SVG; });
    (WIRE[s] || (() => {}))();
    const f = box.querySelector('input:not([type=hidden]),[data-w="next"]'); if (f) setTimeout(() => f.focus(), 40);
  }

  const VIEWS = {
    oi: () => `<div class="wz-hero"><span class="face wz-face" data-face></span>
        <h2>Oi! Vamos montar o seu copiloto</h2>
        <p class="muted">São alguns passos rápidos: escolher a sua IA, entrar na sua conta, contar um pouco sobre você, conectar a agenda e deixar o robô do seu jeito. Leva uns 5 minutos.</p></div>
        <div class="wz-nav"><span class="grow"></span><button class="btn primary" type="button" data-w="next">Começar</button></div>`,

    ia: () => `<h2>Qual assinatura você tem?</h2>
        <p class="muted">O Bit usa a IA que você já assina, sem custo extra e sem chave de API.</p>
        <div class="wz-choices">
          <button type="button" class="wz-choice ${gpt() ? '' : 'on'}" data-ai="claude"><b>Claude</b><small>Pro ou Max (claude.ai)</small></button>
          <button type="button" class="wz-choice ${gpt() ? 'on' : ''}" data-ai="chatgpt"><b>ChatGPT</b><small>Go, Plus, Pro ou Team (chatgpt.com)</small></button>
        </div>
        <p class="muted wz-note">Não tem nenhuma? O ChatGPT Free também funciona, com limite menor. Dá para trocar depois em Config.</p>
        ${nav()}`,

    login: () => {
      const st = W.st || {}; const v = gpt() ? st.chatgpt : st.claude;
      const ok = v === 'ok', miss = v === 'missing' || v == null;
      return `<h2>Entrar na sua conta do ${aiLabel()}</h2>
        <div class="wz-status ${ok ? 'ok' : ''}">${ok ? `<span class="wz-ok">✓</span> Conectado: o Bit vai usar o seu plano do ${aiLabel()}.`
          : W.busy ? '<span class="wz-spin"></span> Esperando você terminar na janela que abriu…' : miss ? `O programa do ${aiLabel()} ainda não está neste PC.` : 'Instalado. Falta entrar na sua conta.'}</div>
        ${ok ? '' : `<ol class="wz-steps">
          <li>Clique em <b>${miss ? 'Instalar e entrar' : 'Entrar na minha conta'}</b>. Abre uma janela do PowerShell${miss ? ' que instala tudo sozinha' : ''}.</li>
          ${gpt() ? '<li>O navegador abre: entre com a mesma conta que você usa no ChatGPT.</li>'
            : '<li>Na janela, aperte <kbd>Enter</kbd> nas perguntas e escolha entrar com a sua conta do Claude. O navegador abre para você confirmar.</li>'}
          <li>Pronto! O Bit percebe sozinho quando der certo. Pode fechar a janela.</li></ol>
          <div class="row"><button class="btn primary" type="button" id="wzConnect">${miss ? 'Instalar e entrar' : 'Entrar na minha conta'}</button>
          <button class="link" type="button" id="wzRecheck">Já fiz, conferir</button></div>`}
        ${nav({ can: ok, skip: !ok })}`;
    },

    voce: () => {
      const p = S.profile || {};
      return `<h2>Agora, sobre você</h2>
        <p class="muted">É assim que o copiloto entende seus pedidos e sabe o que é seu. Fica só neste computador.</p>
        <div class="fgrid">
          <div class="f"><label for="wzNome">Seu nome *</label><input id="wzNome" value="${esc(p.nome || '')}" placeholder="Ex.: Ana Souza" autocomplete="off"></div>
          <div class="f"><label for="wzCargo">O que você faz</label><input id="wzCargo" value="${esc(p.cargo || '')}" placeholder="Ex.: Analista de marketing" autocomplete="off"></div>
          <div class="f"><label for="wzEmpresa">Onde trabalha</label><input id="wzEmpresa" value="${esc(p.empresa || '')}" placeholder="Ex.: Empresa X · time de vendas" autocomplete="off"></div>
          <div class="f"><label for="wzSobre">O que você cuida no dia a dia <small>opcional</small></label><input id="wzSobre" value="${esc(p.sobre || '')}" placeholder="Ex.: campanhas e relatórios semanais" autocomplete="off"></div>
          <div class="f wide"><label for="wzPessoas">Com quem você trabalha <small>opcional · uma por linha: Nome — papel</small></label><textarea id="wzPessoas" rows="3" placeholder="Carla — minha gestora&#10;João — comercial">${esc((p.pessoas || []).map(x => x.papel ? `${x.nome} — ${x.papel}` : x.nome).join('\n'))}</textarea></div>
        </div>
        ${nav({ can: !!(p.nome) })}`;
    },

    agenda: () => {
      const n = (W.st && W.st.calendars) || 0, ol = W.agTab === 'outlook';
      return `<h2>Conectar a sua agenda</h2>
        <p class="muted">Assim o copiloto mostra suas reuniões, avisa antes de começar e grava com um clique.</p>
        ${n ? `<div class="wz-status ok"><span class="wz-ok">✓</span> ${n > 1 ? `${n} agendas conectadas` : 'Agenda conectada'}. Pode adicionar outra se quiser.</div>` : ''}
        <div class="seg wz-tabs"><button type="button" data-tab2="outlook" class="${ol ? 'on' : ''}"><b>Outlook</b></button><button type="button" data-tab2="google" class="${ol ? '' : 'on'}"><b>Google</b></button></div>
        ${ol ? `<ol class="wz-steps">
            <li>Clique em <b>Abrir o Outlook</b> (abre as configurações de calendário no navegador).</li>
            <li>Em <b>Publicar um calendário</b>, escolha <b>Calendário</b> e <b>Pode ver todos os detalhes</b>, e clique em <b>Publicar</b>.</li>
            <li>Copie o link que termina em <b>.ics</b> e cole aqui embaixo.</li></ol>
            <div class="row"><button class="btn" type="button" data-open="https://outlook.office.com/mail/options/calendar/SharedCalendars">Abrir o Outlook</button></div>`
          : `<ol class="wz-steps">
            <li>Clique em <b>Abrir o Google Agenda</b>.</li>
            <li>No menu da esquerda, clique na sua agenda e role até <b>Endereço secreto no formato iCal</b>.</li>
            <li>Copie esse link e cole aqui embaixo.</li></ol>
            <div class="row"><button class="btn" type="button" data-open="https://calendar.google.com/calendar/r/settings">Abrir o Google Agenda</button></div>`}
        <div class="row wz-paste"><input id="wzIcs" placeholder="Cole o link .ics aqui" autocomplete="off"><button class="btn primary" type="button" id="wzIcsAdd">Conectar</button></div>
        <div class="muted wz-msg" id="wzIcsMsg" role="status"></div>
        ${nav({ can: true, next: n ? 'Continuar' : 'Continuar sem agenda' })}`;
    },

    baixar: () => {
      const st = W.st || {};
      const it = (ok, t, d, act = '') => `<div class="wz-item ${ok ? 'done' : ''}"><span class="st ${ok ? 'ok' : 'todo'}">${ok ? '✓' : ''}</span><div><b>${t}</b><span>${d}</span></div>${ok ? '' : act}</div>`;
      const v = gpt() ? st.chatgpt : st.claude;
      return `<h2>Baixando o que falta</h2>
        <p class="muted">Confere o que já está pronto e baixa o resto.</p>
        <div class="wz-list">
          ${it(v === 'ok', `IA (${aiLabel()})`, v === 'ok' ? 'Conectada.' : 'Ainda não conectada.', '<button class="btn sm" type="button" data-goto="login">Conectar</button>')}
          ${it(!!st.profile, 'Seu perfil', st.profile ? 'Preenchido.' : 'Falta o seu nome.', '<button class="btn sm" type="button" data-goto="voce">Preencher</button>')}
          ${it(!!st.voice, 'Voz (Whisper)', st.voice ? 'Baixada: dá para ditar e transcrever reuniões.' : 'Grátis, roda no seu PC (~190 MB). Para ditar e gravar reuniões.', '<button class="btn sm primary" type="button" id="wzVoice">Baixar</button>')}
          ${it((st.calendars || 0) > 0, 'Agenda', st.calendars ? 'Conectada.' : 'Opcional.', '<button class="btn sm" type="button" data-goto="agenda">Conectar</button>')}
        </div>
        <div class="wz-prog" id="wzProg" hidden><i id="wzFill"></i></div><div class="muted wz-msg" id="wzVoiceMsg" role="status"></div>
        ${nav()}`;
    },

    jeito: () => `<h2>Do seu jeitinho</h2>
        <p class="muted">Dê um nome e uma cor para o seu copiloto. Dá para mudar quando quiser em Config > Aparência.</p>
        <div class="wz-look">
          <div class="wz-preview"><span class="face wz-face" data-face></span><b id="wzPrevName">${esc(botName())}</b></div>
          <div class="wz-look-f">
            <div class="f"><label for="wzBot">Nome do copiloto</label><input id="wzBot" maxlength="24" value="${esc((S.profile && S.profile.bot) || '')}" placeholder="Bit" autocomplete="off"></div>
            <div class="f"><span class="lbl2">Cor</span>${swatchesHtml('wzSwatches')}</div>
            <div class="f"><span class="lbl2">Tema</span><div class="seg wz-theme">${[['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Igual ao Windows']].map(([v, l]) => `<button type="button" data-theme2="${v}" class="${(S.settings.theme || 'claro') === v ? 'on' : ''}"><b>${l}</b></button>`).join('')}</div></div>
          </div>
        </div>
        ${nav()}`,

    fim: () => `<div class="wz-hero"><span class="face wz-face" data-face></span>
        <h2>Tudo pronto! Eu sou o ${esc(botName())}.</h2>
        <p class="muted">Me chame com <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd>. Escreva ou fale o que chegou: eu organizo as demandas, lembro das reuniões e escrevo junto com você.</p></div>
        <div class="wz-nav"><button class="btn" type="button" data-w="back">Voltar</button><span class="grow"></span><button class="btn primary" type="button" id="wzDone">Começar a usar</button></div>`,
  };

  const ON_NEXT = {
    voce: async () => {
      const nome = $('#wzNome').value.trim(); if (!nome) { $('#wzNome').focus(); return; }
      const split = (l) => { const m = l.split(/\s+[—–-]\s+|\s*[—–]\s*/); return { nome: m[0].trim(), papel: (m[1] || '').trim() }; };
      S.profile = await api.profileSave({ ...S.profile, nome, cargo: $('#wzCargo').value, empresa: $('#wzEmpresa').value, sobre: $('#wzSobre').value,
        pessoas: $('#wzPessoas').value.split('\n').map(l => l.trim()).filter(Boolean).map(split) });
      if (window.fillProfile) window.fillProfile();
      await status(); next();
    },
    jeito: async () => { await saveBotName($('#wzBot').value); next(); },
  };

  const WIRE = {
    ia: () => box.querySelectorAll('.wz-choice').forEach(b => b.addEventListener('click', async () => {
      const r = await api.saveSettings({ ai: b.dataset.ai }); S.settings = r.settings; if (r.engine) S.engine = r.engine;
      fillCfg(); renderEngine(); W.st = null; render();
    })),
    login: () => {
      const check = async () => { await status(); const v = gpt() ? W.st.chatgpt : W.st.claude; if (v === 'ok') { W.busy = false; render(); } };
      if (!W.st) status().then(render);
      const c = $('#wzConnect');
      if (c) c.addEventListener('click', async () => {
        const r = await api.aiConnect(gpt() ? 'chatgpt' : 'claude');
        if (!r.ok) { setState('error', r.error || 'Não consegui abrir a janela.'); return; }
        W.busy = true; render();
      });
      const rc = $('#wzRecheck'); if (rc) rc.addEventListener('click', async () => { rc.textContent = 'Conferindo…'; await check(); if (rc.isConnected) rc.textContent = 'Ainda não: termine na janela e tente de novo'; });
      const v = W.st && (gpt() ? W.st.chatgpt : W.st.claude);
      if (v !== 'ok') W.poll = setInterval(check, 3000); // percebe sozinho quando o login termina
    },
    voce: () => { const n = $('#wzNome'), b = box.querySelector('[data-w="next"]'); const upd = () => { b.disabled = !n.value.trim(); }; n.addEventListener('input', upd); upd();
      box.querySelectorAll('input').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!b.disabled) b.click(); } })); },
    agenda: () => {
      if (!W.st) status().then(render);
      box.querySelectorAll('[data-tab2]').forEach(b => b.addEventListener('click', () => { W.agTab = b.dataset.tab2; render(); }));
      box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => api.openExternal(b.dataset.open)));
      const add = $('#wzIcsAdd'), inp = $('#wzIcs'), msg = $('#wzIcsMsg');
      const go_ = async () => {
        if (!inp.value.trim()) { inp.focus(); return; }
        add.disabled = true; add.textContent = 'Testando…'; msg.textContent = '';
        try {
          const r = await api.agendaAddCal({ name: W.agTab === 'outlook' ? 'Outlook' : 'Google', url: inp.value });
          await status(); render(); setState('seen', `Agenda conectada (${r.events} eventos)`);
        } catch (e) { add.disabled = false; add.textContent = 'Conectar'; const t = String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); msg.textContent = /net::|ERR_|HTTP|fetch|ENOTFOUND|ECONN/i.test(t) ? 'Não consegui abrir esse link. Confira se copiou o link inteiro (termina em .ics) e se a agenda está publicada.' : t; }
      };
      add.addEventListener('click', go_); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go_(); } });
    },
    baixar: () => {
      if (!W.st) status().then(render);
      box.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => { W.i = STEPS.indexOf(b.dataset.goto); render(); }));
      const vb = $('#wzVoice'); if (!vb) return;
      vb.addEventListener('click', async () => {
        vb.disabled = true; vb.textContent = 'Baixando…'; $('#wzProg').hidden = false;
        const r = await api.voiceInstall();
        if (r && r.error) { $('#wzVoiceMsg').textContent = r.error; vb.disabled = false; vb.textContent = 'Tentar de novo'; return; }
        await status(); render(); typeof refreshVoice === 'function' && refreshVoice();
      });
    },
    jeito: () => {
      const inp = $('#wzBot'), prev = $('#wzPrevName');
      inp.addEventListener('input', () => { prev.textContent = inp.value.trim() || 'Bit'; });
      wireSwatches(box);
      box.querySelectorAll('[data-theme2]').forEach(b => b.addEventListener('click', async () => {
        const r = await api.saveSettings({ theme: b.dataset.theme2 }); S.settings = r.settings; applyTheme(); applyAccent();
        box.querySelectorAll('[data-theme2]').forEach(x => x.classList.toggle('on', x === b)); $('#cfgTheme').value = S.settings.theme;
      }));
    },
    fim: () => { $('#wzDone').addEventListener('click', close); },
  };
  // o app pode ter pedido o passo a passo antes deste arquivo carregar
  if (window.__wizPending) { const at = window.__wizPending; window.__wizPending = null; open(at); }
  // progresso do download da voz também aparece aqui
  api.onVoiceProgress(({ got, total }) => { const f = $('#wzFill'); if (f && total) f.style.width = Math.round(got / total * 100) + '%'; const m = $('#wzVoiceMsg'); if (m && total) m.textContent = `Baixando… ${Math.round(got / total * 100)}%`; });
})();
