// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[“”„"]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9äöüß\s\-\/]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(arr) { return [...new Set(arr)]; }

function cleanStr(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Kapitel exakt wie Vorlage ----------
const CHAPTER_ORDER = [
  "Wetter",
  "Notfälle",
  "Navigation",
  "Schiffsmerkmale",
  "Wendungen",
  "Weitere nautische Begriffe",
  "Meldungsstruktur"
];

function normalizeChapterName(ch) {
  const c = cleanStr(ch);
  const key = c.toLowerCase();

  if (key === "wetter") return "Wetter";
  if (key === "navigation") return "Navigation";
  if (key === "wendungen") return "Wendungen";
  if (key === "meldungsstruktur") return "Meldungsstruktur";
  if (key === "notfaelle" || key === "notfälle" || key === "notfalle") return "Notfälle";
  if (key === "weitere nautische begriffe") return "Weitere nautische Begriffe";
  if (key === "schiffsmerkmale" || key === "schiffs merkmale") return "Schiffsmerkmale";

  return c;
}

// ---------- Bewertung (bestehend) ----------
function extractRequiredTokens(reference) {
  const coord = reference.match(/\b\d{2}-\d{2}\s[NS]\s\d{3}-\d{2}\s[EW]\b/g) || [];
  const calls = (reference.match(/\/[A-Z0-9]{3,6}\b/g) || []).map(s => s.slice(1));
  const utc = reference.match(/\b\d{4}\sUTC\b/g) || [];
  const vhf = reference.match(/\bVHF channel\s\d+\b/gi) || [];
  return unique([...coord, ...calls, ...utc, ...vhf]);
}

function requiredOK(user, required) {
  const u = (user || "").toLowerCase();
  const missing = required.filter(tok => !u.includes(tok.toLowerCase()));
  return { ok: missing.length === 0, missing };
}

// token overlap + tiny typo tolerance
function similarity(a, b) {
  const A = norm(a).split(" ").filter(Boolean);
  const B = norm(b).split(" ").filter(Boolean);
  if (!A.length || !B.length) return 0;

  const setB = new Set(B);
  let hit = 0;

  for (const w of A) {
    if (setB.has(w)) { hit++; continue; }
    if (w.length >= 5) {
      for (const t of setB) {
        if (t.length === w.length && lev(w, t) <= 1) { hit++; break; }
      }
    }
  }

  const jacc = hit / (A.length + B.length - hit);
  return Math.max(0, Math.min(1, jacc));
}

function lev(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, () => Array(n+1).fill(0));
  for (let i=0;i<=m;i++) dp[i][0]=i;
  for (let j=0;j<=n;j++) dp[0][j]=j;
  for (let i=1;i<=m;i++) {
    for (let j=1;j<=n;j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + cost
      );
    }
  }
  return dp[m][n];
}

function grade(user, reference, mode) {
  const required = extractRequiredTokens(reference);
  const req = requiredOK(user, required);
  const sim = similarity(user, reference);

  const threshold = mode === "de" ? 0.55 : 0.58;
  const passed = req.ok && sim >= threshold;

  const lines = [];
  lines.push(passed ? "BESTANDEN ✅" : "NICHT BESTANDEN ❌");
  lines.push(`Ähnlichkeit: ${(sim*100).toFixed(0)}% (Schwelle ${Math.round(threshold*100)}%)`);
  if (!req.ok) lines.push(`Fehlende Pflichtteile: ${req.missing.join(", ")}`);
  if (required.length) lines.push(`Pflichtteile erkannt: ${required.join(", ")}`);
  return { passed, text: lines.join("\n") };
}

// ---------- Original Audio ----------
let currentAudio = null;

