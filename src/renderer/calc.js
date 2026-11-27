// Bit — Calculadora rápida (aba t:calc). Sem eval: parser próprio, números no jeito brasileiro.
// Entende: + - * x × / ÷ ^ ( ) %, "15% de 300", "250 + 10%", "mais/menos/vezes/dividido por/elevado a", "raiz de 16".
(function () {
  // ---------------- números ----------------
  // "1.234,56" → 1234.56 · "1234.5" → 1234.5 · "1.234" → 1234 · "12,5" → 12.5
  function toNum(s) {
    if (/,/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''));
    return parseFloat(s);
  }
  function fmt(n) {
    if (!isFinite(n)) return 'não dá (divisão por zero)';
    const a = Math.abs(n);
    if (a !== 0 && (a >= 1e15 || a < 1e-9)) return n.toExponential(6).replace('.', ',');
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 10 });
  }

  // ---------------- texto → símbolos ----------------
  function normalize(t) {
    return String(t).toLowerCase()
      .replace(/^\s*(quanto\s+(é|e|da|dá)|calcul[ae]|conta)\s*:?\s*/, '')
      .replace(/[?=]\s*$/, '')
      .replace(/r\$\s*/g, '')
      .replace(/\bpor\s*cento\b/g, '%')
      .replace(/\bdividido\s+por\b/g, '/')
      .replace(/\belevado\s+(a|ao)\b/g, '^')
      .replace(/\bao\s+quadrado\b/g, '^2').replace(/\bao\s+cubo\b/g, '^3')
      .replace(/\bra[ií]z(\s+quadrada)?(\s+de)?\b/g, '√')
      .replace(/\bmais\b/g, '+').replace(/\bmenos\b/g, '-').replace(/\bvezes\b/g, '*')
      .replace(/[×x]/g, '*').replace(/[÷:]/g, '/').replace(/−/g, '-')
      .replace(/%\s*(de|do|da|sobre|of)\b/g, '%of');
  }
  function tokenize(s) {
    const out = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      const m = s.slice(i).match(/^\d[\d.,]*/);
      if (m) { let v = m[0].replace(/[.,]$/, ''); out.push({ t: 'n', v: toNum(v) }); i += v.length; continue; }
      if (s.startsWith('%of', i)) { out.push({ t: 'pof' }); i += 3; continue; }
      if ('+-*/^()%√'.includes(c)) { out.push({ t: c }); i++; continue; }
      throw new Error('?');
    }
    return out;
  }

  // ---------------- parser (precedência normal) ----------------
  // expr := term (('+'|'-') term ['%'])*   → "a + b%" = a * (1 + b/100)
  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p], eat = (t) => (tokens[p] && tokens[p].t === t ? tokens[p++] : null);
    function expr() {
      let v = term();
      for (;;) {
        const op = eat('+') || eat('-'); if (!op) return v;
        const start = p; let r = term();
        // percentual relativo ao que veio antes: 200 + 10% = 220
        if (tokens[p - 1] && tokens[p - 1].t === '%' && p - 1 >= start && isPlainPct(start, p)) r = v * pctOf(start, p);
        v = op.t === '+' ? v + r : v - r;
      }
    }
    // o termo inteiro foi só "N%" (ex.: "10%"), sem multiplicação no meio
    function isPlainPct(a, b) { return b - a === 2 && tokens[a].t === 'n'; }
    function pctOf(a) { return tokens[a].v / 100; }
    function term() {
      let v = factor();
      for (;;) {
        if (eat('*')) v *= factor();
        else if (eat('/')) v /= factor();
        else if (eat('pof')) v = v / 100 * factor();
        else if (peek() && (peek().t === '(' || peek().t === '√')) v *= factor(); // 2(3+4)
        else return v;
      }
    }
    function factor() {
      let v = unary();
      if (eat('^')) v = Math.pow(v, factor());
      return v;
    }
    function unary() {
      if (eat('-')) return -unary();
      if (eat('+')) return unary();
      if (eat('√')) return Math.sqrt(unary());
      return postfix();
    }
    function postfix() {
      let v = atom();
      while (eat('%')) v /= 100;
      return v;
    }
    function atom() {
      const n = eat('n'); if (n) return n.v;
      if (eat('(')) { const v = expr(); eat(')'); return v; }
      throw new Error('?');
    }
    const v = expr();
    if (p < tokens.length) throw new Error('?');
    return v;
  }

  /** Conta o texto; devolve { value, text } ou null se não for uma conta. */
  function calc(text) {
    try {
      const s = normalize(text).trim();
      if (!s || !/\d/.test(s)) return null;
      const v = parse(tokenize(s));
      if (typeof v !== 'number' || isNaN(v)) return null;
      return { value: v, text: fmt(v) };
    } catch { return null; }
  }
  // parece conta? (para o "Fala com o Bit" responder na hora): tem número e operador, e nada de palavras soltas
  function looksLikeMath(text) {
    const s = normalize(text).trim();
    return /\d/.test(s) && /[-+*/^%√]|%of/.test(s) && !/[a-zà-ú]/i.test(s.replace(/%of/g, '')) && !!calc(text);
  }
  window.calcEval = calc;
  window.calcLooksLikeMath = looksLikeMath;
  window.calcFmt = fmt;

  // ---------------- aba ----------------
  const H_MAX = 30;
  const box = () => document.querySelector('.tpane[data-pane="calc"]');
  if (!box()) return;
  const inp = $('#calcIn'), out = $('#calcOut'), hist = $('#calcHist');
  const getHist = () => ((S.meta && S.meta.calcHist) || []);
  function saveHist(list) { S.meta = { ...(S.meta || {}), calcHist: list }; api.setMeta({ calcHist: list }); }
  function live() {
    const r = calc(inp.value);
    out.textContent = inp.value.trim() ? (r ? '= ' + r.text : '…') : '0';
    out.classList.toggle('dim', !r);
    return r;
  }
  function commit() {
    const r = live(); if (!r) return;
    const e = inp.value.trim();
    const list = [{ e, r: r.text, v: r.value, at: Date.now() }, ...getHist().filter(x => x.e !== e)].slice(0, H_MAX);
    saveHist(list); renderHist();
    copy(r.text.replace(/\./g, ''), out);
    inp.value = String(r.text.replace(/\./g, '')); inp.select(); live();
  }
  function renderHist() {
    const list = getHist();
    hist.innerHTML = list.length ? list.map((x, i) => `<button type="button" class="calc-h" data-i="${i}" title="Usar de novo"><span>${esc(x.e)}</span><b>= ${esc(x.r)}</b></button>`).join('')
      : '<p class="muted calc-empty">As contas que você fizer aparecem aqui.</p>';
    hist.querySelectorAll('.calc-h').forEach(b => b.addEventListener('click', () => { inp.value = getHist()[+b.dataset.i].e; live(); inp.focus(); }));
  }
  inp.addEventListener('input', live);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape' && inp.value) { e.preventDefault(); e.stopPropagation(); inp.value = ''; live(); }
  });
  out.addEventListener('click', () => { const r = calc(inp.value); if (r) copy(r.text.replace(/\./g, ''), out); });
  $$('.calc-keys button').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (k === 'C') inp.value = '';
    else if (k === 'back') inp.value = inp.value.slice(0, -1);
    else if (k === '=') return commit();
    else {
      const s = inp.selectionStart ?? inp.value.length, en = inp.selectionEnd ?? inp.value.length;
      inp.value = inp.value.slice(0, s) + k + inp.value.slice(en); inp.setSelectionRange(s + k.length, s + k.length);
    }
    live(); inp.focus();
  }));
  $('#calcClear').addEventListener('click', () => { saveHist([]); renderHist(); });
  window.calcOpen = (expr) => { if (expr != null) inp.value = expr; live(); renderHist(); setTimeout(() => inp.focus(), 30); };
  renderHist(); live();
})();
