// Lê questões de concurso de um PDF: extrai o texto com o pdf.js (vendor/)
// e separa enunciado, alternativas, gabarito e comentário.

// pdf.js 4.10.38 (versão legacy, para celulares mais antigos), carregado só quando alguém abre um PDF
let pdfjsReady = null;
function loadPdfjs(){
  if (!pdfjsReady) pdfjsReady = import(new URL("vendor/pdfjs/pdf.min.mjs", document.baseURI).href).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.mjs", document.baseURI).href;
    return lib;
  }, e => { pdfjsReady = null; const err = new Error("pdfjs"); err.code = "pdfjs-load"; err.cause = e; throw err; });
  return pdfjsReady;
}

// Junta os pedaços de texto de uma página em linhas, respeitando provas em duas colunas.
function pageLines(items, width, columns = true){
  const its = items.filter(i => i.str && i.str.trim()).map(i => ({s:i.str, x:i.transform[4], y:i.transform[5], w:i.width || 0, h:Math.abs(i.transform[3]) || 10}));
  if (!its.length) return [];
  // duas colunas só quando, nas linhas que têm texto dos dois lados, sobra um corredor vazio no meio da página
  const mid = width / 2, hs = width * 0.012;
  const rows = []; [...its].sort((a, b) => b.y - a.y).forEach(i => { const r = rows[rows.length - 1]; if (r && Math.abs(r.y - i.y) <= Math.max(2, i.h * 0.45)) r.its.push(i); else rows.push({y:i.y, its:[i]}); });
  const gutter = (pos, h) => {
    let both = 0, free = 0, prose = 0;
    for (const r of rows) {
      const L = r.its.filter(i => i.x + i.w < pos), R = r.its.filter(i => i.x > pos);
      if (!L.length || !R.length) continue;
      both++; if (r.its.some(i => i.x < pos + h && i.x + i.w > pos - h)) continue;
      free++; if (/[A-Za-zÀ-ú]{4}/.test(L.map(i => i.s).join(" ")) && /[A-Za-zÀ-ú]{4}/.test(R.map(i => i.s).join(" "))) prose++;
    }
    return {both, free, prose};
  };
  const ok = g => g.both >= 3 && g.free / g.both >= 0.85;
  let pos = mid, g = gutter(mid, hs);
  // corredor fora do centro (margens diferentes dos dois lados): procura perto do meio, só em texto corrido (tabela não)
  if (!ok(g)) for (let x = width * 0.4; x <= width * 0.6; x += 1) { const t = gutter(x, width * 0.005); if (ok(t) && t.prose / t.free >= 0.6 && (!ok(g) || t.free / t.both > g.free / g.both || (t.free / t.both === g.free / g.both && Math.abs(x - mid) < Math.abs(pos - mid)))) { g = t; pos = x; } }
  const left = its.filter(i => i.x + i.w <= pos + hs), right = its.filter(i => i.x >= pos - hs);
  const cols = (columns && ok(g) && left.length > 5 && right.length > 5) ? [its.filter(i => i.x < pos), its.filter(i => i.x >= pos)] : [its];
  const out = [];
  for (const col of cols) {
    col.sort((a, b) => b.y - a.y || a.x - b.x);
    let line = [], ly = null; const ls = [];
    const flush = () => { if (!line.length) return; line.sort((a, b) => a.x - b.x); let t = "", end = null; for (const i of line) { if (end !== null && i.x - end > 1.5 && !t.endsWith(" ") && !i.s.startsWith(" ")) t += " "; t += i.s; end = i.x + i.w; } ls.push({t:t.replace(/\s+/g, " ").trim(), y:line[0].y, h:Math.max(...line.map(i => i.h))}); line = []; };
    for (const i of col) { if (ly !== null && Math.abs(i.y - ly) > Math.max(2, i.h * 0.45)) flush(); line.push(i); ly = i.y; }
    flush();
    // espaço vertical maior que o normal entre duas linhas vira linha vazia (separa parágrafos e blocos)
    const steps = ls.slice(1).map((l, k) => ls[k].y - l.y).filter(d => d > 0).sort((a, b) => a - b), step = steps[Math.floor(steps.length / 2)] || 0;
    ls.forEach((l, k) => { if (k && step && ls[k - 1].y - l.y > Math.max(step * 1.6, step + l.h * 0.6)) out.push(""); out.push(l.t); });
  }
  return out;
}

let lastDoc = null, lastFile = null;
async function openDoc(file){
  if (lastFile === file && lastDoc) return lastDoc;
  const pdfjs = await loadPdfjs();
  // isEvalSupported:false: o pdf.js nunca monta código a partir das fontes do PDF (proteção contra PDF malicioso)
  lastDoc = await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()), isEvalSupported:false}).promise; lastFile = file;
  return lastDoc;
}
export async function pdfPageCount(file){ return (await openDoc(file)).numPages; }

// texto de cada página na última extração (para achar páginas que são só imagem no meio de um PDF com texto)
export const lastText = {pages:{}};
// columns:false lê cada linha de ponta a ponta (gabarito em tabela: com colunas, a metade direita ia para o fim)
export async function extractPdfText(file, onProgress, {columns = true} = {}){
  const doc = await openDoc(file);
  const lines = []; lastText.pages = {};
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({scale:1});
    const tc = await page.getTextContent();
    const pl = pageLines(tc.items, vp.width, columns);
    lastText.pages[p] = pl.join("\n");
    lines.push(...pl);
    onProgress && onProgress(p, doc.numPages);
  }
  return lines.join("\n");
}

