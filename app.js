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

async function loadData() {
  texts = await fetch("seefunktexte.json").then(r => r.json());
  vocab = await fetch("vokabeln.json").then(r => r.json());

  // WICHTIG: unsichtbare Leerzeichen entfernen
  vocab = vocab.map(v => ({
    ...v,
    chapter: (v.chapter || "").trim(),
    de: (v.de || "").trim(),
    en: (v.en || "").trim()
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

function fillSelect(sel, items) {
 sel.innerHTML = "";
  items.forEach((it, idx) => {
    const opt = document.createElement("option");

    // WICHTIG:
    // - Bei Strings (Kapitel) soll value = Text sein (z.B. "Meldungsstruktur")
    // - Bei Objekten (Seefunktexte) soll value = Index bleiben
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

// ---------- Vocab ----------
let currentCard = null;
let correct = 0, total = 0;

function chapters() {
  return ["Alle", ...unique(vocab.map(v => v.chapter)).sort()];
}
function vocabFiltered(ch) {
  const chapter = (ch || "").trim();
  return chapter === "Alle" ? vocab : vocab.filter(v => (v.chapter || "").trim() === chapter);
}
function nextCard() {
  const ch = $("chapterSelect").value.trim();
  const list = vocabFiltered(ch);

  if (!list.length) {
    currentCard = null;
    $("vPrompt").textContent = "Keine Vokabeln in diesem Kapitel gefunden.";
    $("vFeedback").textContent = "Tipp: Kapitel auf 'Alle' stellen.";
    return;
  }

  currentCard = list[Math.floor(Math.random() * list.length)];
  $("vFeedback").textContent = "";
  $("vAnswer").value = "";
  updatePrompt();
}
function updatePrompt() {
  if (!currentCard) return;
  const dir = $("dirSelect").value;

  if (dir === "en2de") {
    // EN → DE: englisches Wort anzeigen
    $("vPrompt").textContent = currentCard.en;
  } else {
    // DE → EN: deutsches Wort anzeigen
    $("vPrompt").textContent = currentCard.de;
  }
}
function checkCard() {
  if (!currentCard) return;
  total++;

  const dir = $("dirSelect").value;
  const solution =
    dir === "en2de"
      ? currentCard.de   // EN → DE → deutsche Lösung
      : currentCard.en;  // DE → EN → englische Lösung

  const ans = ($("vAnswer").value || "").trim();

  const ok = norm(ans) === norm(solution);
  if (ok) correct++;

  $("vFeedback").textContent = ok ? "Richtig ✅" : `Falsch ❌ — richtig: ${solution}`;
  $("vScore").textContent = `Score: ${correct}/${total}`;
}

// ---------- Main ----------
(async function main() {
  await loadData();

  fillSelect($("diktatSelect"), texts);
  fillSelect($("de2enSelect"), texts);

  $("playAudio").addEventListener("click", () => {
    const t = texts[+$("diktatSelect").value];
    if (t.audio) playAudio(t.audio);
    else alert("Keine Audiodatei für diesen Text gefunden.");
  });

  $("stopAudio").addEventListener("click", stopAudio);

  $("gradeDE").addEventListener("click", () => {
    const t = texts[+$("diktatSelect").value];
    const res = grade($("typedDE").value, t.de, "de");
    $("result1").textContent = res.text;
  });

  let ref1Shown = false;
  $("toggleRef1").addEventListener("click", () => {
    ref1Shown = !ref1Shown;
    const t = texts[+$("diktatSelect").value];
    setRef($("ref1"), t);
    $("ref1").classList.toggle("hidden", !ref1Shown);
    $("toggleRef1").textContent = ref1Shown ? "Referenz ausblenden" : "Referenz anzeigen";
  });

  function updateDEPrompt() {
    const t = texts[+$("de2enSelect").value];
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
    $("ref2").innerHTML = `<b>Referenz EN:</b><br>${t.en}`;
    $("ref2").classList.toggle("hidden", !ref2Shown);
  });

  $("gradeEN").addEventListener("click", () => {
    const t = texts[+$("de2enSelect").value];
    const res = grade($("userEN").value, t.en, "en");
    $("result2").textContent = res.text;
  });

  fillSelect($("chapterSelect"), chapters());
  $("chapterSelect").addEventListener("change", nextCard);
  $("dirSelect").addEventListener("change", updatePrompt);

  $("vNext").addEventListener("click", nextCard);
  $("vCheck").addEventListener("click", checkCard);
  $("vAnswer").addEventListener("keydown", (e) => { if (e.key === "Enter") checkCard(); });

  nextCard();
})();
