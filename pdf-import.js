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

export async function extractPdfText(file, onProgress){
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
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
const GAB_LINE = /^(?:gabarito|resposta|resp\.)\s*(?:oficial|definitivo|preliminar)?\s*[:\-–]?\s*(.*)$/i;
const COMMENT = /^(?:coment[áa]rios?|justificativa|fundamenta[çc][ãa]o|explica[çc][ãa]o)\s*[:\-–]?\s*(.*)$/i;
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
    const nums = l.split(/\s+/);
    if (nums.length > 1 && nums.every(n => /^\d{1,3}$/.test(n)) && lines[i+1]) {
      const ans = lines[i+1].split(/\s+/);
      if (ans.length === nums.length && ans.every(a => /^(?:[a-e]|certo|errado|x|\*|anulad[ao])$/i.test(a))) {
        nums.forEach((n, k) => { const a = normAnswer(ans[k]); if (a) key[+n] = a; }); i++; continue;
      }
    }
    let m; while ((m = pairRe.exec(l))) { const a = normAnswer(m[2]); if (a) key[+m[1]] = a; }
  }
  return key;
}

export function parseQuestions(text){
  let lines = text.split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(l => l && !NOISE.test(l));
  // seção de gabarito no fim: última linha que é só "Gabarito..." e tem respostas depois
  let key = {};
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^gabarito\b/i.test(lines[i]) && i > lines.length * 0.4) {
      const k = parseKey([lines[i].replace(/^gabarito\s*\S*\s*[:\-–]?/i, ""), ...lines.slice(i+1)]);
      if (Object.keys(k).length >= 2) { key = k; lines = lines.slice(0, i); }
      break;
    }
  }
  // separa alternativas que vieram na mesma linha: "(A) x (B) y"
  lines = lines.flatMap(l => ALT.test(l) && /\s\(?[B-E]\s*[).]\s/.test(l) ? l.split(/\s(?=\(?[B-E]\s*[).]\s)/) : [l]);

  const qs = []; let q = null, mode = "front", prevNum = null;
  const close = () => { if (q) qs.push(q); };
  for (const l of lines) {
    const m = l.match(QSTART);
    const num = m ? +(m[1] || m[3]) : null;
    const isStart = m && (prevNum === null ? num < 1000 && (m[1] || (m[4] || "").length > 15) : num === prevNum + 1);
    if (isStart) {
      close(); prevNum = num; mode = "front";
      q = {num, front:(m[2] ?? m[4] ?? "").trim(), options:[], answer:null, comment:""};
      continue;
    }
    if (!q) continue;
    const g = l.match(GAB_LINE);
    if (g && g[1] !== undefined) { const a = normAnswer(g[1].split(/\s/)[0]); if (a) { q.answer = a; mode = "after"; continue; } }
    const c = l.match(COMMENT);
    if (c) { mode = "comment"; q.comment = (c[1] || "").trim(); continue; }
    const a = l.match(ALT);
    if (a && mode !== "comment" && a[1].toUpperCase() === "ABCDE"[q.options.length]) { q.options.push(a[2].trim()); mode = "opt"; continue; }
    if (mode === "front") q.front += (q.front ? " " : "") + l;
    else if (mode === "opt") q.options[q.options.length - 1] += " " + l;
    else if (mode === "comment") q.comment += (q.comment ? " " : "") + l;
  }
  close();

  return qs.filter(q => q.front.length > 3).map(q => {
    const ans = q.answer || key[q.num] || null;
    const isCE = q.options.length < 2 || (q.options.length === 2 && /^certo/i.test(q.options[0]) && /^errado/i.test(q.options[1]));
    const out = {num:q.num, type:isCE ? "ce" : "mc", front:q.front, comment:q.comment};
    if (isCE) out.answer = ans === "C" || ans === "E" ? ans : null;
    else { out.options = q.options.slice(0, 5); const idx = ans ? "ABCDE".indexOf(ans) : -1; out.correct = idx >= 0 && idx < out.options.length ? idx : null; }
    return out;
  });
}