/* ---------- interpretação do texto ---------- */
const QSTART = /^(?:quest[ãa]o(?:\s*n[º°o]\.?)?|q\.?)\s*(\d{1,3})\b[\s.:)\-–—]*(.*)$|^(\d{1,3})\s*(?:[.)\-–—:]|\s)\s*(.*)$/i;
// cabeçalho "QUESTÃO 12": quando a prova numera assim, só ele abre questão (a capa com instruções
// numeradas "1. O Cartão de Respostas..." e as listas "1." dentro do enunciado não viram questão)
const QHEAD = /^quest[ãa]o(?:\s*n[º°o]\.?)?\s*\d{1,3}\b/i;
// "(C)2,6" sem espaço também vale quando a letra está entre parênteses
const ALT = /^(?:\(([A-Ea-e])\)|\(?([A-Ea-e])\s*[).\-–—]\s)\s*(.*)$/;
// itens de lista dentro do enunciado: "( ) afirmativa" (V/F), "I.", "II -", "1)"
const LIST_ITEM = /^(?:\(\s*[VvFf_]?\s*\)|\[\s*\]|[IVX]{1,5}\s*[.\-–—)]\s|\d{1,2}\s*\)\s)/;
// linha de tabela: separadores "|" ou dois ou mais valores (R$ 300.000,00 · 31/12/24 · 12,5%)
const TABLE_ROW = l => /\S\s*\|\s*\S/.test(l) || (l.match(/R\$/g) || []).length >= 2 || ((l.match(/\d[\d.,/%]*/g) || []).length >= 2 && (l.match(/\d/g) || []).length / l.length > 0.25);
// gabarito logo depois da questão: "Gabarito: B", "GABARITO: LETRA C", "Gab. C", "Resposta correta: (B)", "Alternativa correta: letra B"
const GAB_RE = /^(?:g[a4]b[a4]r[i1l|!][t7][o0]|gab\.?|resposta(?:\s+correta)?|resp\.|alternativa\s+correta|op[çc][ãa]o\s+correta)\s*(?:oficial|definitivo|preliminar)?(\s*[:\-–.]?\s*(?:[ée]\s+)?(?:a\s+)?(?:letra|alternativa|op[çc][ãa]o|item)?\s*[:;,\-–]?\s*)\(?(certo|errado|anulad[ao]|[a-e8])\)?(?![a-zà-ú\d])/i;
// sem ":" nem "letra" entre a palavra e a resposta, só vale a resposta sozinha no fim da linha ("Gabarito B"):
// "pronta resposta a incidentes." é texto do enunciado, não gabarito
const gabLine = l => {
  const m = l.match(GAB_RE); if (!m) return null;
  const ok = /[:\-–.;,]|[ée]\s|letra|alternativa|op[çc]|item/i.test(m[1]) || (/^(?:[A-E8]|certo|errado|anulad[ao])$/i.test(m[2]) && !/^[a-e]$/.test(m[2]) && /^[\s.)\]]*$/.test(l.slice(m[0].length)));
  return ok ? [m[0], m[2]] : null;
};
const BANCA = /^\S{0,6}\s*\((?:FGV|CESPE|CEBRASPE|FCC|VUNESP|IBFC|IDECAN|AOCP|QUADRIX|CESGRANRIO|FUNDATEC|CONSULPLAN|IADES|FEPESE|FUNRIO|IBADE|AVANÇA ?SP|INSTITUTO|SELECON|OBJETIVA|FUMARC|COPS|NC-UFPR|COMPERVE|CETRO|ESAF|FUNCAB|IDIB|ITAME|INSTITUTO AOCP)[\s\/)\-–]/i;
const COMMENT = /^(?:coment[áa]rios?|justificativa|fundamenta[çc][ãa]o|explica[çc][ãa]o)\s*[:\-–]?\s*(.*)$/i;
// instruções e textos de apoio entre questões ("Julgue os itens...", "Texto CB1A1") não entram no enunciado anterior
const INSTR = /^(?:texto\s+(?:[A-Z]{1,3}\d|\d{1,2}[A-Z]{1,3}\d|para|associado|i+\b)|julgue\s|considerando\s|com\s+(?:base|rela[çc][ãa]o)\s|acerca\s|a\s+respeito\s|no\s+que\s+se\s+refere|em\s+rela[çc][ãa]o\s|tendo\s+em\s+vista|leia\s|observe\s|(?:conhecimentos|parte)\s+(?:b[áa]sicos|espec[íi]ficos|gerais|[IVX]+)\b|caderno\s|cargo\s)/i;
const NOISE = /^(?:p[áa]gina\s*\d+(\s*de\s*\d+)?|\d{1,3}|www\.\S+|-\s*\d+\s*-)$/i;

function normAnswer(s){
  s = (s || "").trim().replace(/[.;,]$/, "");
  if (/^certo$|^c$|^v$|^verdadeiro$/i.test(s)) return "C";
  if (/^errado$|^f$|^falso$/i.test(s)) return "E";
  if (/^[a-e]$/i.test(s)) return s.toUpperCase();
  if (/^anulad[ao]$|^x$|^\*$/i.test(s)) return "X"; // questão anulada
  return null;
}
// "1-C 2-A 3 B" ou tabela com uma linha de números e outra de letras
function parseKey(lines){
  const key = {};
  const pairRe = /(\d{1,3})\s*[\-–—.:)]?\s*(certo|errado|anulad[ao]|[a-e])(?![a-z])/gi;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const nums = l.replace(/^(?:ite(?:m|ns)|quest(?:[õo]es|[ãa]o)|n[º°o]\.?)\s*/i, "").split(/\s+/);
    if (nums.length > 1 && nums.every(n => /^\d{1,3}$/.test(n)) && lines[i+1]) {
      const ans = lines[i+1].replace(/^(?:gabarito|respostas?|gab\.?)\s*:?\s*/i, "").split(/\s+/);
      if (ans.length === nums.length && ans.every(a => /^(?:[a-e]|certo|errado|x|\*|anulad[ao])$/i.test(a))) {
        nums.forEach((n, k) => { const a = normAnswer(ans[k]); if (a) key[+n] = a; }); i++; continue;
      }
    }
    let m; while ((m = pairRe.exec(l))) { const a = normAnswer(m[2]); if (a) key[+m[1]] = a; }
  }
  return key;
}

// gabarito vindo de outro PDF
export function parseAnswerKey(text){
  return parseKey(text.split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean));
}
// gabarito com uma versão para cada tipo de prova ("PROVA 1", "TIPO 2 - BRANCA", "Caderno 3"): devolve uma chave
// por versão, na ordem do arquivo. Sem versões, devolve uma só, com id null.
const KEY_HEAD = /^(?:gabarito\s+(?:d[ao]\s+)?)?(?:prova|tipo|caderno|vers[ãa]o)\s*(?:tipo\s*)?[:\-–nº°]*\s*(\d{1,2}|[A-H])\b/i;
export function parseAnswerKeys(text){
  const lines = text.split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const secs = []; let cur = {label:"", id:null, lines:[]};
  for (const l of lines) {
    const m = l.length <= 40 && l.match(KEY_HEAD);
    if (m && !/\d\s*[\-–—.:)]\s*[a-e](?![a-zà-ú])/i.test(l.slice(m[0].length))) {
      secs.push(cur); cur = {label:l.charAt(0).toUpperCase() + l.slice(1).toLowerCase(), id:m[1].toUpperCase(), lines:[]}; continue;
    }
    cur.lines.push(l);
  }
  secs.push(cur);
  const keys = secs.map(s => ({label:s.label, id:s.id, key:parseKey(s.lines)})).filter(s => Object.keys(s.key).length >= 5);
  if (keys.length >= 2 && keys.every(s => s.id) && new Set(keys.map(s => s.id)).size === keys.length) return keys;
  return [{label:"", id:null, key:parseKey(lines)}];
}
// tipo do caderno de questões ("Tipo 1 – Página 2" no rodapé, "PROVA TIPO 3"): o número que mais aparece
// depois de "tipo", se aparecer bastante e bem mais que os outros
export function examType(text){
  const c = {};
  for (const m of (text || "").matchAll(/\btipo\s*(?:de\s+prova\s*)?[:\-–nº°]*\s*(\d{1,2})\b(?![,.]\d|\s*(?:%|anos?\b|dias?\b|horas?\b))/gi)) c[m[1]] = (c[m[1]] || 0) + 1;
  const [a, b] = Object.entries(c).sort((x, y) => y[1] - x[1]);
  return a && a[1] >= 3 && (!b || a[1] >= b[1] * 3) ? a[0] : null;
}

