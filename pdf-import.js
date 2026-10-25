// Lê questões de concurso de um PDF: extrai o texto com o pdf.js (vendor/)
// e separa enunciado, alternativas, gabarito e comentário.

let pdfjsReady = null;
function loadPdfjs(){
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsReady) pdfjsReady = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = new URL("vendor/pdf.min.js", document.baseURI).href;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.js", document.baseURI).href; res(window.pdfjsLib); };
    s.onerror = () => { pdfjsReady = null; rej(new Error("pdfjs")); };
    document.head.appendChild(s);
  });
  return pdfjsReady;
}

// Junta os pedaços de texto de uma página em linhas, respeitando provas em duas colunas.
function pageLines(items, width){
  const its = items.filter(i => i.str && i.str.trim()).map(i => ({s:i.str, x:i.transform[4], y:i.transform[5], w:i.width || 0, h:Math.abs(i.transform[3]) || 10}));
  if (!its.length) return [];
  // duas colunas só quando, nas linhas que têm texto dos dois lados, sobra um corredor vazio no meio da página
  const mid = width / 2, hs = width * 0.012;
  const rows = []; [...its].sort((a, b) => b.y - a.y).forEach(i => { const r = rows[rows.length - 1]; if (r && Math.abs(r.y - i.y) <= Math.max(2, i.h * 0.45)) r.its.push(i); else rows.push({y:i.y, its:[i]}); });
  let both = 0, free = 0;
  for (const r of rows) {
    if (!r.its.some(i => i.x + i.w < mid) || !r.its.some(i => i.x > mid)) continue;
    both++; if (!r.its.some(i => i.x < mid + hs && i.x + i.w > mid - hs)) free++;
  }
  const left = its.filter(i => i.x + i.w <= mid + hs), right = its.filter(i => i.x >= mid - hs);
  const cols = (both >= 3 && free / both >= 0.85 && left.length > 5 && right.length > 5) ? [its.filter(i => i.x < mid), its.filter(i => i.x >= mid)] : [its];
  const out = [];
  for (const col of cols) {
    col.sort((a, b) => b.y - a.y || a.x - b.x);
    let line = [], ly = null;
    const flush = () => { if (!line.length) return; line.sort((a, b) => a.x - b.x); let t = "", end = null; for (const i of line) { if (end !== null && i.x - end > 1.5 && !t.endsWith(" ") && !i.s.startsWith(" ")) t += " "; t += i.s; end = i.x + i.w; } out.push(t.replace(/\s+/g, " ").trim()); line = []; };
    for (const i of col) { if (ly !== null && Math.abs(i.y - ly) > Math.max(2, i.h * 0.45)) flush(); line.push(i); ly = i.y; }
    flush();
  }
  return out;
}

let lastDoc = null, lastFile = null;
async function openDoc(file){
  if (lastFile === file && lastDoc) return lastDoc;
  const pdfjs = await loadPdfjs();
  lastDoc = await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise; lastFile = file;
  return lastDoc;
}
export async function pdfPageCount(file){ return (await openDoc(file)).numPages; }

// texto de cada página na última extração (para achar páginas que são só imagem no meio de um PDF com texto)
export const lastText = {pages:{}};
export async function extractPdfText(file, onProgress){
  const doc = await openDoc(file);
  const lines = []; lastText.pages = {};
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({scale:1});
    const tc = await page.getTextContent();
    const pl = pageLines(tc.items, vp.width);
    lastText.pages[p] = pl.join("\n");
    lines.push(...pl);
    onProgress && onProgress(p, doc.numPages);
  }
  return lines.join("\n");
}

