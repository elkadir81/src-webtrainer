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

// ---------- Kapitel exakt wie in der PDF ----------
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
  const c = (ch || "").trim();
  const key = c.toLowerCase();

  if (key === "wetter") return "Wetter";
  if (key === "navigation") return "Navigation";
  if (key === "wendungen") return "Wendungen";
  if (key === "meldungsstruktur") return "Meldungsstruktur";

  // Notfälle Varianten
  if (key === "notfaelle" || key === "notfälle" || key === "notfalle") return "Notfälle";

  // Weitere nautische Begriffe Varianten
  if (key === "weitere nautische begriffe") return "Weitere nautische Begriffe";

  // Schiffsmerkmale Varianten
  if (key === "schiffsmerkmale" || key === "schiffs merkmale") return "Schiffsmerkmale";

  return c;
}

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
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
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
  lines.push(`Ähnlichkeit: ${(sim * 100).toFixed(0)}% (Schwelle ${Math.round(threshold * 100)}%)`);
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

async function loadData() {
  texts = await fetch("seefunktexte.json").then(r => r.json());
  vocab = await fetch("vokabeln.json").then(r => r.json());

  // Kapitel + Texte säubern & normalisieren
  vocab = vocab.map(v => ({
    ...v,
    chapter: normalizeChapterName(v.chapter),
    de: (v.de || "").trim(),
    en: (v.en || "").trim()
  }));
}

// ---------- Reset Helpers ----------
function resetDiktatUI() {
  $("typedEN").value = "";
  $("typedDE").value = "";
  $("result1").textContent = "";
  $("ref1").classList.add("hidden");
  $("toggleRef1").textContent = "Referenz anzeigen";
  stopAudio();
}

function resetDe2EnUI() {
  $("userEN").value = "";
  $("result2").textContent = "";
  $("ref2").classList.add("hidden");
  stopAudio();
}

// ---------- Tabs (mit Reset beim Tab-Wechsel) ----------
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.add("active");

    const tab = btn.dataset.tab;
    if (tab === "diktat") resetDiktatUI();
    if (tab === "de2en") resetDe2EnUI();
    if (tab === "vokabeln") stopAudio();
  });
});

function fillSelect(sel, items) {
  sel.innerHTML = "";
  items.forEach((it, idx) => {
    const opt = document.createElement("option");

    // Strings (Kapitel): value = Text
    // Objekte (Seefunktexte): value = Index
    if (typeof it === "string") {
      opt.value = it;
      opt.textContent = it;
    } else {
      opt.value = idx;
      opt.textContent = it.title || `Eintrag ${idx + 1}`;
    }

    sel.appendChild(opt);
  });
}

function setRef(el, t) {
  el.innerHTML = `
    <div><b>Referenz EN:</b><br>${t.en}</div>
    <hr>
    <div><b>Referenz DE:</b><br>${t.de}</div>
  `;
}

// ---------- Vocab (Reihenfolge + Drill + Fehlerliste + Abschluss + Shuffle) ----------
let vocabList = [];
let vocabIndex = 0;
let reviewQueue = []; // [{ card, dueIn }]
let currentCard = null;

let correct = 0, total = 0;

// pro Kapitel-Session
let masteredKeys = new Set();
let wrongMap = new Map();
let completionTarget = 20;
let sessionDone = false;

function cardKey(card) {
  return `${(card.chapter || "").trim()}||${(card.de || "").trim()}||${(card.en || "").trim()}`;
}

// Kapitel-Auswahl exakt wie PDF (Reihenfolge)
function chapters() {
  return ["Alle", ...CHAPTER_ORDER];
}