const SMALL = new Set(["de","da","do","das","dos","e","a","o","em","na","no","para","com"]);
function titleCase(t){ return t.toLowerCase().split(/\s+/).map((w, i) => i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }
// junta as linhas de um texto corrido em parágrafos: quebra depois de linha curta que fecha frase; o rótulo
// "Texto I", o título em maiúsculas e o autor ou a fonte no fim ficam em linhas próprias
function joinText(ls){
  const lens = ls.map(l => l.length).sort((a, b) => a - b), full = lens[Math.floor(lens.length * 0.75)] || 60;
  const own = s => /^texto\s+\S{1,6}$/i.test(s) || (!/[a-zà-ú]/.test(s) && /[A-ZÀ-Ú]{3}/.test(s));
  let out = "";
  ls.forEach((l, k) => {
    if (!k) { out = l; return; }
    const p = ls[k - 1];
    const brk = own(p) || own(l) || (/[.!?:;"”»)\]…]$/.test(p) && p.length < full * 0.85)
      || (k === ls.length - 1 && l.length < 45 && !/[.!?;,]$/.test(l)) || /^(?:dispon[íi]vel em|fonte:|adaptado|texto adaptado|in:)/i.test(l) || /^[•●▪]\s?/.test(l);
    out += brk ? "\n" + l : /[a-zà-ú]-$/.test(p) && /^[a-zà-ú]/.test(l) ? l : " " + l;
  });
  return out;
}

/* matéria pelo conteúdo da questão, quando o PDF não traz títulos: palavras típicas de cada disciplina */
const SUBJECTS = [
  ["Língua Portuguesa", "concordancia|regencia|crase|colocacao pronominal|oracao|oracoes|sujeito|predicado|substantivo|adjetivo|adverbio|pronome|conjuncao|preposicao|pontuacao|virgula|acentuacao|ortografia|sinonimo|antonimo|coesao|coerencia|sentido original|reescrita|vocabulo|figura de linguagem|interpretacao do texto|no texto|do texto|trecho|semantic|morfolog|sintatic|voz passiva|gramatical|norma culta|norma-padrao|tempo verbal|forma verbal|frase|frases|periodo composto"],
  ["Matemática", "equacao|funcao (?:afim|quadratica|exponencial|logaritmica|do primeiro grau|do segundo grau)|porcentagem|razao|proporcao|regra de tres|fracao|perimetro|volume|triangulo|retangulo|circulo|mmc|mdc|potencia|raiz quadrada|progressao aritmetica|progressao geometrica|numeros inteiros|numero natural|geometri|algebr"],
  ["Matemática Financeira", "juros|montante|capitalizacao|amortizacao|sistema de amortizacao|tabela price|desconto comercial|desconto racional|taxa nominal|taxa efetiva|valor presente|valor futuro|emprestimo|financiamento|valor da prestacao|prestacoes (?:mensais|iguais|fixas|anuais)|parcelas mensais"],
  ["Raciocínio Lógico", "proposicao|proposicoes|logica|tabela-verdade|tabela verdade|negacao|silogismo|se e somente se|conectivo|argumento valido|premissa|tautologia|contradicao|equivalente logic|diagrama de venn|probabilidade|combinacao|arranjo|permutacao|sequencia logica|anagrama"],
  ["Informática", "windows|linux|excel|word|planilha|navegador|internet|e-mail|correio eletronico|virus|malware|ransomware|backup|hardware|software|computador|teclas de atalho|atalho|nuvem|firewall|phishing|sistema operacional|libreoffice|writer|calc|outlook|chrome|firefox|url|intranet|protocolo http|pendrive|memoria ram"],
  ["Direito Constitucional", "constituicao federal|constituicao|cf/88|cf/1988|constitucional|emenda constitucional|direitos fundamentais|direitos e garantias|habeas data|mandado de seguranca|mandado de injuncao|acao popular|stf|supremo tribunal|poder legislativo|congresso nacional|senado federal|camara dos deputados|presidente da republica|clausula petrea|nacionalidade|direitos politicos|direitos sociais"],
  ["Direito Administrativo", "administracao publica|ato administrativo|atos administrativos|licitacao|contrato administrativo|servidor publico|servidores publicos|8\\.112|autarquia|fundacao publica|empresa publica|sociedade de economia mista|poder de policia|poder hierarquico|poder disciplinar|improbidade|agente publico|principio da eficiencia|impessoalidade|moralidade|14\\.133|concessao de servico|administracao direta|administracao indireta|processo administrativo|desvio de finalidade|anulacao|revogacao|motivacao do ato"],
  ["Direito Penal", "crime|crimes|codigo penal|dolo|culposo|doloso|furto|roubo|homicidio|legitima defesa|imputabilidade|tentativa|consumacao|ilicitude|tipicidade|culpabilidade|reclusao|detencao|latrocinio|estelionato|peculato|concussao|corrupcao passiva|prevaricacao|pena privativa|insignificancia"],
  ["Direito Processual Penal", "inquerito|processo penal|cpp|codigo de processo penal|denuncia|queixa-crime|acao penal|prisao em flagrante|prisao preventiva|prisao temporaria|autoridade policial|delegado de policia|interrogatorio|fianca|audiencia de custodia|indiciado|busca e apreensao"],
  ["Direito Civil", "codigo civil|pessoa natural|pessoa juridica de direito privado|capacidade civil|negocio juridico|prescricao|decadencia|obrigacoes|posse|usucapiao|sucessao|heranca|casamento|uniao estavel|responsabilidade civil"],
  ["Direito Tributário", "tributo|tributos|tributaria|tributario|imposto|icms|ipi|iss|iptu|ctn|fato gerador|obrigacao tributaria|credito tributario|lancamento tributario|isencao|imunidade tributaria|contribuicao de melhoria"],
  ["Contabilidade", "ativo|passivo|patrimonio liquido|balanco patrimonial|dre|demonstracao do resultado|demonstracoes contabeis|lancamento|debito|credito|estoque|estoques|depreciacao|receita|despesa|custo|cpc|nbc tg|contabil|contabeis|fornecedores|lucro|razonete|provisao|escrituracao|exercicio social|caixa e equivalentes|ativo circulante|imobilizado|intangivel|amortizacao acumulada|mensuracao|valor justo"],
  ["Ética e Legislação Profissional", "codigo de etica|etica profissional|profissional da contabilidade|crc|cfc|conselho federal de contabilidade|conselho regional|educacao profissional continuada|epc|nbc pg|perito contabil|cnpc|exercicio profissional|responsabilidade tecnica|sigilo profissional|profissao contabil|funcao social|interesse publico"],
  ["Auditoria", "auditoria|auditor|auditores|parecer|opiniao do auditor|amostragem|nbc ta|distorcao relevante|ceticismo|procedimentos de auditoria|controle interno"],
  ["Legislação Eleitoral", "eleitoral|eleitorais|eleicao|eleicoes|eleitor|eleitores|campanha eleitoral|gastos de campanha|partido politico|partidos politicos|candidato|candidatos|diplomacao|justica eleitoral|tse|tre|fundo partidario"],
  ["Administração", "planejamento estrategico|organizacao|lideranca|motivacao|gestao de pessoas|swot|maslow|herzberg|cultura organizacional|clima organizacional|administracao geral|processo decisorio|estrutura organizacional"],
  ["Economia", "oferta|demanda|pib|inflacao|elasticidade|monopolio|oligopolio|microeconomia|macroeconomia|politica monetaria|politica fiscal|taxa de cambio|curva de"],
  ["Estatística", "media aritmetica|mediana|moda|desvio padrao|variancia|amostra|distribuicao normal|frequencia relativa|quartil|estatistic"],
  ["Arquivologia", "arquivologia|arquivo corrente|arquivo intermediario|arquivo permanente|gestao documental|tabela de temporalidade|documento de arquivo|protocolo"],
].map(([name, re]) => [name, new RegExp("(?:^|[^a-z])(?:" + re + ")(?![a-z])", "g")]);
export const SUBJECT_NAMES = SUBJECTS.map(([n]) => n).concat("Inglês");
export function guessSubject(text){
  const t = " " + (text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + " ";
  // texto em inglês
  const en = (t.match(/\b(?:the|and|of|is|which|that|according|following)\b/g) || []).length;
  if (en >= 5) return "Inglês";
  let best = "", bs = 0;
  for (const [name, re] of SUBJECTS) {
    let sc = 0; for (const m of t.matchAll(re)) sc += m[0].includes(" ") ? 2 : 1;
    if (sc > bs) { bs = sc; best = name; }
  }
  return bs >= 2 ? best : "";
}

export function parseQuestions(text){
  let lines = text.split(/\n/).map(l => l.replace(/\s+/g, " ").trim());
  // linhas que começam um bloco depois de um espaço vertical (a leitura do PDF marca com linha vazia)
  const paraStart = new Set(lines.filter((l, i) => l && i && !lines[i - 1]));
  lines = lines.filter(Boolean);
  // alternativa que é uma fração montada (numerador em cima, letra no meio, denominador embaixo): "(A) 5/7"
  for (let i = 1; i < lines.length - 1; i++) {
    if (/^\(?[A-E]\)$/.test(lines[i]) && /^\d{1,4}$/.test(lines[i - 1]) && /^\d{1,4}$/.test(lines[i + 1])) {
      lines.splice(i - 1, 3, `${lines[i]} ${lines[i - 1]}/${lines[i + 1]}`); i--;
    }
  }
  lines = lines.filter(l => !NOISE.test(l));
  // cabeçalhos e rodapés que se repetem em várias páginas
  const freq = {}; lines.forEach(l => freq[l] = (freq[l] || 0) + 1);
  // título de matéria: linha curta em maiúsculas que aparece uma vez só ("MATEMÁTICA FINANCEIRA")
  const sectionTitle = l => {
    if (!l || freq[l] > 1) return "";
    const t = l.replace(/^[^A-Za-zÀ-ú]+|[^A-Za-zÀ-ú]+$/g, "");
    if (t.length < 5 || t.length > 60 || /[a-zà-ú]/.test(t) || !/[A-ZÀ-Ú]{4}/.test(t) || /\d/.test(t) || gabLine(t) || COMMENT.test(t) || INSTR.test(t) || /^(?:QUEST[ÕO]ES|GABARITO|COMENT[ÁA]RIOS?|ATEN[ÇC][ÃA]O|INSTRU[ÇC][ÕO]ES)\b/.test(t) || /(?:^|\s)(?:PROVA|SIMULADO|CADERNO|CONCURSO|CARGO|EDITAL|TRIBUNAL|BANCA|APOSTILA)(?:\s|$)|\s[-–—|]\s/.test(t)) return "";
    return titleCase(t);
  };
  // rodapé com o número da página ("Tipo 1 – Página 6"): repete trocando só os números
  const dnorm = l => l.replace(/\d+/g, "#"), dfreq = {};
  lines.forEach(l => { if (/\d/.test(l)) dfreq[dnorm(l)] = (dfreq[dnorm(l)] || 0) + 1; });
  const pageMark = l => l.length <= 60 && /p[áa]g(?:ina|\.)?\s*#/i.test(dnorm(l)) && dfreq[dnorm(l)] >= 3;
  // linha repetida é cabeçalho ou rodapé quando aparece em boa parte das páginas (o cabeçalho que mais se repete dá
  // a medida) e com as repetições espalhadas. Frases que se repetem em poucas questões ("Assinale a alternativa
  // correta:") e linhas iguais em alternativas da mesma questão ("Ferroviária Federal, Polícias Militares, Corpos de") ficam
  const pos = {}; lines.forEach((l, i) => (pos[l] = pos[l] || []).push(i));
  // (páginas finais quase vazias deixam o rodapé colado: com 4+ repetições basta a maioria espalhada)
  const spread = l => { const ps = pos[l]; if (ps.length < 2) return false; const far = ps.filter((p, k) => k && p - ps[k - 1] >= 12).length; return ps.length < 4 ? far === ps.length - 1 : far >= (ps.length - 1) * 0.75; };
  const headLike = l => l.length > 10 && !ALT.test(l) && !QSTART.test(l) && !BANCA.test(l) && !gabLine(l) && !COMMENT.test(l);
  const maxRep = Math.max(0, ...Object.keys(freq).filter(l => freq[l] > 1 && headLike(l) && spread(l)).map(l => freq[l]));
  const pages = Math.max(2, Math.ceil(maxRep / 2));
  // sigla curta no cabeçalho de cada página ("IBADE"); no meio da questão ela cortava o resto da alternativa
  const shortHead = l => freq[l] >= Math.max(3, pages) && spread(l) && /^[A-ZÀ-Ú]{3,10}$/.test(l) && !/^(?:CERTO|ERRADO|ANULADA|PROVA|TEXTO|QUEST[ÃA]O|GABARITO|ITEM|ITENS|RESPOSTA)$/.test(l);
  lines = lines.filter(l => !pageMark(l) && !shortHead(l) && !(freq[l] >= pages && spread(l) && headLike(l)));
  // sumário/índice: linhas com pontilhado até o número da página e o bloco logo abaixo do título "Sumário"
  const TOC_LINE = /(?:\.\s?){4,}\s*\d{1,4}$|…+\s*\d{1,4}$|_{4,}\s*\d{1,4}$/;
  const tocKept = []; let inToc = false;
  for (const l of lines) {
    if (/^(?:sum[áa]rio|[íi]ndice|conte[úu]do program[áa]tico)\b/i.test(l) && l.length < 40) { inToc = true; continue; }
    if (TOC_LINE.test(l)) continue;
    if (inToc) {
      // entradas de sumário: curtas e terminando no número da página
      if (l.length < 110 && /\s\d{1,4}$/.test(l) && !ALT.test(l)) continue;
      inToc = false;
    }
    tocKept.push(l);
  }
  lines = tocKept;

  // gabarito em qualquer parte do arquivo (primeiras páginas, fim ou meio):
  // linhas só com pares "1-C 2-A", tabela de números com letras embaixo, ou pares logo após um título "Gabarito"
  const key = {};
  const pairRe = /(\d{1,3})\s*[\-–—.:)]?\s*(certo|errado|anulad[ao]|[a-e])(?![a-zà-ú])/gi;
  const isKeyTok = a => /^(?:[a-e]|certo|errado|x|\*|anulad[ao])$/i.test(a);
  const addPairs = l => { for (const m of l.matchAll(pairRe)) { const a = normAnswer(m[2]); if (a) key[+m[1]] = a; } };
  const kept = []; let inKey = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^gabaritos?\b/i.test(l) && !gabLine(l)) {
      inKey = true; addPairs(l.replace(/^gabaritos?\s*(?:oficial|definitivo|preliminar)?\s*[:\-–]?\s*/i, "")); continue;
    }
    const nums = l.replace(/^(?:ite(?:m|ns)|quest(?:[õo]es|[ãa]o)|n[º°o]\.?)\s*/i, "").split(/\s+/);
    if (nums.length > 1 && nums.every(n => /^\d{1,3}$/.test(n)) && lines[i+1]) {
      const ans = lines[i+1].replace(/^(?:gabarito|respostas?|gab\.?)\s*:?\s*/i, "").split(/\s+/);
      if (ans.length === nums.length && ans.every(isKeyTok)) { nums.forEach((n, k) => { const a = normAnswer(ans[k]); if (a) key[+n] = a; }); i++; inKey = true; continue; }
    }
    const pairs = [...l.matchAll(pairRe)].length;
    const leftover = l.replace(pairRe, "").replace(/[\s|;,.\-–—()]/g, "");
    if ((pairs >= 3 && leftover.length <= 8) || (inKey && pairs >= 1 && leftover.length <= 4)) { addPairs(l); continue; }
    if (inKey && l.length > 25) inKey = false;
    kept.push(l);
  }
  lines = kept;
  // tabela de gabarito em que a leitura por imagem perdeu os números (texto branco no fundo azul):
  // sobram linhas só de letras, "B D B D C ...". Guardadas na ordem, para completar as respostas que faltarem.
  const gridRows = [];
  const letterRow = l => {
    const toks = l.split(/\s+/).filter(Boolean); if (toks.length < 5) return null;
    const out = []; let bad = 0;
    for (const t0 of toks) {
      const t = t0.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z]/g, "");
      if (/^([A-Ea-e])\1*$/i.test(t) && t.length <= 3) out.push(t[0].toUpperCase());       // "C", "CC", "Cc"
      else if (/^[A-E]{2,3}$/.test(t)) out.push(...t);                                    // "BD" = duas células grudadas
      else { out.push(null); bad++; }
    }
    return bad <= Math.max(1, out.length * 0.15) ? out : null;
  };
  lines = lines.filter(l => { const r = letterRow(l); if (r) { gridRows.push(r); return false; } return true; });
  // separa alternativas que vieram na mesma linha: "(A) x (B) y"
  lines = lines.flatMap(l => ALT.test(l) && /\s\(?[B-E]\s*[).]\s/.test(l) ? l.split(/\s(?=\(?[B-E]\s*[).]\s)/) : [l]);
  // "(A)" no meio da linha (comum no OCR): quebra antes de cada alternativa entre parênteses
  lines = lines.flatMap(l => /\S\s+\([A-E]\)\s/.test(l) ? l.split(/\s+(?=\([A-E]\)\s)/) : [l]);

  // prova que numera as questões com "QUESTÃO 12" (o cabeçalho sozinho na linha também vale)
  const strict = lines.filter(l => QHEAD.test(l)).length >= 5;
  // textos de apoio: "Leia o Texto I para responder as questões de 1 a 5." O texto vai até a primeira dessas questões
  // e sai da leitura das questões; depois entra em cada uma delas (sem ele, as de interpretação ficam sem sentido)
  const SUPPORT_RE = /\btexto\s*([IVX]{1,5}\b|\d{1,2}\b|[A-Z]{1,3}\d[A-Z0-9]{0,4}\b)?.{0,70}?\bquest(?:[õo]es|[ãa]o)\s*(?:de\s+|n[º°os]+\.?\s*)?(\d{1,3})(?:\s*(?:a|à|até|e|-|–)\s*(\d{1,3}))?/i;
  const support = [], drop = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!/^(?:leia|texto|considere|observe|analise|com\s+base|utilize|use|baseado)/i.test(lines[i])) continue;
    let m = lines[i].match(SUPPORT_RE), last = i;
    if (!m && lines[i + 1] && lines[i].length < 90) { m = (lines[i] + " " + lines[i + 1]).match(SUPPORT_RE); last = i + 1; }
    if (!m) continue;
    const from = +m[2], to = +(m[3] || m[2]); if (to < from || to - from > 15) continue;
    // o texto termina onde começa a primeira questão do intervalo
    let end = -1;
    for (let k = last + 1; k < Math.min(lines.length, last + 400); k++) {
      const q = lines[k].match(QSTART); if (!q || (strict && !QHEAD.test(lines[k]))) continue;
      if (+(q[1] || q[3]) === from) { end = k; break; }
      if (strict || q[1]) break; // outra questão no caminho: não é esse formato
    }
    if (end < 0 || end - last < 3) continue;
    support.push({from, to, text:joinText(lines.slice(last + 1, end))});
    for (let k = last + 1; k < end; k++) drop.add(k);
    i = end - 1;
  }
  if (drop.size) lines = lines.filter((l, i) => !drop.has(i));

  // prova de itens no estilo Cebraspe: "Com base no texto CG1A1-I, julgue os itens a seguir." e "A partir dessa situação
  // hipotética, julgue o item." O texto citado, a situação e a instrução valem para os itens seguintes; sem isso a
  // situação grudava no fim do item anterior e o item seguinte ficava sem sentido
  const qnum = l => { const m = l && l.match(QSTART); return m ? +(m[1] || m[3]) : null; };
  const JULG = /\bjulgue\b/i, caps = l => !/[a-zà-ú]/.test(l) && /[A-ZÀ-Ú]{3}/.test(l);
  const ceb = !strict && lines.filter(l => JULG.test(l)).length >= 3;
  const blocks = [];
  // onde termina o texto do item que começa em p (antes de "end"): no espaço vertical ou, sem ele, no fim de frase
  // ("Nessa situação, ..." continua o próprio item)
  // (early: o primeiro dos dois, para cortar a parte discursiva que vem logo depois do último item)
  const itemEnd = (p, end, early = false) => {
    const cont = l => /^(?:ness[ae]s?|nest[ae]s?|dess[ae]s?|assim|portanto|logo|ou seja)\b/i.test(l);
    let gap = end, sent = end;
    for (let k = p + 1; k < end; k++) if (paraStart.has(lines[k]) && !cont(lines[k])) { gap = k; break; }
    for (let k = p + 1; k < end - 1; k++) if (/[.!?]["”’]?$/.test(lines[k - 1]) && /^[A-ZÀ-Ú“"‘(•●]/.test(lines[k]) && !cont(lines[k])) { sent = k; break; }
    return early ? Math.min(gap, sent) : gap < end ? gap : sent;
  };
  if (ceb) {
    const named = {}, cut = new Set();
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].length <= 30 && lines[i].match(/^texto\s+([A-Z0-9][\w\-]{0,15})$/i); if (!m) continue;
      let k = i + 1; while (k < lines.length && k < i + 250 && qnum(lines[k]) === null && !/\(com adapta[çc][õo]es\)\.?$|^internet:|^dispon[íi]vel em/i.test(lines[k])) k++;
      if (k >= lines.length || qnum(lines[k]) !== null || k - i < 3) continue;
      while (k + 1 < lines.length && /^(?:internet|dispon[íi]vel|acesso em|<)/i.test(lines[k + 1])) k++;
      named[m[1].toUpperCase()] = joinText(lines.slice(i, k + 1));
      for (let j = i; j <= k; j++) cut.add(j);
      i = k;
    }
    for (let i = 0; i < lines.length; i++) {
      if (cut.has(i) || !JULG.test(lines[i]) || qnum(lines[i]) !== null) continue;
      let e = i; while (e < i + 4 && e + 1 < lines.length && !/[.:]$/.test(lines[e]) && qnum(lines[e + 1]) === null) e++;
      const num = qnum(lines[e + 1] || ""); if (num === null) continue;
      let st = i; while (st > 0 && i - st < 4 && !cut.has(st - 1) && !/[.!?:;)]["”]?$/.test(lines[st - 1]) && qnum(lines[st - 1]) === null && !caps(lines[st - 1])) st--;
      // a situação hipotética fica entre o fim do item anterior e a instrução
      let c = st;
      for (let k = st - 1; k >= Math.max(0, st - 150); k--) {
        if (cut.has(k)) break;
        if (qnum(lines[k]) === num - 1) { c = itemEnd(k, st); break; }
      }
      // título de matéria em maiúsculas fica na leitura (ele dá a matéria das questões seguintes)
      while (c < st && caps(lines[c])) c++;
      const instr = lines.slice(st, e + 1).join(" ");
      const ref = instr.match(/\btextos?\s+([A-Z0-9][\w\-]{0,15})/i);
      // situação que termina no meio da frase (a instrução começa na mesma frase): vai tudo junto
      const sit = c < st && !/[.!?:;)]["”]?$/.test(lines[st - 1]) ? [joinText(lines.slice(c, e + 1))] : [c < st ? joinText(lines.slice(c, st)) : "", instr];
      const parts = [ref && named[ref[1].toUpperCase()], ...sit].filter(Boolean);
      blocks.push({from:num, text:parts.join("\n\n"), lines:[...lines.slice(c, e + 1)]});
      for (let j = c; j <= e; j++) cut.add(j);
      i = e;
    }
    // parte discursiva depois do último item ("redija um texto dissertativo"): fica de fora
    const disc = lines.findLastIndex(l => /\bredija\b|texto dissertativo|prova discursiva|quest[ãa]o discursiva/i.test(l));
    if (disc > 0) {
      let last = -1; for (let k = disc - 1; k >= 0; k--) if (qnum(lines[k]) !== null && !cut.has(k)) { last = k; break; }
      if (last >= 0) for (let j = itemEnd(last, disc + 1, true); j < lines.length; j++) cut.add(j);
    }
    if (cut.size) lines = lines.filter((l, i) => !cut.has(i));
    blocks.forEach((b, k) => { b.to = blocks[k + 1] ? blocks[k + 1].from - 1 : Infinity; support.push(b); });
  }

  // as alternativas vêm logo em seguida (antes de outra questão)?
  const altSoon = i => { for (let k = i + 1; k < Math.min(lines.length, i + 6); k++) { if (ALT.test(lines[k])) return true; if (QSTART.test(lines[k]) || BANCA.test(lines[k])) return false; } return false; };
  // lê as questões a partir de uma linha, exigindo numeração em sequência (1, 2, 3...)
  const runFrom = (start, forced = true, end = lines.length) => {
    const qs = []; let q = null, mode = "front", prevNum = null, section = "", pend = null;
    const close = () => { if (q) qs.push(q); };
    // título de matéria logo antes da primeira questão
    for (let k = start - 1; k >= Math.max(0, start - 3); k--) { const t = sectionTitle(lines[k]); if (t) { section = t; break; } }
    for (let i = start; i < end; i++) {
      const l = lines[i];
      const m = l.match(QSTART);
      const num = m ? +(m[1] || m[3]) : null;
      // "42. (FGV/...)" com o número mal lido: a banca entre parênteses no começo da linha também abre questão
      const banca = BANCA.test(l);
      let isStart = m && (prevNum === null ? ((forced && i === start) || (num < 1000 && (m[1] || (m[4] || "").length > 15))) : num === prevNum + 1);
      // pulo de até 3 números (questão anulada ou número ilegível no meio) só quando a linha tem cara forte de início de questão
      if (!isStart && m && prevNum !== null && num > prevNum + 1 && num <= prevNum + 4 && (banca || m[1])) isStart = true;
      if (!isStart && !m && banca && prevNum !== null && mode !== "front") { isStart = true; }
      if (strict && isStart && !QHEAD.test(l)) isStart = false;
      if (isStart && !m) {
        close(); prevNum = prevNum + 1; mode = "front";
        if (pend && i - pend.i <= 3) section = pend.t;
        pend = null;
        q = {num:prevNum, front:l.replace(/^[^(]*/, "").trim(), options:[], answer:null, comment:"", section};
        continue;
      }
      if (isStart) {
        close(); prevNum = num; mode = "front";
        if (pend && i - pend.i <= 3) section = pend.t;
        pend = null;
        q = {num, front:(m[2] ?? m[4] ?? "").trim(), options:[], answer:null, comment:"", section};
        continue;
      }
      if (!q) continue;
      const g = gabLine(l);
      if (g) { const a = normAnswer(g[1] === "8" ? "B" : g[1]); // leitura por imagem às vezes troca o B por 8
        if (a) { q.answer = a; mode = "after"; continue; } }
      // títulos de seção em maiúsculas ("DIREITO PENAL") e instruções
      // (no meio do comentário, só pula a linha: costuma ser o cabeçalho da página seguinte)
      const st = sectionTitle(l); if (st) pend = {t:st, i};
      // sobra de tabela lida por imagem: só barras e letras soltas
      if (mode === "front" && !ALT.test(l) && l.replace(/[^A-Za-zÀ-ú0-9]/g, "").length < 2 && !/^[a-zà-ú]{1,3}:$/i.test(l)) continue;
      const upper = l.length < 70 && /[A-ZÀ-Ú]{3}/.test(l) && !/[a-zà-ú]/.test(l) && !ALT.test(l);
      // no meio do enunciado: cabeçalho de página repetido é só pulado (título de matéria ainda encerra a questão),
      // e "Com base nesses dados, ..." seguido das alternativas continua o enunciado
      const inFront = mode === "front" && q.front;
      // logo depois de "QUESTÃO 23" sozinho na linha, "Considerando...", "Leia...", "Com base..." já são o enunciado
      const fresh = mode === "front" && !q.front;
      if (fresh && upper) continue;
      if (inFront && upper && !st) continue;
      if (fresh && INSTR.test(l)) { /* começo do enunciado */ }
      else if (inFront && INSTR.test(l) && !/^texto\s/i.test(l) && !/julg|\bitens?\b|quest(?:[õo]es|[ãa]o)/i.test(l) && altSoon(i)) { /* segue como enunciado */ }
      else if (INSTR.test(l) || upper) { if (mode !== "comment" && mode !== "after") mode = "skip"; continue; }
      const c = l.match(COMMENT);
      if (c) { mode = "comment"; q.comment = (c[1] || "").trim(); continue; }
      const a = l.match(ALT);
      if (a && mode !== "comment" && (a[1] || a[2]).toUpperCase() === "ABCDE"[q.options.length]) { q.options.push(a[3].trim()); mode = "opt"; continue; }
      if (mode === "front") {
        // depois da lista, a frase que fecha o enunciado ("As afirmativas são, respectivamente,") vai para a linha de baixo
        const afterList = q.lastItem && /[.;]$/.test(q.front) && /^[A-ZÀ-Ú]/.test(l);
        const br = q.front && (LIST_ITEM.test(l) || TABLE_ROW(l) || q.lastRow || afterList);
        q.front += (q.front ? (br ? "\n" : " ") : "") + l; q.lastRow = TABLE_ROW(l);
        if (LIST_ITEM.test(l)) q.lastItem = true; else if (afterList) q.lastItem = false;
      }
      else if (mode === "opt") q.options[q.options.length - 1] += " " + l;
      else if (mode === "comment" || mode === "after") q.comment += (q.comment ? " " : "") + l; // explicação que vem depois do "Gabarito: D" também entra
    }
    close();
    return qs;
  };
  // pontuação de uma sequência: questão com alternativas vale mais; título solto (sumário, capítulo) não vale nada
  const score = qs => qs.reduce((s, q) => s + (q.options.length >= 2 ? 3 : q.answer ? 2 : q.front.length >= 60 ? 1 : 0), 0);
  // tenta começar em cada "1" do arquivo e fica com a sequência mais parecida com uma prova
  const starts = [];
  // (títulos de capítulo em maiúsculas, como "1 DIREITO PENAL", não contam como questão 1)
  lines.forEach((l, i) => { const m = l.match(QSTART); if (m && +(m[1] || m[3]) === 1 && (strict ? QHEAD.test(l) : /[a-zà-ú]/.test(m[2] ?? m[4] ?? ""))) starts.push(i); });
  let qs = [], best = -1;
  for (const st of starts) { const r = runFrom(st); const sc = score(r); if (sc > 0 && sc >= best) { best = sc; qs = r; } }
  if (best <= 0) qs = runFrom(0, false);
  // provas com cabeçalho forte em cada questão ("42. (FGV/Exame...)"): corta o texto em cada cabeçalho, sem depender
  // da sequência. Serve quando a leitura erra números ou há sumário com a lista das questões.
  const strong = [];
  lines.forEach((l, i) => { if (BANCA.test(l) && (QSTART.test(l) || !/^\d/.test(l))) strong.push(i); });
  if (strong.length >= 5) {
    const byNum = new Map(); let last = 0;
    strong.forEach((st, k) => {
      const m = lines[st].match(QSTART);
      const r = runFrom(st, true, strong[k + 1] ?? lines.length)[0]; if (!r) return;
      r.num = m ? +(m[1] || m[3]) : last + 1;
      last = r.num;
      const sc = score([r]), old = byNum.get(r.num);
      if (!old || sc > score([old])) byNum.set(r.num, r);
    });
    const alt = [...byNum.values()].filter(q => q.options.length >= 2 || q.answer || q.front.length >= 60).sort((a, b) => a.num - b.num);
    if (score(alt) > score(qs)) qs = alt;
  }

  // quantas questões a prova parece ter: maior número de cabeçalho forte ou do gabarito
  const keyNums = Object.keys(key).map(Number);
  const expected = Math.max(0, ...(strong.length >= 5 ? strong.map(i => +((lines[i].match(QSTART) || [])[1] || (lines[i].match(QSTART) || [])[3] || 0)) : []), ...(keyNums.length >= 5 ? keyNums : []));
  const lastNum = Math.max(0, ...qs.map(q => q.num));
  // nos itens Cebraspe a matéria sai do grupo inteiro (instrução, situação e itens), não de cada item sozinho
  const norm = t => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const named = b => { const t = norm(b.lines.join(" ")); return SUBJECTS.map(([n]) => n).find(n => n.includes(" ") && t.includes(norm(n))); };
  const groupSubject = b => b.subject ?? (b.subject = named(b) || guessSubject([...b.lines, ...qs.filter(q => q.num >= b.from && q.num <= b.to).map(q => q.front)].join(" ")));
  let prevSubject = "";
  const result = qs.filter(q => q.front.length > 3).map(q => {
    const ans = q.answer || key[q.num] || null;
    const sup = support.find(s => q.num >= s.from && q.num <= s.to);
    // sem alternativas, mas com cara de múltipla escolha (a página das alternativas faltou ou não foi lida)
    const lost = q.options.length < 2 && ((ans && /[ABD]/.test(ans)) || (!ceb && /assinale|alternativa|respectivamente|verdadeira \(V\)|correto o que se afirma|est[áa]\s+corret[ao]\s+(?:o|apenas)/i.test(q.front)));
    const isCE = !lost && (q.options.length < 2 || (q.options.length === 2 && /^certo/i.test(q.options[0]) && /^errado/i.test(q.options[1])));
    const out = {num:q.num, type:isCE ? "ce" : "mc", front:q.front, comment:q.comment, subject:q.section || (sup && sup.lines && groupSubject(sup)) || guessSubject([q.front, ...q.options, q.comment].join(" "))};
    if (sup) { out.support = sup.text; out.supportRange = [sup.from, Math.min(sup.to, lastNum)]; }
    // item Cebraspe sem pista de matéria: fica com a do item anterior (os grupos vêm em blocos da mesma matéria)
    if (ceb && !out.subject) out.subject = prevSubject; prevSubject = out.subject;
    if (ans === "X") out.void = true; // anulada no gabarito
    if (isCE) out.answer = ans === "C" || ans === "E" ? ans : null;
    else if (lost) { out.options = ["", "", "", ""]; out.lost = true; const idx = ans ? "ABCD".indexOf(ans) : -1; out.correct = idx >= 0 ? idx : null; }
    else { out.options = q.options.slice(0, 5).map(o => o.trim()); const idx = ans ? "ABCDE".indexOf(ans) : -1; out.correct = idx >= 0 && idx < out.options.length ? idx : null; }
    return out;
  });
  // completa pela tabela só de letras. A leitura pode grudar ou perder uma célula, então a tabela é alinhada
  // às respostas já conhecidas (como um "diff") antes de preencher as que faltam
  const grid = gridRows.flat();
  const total = expected || Math.max(0, ...result.map(q => q.num));
  if (grid.length >= total * 0.8 && total) {
    const ansOf = q => q.type === "mc" ? (q.correct != null ? "ABCDE"[q.correct] : null) : q.answer;
    const byNum = {}; result.forEach(q => byNum[q.num] = q);
    const A = Array.from({length:total}, (_, k) => byNum[k + 1] ? ansOf(byNum[k + 1]) : null);
    const n = A.length, m = grid.length, G = -2;
    const sc = (x, y) => x == null || y == null ? 0 : x === y ? 2 : -1;
    const D = Array.from({length:n + 1}, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) D[i][0] = i * G;
    for (let j = 1; j <= m; j++) D[0][j] = j * G;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.max(D[i-1][j-1] + sc(A[i-1], grid[j-1]), D[i-1][j] + G, D[i][j-1] + G);
    const pair = new Array(n).fill(null); let i = n, j = m, hit = 0, cmp = 0;
    while (i > 0 && j > 0) {
      if (D[i][j] === D[i-1][j-1] + sc(A[i-1], grid[j-1])) { pair[i-1] = grid[j-1]; if (A[i-1] && grid[j-1]) { cmp++; if (A[i-1] === grid[j-1]) hit++; } i--; j--; }
      else if (D[i][j] === D[i-1][j] + G) i--; else j--;
    }
    if (!cmp || hit / cmp >= 0.8) result.forEach(q => {
      const g = pair[q.num - 1]; if (!g || ansOf(q)) return;
      if (q.type === "mc") { const k = "ABCDE".indexOf(g); if (k < q.options.length) q.correct = k; }
      else if (g === "C" || g === "E") q.answer = g;
    });
  }
  result.expected = expected;
  return result;
}