/* ---------- interpretação do texto ---------- */
const QSTART = /^(?:quest[ãa]o|q\.?)\s*(\d{1,3})\b[\s.:)\-–—]*(.*)$|^(\d{1,3})\s*(?:[.)\-–—:]|\s)\s*(.*)$/i;
const ALT = /^\(?([A-Ea-e])\s*[).\-–—]\s+(.*)$/;
// gabarito logo depois da questão: "Gabarito: B", "GABARITO: LETRA C", "Gab. C", "Resposta correta: (B)", "Alternativa correta: letra B"
const GAB_LINE = /^(?:g[a4]b[a4]r[i1l|!][t7][o0]|gab\.?|resposta(?:\s+correta)?|resp\.|alternativa\s+correta|op[çc][ãa]o\s+correta)\s*(?:oficial|definitivo|preliminar)?\s*[:\-–.]?\s*(?:[ée]\s+)?(?:a\s+)?(?:letra|alternativa|op[çc][ãa]o|item)?\s*[:;,\-–]?\s*\(?(certo|errado|[a-e8])\)?(?![a-zà-ú\d])/i;
const BANCA = /^\S{0,6}\s*\((?:FGV|CESPE|CEBRASPE|FCC|VUNESP|IBFC|IDECAN|AOCP|QUADRIX|CESGRANRIO|FUNDATEC|CONSULPLAN|IADES|FEPESE|FUNRIO|IBADE|AVANÇA ?SP|INSTITUTO|SELECON|OBJETIVA|FUMARC|COPS|NC-UFPR|COMPERVE|CETRO|ESAF|FUNCAB|IDIB|ITAME|INSTITUTO AOCP)[\s\/)\-–]/i;
const COMMENT = /^(?:coment[áa]rios?|justificativa|fundamenta[çc][ãa]o|explica[çc][ãa]o)\s*[:\-–]?\s*(.*)$/i;
// instruções e textos de apoio entre questões ("Julgue os itens...", "Texto CB1A1") não entram no enunciado anterior
const INSTR = /^(?:texto\s+(?:[A-Z]{1,3}\d|para|associado|i+\b)|julgue\s|considerando\s|com\s+(?:base|rela[çc][ãa]o)\s|acerca\s|a\s+respeito\s|no\s+que\s+se\s+refere|em\s+rela[çc][ãa]o\s|tendo\s+em\s+vista|leia\s|observe\s|(?:conhecimentos|parte)\s+(?:b[áa]sicos|espec[íi]ficos|gerais|[IVX]+)\b|caderno\s|cargo\s)/i;
const NOISE = /^(?:p[áa]gina\s*\d+(\s*de\s*\d+)?|\d{1,3}|www\.\S+|-\s*\d+\s*-)$/i;

