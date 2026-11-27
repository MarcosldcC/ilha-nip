// Bit — Ferramentas: arquivos, notas, cofre, reunião e música.
(function () {
  const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');
  const stem = (n) => n.replace(/\.[^.]+$/, '');
  const hhmm = (t = Date.now()) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const twoClick = (btn, fn, label = 'Confirmar?') => {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; fn(); return; }
    btn.dataset.orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 3000);
  };

  // ---------------- navegação interna ----------------
  let tool = 'arquivos';
  function showTool(t) {
    tool = t;
    $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === 't:' + t));
    $$('.tpane').forEach(p => { p.hidden = p.dataset.pane !== t; });
    if (t === 'notas') loadNotes();
    if (t === 'cofre') loadVault();
    if (t === 'reuniao') { loadMeetings(); api.voiceWarm(); }
    if (t === 'musica') loadPlaylist();
    if (t === 'calc' && window.calcOpen) window.calcOpen();
  }
  window.showTool = showTool;
  window.currentTool = () => tool;
  window.toolsSetFiles = (p) => setFiles(p);

  // ---------------- arrastar e soltar (em qualquer lugar, até na pílula) ----------------
  let dragDepth = 0, leaveT = null;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const isl = () => $('#island');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; clearTimeout(leaveT);
    isl().classList.add('dragging'); $('#dropOver').hidden = false; wake();
    if (isl().classList.contains('collapsed')) api.dropMode(true);
  });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth) return;
    isl().classList.remove('dragging');
    if (isl().classList.contains('dropmode')) leaveT = setTimeout(() => api.dropMode(false), 700);
    else $('#dropOver').hidden = true;
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault(); dragDepth = 0; clearTimeout(leaveT); isl().classList.remove('dragging'); $('#dropOver').hidden = true;
    const paths = [...(e.dataTransfer?.files || [])].map(f => api.pathFor(f)).filter(Boolean);
    if (!paths.length) return;
    if (tab === 'ferramentas' && tool === 'musica' && paths.every(isAudio)) { addToPlaylist(paths); return; }
    api.expand('t:arquivos'); go('t:arquivos'); setFiles(paths);
  });

  // ---------------- ARQUIVOS ----------------
  const IMG = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'ico', 'svg'];
  const ARCH = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'];
  let FILES = [], fbusy = false;
  async function setFiles(paths) { FILES = await api.fileStat(paths); renderFiles(); }
  $('#pickFiles').addEventListener('click', async () => { const p = await api.filePick(); if (p.length) setFiles(p); });
  const dz = $('#dropZone');
  dz.addEventListener('dragenter', () => dz.classList.add('over'));
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', () => dz.classList.remove('over'));

  // ----- lista de arquivos (com renomear) -----
  const PEN = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
  const XX = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function renderFiles() {
    $('#dropZone').classList.toggle('compact', FILES.length > 0);
    $('#fileList').classList.toggle('many', FILES.length > 3);
    $('#fileList').innerHTML = FILES.map((f, i) => `<div class="fitem" data-i="${i}"><span class="ic">${f.isDir ? 'pasta' : esc(f.ext || '?')}</span><span class="nm" title="${esc(f.path)}">${esc(f.name)}</span><span class="sz">${f.isDir ? '' : fmtSize(f.size)}</span><span class="frow-acts"><button class="mini" data-ren="${i}" title="Renomear">${PEN}</button><button class="mini" data-rm="${i}" title="Tirar da lista">${XX}</button></span></div>`).join('');
    $$('#fileList [data-rm]').forEach(b => b.addEventListener('click', () => { FILES.splice(+b.dataset.rm, 1); renderFiles(); }));
    $$('#fileList [data-ren]').forEach(b => b.addEventListener('click', () => startRename(+b.dataset.ren)));
    renderBatch();
    renderQuick();
  }
  function startRename(i) {
    const f = FILES[i], row = $(`#fileList .fitem[data-i="${i}"]`); if (!f || !row) return;
    const nm = row.querySelector('.nm'), inp = document.createElement('input');
    inp.className = 'ren-in'; inp.value = f.isDir ? f.name : stem(f.name);
    nm.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const finish = async (save) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (save && v && v !== (f.isDir ? f.name : stem(f.name))) {
        try {
          const to = await api.fileRename(f.path, f.isDir || !f.ext ? v : `${v}.${f.ext}`);
          Object.assign(f, (await api.fileStat([to]))[0]);
          log(true, `Renomeado para ${f.name}`, to);
        } catch (e) { setState('error', errMsg(e)); }
      }
      renderFiles();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    inp.addEventListener('blur', () => finish(true));
  }
  const errMsg = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ----- receita: fazer tudo de uma vez (todos os tipos) -----
  const T = {
    img: { l: 'Imagens', ext: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'ico', 'svg'] },
    heic: { l: 'Fotos do iPhone', ext: ['heic', 'heif'] },
    video: { l: 'Vídeos', ext: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', '3gp', 'mpeg', 'mpg', 'ts'] },
    audio: { l: 'Áudios', ext: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wma', 'amr'] },
    pdf: { l: 'PDFs', ext: ['pdf'] },
    sheet: { l: 'Planilhas', ext: ['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'json'] },
    doc: { l: 'Documentos', ext: ['doc', 'docx', 'rtf', 'odt'] },
    slides: { l: 'Apresentações', ext: ['ppt', 'pptx', 'pps', 'ppsx', 'odp'] },
    text: { l: 'Textos', ext: ['txt', 'md', 'markdown', 'html', 'htm'] },
  };
  const kindOf = (f) => (f.isDir ? 'dir' : Object.keys(T).find(k => T[k].ext.includes(f.ext)) || 'other');
  const CONV = {
    img: (n) => [['keep', 'Manter'], ['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['pdf', n > 1 ? 'Um PDF só' : 'PDF', 'Junta as imagens num único PDF']],
    heic: () => [['jpg', 'JPG'], ['png', 'PNG']],
    video: () => [['keep', 'Manter'], ['mp4', 'MP4'], ['webm', 'WebM'], ['mov', 'MOV'], ['gif', 'GIF'], ['mp3', 'Só o áudio (MP3)']],
    audio: () => [['keep', 'Manter'], ['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['ogg', 'OGG']],
    pdf: () => [['keep', 'Manter'], ['img', 'Imagens PNG', 'Cada página vira uma imagem'], ['split', 'Separar páginas', 'Um PDF por página'], ['docx', 'Word', 'Vira um .docx editável (precisa do Office ou LibreOffice)']],
    sheet: (n) => [['keep', 'Manter'], ['xlsx', 'Excel'], ['csv', 'CSV'], ['json', 'JSON'], ['pdf', 'PDF', 'Precisa do Office ou LibreOffice'], ...(n > 1 ? [['merge', 'Juntar numa planilha', 'Cada arquivo vira uma aba']] : [])],
    doc: () => [['keep', 'Manter'], ['pdf', 'PDF'], ['docx', 'DOCX']],
    slides: () => [['keep', 'Manter'], ['pdf', 'PDF']],
    text: () => [['keep', 'Manter'], ['pdf', 'PDF']],
  };
  const SHRINKABLE = ['img', 'pdf', 'video', 'audio'];
  const REC_DEF = { conv: {}, shrink: 'none', name: '{nome}', dest: 'same', destDir: '', zip: false, copy: false, show: true, trash: false };
  let REC = { ...REC_DEF, conv: {} };
  let recLoaded = false, lastBatchMsg = '', CONVST = null;
  const saveRec = () => api.setMeta({ batch: { ...REC, trash: false } });
  const today = () => new Date().toISOString().slice(0, 10);
  function applyName(tpl, f, n, total) {
    const pad = String(total).length;
    const out = String(tpl || '{nome}').replace(/\{nome\}/gi, stem(f.name)).replace(/\{n\}/gi, String(n).padStart(Math.max(2, pad), '0')).replace(/\{data\}/gi, today())
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/[. ]+$/, '');
    return out || stem(f.name);
  }
  function segmHTML(attr, opts, cur) {
    return `<div class="segm" ${attr}>${opts.map(([v, l, t]) => `<button type="button" data-v="${v}" class="${cur === v ? 'on' : ''}" ${t ? `title="${esc(t)}"` : ''}>${l}</button>`).join('')}</div>`;
  }
  const officeOK = () => CONVST && CONVST.office && (CONVST.office.word || CONVST.office.excel || CONVST.office.powerpoint || CONVST.office.libre);
  const needsOffice = (k, v) => (k === 'pdf' && v === 'docx') || (['doc', 'slides'].includes(k) && v !== 'keep') || (k === 'sheet' && v === 'pdf');
  const needsFF = (k, v, shrink) => (k === 'video' && (v !== 'keep' || shrink !== 'none')) || (k === 'audio' && (v !== 'keep' || shrink !== 'none'));
  function renderBatch() {
    const box = $('#batchBox'); if (!box) return;
    if (!recLoaded && S.meta && S.meta.batch) { const b = S.meta.batch; REC = { ...REC_DEF, ...b, conv: typeof b.conv === 'object' && b.conv ? b.conv : {}, trash: false }; recLoaded = true; }
    if (!CONVST) api.convStatus().then(st => { CONVST = st; renderBatch(); });
    const files = FILES.filter(f => !f.isDir);
    box.hidden = !files.length;
    if (!files.length) return;
    const byKind = {}; files.forEach(f => { const k = kindOf(f); (byKind[k] ||= []).push(f); });
    const kinds = Object.keys(byKind).filter(k => CONV[k]);
    kinds.forEach(k => { const opts = CONV[k](byKind[k].length); if (!opts.some(o => o[0] === REC.conv[k])) REC.conv[k] = opts[0][0]; });
    const canShrink = kinds.some(k => SHRINKABLE.includes(k));
    if (!canShrink) REC.shrink = 'none';
    const multi = kinds.length > 1;
    const convRows = kinds.map(k => `<div class="bb-row${multi ? ' kindrow' : ''}"><span class="bb-l">${multi ? `<span class="kl">${T[k].l} <b>${byKind[k].length}</b></span>` : '<i>1</i>Converter'}</span>${segmHTML(`data-ck="${k}"`, CONV[k](byKind[k].length), REC.conv[k])}</div>`).join('');
    const warn = [];
    const wantFF = kinds.some(k => needsFF(k, REC.conv[k], REC.shrink));
    if (wantFF && CONVST && !CONVST.ffmpeg) warn.push('Vídeo/áudio usa o FFmpeg (grátis, ~85 MB). Ele baixa sozinho na primeira vez.');
    if (kinds.some(k => needsOffice(k, REC.conv[k])) && CONVST && !officeOK()) warn.push('Documentos precisam do Microsoft Office ou do <button class="link" type="button" data-ext="https://pt-br.libreoffice.org/baixe-ja/libreoffice-novo/">LibreOffice (grátis)</button> instalado.');
    if (byKind.img && REC.conv.img === 'png' && byKind.img.some(f => ['jpg', 'jpeg'].includes(f.ext))) warn.push('Foto em PNG costuma ficar maior que em JPG; pro menor tamanho, use JPG ou WebP.');
    if (REC.shrink !== 'none' && byKind.pdf && ['keep', 'split'].includes(REC.conv.pdf)) warn.push('Comprimir PDF transforma as páginas em imagem (o texto deixa de ser selecionável).');
    const others = byKind.other ? byKind.other.length : 0;
    const sample = files.slice(0, 3).map((f, i) => applyName(REC.name, f, i + 1, files.length)).join(', ') + (files.length > 3 ? '…' : '');
    const destLbl = REC.dest === 'pick' ? (REC.destDir ? `<span class="muted dpath" title="${esc(REC.destDir)}">${esc(REC.destDir.split(/[\\/]/).slice(-2).join('/'))}</span>` : '<span class="muted">escolha ao rodar</span>') : '';
    box.innerHTML = `
      <div class="bb-h"><b>Fazer tudo de uma vez</b><span class="muted">${files.length} arquivo${files.length > 1 ? 's' : ''}${others ? ` · ${others} sem conversão (só renomear/mover)` : ''}</span></div>
      ${multi && kinds.length ? '<div class="bb-row"><span class="bb-l"><i>1</i>Converter</span></div>' : ''}${convRows}
      ${canShrink ? `<div class="bb-row"><span class="bb-l"><i>2</i>Comprimir</span>${segmHTML('data-rk="shrink"', [['none', 'Não'], ['leve', 'Leve'], ['medio', 'Médio'], ['forte', 'Forte']], REC.shrink)}</div>` : ''}
      <div class="bb-row"><span class="bb-l"><i>3</i>Nome</span><input id="bbName" value="${esc(REC.name)}" spellcheck="false"><span class="bb-tokens"><button type="button" data-tok="{nome}">{nome}</button><button type="button" data-tok="{n}">{n}</button><button type="button" data-tok="{data}">{data}</button></span></div>
      <div class="bb-row sub"><span class="bb-l"></span><span class="muted bb-prev">Ex.: ${esc(sample)}</span><button class="link" type="button" id="bbRenameOrig" title="Renomeia os arquivos originais com esse padrão, sem criar cópias">Renomear os originais assim</button></div>
      <div class="bb-row"><span class="bb-l"><i>4</i>Salvar em</span>${segmHTML('data-rk="dest"', [['same', 'Mesma pasta'], ['sub', 'Pasta nova', 'Cria a pasta "Convertidos" ao lado dos arquivos'], ['pick', 'Escolher…']], REC.dest)}${destLbl}</div>
      <div class="bb-row"><span class="bb-l"><i>5</i>Depois</span><span class="bb-checks">
        <label><input type="checkbox" data-rc="zip" ${REC.zip ? 'checked' : ''}> Compactar tudo em .zip</label>
        <label><input type="checkbox" data-rc="copy" ${REC.copy ? 'checked' : ''}> Copiar (pra colar)</label>
        <label><input type="checkbox" data-rc="show" ${REC.show ? 'checked' : ''}> Abrir a pasta</label>
        <label class="danger"><input type="checkbox" data-rc="trash" ${REC.trash ? 'checked' : ''}> Originais pra Lixeira</label></span></div>
      ${warn.length ? `<div class="bb-warn">${warn.map(w => `<span>${w}</span>`).join('')}</div>` : ''}
      <div class="bb-go"><div class="bb-bar" id="bbBar" hidden><i id="bbFill"></i></div><span class="muted" id="bbStatus">${esc(lastBatchMsg)}</span><span class="grow"></span><button class="btn primary" type="button" id="bbRun">Fazer tudo (${files.length})</button></div>`;
    box.querySelectorAll('.segm[data-ck] button').forEach(b => b.addEventListener('click', () => { REC.conv[b.closest('.segm').dataset.ck] = b.dataset.v; saveRec(); renderBatch(); }));
    box.querySelectorAll('.segm[data-rk] button').forEach(b => b.addEventListener('click', async () => {
      const k = b.closest('.segm').dataset.rk; REC[k] = b.dataset.v;
      if (k === 'dest' && REC.dest === 'pick') { const d = await api.filePickDir(); if (d) REC.destDir = d; else if (!REC.destDir) REC.dest = 'same'; }
      saveRec(); renderBatch();
    }));
    box.querySelectorAll('[data-ext]').forEach(b => b.addEventListener('click', () => api.openExternal(b.dataset.ext)));
    const nameIn = $('#bbName');
    nameIn.addEventListener('input', () => { REC.name = nameIn.value; saveRec(); $('#batchBox .bb-prev').textContent = 'Ex.: ' + files.slice(0, 3).map((f, i) => applyName(REC.name, f, i + 1, files.length)).join(', ') + (files.length > 3 ? '…' : ''); });
    box.querySelectorAll('[data-tok]').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.tok, p = nameIn.selectionStart ?? nameIn.value.length;
      nameIn.value = nameIn.value.slice(0, p) + t + nameIn.value.slice(nameIn.selectionEnd ?? p); nameIn.dispatchEvent(new Event('input')); nameIn.focus();
    }));
    box.querySelectorAll('[data-rc]').forEach(c => c.addEventListener('change', () => { REC[c.dataset.rc] = c.checked; saveRec(); }));
    $('#bbRenameOrig').addEventListener('click', renameOriginals);
    $('#bbRun').addEventListener('click', runBatch);
  }
  async function renameOriginals() {
    const files = FILES.filter(f => !f.isDir);
    if (REC.name.trim() === '{nome}') { setState('error', 'Mude o padrão do nome primeiro (ex.: foto-{n})'); return; }
    let ok = 0;
    for (const [i, f] of files.entries()) {
      try {
        const to = await api.fileRename(f.path, `${applyName(REC.name, f, i + 1, files.length)}${f.ext ? '.' + f.ext : ''}`);
        Object.assign(f, (await api.fileStat([to]))[0]); ok++;
      } catch (e) { log(false, `${f.name}: ${errMsg(e)}`); }
    }
    log(true, `${ok} arquivo(s) renomeado(s)`, files.map(f => f.path));
    setState('seen', 'Renomeados!'); renderFiles();
  }
  let curProg = { i: 0, n: 1, txt: '' };
  function progress(i, n, txt) {
    curProg = { i, n, txt };
    $('#bbBar').hidden = false; $('#bbFill').style.width = `${Math.round((i / n) * 100)}%`;
    $('#bbStatus').textContent = txt; setState('working', txt);
  }
  api.onConvProgress((p) => {
    if (!fbusy) return;
    if (p.what === 'install') { const pc = p.total ? Math.round(p.got / p.total * 100) : 0; $('#bbStatus').textContent = `Baixando o conversor (só 1x)… ${pc}%`; $('#bbFill').style.width = pc + '%'; }
    if (p.what === 'file') { const v = curProg.i + Math.min(1, p.p); $('#bbFill').style.width = `${Math.round((v / curProg.n) * 100)}%`; $('#bbStatus').textContent = `${curProg.txt} · ${Math.round(p.p * 100)}%`; }
  });
  const okOr = (r) => { if (!r.ok) throw new Error(r.error === 'FFMPEG_MISSING' ? 'O conversor de vídeo não está instalado.' : r.error === 'OFFICE_MISSING' ? 'Precisa do Microsoft Office ou do LibreOffice (grátis) para converter documentos.' : r.error); return r; };
  function textHtml(title, body) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font:11pt/1.6 "Segoe UI",Arial,sans-serif;color:#111;margin:0}h1,h2,h3,h4{line-height:1.25;margin:1.2em 0 .4em}
      pre{white-space:pre-wrap;word-wrap:break-word;font:10pt/1.5 Consolas,monospace}code{font-family:Consolas,monospace;background:#f2f2f2;padding:0 3px}
      table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px;color:#444}
      </style></head><body>${body}</body></html>`;
  }
  async function readSheet(f) {
    const buf = await api.fileRead(f.path);
    if (f.ext === 'json') {
      const j = JSON.parse(new TextDecoder().decode(buf));
      const wb = XLSX.utils.book_new();
      if (Array.isArray(j)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(j), 'Dados');
      else for (const [k, v] of Object.entries(j)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Array.isArray(v) ? v : [v]), k.slice(0, 31));
      return wb;
    }
    if (f.ext === 'csv') {
      const txt = new TextDecoder().decode(buf).replace(/^﻿/, '');
      const first = txt.split('\n')[0] || '';
      const FS = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
      const wb = XLSX.read(txt, { type: 'string', FS, raw: true });
      // números no formato brasileiro (1.234,56) viram número de verdade
      const BR = /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/;
      for (const sn of wb.SheetNames) for (const [a, cell] of Object.entries(wb.Sheets[sn])) {
        if (a[0] === '!' || cell.t !== 's') continue;
        const v = String(cell.v).trim();
        if (FS === ';' ? BR.test(v) : /^-?\d+(\.\d+)?$/.test(v)) { cell.t = 'n'; cell.v = Number(FS === ';' ? v.replace(/\./g, '').replace(',', '.') : v); }
      }
      return wb;
    }
    return XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  }
  const enc = (s) => new TextEncoder().encode(s).buffer;
  async function runBatch() {
    if (fbusy) return;
    const files = FILES.filter(f => !f.isDir);
    if (!files.length) return;
    const P = REC.shrink !== 'none' ? SHRINK[REC.shrink] : null;
    fbusy = true; $('#bbRun').disabled = true; lastBatchMsg = '';
    const outs = [], before = files.reduce((a, f) => a + f.size, 0), errors = [];
    try {
      CONVST = await api.convStatus();
      // baixa o FFmpeg se for preciso
      if (files.some(f => needsFF(kindOf(f), REC.conv[kindOf(f)], REC.shrink)) && !CONVST.ffmpeg) {
        progress(0, 1, 'Baixando o conversor de vídeo (só 1x)…');
        okOr(await api.convFfInstall()); CONVST.ffmpeg = true;
      }
      let dest = null;
      if (REC.dest === 'sub') dest = await api.fileMkdir(`${dirOf(files[0].path)}/Convertidos`);
      if (REC.dest === 'pick') { if (!REC.destDir) REC.destDir = await api.filePickDir(); if (!REC.destDir) throw new Error('Nenhuma pasta escolhida.'); dest = REC.destDir; saveRec(); }
      const dirFor = (f) => dest || dirOf(f.path);
      const write = async (f, name, data) => { const r = await api.fileWrite(dirFor(f), name, data); outs.push(r); return r; };
      const imgs = files.filter(f => kindOf(f) === 'img'), sheets = files.filter(f => kindOf(f) === 'sheet');

      // imagens → um PDF só
      if (imgs.length && REC.conv.img === 'pdf') {
        const doc = await PDFLib.PDFDocument.create();
        for (const [i, f] of imgs.entries()) {
          progress(i, files.length, `Montando o PDF ${i + 1}/${imgs.length}…`);
          const bmp = await decodeImg(f);
          const max = P ? P.max : 2600, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
          const im = await doc.embedJpg(await encodeImg(bmp, 'image/jpeg', P ? P.q : 0.88, max));
          const w = bmp.width * k * 0.75, h = bmp.height * k * 0.75;
          doc.addPage([w, h]).drawImage(im, { x: 0, y: 0, width: w, height: h });
        }
        const name = REC.name.trim() === '{nome}' ? (imgs.length > 1 ? 'imagens' : stem(imgs[0].name)) : applyName(REC.name, imgs[0], 1, 1);
        await write(imgs[0], `${name}.pdf`, (await doc.save()).buffer);
      }
      // planilhas → uma só
      if (sheets.length > 1 && REC.conv.sheet === 'merge') {
        progress(0, files.length, 'Juntando as planilhas…');
        const wb = XLSX.utils.book_new(), used = new Set();
        for (const f of sheets) {
          const src = await readSheet(f);
          for (const sn of src.SheetNames) {
            let nm = (src.SheetNames.length > 1 ? `${stem(f.name)}-${sn}` : stem(f.name)).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Aba';
            let k = 2; while (used.has(nm.toLowerCase())) nm = `${nm.slice(0, 28)}-${k++}`;
            used.add(nm.toLowerCase()); XLSX.utils.book_append_sheet(wb, src.Sheets[sn], nm);
          }
        }
        const name = REC.name.trim() === '{nome}' ? 'planilhas-juntas' : applyName(REC.name, sheets[0], 1, 1);
        await write(sheets[0], `${name}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
      }

      for (const [i, f] of files.entries()) {
        const k = kindOf(f), c = REC.conv[k] || 'keep';
        if ((k === 'img' && c === 'pdf') || (k === 'sheet' && c === 'merge' && sheets.length > 1)) continue;
        const base = applyName(REC.name, f, i + 1, files.length);
        progress(i, files.length, `${i + 1}/${files.length} · ${f.name}`);
        try {
          if (k === 'img') {
            let ext = c === 'keep' ? (f.ext === 'jpeg' ? 'jpg' : f.ext) : c;
            if (!MIME[ext]) ext = 'png';
            const same = ext === (f.ext === 'jpeg' ? 'jpg' : f.ext);
            if (same && !P) { await write(f, `${base}.${ext}`, await api.fileRead(f.path)); continue; }
            const bmp = await decodeImg(f);
            let data = ext === 'png' && P ? encodePngSmall(bmp, P.max, P.colors) : await encodeImg(bmp, MIME[ext], ext === 'png' ? undefined : (P ? P.q : 0.92), P ? P.max : undefined);
            if (same && data.byteLength >= f.size) data = await api.fileRead(f.path);
            await write(f, `${base}.${ext}`, data);
          } else if (k === 'heic') {
            outs.push(okOr(await api.convHeic({ input: f.path, outDir: dirFor(f), name: base, to: c })));
          } else if (k === 'video' || k === 'audio') {
            let op = c;
            if (c === 'keep') {
              if (!P) { await write(f, `${base}.${f.ext}`, await api.fileRead(f.path)); continue; }
              op = k === 'video' ? (f.ext === 'webm' ? 'webm' : f.ext === 'mov' ? 'mov' : 'mp4') : (['mp3', 'm4a', 'ogg'].includes(f.ext) ? f.ext : f.ext === 'opus' ? 'ogg' : f.ext === 'aac' ? 'm4a' : 'mp3');
            }
            outs.push(okOr(await api.convFF({ input: f.path, outDir: dirFor(f), name: base, op, shrink: P ? REC.shrink : null })));
          } else if (k === 'pdf') {
            if (c === 'docx') { outs.push(okOr(await api.convOffice({ input: f.path, outDir: dirFor(f), name: base, to: 'docx' }))); continue; }
            const bytes = new Uint8Array(await api.fileRead(f.path));
            if (c === 'img') {
              const pdf = await pdfjs().getDocument({ data: bytes }).promise;
              const dir = await api.fileMkdir(`${dirFor(f)}/${base} (páginas)`); let tot = 0;
              for (let n = 1; n <= pdf.numPages; n++) {
                progress(i + (n - 1) / pdf.numPages, files.length, `${f.name}: página ${n}/${pdf.numPages}`);
                const pg = await renderPage(pdf, n, P ? Math.max(1, P.max / 1400) : 2);
                tot += (await api.fileWrite(dir, `pagina-${String(n).padStart(2, '0')}.png`, await canvasBytes(pg.canvas, 'image/png'))).size;
              }
              outs.push({ path: dir, size: tot });
              continue;
            }
            let pdfBytes = bytes.buffer;
            if (P) {
              const PP = REC.shrink === 'forte' ? { scale: 1.1, q: 0.5 } : REC.shrink === 'medio' ? { scale: 1.5, q: 0.66 } : { scale: 1.8, q: 0.8 };
              const pdf = await pdfjs().getDocument({ data: bytes.slice() }).promise;
              const doc = await PDFLib.PDFDocument.create();
              for (let n = 1; n <= pdf.numPages; n++) {
                progress(i + (n - 1) / pdf.numPages, files.length, `${f.name}: página ${n}/${pdf.numPages}`);
                const pg = await renderPage(pdf, n, PP.scale);
                const im = await doc.embedJpg(await canvasBytes(pg.canvas, 'image/jpeg', PP.q));
                doc.addPage([pg.w, pg.h]).drawImage(im, { x: 0, y: 0, width: pg.w, height: pg.h });
              }
              const out = (await doc.save()).buffer;
              if (out.byteLength < f.size) pdfBytes = out;
            }
            if (c === 'split') {
              const src = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
              const n = src.getPageCount();
              for (let p = 0; p < n; p++) {
                const one = await PDFLib.PDFDocument.create();
                const [pg] = await one.copyPages(src, [p]); one.addPage(pg);
                await write(f, `${base}-p${String(p + 1).padStart(String(n).length < 2 ? 2 : String(n).length, '0')}.pdf`, (await one.save()).buffer);
              }
            } else await write(f, `${base}.pdf`, pdfBytes);
          } else if (k === 'sheet') {
            if (c === 'keep') { await write(f, `${base}.${f.ext}`, await api.fileRead(f.path)); continue; }
            if (c === 'pdf') {
              if (['csv', 'json'].includes(f.ext)) { const wb = await readSheet(f); outs.push(okOr(await api.convHtml({ html: textHtml(base, XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]])), outDir: dirFor(f), name: base }))); continue; }
              outs.push(okOr(await api.convOffice({ input: f.path, outDir: dirFor(f), name: base, to: 'pdf' }))); continue;
            }
            const wb = await readSheet(f);
            if (c === 'xlsx') await write(f, `${base}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
            else if (c === 'csv') {
              for (const [si, sn] of wb.SheetNames.entries()) {
                const csv = '﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[sn], { FS: ';' });
                await write(f, `${base}${wb.SheetNames.length > 1 ? '-' + sn : ''}.csv`, enc(csv));
                if (si > 30) break;
              }
            } else if (c === 'json') {
              const data = wb.SheetNames.length > 1 ? Object.fromEntries(wb.SheetNames.map(sn => [sn, XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null })])) : XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
              await write(f, `${base}.json`, enc(JSON.stringify(data, null, 2)));
            }
          } else if (k === 'doc' || k === 'slides') {
            if (c === 'keep') { await write(f, `${base}.${f.ext}`, await api.fileRead(f.path)); continue; }
            outs.push(okOr(await api.convOffice({ input: f.path, outDir: dirFor(f), name: base, to: c })));
          } else if (k === 'text') {
            if (c === 'keep') { await write(f, `${base}.${f.ext}`, await api.fileRead(f.path)); continue; }
            if (['html', 'htm'].includes(f.ext)) outs.push(okOr(await api.convHtml({ file: f.path, outDir: dirFor(f), name: base })));
            else {
              const txt = new TextDecoder().decode(await api.fileRead(f.path));
              const body = ['md', 'markdown'].includes(f.ext) ? md(txt) : `<pre>${esc(txt)}</pre>`;
              outs.push(okOr(await api.convHtml({ html: textHtml(base, body), outDir: dirFor(f), name: base })));
            }
          } else {
            await write(f, `${base}${f.ext ? '.' + f.ext : ''}`, await api.fileRead(f.path));
          }
        } catch (e) { errors.push(`${f.name}: ${errMsg(e)}`); }
      }
      let paths = outs.map(o => o.path);
      const after = outs.reduce((a, o) => a + (o.size || 0), 0);
      if (REC.zip && paths.length) { progress(1, 1, 'Compactando…'); const z = await api.fileZip(paths); await api.fileTrash(paths).catch(() => {}); paths = [z]; }
      if (REC.copy && paths.length) await api.fileCopyClip(paths);
      if (REC.trash && !errors.length) await api.fileTrash(files.map(f => f.path));
      if (REC.show && paths.length) api.fileShow(paths[0]);
      $('#bbFill').style.width = '100%';
      const diff = after && after < before ? ` · ${fmtSize(before)} → ${fmtSize(after)} (−${Math.round((1 - after / before) * 100)}%)` : '';
      errors.forEach(e => log(false, e));
      if (outs.length) log(true, `${files.length - errors.length} arquivo(s) prontos${REC.zip ? ' num .zip' : ''}${diff}${REC.copy ? ' · copiados' : ''}${REC.trash && !errors.length ? ' · originais na Lixeira' : ''}`, paths);
      lastBatchMsg = errors.length ? `Pronto, com ${errors.length} erro(s)` : 'Pronto!';
      $('#bbStatus').textContent = lastBatchMsg;
      setState(errors.length ? 'error' : 'seen', errors.length ? `${errors.length} arquivo(s) deram erro` : 'Tudo pronto!');
      if (REC.trash && !errors.length) { FILES = []; REC.trash = false; }
    } catch (e) {
      log(false, errMsg(e)); $('#bbStatus').textContent = ''; setState('error', 'Não consegui terminar o lote');
    } finally {
      fbusy = false;
      setTimeout(() => { const b = $('#bbBar'); if (b) b.hidden = true; }, 1500);
      renderFiles();
    }
  }

  // ----- ações rápidas (uma coisa só) -----
  function renderQuick() {
    const all = (arr) => FILES.length && FILES.every(f => !f.isDir && arr.includes(f.ext));
    const g = [];
    if (all(['pdf'])) g.push(['PDF', `${FILES.length > 1 ? `<button class="btn" data-act="pdfmerge">Juntar os ${FILES.length} PDFs</button>` : ''}<button class="btn" data-act="pdfrot" title="Gira todas as páginas 90° no sentido horário">Girar 90°</button><span class="pgx"><input id="pdfPages" placeholder="páginas: 1-3, 5" spellcheck="false"><button class="btn" data-act="pdfext">Extrair</button></span>`]);
    if (all(ARCH)) g.push(['Arquivo compactado', `<button class="btn" data-act="unzip">Descompactar</button>`]);
    if (FILES.length) g.push(['Ações rápidas', `<button class="btn" data-act="zip">Compactar em .zip</button><button class="btn danger" data-act="trash">Mandar pra Lixeira</button>${fileActs(FILES.length)}<button class="link" data-act="clear">Limpar lista</button>`]);
    $('#fileActions').innerHTML = g.map(([l, h]) => `<div class="fgroup"><span class="gl">${l}</span>${h}</div>`).join('');
    wireActs($('#fileActions'), FILES.map(f => f.path));
    $$('#fileActions [data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act, b)));
  }
  // ações de arquivo: copiar, enviar para, compartilhar, mostrar
  const fileActs = (n) => `<span class="facts"><button class="fa" data-fa="copy" type="button" title="Copiar o arquivo (cola com Ctrl+V)"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>Copiar</button><button class="fa" data-fa="send" type="button" title="Copiar para uma pasta"><svg viewBox="0 0 24 24"><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M10 13.5h6M13.5 11l2.5 2.5-2.5 2.5"/></svg>Enviar para…</button><button class="fa" data-fa="share" type="button" title="Compartilhar"><svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12"/></svg>Compartilhar</button>${n === 1 ? `<button class="fa" data-fa="show" type="button" title="Mostrar na pasta"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg></button>` : ''}</span>`;
  function wireActs(root, paths) {
    root.querySelectorAll('[data-fa]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); doAct(b.dataset.fa, paths, b); }));
  }
  async function doAct(a, paths, btn) {
    try {
      if (a === 'show') return api.fileShow(paths[0]);
      if (a === 'copy') { await api.fileCopyClip(paths); setState('seen', paths.length > 1 ? 'Arquivos copiados: cola com Ctrl+V' : 'Arquivo copiado: cola com Ctrl+V'); return; }
      if (a === 'send') { const r = await api.fileSendTo(paths); if (r) { setState('seen', 'Enviado!'); log(true, `Copiado para ${r[0].split(/[\\/]/).slice(-2, -1)[0]}`, r[0], false); } return; }
      if (a === 'share') return shareMenu(btn, paths);
    } catch (e) { setState('error', 'Não deu: ' + e.message); }
  }
  function shareMenu(anchor, paths) {
    document.querySelectorAll('.share-pop').forEach(x => x.remove());
    const pop = document.createElement('div'); pop.className = 'share-pop';
    pop.innerHTML = [['email', 'E-mail', '<path d="M4 6.5h16v11H4z"/><path d="M4 7l8 6 8-6"/>'], ['whatsapp', 'WhatsApp', '<path d="M5 19l1.2-3.6A7.5 7.5 0 1 1 9 18.3z"/>'], ['teams', 'Teams', '<rect x="4" y="6" width="11" height="12" rx="2"/><path d="M8 9.5h3.5M9.7 9.5V15"/><circle cx="18" cy="9" r="2"/>']]
      .map(([k, l, ic]) => `<button type="button" data-via="${k}"><svg viewBox="0 0 24 24">${ic}</svg>${l}</button>`).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - 180) + 'px'; pop.style.top = (r.bottom + 6 + 130 > innerHeight ? r.top - 136 : r.bottom + 6) + 'px';
    pop.querySelectorAll('[data-via]').forEach(b => b.addEventListener('click', async () => {
      pop.remove();
      const res = await api.fileShare(paths, b.dataset.via);
      setState('seen', res.how === 'outlook' ? 'E-mail aberto com o anexo' : `Arquivo copiado: cole (Ctrl+V) no ${b.textContent}`);
    }));
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', off); } }), 0);
  }
  function log(ok, text, outPath, acts = true) {
    const paths = Array.isArray(outPath) ? outPath.filter(Boolean) : outPath ? [outPath] : [];
    const el = document.createElement('div'); el.className = ok ? 'ok' : 'bad';
    el.innerHTML = `<span class="lt"><span>${ok ? '✓' : '✗'}</span><span>${esc(text)}</span></span>${paths.length && acts ? fileActs(paths.length === 1 ? 1 : 2) + (paths.length > 1 ? `<button class="fa" data-fa="show" type="button" title="Mostrar na pasta"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg></button>` : '') : paths.length ? `<button class="link" type="button" data-fa="show">Mostrar</button>` : ''}`;
    if (paths.length) wireActs(el, paths);
    $('#fileLog').prepend(el);
  }
  function busyUI(on, txt) {
    fbusy = on; $$('#fileActions .btn').forEach(b => { b.disabled = on; });
    if (on) setState('working', txt || 'Mexendo nos arquivos…'); else setState('idle');
  }

  async function decodeImg(fp) {
    const p = typeof fp === 'string' ? fp : fp.path;
    const buf = await api.fileRead(p);
    if (/\.svg$/i.test(p)) {
      const url = URL.createObjectURL(new Blob([buf], { type: 'image/svg+xml' }));
      try {
        const img = new Image(); img.src = url; await img.decode();
        const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024, k = Math.max(1, 1600 / Math.max(w, h));
        return await createImageBitmap(img, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k) });
      } finally { URL.revokeObjectURL(url); }
    }
    return createImageBitmap(new Blob([buf]));
  }
  async function encodeImg(bmp, type, quality, maxSide) {
    let w = bmp.width, h = bmp.height;
    if (maxSide && Math.max(w, h) > maxSide) { const k = maxSide / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
    x.drawImage(bmp, 0, 0, w, h);
    return (await c.convertToBlob({ type, quality })).arrayBuffer();
  }
  function hasAlpha(bmp) {
    const c = new OffscreenCanvas(48, 48), x = c.getContext('2d'); x.drawImage(bmp, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true; return false;
  }
  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  const SHRINK = { leve: { q: 0.85, max: 3200, colors: 0 }, medio: { q: 0.72, max: 2200, colors: 256 }, forte: { q: 0.55, max: 1600, colors: 128 } };
  // PNG com perda (estilo TinyPNG): reduz a paleta de cores; colors 0 = sem perda, só recomprime
  function encodePngSmall(bmp, maxSide, colors) {
    let w = bmp.width, h = bmp.height;
    if (maxSide && Math.max(w, h) > maxSide) { const k = maxSide / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    x.drawImage(bmp, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data;
    return UPNG.encode([px.buffer], w, h, colors || 0);
  }

  let pdfReady = false;
  function pdfjs() { if (!pdfReady) { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; pdfReady = true; } return pdfjsLib; }
  async function renderPage(pdf, n, scale) {
    const page = await pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { canvas: c, w: vp1.width, h: vp1.height };
  }
  const canvasBytes = (c, type, q) => new Promise(r => c.toBlob(b => b.arrayBuffer().then(r), type, q));

  function parsePages(txt, max) {
    const out = [];
    for (const part of String(txt).split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:-(\d*))?$/); if (!m) throw new Error(`Não entendi "${part}". Use algo como 1-3, 5`);
      const a = +m[1], b = m[2] === undefined ? a : m[2] === '' ? max : +m[2];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max && !out.includes(i - 1)) out.push(i - 1);
    }
    if (!out.length) throw new Error('Nenhuma página válida nesse intervalo.');
    return out;
  }
  async function pdfTools(kind) {
    const txt = ($('#pdfPages') || {}).value || '';
    if (kind === 'pdfext' && !txt.trim()) { setState('error', 'Diga quais páginas (ex.: 1-3, 5)'); $('#pdfPages').focus(); return; }
    busyUI(true);
    try {
      for (const f of FILES) {
        busyUI(true, `${kind === 'pdfrot' ? 'Girando' : 'Extraindo'} ${f.name}…`);
        const src = await PDFLib.PDFDocument.load(await api.fileRead(f.path), { ignoreEncryption: true });
        let doc = src, suf = 'girado';
        if (kind === 'pdfrot') src.getPages().forEach(p => p.setRotation(PDFLib.degrees((p.getRotation().angle + 90) % 360)));
        else {
          const idx = parsePages(txt, src.getPageCount());
          doc = await PDFLib.PDFDocument.create();
          (await doc.copyPages(src, idx)).forEach(p => doc.addPage(p));
          suf = 'p' + txt.trim().replace(/\s+/g, '').replace(/[,;]/g, '_');
        }
        const r = await api.fileWrite(dirOf(f.path), `${stem(f.name)}-${suf}.pdf`, (await doc.save()).buffer);
        log(true, kind === 'pdfrot' ? `${f.name} girado` : `${doc.getPageCount()} página(s) extraída(s) de ${f.name}`, r.path);
      }
      setState('seen', 'Pronto!');
    } catch (e) { log(false, errMsg(e)); setState('error', 'Não deu certo'); }
    finally { busyUI(false); }
  }
  async function act(a, btn) {
    if (fbusy) return;
    const [kind, opt] = a.split(':');
    if (kind === 'clear') { FILES = []; renderFiles(); return; }
    if (kind === 'pdfrot' || kind === 'pdfext') return pdfTools(kind);
    if (kind === 'trash') return twoClick(btn, async () => {
      try { await api.fileTrash(FILES.map(f => f.path)); log(true, `${FILES.length} item(ns) na Lixeira (dá pra recuperar por lá)`); FILES = []; renderFiles(); }
      catch (e) { log(false, e.message); }
    }, 'Confirmar: mandar pra Lixeira?');
    busyUI(true);
    try {
      if (kind === 'img') {
        for (const f of FILES) {
          busyUI(true, `Convertendo ${f.name}…`);
          const bmp = await decodeImg(f.path);
          const data = await encodeImg(bmp, MIME[opt], opt === 'png' ? undefined : 0.92);
          const r = await api.fileWrite(dirOf(f.path), `${stem(f.name)}.${opt}`, data);
          log(true, `${f.name} → ${r.path.split(/[\\/]/).pop()} (${fmtSize(r.size)})`, r.path);
        }
      } else if (kind === 'shrink') {
        const P = SHRINK[opt];
        for (const f of FILES) {
          busyUI(true, `Diminuindo ${f.name}…`);
          const bmp = await decodeImg(f.path);
          let ext = f.ext === 'jpeg' ? 'jpg' : f.ext;
          if (!['jpg', 'webp'].includes(ext)) ext = hasAlpha(bmp) ? 'webp' : 'jpg';
          const data = await encodeImg(bmp, MIME[ext], P.q, P.max);
          if (data.byteLength >= f.size) { log(true, `${f.name} já estava leve (${fmtSize(f.size)}), deixei como está`); continue; }
          const r = await api.fileWrite(dirOf(f.path), `${stem(f.name)}-menor.${ext}`, data);
          log(true, `${f.name}: ${fmtSize(f.size)} → ${fmtSize(r.size)} (−${Math.round((1 - r.size / f.size) * 100)}%)`, r.path);
        }
      } else if (kind === 'img2pdf') {
        const doc = await PDFLib.PDFDocument.create();
        for (const [i, f] of FILES.entries()) {
          busyUI(true, `Montando PDF ${i + 1}/${FILES.length}…`);
          const bmp = await decodeImg(f.path);
          const jpg = await encodeImg(bmp, 'image/jpeg', 0.85, 2400);
          const im = await doc.embedJpg(jpg);
          const w = bmp.width * 0.75, h = bmp.height * 0.75;
          doc.addPage([w, h]).drawImage(im, { x: 0, y: 0, width: w, height: h });
        }
        const bytes = await doc.save();
        const r = await api.fileWrite(dirOf(FILES[0].path), `${FILES.length > 1 ? 'imagens' : stem(FILES[0].name)}.pdf`, bytes.buffer);
        log(true, `PDF criado com ${FILES.length} página(s) (${fmtSize(r.size)})`, r.path);
      } else if (kind === 'pdfshrink') {
        const P = opt === 'forte' ? { scale: 1.1, q: 0.5 } : { scale: 1.5, q: 0.66 };
        for (const f of FILES) {
          const pdf = await pdfjs().getDocument({ data: new Uint8Array(await api.fileRead(f.path)) }).promise;
          const doc = await PDFLib.PDFDocument.create();
          for (let n = 1; n <= pdf.numPages; n++) {
            busyUI(true, `Diminuindo ${f.name}: página ${n}/${pdf.numPages}…`);
            const pg = await renderPage(pdf, n, P.scale);
            const im = await doc.embedJpg(await canvasBytes(pg.canvas, 'image/jpeg', P.q));
            doc.addPage([pg.w, pg.h]).drawImage(im, { x: 0, y: 0, width: pg.w, height: pg.h });
          }
          const bytes = await doc.save();
          if (bytes.byteLength >= f.size) { log(true, `${f.name} já estava leve (${fmtSize(f.size)}), deixei como está`); continue; }
          const r = await api.fileWrite(dirOf(f.path), `${stem(f.name)}-menor.pdf`, bytes.buffer);
          log(true, `${f.name}: ${fmtSize(f.size)} → ${fmtSize(r.size)} (−${Math.round((1 - r.size / f.size) * 100)}%)`, r.path);
        }
      } else if (kind === 'pdf2img') {
        for (const f of FILES) {
          const pdf = await pdfjs().getDocument({ data: new Uint8Array(await api.fileRead(f.path)) }).promise;
          const dir = await api.fileMkdir(`${dirOf(f.path)}/${stem(f.name)} (páginas)`);
          for (let n = 1; n <= pdf.numPages; n++) {
            busyUI(true, `${f.name}: página ${n}/${pdf.numPages}…`);
            const pg = await renderPage(pdf, n, 2);
            await api.fileWrite(dir, `pagina-${String(n).padStart(2, '0')}.png`, await canvasBytes(pg.canvas, 'image/png'));
          }
          log(true, `${f.name}: ${pdf.numPages} imagem(ns) na pasta "${dir.split(/[\\/]/).pop()}"`, dir);
        }
      } else if (kind === 'pdfmerge') {
        const out = await PDFLib.PDFDocument.create();
        for (const f of FILES) {
          busyUI(true, `Juntando ${f.name}…`);
          const src = await PDFLib.PDFDocument.load(await api.fileRead(f.path), { ignoreEncryption: true });
          (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
        }
        const r = await api.fileWrite(dirOf(FILES[0].path), 'juntado.pdf', (await out.save()).buffer);
        log(true, `PDFs juntados em ${r.path.split(/[\\/]/).pop()} (${fmtSize(r.size)})`, r.path);
      } else if (kind === 'zip') {
        busyUI(true, 'Compactando…');
        const out = await api.fileZip(FILES.map(f => f.path));
        log(true, `Compactado em ${out.split(/[\\/]/).pop()}`, out);
      } else if (kind === 'unzip') {
        for (const f of FILES) { busyUI(true, `Descompactando ${f.name}…`); const d = await api.fileUnzip(f.path); log(true, `${f.name} → pasta "${d.split(/[\\/]/).pop()}"`, d); }
      }
      busyUI(false); setState('seen', 'Prontinho!');
    } catch (e) { busyUI(false); log(false, e.message || String(e)); setState('error', 'Não consegui mexer no arquivo'); }
  }

  // ---------------- NOTAS ----------------
  let NOTES = [], curNote = null, saveT = null;
  const noteTitle = (n) => (n.text || '').split('\n').find(l => l.trim())?.trim().slice(0, 50) || 'Nota vazia';
  async function loadNotes() {
    NOTES = await api.notesList();
    if (!NOTES.length) { await newNote(); return; }
    if (!curNote || !NOTES.find(n => n.id === curNote)) curNote = sortNotes(NOTES)[0].id;
    renderNotes(); fillNote();
  }
  const sortNotes = (l) => [...l].sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  function renderNotes() {
    const q = $('#noteSearch').value.trim().toLowerCase();
    const list = sortNotes(NOTES).filter(n => !q || (n.text || '').toLowerCase().includes(q));
    $('#notesList').innerHTML = list.map(n => `<button type="button" class="nitem ${n.id === curNote ? 'on' : ''}" data-id="${n.id}"><div class="t">${n.pinned ? '📌 ' : ''}${esc(noteTitle(n))}</div><div class="s">${new Date(n.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc((n.text || '').split('\n').slice(1).join(' ').slice(0, 40))}</div></button>`).join('') || '<p class="muted">Nada encontrado.</p>';
    $$('#notesList .nitem').forEach(b => b.addEventListener('click', () => { flushNote(); curNote = b.dataset.id; renderNotes(); fillNote(); }));
  }
  function fillNote() {
    const n = NOTES.find(x => x.id === curNote); if (!n) return;
    $('#noteText').value = n.text || '';
    $('#notePin').textContent = n.pinned ? 'Desafixar' : 'Fixar';
    $('#noteInfo').textContent = `Salva · ${(n.text || '').length} caracteres`;
  }
  async function newNote() {
    flushNote();
    const n = await api.noteSave({ text: '' }); NOTES.unshift(n); curNote = n.id; renderNotes(); fillNote(); $('#noteText').focus();
  }
  function flushNote() { if (saveT) { clearTimeout(saveT); saveT = null; doSave(); } }
  async function doSave() {
    const n = NOTES.find(x => x.id === curNote); if (!n) return;
    const saved = await api.noteSave({ id: n.id, text: $('#noteText').value });
    Object.assign(n, saved); $('#noteInfo').textContent = `Salva · ${(n.text || '').length} caracteres`; renderNotes();
  }
  $('#noteText').addEventListener('input', () => { $('#noteInfo').textContent = 'Salvando…'; clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; doSave(); }, 500); });
  window.openNote = (id) => { flushNote(); curNote = id; loadNotes(); };
  api.onNotes(() => { if (tool === 'notas' && !saveT) loadNotes(); });
  $('#noteNew').addEventListener('click', newNote);
  $('#noteSearch').addEventListener('input', renderNotes);
  $('#notePin').addEventListener('click', async () => { const n = NOTES.find(x => x.id === curNote); if (!n) return; Object.assign(n, await api.noteSave({ id: n.id, pinned: !n.pinned })); renderNotes(); fillNote(); });
  $('#noteCopy').addEventListener('click', (e) => copy($('#noteText').value, e.currentTarget));
  $('#noteDel').addEventListener('click', (e) => twoClick(e.currentTarget, async () => { NOTES = await api.noteDelete(curNote); curNote = null; loadNotes(); }, 'Apagar mesmo?'));

  // ---------------- COFRE (chaves e contas) ----------------
  let VAULT = [], editing = null, vKind = 'chave', vFilter = 'all';
  async function loadVault() { VAULT = await api.vaultList(); renderVault(); }
  const ICON_KEY = '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/></svg>';
  const ICON_USER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>';
  function renderVault() {
    const q = $('#vSearch').value.trim().toLowerCase();
    const list = VAULT.filter(v => (vFilter === 'all' || (v.kind || 'chave') === vFilter) && (!q || `${v.name} ${v.user} ${v.url} ${v.note}`.toLowerCase().includes(q)));
    $('#vaultList').innerHTML = list.map(v => {
      const conta = v.kind === 'conta';
      return `<div class="vitem ${conta ? 'conta' : 'chave'}" data-id="${v.id}">
        <span class="vic">${conta ? ICON_USER : ICON_KEY}</span>
        <div style="min-width:0"><div class="n">${esc(v.name)}${conta && v.url ? ` <button class="link vurl" type="button">${esc(v.url.replace(/^https?:\/\//, ''))} ↗</button>` : ''}</div>
          ${conta && v.user ? `<div class="u">${esc(v.user)}</div>` : ''}
          <div class="v">••••••••••${esc(v.hint || '')}</div>${v.note ? `<div class="muted">${esc(v.note)}</div>` : ''}</div>
        <div class="acts">${conta && v.user ? '<button class="btn sm" data-a="user">Copiar usuário</button>' : ''}<button class="btn primary sm" data-a="copy">${conta ? 'Copiar senha' : 'Copiar'}</button><button class="mini" data-a="show" title="Mostrar por 10s"><svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg></button><button class="mini" data-a="edit" title="Editar"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button><button class="mini" data-a="del" title="Apagar"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></div></div>`;
    }).join('') || `<p class="muted">${VAULT.length ? 'Nada encontrado.' : 'Nada guardado ainda. Clique em <b>+ Novo</b> e escolha entre chave/token ou conta (login e senha).'}</p>`;
    $$('#vaultList .vitem').forEach(el => {
      const id = el.dataset.id, v = VAULT.find(x => x.id === id);
      const u = el.querySelector('.vurl'); if (u) u.addEventListener('click', () => api.vaultOpenUrl(v.url));
      const cu = el.querySelector('[data-a="user"]'); if (cu) cu.addEventListener('click', (e) => copy(v.user, e.currentTarget));
      el.querySelector('[data-a="copy"]').addEventListener('click', async (e) => { await api.vaultCopy(id); const b = e.currentTarget, o = b.textContent; b.textContent = 'Copiado (30s)'; setTimeout(() => { b.textContent = o; }, 2000); });
      el.querySelector('[data-a="show"]').addEventListener('click', async () => {
        const box = el.querySelector('.v'); box.textContent = await api.vaultReveal(id); box.classList.add('shown');
        setTimeout(() => { box.textContent = '••••••••••' + (v.hint || ''); box.classList.remove('shown'); }, 10000);
      });
      el.querySelector('[data-a="edit"]').addEventListener('click', () => openVaultForm(v));
      el.querySelector('[data-a="del"]').addEventListener('click', (e) => {
        const b = e.currentTarget;
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.style.color = 'var(--red)'; b.title = 'Clique de novo para apagar'; setTimeout(() => { delete b.dataset.armed; b.style.color = ''; }, 2500); return; }
        api.vaultDelete(id).then(l => { VAULT = l; renderVault(); });
      });
    });
  }
  function setKind(k) {
    vKind = k;
    $$('#vKind button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    $$('#vaultForm [data-only]').forEach(el => { el.hidden = el.dataset.only !== k; });
    $('#vName').placeholder = k === 'conta' ? 'Nome (ex.: Banco, E-mail do trabalho)' : 'Nome (ex.: Token GitHub, chave de API)';
    $('#vValue').placeholder = editing ? 'Nova senha/chave (vazio = mantém a atual)' : k === 'conta' ? 'Senha (fica criptografada)' : 'Chave (fica criptografada)';
  }
  function openVaultForm(v) {
    editing = v ? v.id : null;
    $('#vaultForm').hidden = false;
    $('#vName').value = v ? v.name : ''; $('#vUser').value = v ? v.user : ''; $('#vUrl').value = v ? v.url : ''; $('#vNote').value = v ? v.note : ''; $('#vValue').value = '';
    $('#vValue').type = 'password';
    setKind(v ? (v.kind || 'chave') : (vFilter === 'conta' ? 'conta' : 'chave'));
    $('#vSave').textContent = v ? 'Salvar' : 'Guardar';
    $('#vName').focus();
  }
  function closeVaultForm() { editing = null; $('#vaultForm').reset(); $('#vaultForm').hidden = true; }
  $$('#vKind button').forEach(b => b.addEventListener('click', () => setKind(b.dataset.k)));
  $$('#vFilter button').forEach(b => b.addEventListener('click', () => { vFilter = b.dataset.f; $$('#vFilter button').forEach(x => x.classList.toggle('on', x === b)); renderVault(); }));
  $('#vSearch').addEventListener('input', renderVault);
  $('#vNew').addEventListener('click', () => openVaultForm(null));
  $('#vCancel').addEventListener('click', closeVaultForm);
  $('#vEye').addEventListener('click', () => { const i = $('#vValue'); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('#vGen').addEventListener('click', () => {
    const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_+='];
    const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
    let pw = sets.map(c => c[rnd(c.length)]).join('');
    const all = sets.join(''); while (pw.length < 18) pw += all[rnd(all.length)];
    pw = pw.split('').sort(() => rnd(3) - 1).join('');
    const i = $('#vValue'); i.value = pw; i.type = 'text';
  });
  $('#vaultForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editing && !$('#vValue').value) { $('#vValue').focus(); return; }
    await api.vaultSave({ id: editing, kind: vKind, name: $('#vName').value, user: $('#vUser').value, url: $('#vUrl').value, value: $('#vValue').value, note: $('#vNote').value });
    closeVaultForm(); loadVault();
  });

  // ---------------- REUNIÃO ----------------
  let MEETS = [], meet = null, saveMT = null, sumText = '';
  const R = { on: false, t0: 0, tick: null, nodes: [] };
  async function loadMeetings() {
    MEETS = await api.meetingList();
    renderMeetSel();
    if (!meet && MEETS[0] && !R.on) await openMeet(MEETS[0].id);
    else if (!meet) blankMeet();
  }
  function renderMeetSel() {
    $('#meetSel').innerHTML = `<option value="__new">+ Nova reunião</option>` + MEETS.map(m => `<option value="${m.id}" ${meet && m.id === meet.id ? 'selected' : ''}>${esc(m.title)}</option>`).join('');
    if (!meet) $('#meetSel').value = '__new';
  }
  function blankMeet() { meet = null; $('#meetTitle').value = ''; $('#meetNotes').value = ''; sumText = ''; renderTr(); renderSum(); }
  async function openMeet(id) {
    meet = await api.meetingGet(id);
    $('#meetTitle').value = meet.title; $('#meetNotes').value = meet.notes || ''; sumText = meet.summary || '';
    renderMeetSel(); renderTr(); renderSum();
  }
  async function ensureMeet() {
    if (meet) return meet;
    meet = await api.meetingStart({ title: $('#meetTitle').value });
    $('#meetTitle').value = meet.title; MEETS = await api.meetingList(); renderMeetSel();
    return meet;
  }
  $('#meetSel').addEventListener('change', async (e) => {
    if (R.on) { e.target.value = meet.id; setState('error', 'Pare a gravação antes de trocar'); return; }
    if (e.target.value === '__new') blankMeet(); else await openMeet(e.target.value);
  });
  $('#meetTitle').addEventListener('change', async () => { if (meet) { await api.meetingUpdate(meet.id, { title: $('#meetTitle').value }); MEETS = await api.meetingList(); renderMeetSel(); } });
  const ta = $('#meetNotes');
  ta.addEventListener('focus', () => { if (!ta.value) ta.value = `[${hhmm()}] `; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const s = ta.selectionStart, ins = `\n[${hhmm()}] `;
      ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + ins.length; ta.dispatchEvent(new Event('input'));
    }
  });
  ta.addEventListener('input', () => { clearTimeout(saveMT); saveMT = setTimeout(async () => { const m = await ensureMeet(); api.meetingUpdate(m.id, { notes: ta.value }); }, 600); });

  function segHTML(s) { return `<div class="seg t-${s.track}"><span class="who">${hhmm(s.t)} ${s.track === 'mic' ? 'Você' : 'Outros'}</span><span>${esc(s.text)}</span></div>`; }
  function renderTr() {
    const box = $('#meetTr'), segs = meet?.segments || [];
    // junta falas seguidas da mesma pessoa (os trechos ao vivo são curtos)
    const grp = [];
    for (const x of segs) { const g = grp[grp.length - 1]; if (g && g.track === x.track && x.t - g.last < 25000) { g.text += ' ' + x.text; g.last = x.t; } else grp.push({ ...x, last: x.t }); }
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = grp.length ? grp.map(segHTML).join('') + (R.on ? '<div class="live-dot"><i></i><i></i><i></i> ouvindo</div>' : '')
      : `<div class="empty">${R.on ? 'Ouvindo… o texto aparece aqui poucos segundos depois de cada fala.' : 'Clique em <b>Gravar</b> para transcrever a reunião ao vivo (áudio do PC + seu microfone). Tudo roda no seu PC, de graça.'}</div>`;
    if (near || !R.on) box.scrollTop = box.scrollHeight;
  }
  function renderSum() {
    const has = !!sumText;
    $('#meetSumBox').innerHTML = has ? md(sumText) : '<p class="muted">O resumo aparece aqui: resumo, decisões, tarefas e pendências.</p>';
    $('#meetSumActions').hidden = !has;
  }
  function meetTab(t) {
    $$('.mtab').forEach(b => b.classList.toggle('on', b.dataset.mt === t));
    $('#meetTr').hidden = t !== 'tr'; $('#meetSumBox').hidden = t !== 'sum';
    $('#meetSumActions').hidden = t !== 'sum' || !sumText;
  }
  $$('.mtab').forEach(b => b.addEventListener('click', () => meetTab(b.dataset.mt)));

  api.onMeetingSegment(({ meetingId, seg }) => {
    if (meet && meet.id === meetingId) { meet.segments = [...(meet.segments || []), seg].sort((a, b) => a.t - b.t); renderTr(); }
  });
  let lagWarned = false;
  api.onMeetingQueue(({ pending, lag, loading, model }) => {
    $('#meetQueue').textContent = loading ? '· carregando o modelo de voz…' : lag > 12 ? `· atrasado ${lag}s (${pending} na fila)` : '';
    if (lag > 40 && model === 'turbo' && !lagWarned) { lagWarned = true; setState('error', 'O Turbo não está acompanhando ao vivo. Em Config > Voz, o Small é bem mais rápido.'); }
  });
  api.onMeetingWarn(({ error }) => setState('error', 'Reunião: ' + error));

  function pcmNode(stream, track) {
    const ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      const f = e.inputBuffer.getChannelData(0), out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) { const x = Math.max(-1, Math.min(1, f[i])); out[i] = x < 0 ? x * 0x8000 : x * 0x7fff; }
      api.meetingPcm(track, out.buffer);
    };
    src.connect(proc); proc.connect(ctx.destination);
    return { ctx, stream };
  }
  window.meetStartWith = async (title) => {
    if (R.on) return;
    await loadMeetings(); blankMeet(); $('#meetTitle').value = title || ''; startRec();
  };
  async function startRec() {
    const vs = await api.voiceStatus();
    if (!vs.ready) { setState('error', 'Baixe a voz primeiro (Config > Voz)'); go('config'); return; }
    const m = await ensureMeet();
    let mic = null, sys = null;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch { setState('error', 'Sem acesso ao microfone'); }
    try {
      sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      sys.getVideoTracks().forEach(t => t.stop());
      if (!sys.getAudioTracks().length) sys = null;
    } catch { sys = null; }
    if (!mic && !sys) { setState('error', 'Não consegui ouvir nada (microfone nem áudio do PC)'); return; }
    if (!sys) setState('error', 'Sem o áudio do PC: gravando só o seu microfone');
    R.nodes = [mic && pcmNode(mic, 'mic'), sys && pcmNode(new MediaStream(sys.getAudioTracks()), 'sys')].filter(Boolean);
    R.extra = sys;
    await api.meetingRec(m.id, true);
    R.on = true; R.t0 = Date.now();
    $('#meetRec').classList.add('on'); $('#meetRecTxt').textContent = 'Parar'; $('#meetBanner').hidden = false; $('#recDot').hidden = false;
    const tick = () => { const s = Math.floor((Date.now() - R.t0) / 1000); $('#meetTimer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; renderBar(); };
    tick(); R.tick = setInterval(tick, 1000);
    renderTr(); meetTab('tr');
  }
  async function stopRec() {
    clearInterval(R.tick);
    R.nodes.forEach(n => { try { n.stream.getTracks().forEach(t => t.stop()); n.ctx.close(); } catch {} });
    try { R.extra && R.extra.getTracks().forEach(t => t.stop()); } catch {}
    R.nodes = []; R.on = false;
    await api.meetingRec(meet.id, false);
    await api.meetingUpdate(meet.id, { endedAt: Date.now() });
    $('#meetRec').classList.remove('on'); $('#meetRecTxt').textContent = 'Gravar'; $('#meetBanner').hidden = true; $('#recDot').hidden = true; $('#meetTimer').textContent = '';
    renderBar(); renderTr();
    setState('seen', 'Gravação parada. Quando terminar de transcrever, gere o resumo.');
  }
  $('#meetRec').addEventListener('click', () => (R.on ? stopRec() : startRec()));

  let sumLive = false;
  api.onMeetingDelta(({ id, text }) => { if (meet && id === meet.id && sumLive) { sumText += text; renderSum(); $('#meetSumBox').scrollTop = 1e9; } });
  $('#meetSum').addEventListener('click', async () => {
    const m = await ensureMeet();
    meetTab('sum'); sumText = ''; sumLive = true; renderSum(); $('#meetSum').disabled = true;
    setState('working', 'Resumindo a reunião…');
    try { sumText = await api.meetingSummary(m.id, $('#meetModel').value); renderSum(); meetTab('sum'); setState('seen', 'Resumo pronto!'); }
    catch (e) { sumText = ''; renderSum(); setState('error', e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    sumLive = false; $('#meetSum').disabled = false;
  });
  $('#meetCopy').addEventListener('click', (e) => copy(sumText, e.currentTarget));
  $('#meetToNip').addEventListener('click', async () => {
    const t = (sumText.split(/##\s*Tarefas/i)[1] || '').split(/\n##\s/)[0].trim();
    if (!t) { setState('error', 'Não achei a seção de tarefas no resumo'); return; }
    const n = nipSession(); go('chat'); await openSession(n.id);
    send(`chegou demanda (tarefas da reunião "${meet.title}"):\n${t}`, n.id);
  });
  $('#meetDel').addEventListener('click', (e) => twoClick(e.currentTarget, async () => { if (R.on) return; await api.meetingDelete(meet.id); meet = null; MEETS = await api.meetingList(); renderMeetSel(); blankMeet(); }, 'Apagar mesmo?'));

  // ---------------- MÚSICA ----------------
  let NOW = { playing: false };
  const appName = (a = '') => (/spotify/i.test(a) ? 'Spotify' : /chrome|msedge|firefox|opera|brave/i.test(a) ? 'Navegador' : /electron|ilha/i.test(a) ? 'Bit' : a.replace(/\.exe$/i, '').split(/[!\\.]/).pop() || 'PC');
  const PLAY = '<path d="M8 5v14l11-7z"/>', PAUSE = '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>';
  function renderNow() {
    const has = !!NOW.title;
    $('#nowTitle').textContent = has ? NOW.title : 'Nada tocando';
    $('#nowArtist').textContent = has ? [NOW.artist, NOW.album].filter(Boolean).join(' · ') : 'Toca algo no Spotify, YouTube…';
    $('#nowApp').textContent = has ? `Tocando no ${appName(NOW.app)}` : 'Tocando agora no PC';
    $('#nowPP').innerHTML = NOW.playing ? PAUSE : PLAY;
  }
  api.onMusicNow((n) => { NOW = n || { playing: false }; renderNow(); renderBar(); });
  api.musicNow().then(n => { NOW = n || NOW; renderNow(); renderBar(); });
  $$('[data-mc]').forEach(b => b.addEventListener('click', async () => {
    if (b.dataset.mc === 'toggle') { NOW.playing = !NOW.playing; renderNow(); renderBar(); }
    await api.musicCmd(b.dataset.mc);
  }));

  // tocador local
  let PL = [], plIdx = -1;
  const audio = $('#audio');
  const isAudio = (p) => /\.(mp3|m4a|aac|wav|ogg|opus|flac|webm)$/i.test(p);
  const fileUrl = (p) => 'file:///' + encodeURI(p.replace(/\\/g, '/').replace(/^\/+/, '')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  const base = (p) => p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  async function loadPlaylist() { PL = await api.musicPlaylist(); renderPL(); }
  async function addToPlaylist(paths) { PL = await api.musicPlaylist([...PL, ...paths.filter(isAudio).filter(p => !PL.includes(p))]); renderPL(); if (plIdx < 0 && PL.length) playIdx(0); }
  function renderPL() {
    $('#plList').innerHTML = PL.map((p, i) => `<button type="button" class="pli ${i === plIdx ? 'on' : ''}" data-i="${i}">${i === plIdx && !audio.paused ? '♫' : String(i + 1).padStart(2, '0')}<span>${esc(base(p))}</span><span class="x" data-x="${i}">✕</span></button>`).join('')
      || '<p class="muted">Adicione arquivos ou uma pasta de músicas, ou arraste arquivos de áudio pra cá.</p>';
    $$('#plList .pli').forEach(b => b.addEventListener('click', async (e) => {
      if (e.target.dataset.x !== undefined) { const i = +e.target.dataset.x; PL.splice(i, 1); if (i === plIdx) { audio.pause(); plIdx = -1; } else if (i < plIdx) plIdx--; PL = await api.musicPlaylist(PL); renderPL(); return; }
      playIdx(+b.dataset.i);
    }));
    $('#plPP').innerHTML = audio.paused ? PLAY : PAUSE;
  }
  function playIdx(i) {
    if (!PL.length) return;
    plIdx = (i + PL.length) % PL.length;
    audio.src = fileUrl(PL[plIdx]); audio.volume = $('#plVol').value / 100;
    audio.play().catch(() => setState('error', 'Não consegui tocar esse arquivo'));
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: base(PL[plIdx]), artist: 'Bit' });
    renderPL();
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('nexttrack', () => playIdx(plIdx + 1));
    navigator.mediaSession.setActionHandler('previoustrack', () => playIdx(plIdx - 1));
  }
  $('#plPlay').addEventListener('click', () => { if (plIdx < 0) return playIdx(0); audio.paused ? audio.play() : audio.pause(); });
  $('#plNext').addEventListener('click', () => playIdx(plIdx + 1));
  $('#plPrev').addEventListener('click', () => playIdx(plIdx - 1));
  audio.addEventListener('play', renderPL); audio.addEventListener('pause', renderPL);
  audio.addEventListener('ended', () => playIdx(plIdx + 1));
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime || 0, d = audio.duration || 0;
    $('#plTime').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}${d ? ' / ' + Math.floor(d / 60) + ':' + String(Math.floor(d % 60)).padStart(2, '0') : ''}`;
    if (d && !$('#plSeek').matches(':active')) $('#plSeek').value = Math.round((t / d) * 1000);
  });
  $('#plSeek').addEventListener('input', (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });
  $('#plVol').addEventListener('input', (e) => { audio.volume = e.target.value / 100; });
  $('#plAddFiles').addEventListener('click', async () => addToPlaylist(await api.filePick({ filters: [{ name: 'Áudio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'webm'] }] })));
  $('#plAddFolder').addEventListener('click', async () => addToPlaylist(await api.musicPickFolder()));
  $('#plClear').addEventListener('click', (e) => twoClick(e.currentTarget, async () => { audio.pause(); plIdx = -1; PL = await api.musicPlaylist([]); renderPL(); }, 'Limpar a lista?'));

  // ---------------- chips na pílula ----------------
  window.toolChips = () => {
    const c = [];
    if (R.on) c.push(`<span class="pchip limit" data-chip="rec">● REC ${esc($('#meetTimer').textContent || '')}</span>`);
    if (NOW.playing && NOW.title) c.push(`<span class="pchip music" data-chip="music" title="${esc(NOW.title)} — ${esc(NOW.artist || '')}"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="mt">${esc(NOW.title)}</span></span>`);
    return c;
  };
  $('#barChips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-chip]'); if (!c) return;
    e.stopPropagation();
    if (c.dataset.chip === 'cc') { const w = (window.CCLIST || []).find(x => x.status === 'working'); api.expand('chat'); go('chat'); if (w) window.openCC(w.id); return; }
    if (!['rec', 'music'].includes(c.dataset.chip)) return;
    const t = c.dataset.chip === 'rec' ? 't:reuniao' : 't:musica'; api.expand(t); go(t);
  });
})();