/* ---------- PDF escaneado: leitura por imagem (tesseract.js em vendor/tesseract) ---------- */
let tessReady = null;
function loadTesseract(){
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tessReady) tessReady = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = new URL("vendor/tesseract/tesseract.min.js", document.baseURI).href;
    s.onload = () => res(window.Tesseract); s.onerror = () => { tessReady = null; rej(new Error("tesseract")); };
    document.head.appendChild(s);
  });
  return tessReady;
}
let ocrWorker = null, ocrCancel = false;
export function cancelOcr(){ ocrCancel = true; if (ocrWorker) { ocrWorker.terminate(); ocrWorker = null; } }
// onProgress(página atual, total, fração da página)
// páginas lidas na última leitura por imagem: texto de cada uma e as que saíram vazias
export const lastOcr = {pages:{}, empty:[]};
export async function ocrPdf(file, from, to, onProgress, pageList, {columns = true} = {}){
  ocrCancel = false;
  const doc = await openDoc(file);
  const T = await loadTesseract();
  const base = new URL("vendor/tesseract/", document.baseURI).href;
  const list = pageList || Array.from({length:to - from + 1}, (_, k) => from + k);
  let cur = 0;
  ocrWorker = await T.createWorker("por", 1, {
    workerPath: base + "worker.min.js", corePath: base + "core", langPath: base + "lang", gzip: true,
    logger: m => { if (m.status === "recognizing text") onProgress && onProgress(cur, list.length, m.progress); },
  });
  // um canvas só para todas as páginas: no iPhone cada canvas novo soma memória e, depois de umas 30 páginas,
  // o Safari passa a desenhar em branco sem avisar
  const cv = document.createElement("canvas"), cx = cv.getContext("2d", {willReadFrequently:true});
  const read = async (page, maxW) => {
    const vp1 = page.getViewport({scale:1});
    const vp = page.getViewport({scale:Math.min(2.5, maxW / vp1.width)});
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({canvasContext:cx, viewport:vp}).promise;
    const {data} = await ocrWorker.recognize(cv, {}, {text:true, blocks:true});
    // usa a posição de cada palavra para separar colunas, como no PDF com texto
    const words = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(pa => (pa.lines || []).forEach(l => (l.words || []).forEach(w => {
      if (w.text && w.text.trim()) words.push({str:w.text, width:w.bbox.x1 - w.bbox.x0, transform:[1, 0, 0, w.bbox.y1 - w.bbox.y0, w.bbox.x0, cv.height - w.bbox.y1]});
    }))));
    return {text:words.length ? pageLines(words, cv.width, columns).join("\n") : (data.text || ""), words:words.length};
  };
  const out = [];
  lastOcr.pages = {}; lastOcr.empty = [];
  try {
    for (const p of list) {
      if (ocrCancel) break;
      cur++; onProgress && onProgress(cur, list.length, 0);
      const page = await doc.getPage(p);
      let r;
      try {
        r = await read(page, 1800);
        // página que veio quase vazia: tenta de novo menor (pouca memória no celular costuma ser a causa)
        if (r.words < 8 && !ocrCancel) { const r2 = await read(page, 1200); if (r2.words > r.words) r = r2; }
      } catch(e){ if (ocrCancel) break; throw e; }
      finally { try { page.cleanup(); } catch(e){} }
      lastOcr.pages[p] = r.text;
      if (r.words < 8) lastOcr.empty.push(p);
      out.push(r.text);
    }
  } finally { cv.width = cv.height = 0; if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; } }
  return out.join("\n");
}
