// Perfil de quem usa o Bit: nome, time, frentes, regras e prazos vêm daqui (nada disso fica no código).
// Cada pessoa preenche o seu em Config > Seu perfil. O código é o mesmo para todo mundo.

const EMPTY = { bot: '', nome: '', cargo: '', empresa: '', sobre: '', pessoas: [], frentes: [], regras: '', prazos: [], termos: '' };

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'frente';

function normalize(p) {
  p = { ...EMPTY, ...(p || {}) };
  p.pessoas = (Array.isArray(p.pessoas) ? p.pessoas : []).map(x => ({ nome: String(x.nome || '').trim(), papel: String(x.papel || '').trim() })).filter(x => x.nome).slice(0, 20);
  p.frentes = (Array.isArray(p.frentes) ? p.frentes : []).map(x => ({ id: x.id || slug(x.nome), nome: String(x.nome || '').trim(), desc: String(x.desc || '').trim() })).filter(x => x.nome).slice(0, 12);
  p.prazos = (Array.isArray(p.prazos) ? p.prazos : []).filter(x => x && x.data && x.titulo).slice(0, 12);
  p.bot = String(p.bot || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  for (const k of ['nome', 'cargo', 'empresa', 'sobre', 'regras', 'termos']) p[k] = String(p[k] || '').trim();
  return p;
}

// usada uma vez ao carregar os dados
function migrate(DATA) {
  if (DATA.profile) { DATA.profile = normalize(DATA.profile); return false; }
  DATA.profile = normalize(EMPTY);
  for (const s of DATA.sessions || []) if (/^Copiloto\b/.test(s.title || '') && s.kind === 'nip') s.title = 'Copiloto Bit';
  return true;
}

const nome = (p) => p.nome || 'o usuário';
// nome que a pessoa deu ao copiloto (padrão: Bit)
const bot = (p) => (p && p.bot) || 'Bit';
const gestor = (p) => (p.pessoas.find(x => /gerente|gestor|gestora|chefe|l[ií]der|coordenador geral|diretor/i.test(x.papel)) || {}).nome || '';
const fmtData = (d) => { try { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; } catch { return d; } };

// bloco de contexto para os prompts do Claude
function contexto(p) {
  const L = [];
  const quem = [p.cargo, p.empresa].filter(Boolean).join(' · ');
  L.push(`## Quem você ajuda\n${p.nome || 'O usuário'}${quem ? ` — ${quem}` : ''}.${p.sobre ? `\n${p.sobre}` : ''}`);
  if (p.pessoas.length) L.push(`## Pessoas com quem trabalha\n${p.pessoas.map(x => `- ${x.nome}${x.papel ? ` — ${x.papel}` : ''}`).join('\n')}`);
  if (p.frentes.length) L.push(`## Frentes de trabalho\n${p.frentes.map(x => `- ${x.nome}${x.desc ? `: ${x.desc}` : ''}`).join('\n')}`);
  if (p.regras) L.push(`## Regras e combinados\n${p.regras}`);
  if (p.prazos.length) L.push(`## Prazos importantes\n${p.prazos.map(x => `- ${fmtData(x.data)}: ${x.titulo}`).join('\n')}`);
  return L.join('\n\n');
}
// versão curta para o JEV
function contextoCurto(p) {
  const s = [`${p.nome || 'O usuário'}${p.cargo ? `, ${p.cargo}` : ''}${p.empresa ? ` (${p.empresa})` : ''}.`];
  if (p.pessoas.length) s.push('Pessoas: ' + p.pessoas.map(x => `${x.nome}${x.papel ? ` (${x.papel})` : ''}`).join('; ') + '.');
  if (p.regras) s.push(p.regras);
  if (p.prazos.length) s.push('Prazos: ' + p.prazos.map(x => `${x.titulo} até ${fmtData(x.data)}`).join('; ') + '.');
  return 'Contexto: ' + s.join(' ');
}

// perguntas do JEV montadas a partir do perfil
function qMensagem(p) {
  return {
    tipo: {
      type: 'choice',
      instructions: `Que tipo de mensagem ${nome(p)} mandou para o assistente de trabalho?`,
      criteria: {
        demanda: 'Chegou um ou mais pedidos/tarefas de alguém, ou está registrando tarefas novas',
        plano_dia: '"bom dia": despeja o que tem para hoje e quer um plano do dia',
        fechamento: 'Fim do dia: o que fez, o que travou, o que fica para amanhã',
        decisao: 'Precisa escolher entre opções / tomar uma decisão',
        conflito: 'Duas ou mais pessoas pedindo coisas que competem pelo mesmo tempo',
        ti: 'Problema técnico ou de sistema para pedir ajuda/suporte',
        mensagem: 'Quer ajuda para escrever uma mensagem/e-mail para alguém',
        conversa: 'Pergunta ou conversa geral',
      },
    },
    tem_demanda: { type: 'noul', instructions: 'A mensagem traz pelo menos uma tarefa ou pedido NOVO que deveria entrar na lista de demandas?' },
  };
}
function qDemanda(p) {
  const quem = {};
  for (const x of p.pessoas) quem[x.nome] = x.papel || x.nome;
  quem['Outra pessoa'] = 'Alguém que não está na lista acima';
  quem.Eu = `${nome(p)}, por iniciativa própria`;
  const q = { quem: { type: 'choice', instructions: 'Quem pediu ou é dono desta demanda?', criteria: quem } };
  if (p.frentes.length) {
    const fr = {}; for (const x of p.frentes) fr[x.id] = x.desc ? `${x.nome}: ${x.desc}` : x.nome;
    fr.fora = 'Não se encaixa em nenhuma frente de trabalho';
    q.frente = { type: 'choice', instructions: 'Em qual frente de trabalho esta demanda se encaixa?', criteria: fr };
  }
  q.e_meu = { type: 'choice', instructions: `Esta demanda é mesmo de ${nome(p)}?${p.regras ? ` Regras: ${p.regras}` : ''}`, criteria: {
    sim: 'É dele(a): faz parte do trabalho dele(a)', parcial: 'Faz parte, mas depende de outra pessoa/área',
    origem: 'Deveria ser feita por outra pessoa/área: o certo é devolver' } };
  q.esforco = { type: 'score', instructions: 'Quanto trabalho esta demanda dá?', criteria: ['Até 30 minutos', 'Meio dia', 'Um ou mais dias'] };
  const g = gestor(p);
  q.prioridade = { type: 'choice', instructions: `Qual a prioridade certa? Considere prazo, se trava alguém${g ? `, se veio de ${g} (gestão)` : ''}${p.prazos.length ? ` e os prazos importantes (${p.prazos.map(x => `${x.titulo} até ${fmtData(x.data)}`).join('; ')})` : ''}.`, criteria: {
    agora: `Rápida e urgente hoje, ou trava alguém${g ? `, ou pedido direto de ${g}` : ''}`,
    hoje: 'Precisa sair hoje ou trava alguém ou está ligada a um prazo importante próximo',
    semana: 'Prazo nesta semana ou importante sem urgência',
    espera: 'Sem prazo e sem impacto imediato',
    devolver: 'Não é dele(a) ou deveria ser feita por outra pessoa/área' } };
  return q;
}

// vocabulário para o Whisper acertar nomes e termos
function vocab(p) {
  const v = [p.nome, ...p.pessoas.map(x => x.nome), ...String(p.termos || '').split(/[,;\n]/)].map(s => String(s || '').trim()).filter(Boolean);
  return [...new Set(v)].join(', ').slice(0, 500);
}

// a tarefa é desta pessoa? compara com o nome do perfil sem exigir igualdade exata
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
const EU = ['eu', 'mim', 'me', 'comigo', 'meu', 'minha', 'voce', 'usuario', 'eu mesmo', 'eu mesma'];
function isMine(p, who) {
  const w = norm(who);
  if (!w || EU.includes(w)) return true;
  const mine = norm(p && p.nome); if (!mine) return true; // sem nome no perfil: não filtra
  const myTok = mine.split(' ').filter(t => t.length >= 3), tok = w.split(' ').filter(t => t.length >= 3);
  if (!tok.length) return EU.some(e => w.includes(e));
  for (const a of tok) for (const b of myTok) {
    if (a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))))) return true;
    if (1 - lev(a, b) / Math.max(a.length, b.length) >= 0.66) return true;
  }
  return false;
}

module.exports = { isMine, EMPTY, normalize, migrate, contexto, contextoCurto, qMensagem, qDemanda, vocab, nome, bot, gestor, slug };