function normAnswer(s){
  s = (s || "").trim().replace(/[.;,]$/, "");
  if (/^certo$|^c$|^v$|^verdadeiro$/i.test(s)) return "C";
  if (/^errado$|^f$|^falso$/i.test(s)) return "E";
  if (/^[a-e]$/i.test(s)) return s.toUpperCase();
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

const SMALL = new Set(["de","da","do","das","dos","e","a","o","em","na","no","para","com"]);
function titleCase(t){ return t.toLowerCase().split(/\s+/).map((w, i) => i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }

/* matéria pelo conteúdo da questão, quando o PDF não traz títulos: palavras típicas de cada disciplina */
const SUBJECTS = [
  ["Língua Portuguesa", "concordancia|regencia|crase|colocacao pronominal|oracao|oracoes|sujeito|predicado|substantivo|adjetivo|adverbio|pronome|conjuncao|preposicao|pontuacao|virgula|acentuacao|ortografia|sinonimo|antonimo|coesao|coerencia|sentido original|reescrita|vocabulo|figura de linguagem|interpretacao do texto|no texto|do texto|trecho|semantic|morfolog|sintatic|voz passiva|gramatical|norma culta|norma-padrao|tempo verbal|forma verbal|frase|frases|periodo composto"],
  ["Matemática", "equacao|funcao (?:afim|quadratica|exponencial|logaritmica|do primeiro grau|do segundo grau)|porcentagem|razao|proporcao|regra de tres|fracao|perimetro|volume|triangulo|retangulo|circulo|mmc|mdc|potencia|raiz quadrada|progressao aritmetica|progressao geometrica|numeros inteiros|numero natural|geometri|algebr"],
  ["Matemática Financeira", "juros|montante|capitalizacao|amortizacao|sistema de amortizacao|tabela price|desconto comercial|desconto racional|taxa nominal|taxa efetiva|valor presente|valor futuro|emprestimo|financiamento|prestacao|prestacoes|parcelas mensais"],
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
  let lines = text.split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(l => l && !NOISE.test(l));
  // cabeçalhos e rodapés que se repetem em várias páginas
  const freq = {}; lines.forEach(l => freq[l] = (freq[l] || 0) + 1);
  // título de matéria: linha curta em maiúsculas que aparece uma vez só ("MATEMÁTICA FINANCEIRA")
  const sectionTitle = l => {
    if (!l || freq[l] > 1) return "";
    const t = l.replace(/^[^A-Za-zÀ-ú]+|[^A-Za-zÀ-ú]+$/g, "");
    if (t.length < 5 || t.length > 60 || /[a-zà-ú]/.test(t) || !/[A-ZÀ-Ú]{4}/.test(t) || /\d/.test(t) || GAB_LINE.test(t) || COMMENT.test(t) || INSTR.test(t) || /^(?:QUEST[ÕO]ES|GABARITO|COMENT[ÁA]RIOS?|ATEN[ÇC][ÃA]O|INSTRU[ÇC][ÕO]ES)\b/.test(t) || /(?:^|\s)(?:PROVA|SIMULADO|CADERNO|CONCURSO|CARGO|EDITAL|TRIBUNAL|BANCA|APOSTILA)(?:\s|$)|\s[-–—|]\s/.test(t)) return "";
    return titleCase(t);
  };
  lines = lines.filter(l => !(freq[l] > 1 && l.length > 10 && !ALT.test(l) && !QSTART.test(l) && !BANCA.test(l) && !GAB_LINE.test(l) && !COMMENT.test(l)));
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
    if (/^gabaritos?\b/i.test(l) && !GAB_LINE.test(l)) {
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
  // separa alternativas que vieram na mesma linha: "(A) x (B) y"
  lines = lines.flatMap(l => ALT.test(l) && /\s\(?[B-E]\s*[).]\s/.test(l) ? l.split(/\s(?=\(?[B-E]\s*[).]\s)/) : [l]);
  // "(A)" no meio da linha (comum no OCR): quebra antes de cada alternativa entre parênteses
  lines = lines.flatMap(l => /\S\s+\([A-E]\)\s/.test(l) ? l.split(/\s+(?=\([A-E]\)\s)/) : [l]);

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
      const g = l.match(GAB_LINE);
      if (g) { const a = normAnswer(g[1] === "8" ? "B" : g[1]); // leitura por imagem às vezes troca o B por 8
        if (a) { q.answer = a; mode = "after"; continue; } }
      // títulos de seção em maiúsculas ("DIREITO PENAL") e instruções
      // (no meio do comentário, só pula a linha: costuma ser o cabeçalho da página seguinte)
      const st = sectionTitle(l); if (st) pend = {t:st, i};
      if (INSTR.test(l) || (l.length < 70 && /[A-ZÀ-Ú]{3}/.test(l) && !/[a-zà-ú]/.test(l) && !ALT.test(l))) { if (mode !== "comment" && mode !== "after") mode = "skip"; continue; }
      const c = l.match(COMMENT);
      if (c) { mode = "comment"; q.comment = (c[1] || "").trim(); continue; }
      const a = l.match(ALT);
      if (a && mode !== "comment" && a[1].toUpperCase() === "ABCDE"[q.options.length]) { q.options.push(a[2].trim()); mode = "opt"; continue; }
      if (mode === "front") q.front += (q.front ? " " : "") + l;
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
  lines.forEach((l, i) => { const m = l.match(QSTART); if (m && +(m[1] || m[3]) === 1 && /[a-zà-ú]/.test(m[2] ?? m[4] ?? "")) starts.push(i); });
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
  const result = qs.filter(q => q.front.length > 3).map(q => {
    const ans = q.answer || key[q.num] || null;
    const isCE = q.options.length < 2 || (q.options.length === 2 && /^certo/i.test(q.options[0]) && /^errado/i.test(q.options[1]));
    const out = {num:q.num, type:isCE ? "ce" : "mc", front:q.front, comment:q.comment, subject:q.section || guessSubject([q.front, ...q.options, q.comment].join(" "))};
    if (isCE) out.answer = ans === "C" || ans === "E" ? ans : null;
    else { out.options = q.options.slice(0, 5); const idx = ans ? "ABCDE".indexOf(ans) : -1; out.correct = idx >= 0 && idx < out.options.length ? idx : null; }
    return out;
  });
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
export async function ocrPdf(file, from, to, onProgress, pageList){
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
    return {text:words.length ? pageLines(words, cv.width).join("\n") : (data.text || ""), words:words.length};
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