function vocabFiltered(ch) {
  const chapter = (ch || "").trim();
  return chapter === "Alle"
    ? vocab
    : vocab.filter(v => (v.chapter || "").trim() === chapter);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function getSettings() {
  const reviewFirst = !!$("reviewFirstToggle")?.checked;
  const shuffle = !!$("shuffleToggle")?.checked;
  const targetVal = $("targetSelect")?.value || "20";
  const target = (targetVal === "all") ? "all" : Math.max(1, parseInt(targetVal, 10) || 20);
  return { reviewFirst, shuffle, target };
}

function renderProgress() {
  const totalUnique = vocabList.length;
  const mastered = masteredKeys.size;

  $("vProgress").textContent = `Fortschritt: ${mastered}/${totalUnique}`;
  $("vScore").textContent = `Score: ${correct}/${total}`;
  $("vDone").textContent = sessionDone ? "✅ Kapitel abgeschlossen!" : "";
}

function renderErrors() {
  const items = Array.from(wrongMap.values()).sort((a, b) => b.wrongCount - a.wrongCount);

  if (!items.length) {
    $("vErrors").innerHTML = "<b>Fehlerliste:</b><br>Keine Fehler 🎉";
    return;
  }

  let html = "<b>Fehlerliste (nur falsche):</b><br><ol>";
  for (const it of items) {
    html += `<li>
      <div><b>DE:</b> ${it.card.de}</div>
      <div><b>EN:</b> ${it.card.en}</div>
      <div><b>Falsch:</b> ${it.wrongCount}×</div>
    </li><br>`;
  }
  html += "</ol>";
  $("vErrors").innerHTML = html;
}

function rebuildVocabSession() {
  const { shuffle, target } = getSettings();

  const ch = $("chapterSelect").value.trim();
  vocabList = vocabFiltered(ch).slice(); // copy
  if (shuffle) shuffleArray(vocabList);

  vocabIndex = 0;
  reviewQueue = [];
  currentCard = null;

  masteredKeys = new Set();
  wrongMap = new Map();
  sessionDone = false;

  if (target === "all") completionTarget = vocabList.length;
  else completionTarget = Math.min(target, vocabList.length);

  $("vFeedback").textContent = "";
  $("vAnswer").value = "";
  $("vErrors").classList.add("hidden");
  $("vErrors").textContent = "";

  if (!vocabList.length) {
    $("vPrompt").textContent = "Keine Vokabeln in diesem Kapitel gefunden.";
    $("vFeedback").textContent = "Tipp: anderes Kapitel wählen oder 'Alle'.";
    renderProgress();
    return;
  }

  nextCard();
  renderProgress();
}

function updateVocabPrompt() {
  if (!currentCard) return;
  const dir = $("dirSelect").value;
  $("vPrompt").textContent = (dir === "en2de") ? currentCard.en : currentCard.de;
}

function decrementReviewDue() {
  reviewQueue.forEach(x => x.dueIn--);
}

function pickDueReviewCard(reviewFirst) {
  if (!reviewQueue.length) return null;

  if (reviewFirst) {
    decrementReviewDue();

    let idx = reviewQueue.findIndex(x => x.dueIn <= 0);
    if (idx >= 0) return reviewQueue.splice(idx, 1)[0].card;

    // nichts fällig -> die schnellste forcieren
    let minIdx = 0;
    for (let i = 1; i < reviewQueue.length; i++) {
      if (reviewQueue[i].dueIn < reviewQueue[minIdx].dueIn) minIdx = i;
    }
    reviewQueue[minIdx].dueIn = 0;
    return reviewQueue.splice(minIdx, 1)[0].card;
  }

  decrementReviewDue();
  const idx = reviewQueue.findIndex(x => x.dueIn <= 0);
  if (idx >= 0) return reviewQueue.splice(idx, 1)[0].card;
  return null;
}

function nextSequentialCard() {
  if (!vocabList.length) return null;
  if (vocabIndex >= vocabList.length) vocabIndex = 0; // loop
  const c = vocabList[vocabIndex];
  vocabIndex++;
  return c;
}

function nextCard() {
  if (!vocabList.length) return;

  const { reviewFirst } = getSettings();
  const due = pickDueReviewCard(reviewFirst);
  currentCard = due || nextSequentialCard();

  $("vFeedback").textContent = "";
  $("vAnswer").value = "";
  updateVocabPrompt();
}

function queueForRepeat(card) {
  const { reviewFirst } = getSettings();
  const delayCards = reviewFirst ? 2 : 3;

  const key = cardKey(card);
  const exists = reviewQueue.some(x => cardKey(x.card) === key);
  if (!exists) reviewQueue.push({ card, dueIn: delayCards });
}

function checkCompletion() {
  if (sessionDone) return;

  const mastered = masteredKeys.size;
  const targetReached = mastered >= completionTarget;

  if (targetReached && reviewQueue.length === 0) {
    sessionDone = true;
  }
}

function checkCard() {
  if (!currentCard || !vocabList.length) return;

  total++;

  const dir = $("dirSelect").value;
  const solution = (dir === "en2de") ? currentCard.de : currentCard.en;
  const ans = ($("vAnswer").value || "").trim();

  const ok = norm(ans) === norm(solution);

  if (ok) {
    correct++;
    $("vFeedback").textContent = "Richtig ✅";
    masteredKeys.add(cardKey(currentCard));
  } else {
    $("vFeedback").textContent = `Falsch ❌ — richtig: ${solution}`;

    const key = cardKey(currentCard);
    const prev = wrongMap.get(key);
    wrongMap.set(key, { card: currentCard, wrongCount: prev ? prev.wrongCount + 1 : 1 });

    queueForRepeat(currentCard);
  }

  checkCompletion();
  renderProgress();
}

function toggleErrors() {
  const el = $("vErrors");
  const hidden = el.classList.contains("hidden");
  if (hidden) {
    renderErrors();
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// ---------- Main ----------
(async function main() {
  await loadData();

  // Texte
  fillSelect($("diktatSelect"), texts);
  fillSelect($("de2enSelect"), texts);

  // Fix B: Beim Wechsel des Übungstextes Eingaben löschen
  $("diktatSelect").addEventListener("change", resetDiktatUI);

  // Audio
  $("playAudio").addEventListener("click", () => {
    const t = texts[+$("diktatSelect").value];
    if (t.audio) playAudio(t.audio);
    else alert("Keine Audiodatei für diesen Text gefunden.");
  });
  $("stopAudio").addEventListener("click", stopAudio);

  // Diktat Bewertung
  $("gradeDE").addEventListener("click", () => {
    const t = texts[+$("diktatSelect").value];
    const res = grade($("typedDE").value, t.de, "de");
    $("result1").textContent = res.text;
  });

  // Referenz Diktat
  let ref1Shown = false;
  $("toggleRef1").addEventListener("click", () => {
    ref1Shown = !ref1Shown;
    const t = texts[+$("diktatSelect").value];
    setRef($("ref1"), t);
    $("ref1").classList.toggle("hidden", !ref1Shown);
    $("toggleRef1").textContent = ref1Shown ? "Referenz ausblenden" : "Referenz anzeigen";
  });

  // DE -> EN Prompt
  function updateDEPrompt() {
    const t = texts[+$("de2enSelect").value];
    $("dePrompt").innerHTML = `<b>Deutsch:</b><br>${t.de}`;
  }
  updateDEPrompt();

  // Fix B: Beim Wechsel des Übungstextes Eingaben löschen (DE->EN)
  $("de2enSelect").addEventListener("change", () => {
    updateDEPrompt();
    resetDe2EnUI();
  });

  // DE anzeigen/ausblenden
  let deShown = true;
  $("toggleDE").addEventListener("click", () => {
    deShown = !deShown;
    $("dePrompt").classList.toggle("hidden", !deShown);
  });

  // Referenz EN im DE->EN Tab
  let ref2Shown = false;
  $("toggleRef2").addEventListener("click", () => {
    ref2Shown = !ref2Shown;
    const t = texts[+$("de2enSelect").value];
    $("ref2").innerHTML = `<b>Referenz EN:</b><br>${t.en}`;
    $("ref2").classList.toggle("hidden", !ref2Shown);
  });

  // DE->EN Bewertung
  $("gradeEN").addEventListener("click", () => {
    const t = texts[+$("de2enSelect").value];
    const res = grade($("userEN").value, t.en, "en");
    $("result2").textContent = res.text;
  });

  // Vokabeln init (Kapitel exakt wie PDF)
  fillSelect($("chapterSelect"), chapters());

  $("chapterSelect").addEventListener("change", rebuildVocabSession);
  $("dirSelect").addEventListener("change", () => {
    $("vFeedback").textContent = "";
    $("vAnswer").value = "";
    updateVocabPrompt();
  });

  $("reviewFirstToggle").addEventListener("change", rebuildVocabSession);
  $("shuffleToggle").addEventListener("change", rebuildVocabSession);
  $("targetSelect").addEventListener("change", rebuildVocabSession);

  $("showErrorsBtn").addEventListener("click", toggleErrors);

  $("vNext").addEventListener("click", nextCard);
  $("vCheck").addEventListener("click", checkCard);
  $("vAnswer").addEventListener("keydown", (e) => { if (e.key === "Enter") checkCard(); });

  rebuildVocabSession();
})();
