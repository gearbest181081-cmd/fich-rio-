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
  const mid = width / 2;
  const cross = its.filter(i => i.x < mid - 4 && i.x + i.w > mid + 4).length;
  const left = its.filter(i => i.x + i.w <= mid + 4), right = its.filter(i => i.x >= mid - 4);
  const cols = (cross / its.length < 0.04 && left.length > 5 && right.length > 5) ? [its.filter(i => i.x < mid), its.filter(i => i.x >= mid)] : [its];
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

export async function extractPdfText(file, onProgress){
  const doc = await openDoc(file);
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({scale:1});
    const tc = await page.getTextContent();
    lines.push(...pageLines(tc.items, vp.width));
    onProgress && onProgress(p, doc.numPages);
  }
  return lines.join("\n");
}

/* ---------- interpretação do texto ---------- */
const QSTART = /^(?:quest[ãa]o|q\.?)\s*(\d{1,3})\b[\s.:)\-–—]*(.*)$|^(\d{1,3})\s*(?:[.)\-–—:]|\s)\s*(.*)$/i;
const ALT = /^\(?([A-Ea-e])\s*[).\-–—]\s+(.*)$/;
// gabarito logo depois da questão: "Gabarito: B", "GABARITO: LETRA C", "Gab. C", "Resposta correta: (B)", "Alternativa correta: letra B"
const GAB_LINE = /^(?:gabarito|gab\.?|resposta(?:\s+correta)?|resp\.|alternativa\s+correta|op[çc][ãa]o\s+correta)\s*(?:oficial|definitivo|preliminar)?\s*[:\-–.]?\s*(?:[ée]\s+)?(?:a\s+)?(?:letra|alternativa|op[çc][ãa]o|item)?\s*[:\-–]?\s*\(?(certo|errado|[a-e])\)?(?![a-zà-ú])/i;
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

export function parseQuestions(text){
  let lines = text.split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(l => l && !NOISE.test(l));
  // cabeçalhos e rodapés que se repetem em várias páginas
  const freq = {}; lines.forEach(l => freq[l] = (freq[l] || 0) + 1);
  lines = lines.filter(l => !(freq[l] > 1 && l.length > 10 && !ALT.test(l) && !QSTART.test(l)));
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
  const runFrom = (start, forced = true) => {
    const qs = []; let q = null, mode = "front", prevNum = null;
    const close = () => { if (q) qs.push(q); };
    for (let i = start; i < lines.length; i++) {
      const l = lines[i];
      const m = l.match(QSTART);
      const num = m ? +(m[1] || m[3]) : null;
      const isStart = m && (prevNum === null ? ((forced && i === start) || (num < 1000 && (m[1] || (m[4] || "").length > 15))) : num === prevNum + 1);
      if (isStart) {
        close(); prevNum = num; mode = "front";
        q = {num, front:(m[2] ?? m[4] ?? "").trim(), options:[], answer:null, comment:""};
        continue;
      }
      if (!q) continue;
      const g = l.match(GAB_LINE);
      if (g) { const a = normAnswer(g[1]); if (a) { q.answer = a; mode = "after"; continue; } }
      // títulos de seção em maiúsculas ("DIREITO PENAL") e instruções
      if (INSTR.test(l) || (l.length < 70 && /[A-ZÀ-Ú]{3}/.test(l) && !/[a-zà-ú]/.test(l) && !ALT.test(l))) { mode = "skip"; continue; }
      const c = l.match(COMMENT);
      if (c) { mode = "comment"; q.comment = (c[1] || "").trim(); continue; }
      const a = l.match(ALT);
      if (a && mode !== "comment" && a[1].toUpperCase() === "ABCDE"[q.options.length]) { q.options.push(a[2].trim()); mode = "opt"; continue; }
      if (mode === "front") q.front += (q.front ? " " : "") + l;
      else if (mode === "opt") q.options[q.options.length - 1] += " " + l;
      else if (mode === "comment") q.comment += (q.comment ? " " : "") + l;
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

  return qs.filter(q => q.front.length > 3).map(q => {
    const ans = q.answer || key[q.num] || null;
    const isCE = q.options.length < 2 || (q.options.length === 2 && /^certo/i.test(q.options[0]) && /^errado/i.test(q.options[1]));
    const out = {num:q.num, type:isCE ? "ce" : "mc", front:q.front, comment:q.comment};
    if (isCE) out.answer = ans === "C" || ans === "E" ? ans : null;
    else { out.options = q.options.slice(0, 5); const idx = ans ? "ABCDE".indexOf(ans) : -1; out.correct = idx >= 0 && idx < out.options.length ? idx : null; }
    return out;
  });
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
export async function ocrPdf(file, from, to, onProgress){
  ocrCancel = false;
  const doc = await openDoc(file);
  const T = await loadTesseract();
  const base = new URL("vendor/tesseract/", document.baseURI).href;
  let cur = 0;
  ocrWorker = await T.createWorker("por", 1, {
    workerPath: base + "worker.min.js", corePath: base + "core", langPath: base + "lang", gzip: true,
    logger: m => { if (m.status === "recognizing text") onProgress && onProgress(cur, to - from + 1, m.progress); },
  });
  const out = [];
  try {
    for (let p = from; p <= to; p++) {
      if (ocrCancel) break;
      cur = p - from + 1; onProgress && onProgress(cur, to - from + 1, 0);
      const page = await doc.getPage(p);
      const vp1 = page.getViewport({scale:1});
      const scale = Math.min(2.5, 1800 / vp1.width);
      const vp = page.getViewport({scale});
      const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      await page.render({canvasContext:cx, viewport:vp}).promise;
      if (ocrCancel) break;
      let data;
      try { ({data} = await ocrWorker.recognize(cv, {}, {text:true, blocks:true})); } catch(e){ if (ocrCancel) break; throw e; }
      // usa a posição de cada palavra para separar colunas, como no PDF com texto
      const words = [];
      (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(pa => (pa.lines || []).forEach(l => (l.words || []).forEach(w => {
        if (w.text && w.text.trim()) words.push({str:w.text, width:w.bbox.x1 - w.bbox.x0, transform:[1, 0, 0, w.bbox.y1 - w.bbox.y0, w.bbox.x0, cv.height - w.bbox.y1]});
      }))));
      out.push(words.length ? pageLines(words, cv.width).join("\n") : data.text);
      cv.width = cv.height = 0;
    }
  } finally { if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; } }
  return out.join("\n");
}