function playAudio(src) {
  stopAudio();
  currentAudio = new Audio(src);
  currentAudio.play().catch(() => {
    alert("Audio konnte nicht gestartet werden. Bitte erneut auf 'Abspielen' klicken.");
  });
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

// ---------- Data ----------
let texts = [];
let vocab = [];
let uebungslagen = [];
let pruefungsUebungen = [];

async function safeFetchJson(path, fallback = []) {
  try {
    const r = await fetch(path);
    if (!r.ok) return fallback;
    return await r.json();
  } catch {
    return fallback;
  }
}

async function loadData() {
  texts = await safeFetchJson("seefunktexte.json", []);
  vocab = await safeFetchJson("vokabeln.json", []);
  uebungslagen = await safeFetchJson("uebungslagen.json", []);
  pruefungsUebungen = await safeFetchJson("pruefung_uebungen.json", []);

  // Vokabeln säubern + Kapitel normalisieren
  vocab = vocab.map(v => ({
    ...v,
    chapter: normalizeChapterName(v.chapter || ""),
    de: cleanStr(v.de || ""),
    en: cleanStr(v.en || "")
  }));
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

function fillSelect(sel, items, optLabelFn) {
  sel.innerHTML = "";
  items.forEach((it, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = optLabelFn ? optLabelFn(it, idx) : (it.title || `Eintrag ${idx + 1}`);
    sel.appendChild(opt);
  });
}

// ---------- Diktat / DE->EN Referenzen ----------
function setRef(el, t) {
  el.innerHTML = `
    <div><b>Referenz EN:</b><br>${t.en}</div>
    <hr>
    <div><b>Referenz DE:</b><br>${t.de}</div>
  `;
}

// ---------- Vokabel-Drill ----------
let vState = {
  chapter: null,
  dir: null,
  queue: [],
  review: [],
  current: null,
  correctTotal: 0,
  total: 0,
  correctInChapter: 0,
  shownInChapter: 0,
  correctSet: new Set(),      // für Ziel "all"
  wrongCounts: new Map(),     // key -> anzahl falsch
  wrongList: []               // [{key,de,en,chapter,lastAnswer}]
};

function vKey(card) {
  return `${card.chapter}||${card.de}||${card.en}`;
}

function getChaptersExact() {
  const present = unique(vocab.map(v => v.chapter).filter(Boolean));
  const ordered = CHAPTER_ORDER.filter(ch => present.includes(ch));
  const rest = present.filter(ch => !CHAPTER_ORDER.includes(ch)).sort();
  return ["Alle", ...ordered, ...rest];
}

function vocabFiltered(ch) {
  const chapter = cleanStr(ch);
  return chapter === "Alle" ? vocab : vocab.filter(v => v.chapter === chapter);
}

function resetVocabSession() {
  const ch = $("chapterSelect").value;
  const dir = $("dirSelect").value;
  const list = vocabFiltered(ch);

  vState.chapter = ch;
  vState.dir = dir;

  vState.queue = list.map((_, i) => i);
  vState.review = [];
  vState.current = null;

  vState.correctTotal = 0;
  vState.total = 0;
  vState.correctInChapter = 0;
  vState.shownInChapter = 0;
  vState.correctSet = new Set();
  vState.wrongCounts = new Map();
  vState.wrongList = [];

  if ($("shuffleToggle").checked) shuffle(vState.queue);

  $("vFeedback").textContent = "";
  $("vDone").textContent = "";
  $("vErrors").classList.add("hidden");
  $("vErrors").innerHTML = "";

  if (!list.length) {
    $("vPrompt").textContent = "Keine Vokabeln in diesem Kapitel gefunden.";
    $("vProgress").textContent = "Fortschritt: 0/0";
    $("vScore").textContent = "Score: 0/0";
    return;
  }
  nextVocabCard();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function targetReached() {
  const target = $("targetSelect").value;
  const listLen = vocabFiltered($("chapterSelect").value).length;

  if (target === "10") return vState.correctInChapter >= 10;
  if (target === "20") return vState.correctInChapter >= 20;
  if (target === "all") return vState.correctSet.size >= listLen && listLen > 0;
  return false;
}

function pickNextIndex() {
  const reviewFirst = $("reviewFirstToggle").checked;

  if (reviewFirst && vState.review.length) return vState.review.shift();

  // Wenn Queue leer ist, aber Review noch was hat, weiter Review
  if (!vState.queue.length && vState.review.length) return vState.review.shift();

  // Wenn beides leer: nichts mehr
  if (!vState.queue.length) return null;

  // normal: nächste aus queue (Reihenfolge)
  return vState.queue.shift();
}

function updateVocabPrompt(card) {
  const dir = $("dirSelect").value;
  $("vAnswer").value = "";
  $("vFeedback").textContent = "";
  $("vDone").textContent = "";

  if (dir === "en2de") {
    $("vPrompt").textContent = card.en; // EN anzeigen
  } else {
    $("vPrompt").textContent = card.de; // DE anzeigen
  }
  $("vAnswer").focus();
}

function updateVocabStats() {
  const listLen = vocabFiltered($("chapterSelect").value).length;
  $("vScore").textContent = `Score: ${vState.correctTotal}/${vState.total}`;
  $("vProgress").textContent = `Fortschritt: ${vState.correctInChapter}/${$("targetSelect").value === "all" ? listLen : $("targetSelect").value}`;
}

function nextVocabCard() {
  const list = vocabFiltered($("chapterSelect").value);
  if (!list.length) {
    $("vPrompt").textContent = "Keine Vokabeln in diesem Kapitel gefunden.";
    $("vFeedback").textContent = "Tipp: Kapitel auf 'Alle' stellen oder vokabeln.json prüfen.";
    return;
  }

  if (targetReached()) {
    $("vDone").textContent = "Kapitel abgeschlossen ✅";
    vState.current = null;
    return;
  }

  const idx = pickNextIndex();
  if (idx === null) {
    // Wenn Ziel "all": Zyklus zu Ende -> nochmal falsch wiederholen
    if ($("targetSelect").value === "all" && vState.review.length) {
      // continue review
      const idx2 = vState.review.shift();
      vState.current = list[idx2];
      updateVocabPrompt(vState.current);
      updateVocabStats();
      return;
    }

    $("vDone").textContent = "Keine weiteren Karten im Stapel. (Tipp: Ziel/Shuffle/Review prüfen)";
    vState.current = null;
    return;
  }

  vState.current = list[idx];
  vState.shownInChapter++;
  updateVocabPrompt(vState.current);
  updateVocabStats();
}

function addToWrongList(card, lastAnswer) {
  const key = vKey(card);
  const cnt = (vState.wrongCounts.get(key) || 0) + 1;
  vState.wrongCounts.set(key, cnt);

  // Update / insert wrong entry
  const existing = vState.wrongList.find(x => x.key === key);
  const row = { key, chapter: card.chapter, de: card.de, en: card.en, lastAnswer: lastAnswer || "", timesWrong: cnt };
  if (existing) Object.assign(existing, row);
  else vState.wrongList.push(row);
}

function checkVocabCard() {
  const card = vState.current;
  if (!card) return;

  const dir = $("dirSelect").value;
  const solution = dir === "en2de" ? card.de : card.en;
  const ans = cleanStr($("vAnswer").value);

  vState.total++;

  const ok = norm(ans) === norm(solution);

  if (ok) {
    vState.correctTotal++;
    vState.correctInChapter++;
    vState.correctSet.add(vKey(card));
    $("vFeedback").textContent = "Richtig ✅";
  } else {
    $("vFeedback").textContent = `Falsch ❌ — richtig: ${solution}`;
    addToWrongList(card, ans);

    // Wiederholung nach 2-3 Karten: wir legen die Karte ans Ende der Review-Liste,
    // zusätzlich einen kleinen Abstand (2 Karten) indem wir erst "delay marker" schieben:
    const list = vocabFiltered($("chapterSelect").value);
    const idx = list.findIndex(v => vKey(v) === vKey(card));
    if (idx >= 0) {
      // Abstand: 2 Dummy-Slots -> durch -1 marker
      vState.review.push(-1);
      vState.review.push(-1);
      vState.review.push(idx);
    }
  }

  // -1 Marker entfernen beim Picken
  vState.review = vState.review.filter(x => x !== -1 || (Math.random() < 0.5)); // kleine Streuung

  updateVocabStats();

  if (targetReached()) {
    $("vDone").textContent = "Kapitel abgeschlossen ✅";
    vState.current = null;
    return;
  }
}

function showErrors() {
  if (!vState.wrongList.length) {
    $("vErrors").classList.remove("hidden");
    $("vErrors").textContent = "Keine Fehler 👍";
    return;
  }
  const byChapter = {};
  vState.wrongList.forEach(w => {
    if (!byChapter[w.chapter]) byChapter[w.chapter] = [];
    byChapter[w.chapter].push(w);
  });

  const parts = [];
  for (const ch of Object.keys(byChapter)) {
    parts.push(`<h4>${ch}</h4>`);
    parts.push("<ul>");
    for (const w of byChapter[ch]) {
      parts.push(`<li><b>DE:</b> ${w.de} — <b>EN:</b> ${w.en} <span class="hint">(falsch: ${w.timesWrong}×)</span></li>`);
    }
    parts.push("</ul>");
  }

  $("vErrors").classList.remove("hidden");
  $("vErrors").innerHTML = parts.join("");
}

// ---------- Übungslagen / Prüfung Übungen ----------
function labelRoman(it) {
  return `Übungslage ${it.id}`;
}
function labelExam(it) {
  return `Übung ${it.no}`;
}

function openSolutionPdf() {
  // öffnet die komplette PDF, damit du schnell scrollen kannst
  window.open("Scan22012026.pdf", "_blank");
}

function showLage(idx) {
  const it = uebungslagen[idx];
  if (!it) return;

  $("lageTask").innerHTML = `<b>Übungslage ${it.id}</b><br>${it.task || ""}`;

  if (it.image) {
    $("lageImg").src = it.image;
    $("lageImg").classList.remove("hidden");
  } else {
    $("lageImg").classList.add("hidden");
  }

  $("lageHint").textContent = it.hint || "";
}

function showExam(idx) {
  const it = pruefungsUebungen[idx];
  if (!it) return;

  $("examTask").innerHTML = `<b>Übung ${it.no}</b><br>${it.task || ""}`;

  if (it.image) {
    $("examImg").src = it.image;
    $("examImg").classList.remove("hidden");
  } else {
    $("examImg").classList.add("hidden");
  }

  $("examHint").textContent = it.hint || "";
}

// ---------- Main ----------
(async function main() {
  await loadData();

  // --- Diktat / DE->EN ---
  fillSelect($("diktatSelect"), texts, (t, idx) => t.title || `Text ${idx+1}`);
  fillSelect($("de2enSelect"), texts, (t, idx) => t.title || `Text ${idx+1}`);

  $("playAudio").addEventListener("click", () => {
    const t = texts[+$("diktatSelect").value];
    if (t && t.audio) playAudio(t.audio);
    else alert("Keine Audiodatei für diesen Text gefunden.");
  });
  $("stopAudio").addEventListener("click", stopAudio);

  $("gradeDE").addEventListener("click", () => {
    const t = texts[+$("diktatSelect").value];
    if (!t) return;
    const res = grade($("typedDE").value, t.de, "de");
    $("result1").textContent = res.text;
  });

  let ref1Shown = false;
  $("toggleRef1").addEventListener("click", () => {
    ref1Shown = !ref1Shown;
    const t = texts[+$("diktatSelect").value];
    if (!t) return;
    setRef($("ref1"), t);
    $("ref1").classList.toggle("hidden", !ref1Shown);
    $("toggleRef1").textContent = ref1Shown ? "Referenz ausblenden" : "Referenz anzeigen";
  });

  function updateDEPrompt() {
    const t = texts[+$("de2enSelect").value];
    if (!t) return;
    $("dePrompt").innerHTML = `<b>Deutsch:</b><br>${t.de}`;
  }
  updateDEPrompt();
  $("de2enSelect").addEventListener("change", updateDEPrompt);

  let deShown = true;
  $("toggleDE").addEventListener("click", () => {
    deShown = !deShown;
    $("dePrompt").classList.toggle("hidden", !deShown);
  });

  let ref2Shown = false;
  $("toggleRef2").addEventListener("click", () => {
    ref2Shown = !ref2Shown;
    const t = texts[+$("de2enSelect").value];
    if (!t) return;
    $("ref2").innerHTML = `<b>Referenz EN:</b><br>${t.en}`;
    $("ref2").classList.toggle("hidden", !ref2Shown);
  });

  $("gradeEN").addEventListener("click", () => {
    const t = texts[+$("de2enSelect").value];
    if (!t) return;
    const res = grade($("userEN").value, t.en, "en");
    $("result2").textContent = res.text;
  });

  // --- Vokabeln ---
  const chapters = getChaptersExact();
  $("chapterSelect").innerHTML = chapters.map(ch => `<option value="${ch}">${ch}</option>`).join("");
  $("chapterSelect").value = "Meldungsstruktur"; // Start wie vorher, falls vorhanden
  if (!chapters.includes("Meldungsstruktur")) $("chapterSelect").value = "Alle";

  $("chapterSelect").addEventListener("change", resetVocabSession);
  $("dirSelect").addEventListener("change", resetVocabSession);
  $("shuffleToggle").addEventListener("change", resetVocabSession);
  $("targetSelect").addEventListener("change", resetVocabSession);

  $("vNext").addEventListener("click", nextVocabCard);
  $("vCheck").addEventListener("click", () => { checkVocabCard(); });
  $("vAnswer").addEventListener("keydown", (e) => { if (e.key === "Enter") checkVocabCard(); });

  $("showErrorsBtn").addEventListener("click", showErrors);

  resetVocabSession();

  // --- Übungslagen ---
  fillSelect($("lageSelect"), uebungslagen, (it) => `Übungslage ${it.id}`);
  let lageIdx = 0;

  function syncLage() {
    lageIdx = +$("lageSelect").value;
    showLage(lageIdx);
  }
  $("lageSelect").addEventListener("change", syncLage);
  $("lagePrev").addEventListener("click", () => {
    lageIdx = Math.max(0, lageIdx - 1);
    $("lageSelect").value = String(lageIdx);
    showLage(lageIdx);
  });
  $("lageNext").addEventListener("click", () => {
    lageIdx = Math.min(uebungslagen.length - 1, lageIdx + 1);
    $("lageSelect").value = String(lageIdx);
    showLage(lageIdx);
  });
  $("lageClear").addEventListener("click", () => { $("lageAnswer").value = ""; });
  $("openLageSolution").addEventListener("click", openSolutionPdf);

  if (uebungslagen.length) showLage(0);

  // --- Prüfung Übungen ---
  fillSelect($("examSelect"), pruefungsUebungen, (it) => `Übung ${it.no}`);
  let examIdx = 0;

  function syncExam() {
    examIdx = +$("examSelect").value;
    showExam(examIdx);
  }
  $("examSelect").addEventListener("change", syncExam);
  $("examPrev").addEventListener("click", () => {
    examIdx = Math.max(0, examIdx - 1);
    $("examSelect").value = String(examIdx);
    showExam(examIdx);
  });
  $("examNext").addEventListener("click", () => {
    examIdx = Math.min(pruefungsUebungen.length - 1, examIdx + 1);
    $("examSelect").value = String(examIdx);
    showExam(examIdx);
  });
  $("examClear").addEventListener("click", () => { $("examAnswer").value = ""; });
  $("openExamSolution").addEventListener("click", openSolutionPdf);

  if (pruefungsUebungen.length) showExam(0);
})();