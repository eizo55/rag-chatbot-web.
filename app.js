(function () {
  "use strict";

  const TOP_K = 4;
  const EXAMPLES = [
    "Wie hoch darf eine Mietkaution sein?",
    "Bis wann muss die Betriebskostenabrechnung kommen?",
    "Was macht eine Hausverwaltung?",
    "Darf die Kaution in Raten gezahlt werden?",
  ];

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of children) node.append(c);
    return node;
  };

  const state = { docs: [], bm25: null, requestId: 0 };

  /* ---------- Einstellungen merken (ohne API-Schlüssel) ---------- */
  const store = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* privater Modus */ } },
  };

  /* ---------- Dokumente und Index ---------- */
  function loadSamples() {
    state.docs = window.SAMPLE_DOCS.map((d) => ({ name: d.name, text: d.text }));
    rebuild();
  }

  function rebuild() {
    const chunks = state.docs.flatMap((d) => window.Rag.chunk(d.name, d.text));
    state.bm25 = new window.Rag.Bm25(chunks);
    renderDocs(chunks);
  }

  function renderDocs(chunks) {
    const list = $("#docs-list");
    list.replaceChildren();
    $("#docs-count").textContent = `(${state.docs.length}, ${chunks.length} Abschnitte)`;
    if (state.docs.length === 0) {
      list.append(el("li", { className: "empty" }, "Keine Dokumente geladen. Füge eigene Dateien hinzu oder setze die Beispiele zurück."));
      return;
    }
    for (const doc of state.docs) {
      const count = chunks.filter((c) => c.source === doc.name).length;
      const remove = el("button", { type: "button", textContent: "Entfernen" });
      remove.setAttribute("aria-label", `${doc.name} entfernen`);
      remove.addEventListener("click", () => {
        state.docs = state.docs.filter((d) => d !== doc);
        rebuild();
      });
      list.append(el("li", {},
        el("span", { className: "name", textContent: doc.name }),
        el("span", { className: "meta", textContent: `${count} Abschnitte` }),
        remove));
    }
  }

  async function addFiles(files) {
    for (const file of files) {
      const text = await file.text();
      if (!text.trim()) continue;
      state.docs = state.docs.filter((d) => d.name !== file.name);
      state.docs.push({ name: file.name, text });
    }
    rebuild();
  }

  /* ---------- Frage stellen ---------- */
  async function ask(question) {
    const q = question.trim();
    if (!q) return;
    const myId = ++state.requestId;
    const hits = state.bm25.retrieve(q, TOP_K);
    renderSources(hits, q);

    const mode = currentMode();
    if (mode === "none") { renderAnswerNone(hits); return; }

    const button = $("#ask button");
    button.disabled = true;
    renderAnswerNote(mode === "ollama"
      ? "Antwort wird erstellt. Beim ersten Mal lädt Ollama das Modell, das kann eine Minute dauern."
      : "Antwort wird erstellt.");
    try {
      const text = await callModel(mode, q, hits);
      if (myId === state.requestId) renderAnswer(text, hits.length);
    } catch (err) {
      if (myId === state.requestId) renderAnswerError(err);
    } finally {
      if (myId === state.requestId) button.disabled = false;
    }
  }

  /* ---------- Sprachmodelle ---------- */
  class UserFacingError extends Error {
    constructor(title, detail) { super(title); this.title = title; this.detail = detail; }
  }

  async function callModel(mode, question, hits) {
    const prompt = window.Rag.buildUserPrompt(question, hits);
    return mode === "ollama" ? callOllama(prompt) : callClaude(prompt);
  }

  async function callOllama(prompt) {
    const base = $("#ollama-url").value.trim().replace(/\/+$/, "") || "http://localhost:11434";
    const model = $("#ollama-model").value.trim() || "llama3.2";
    let res;
    try {
      res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model, stream: false, options: { temperature: 0.2 },
          messages: [{ role: "system", content: window.Rag.SYSTEM_PROMPT }, { role: "user", content: prompt }],
        }),
      });
    } catch {
      throw new UserFacingError("Ollama ist nicht erreichbar.",
        `Prüfe, ob Ollama unter ${base} läuft und ob diese Seite zugelassen ist (OLLAMA_ORIGINS, siehe Antwortmodus).`);
    }
    if (res.status === 404) {
      throw new UserFacingError(`Ollama kennt das Modell „${model}“ nicht.`, `Lade es mit: ollama pull ${model}`);
    }
    if (res.status === 403) {
      throw new UserFacingError("Ollama hat die Anfrage abgelehnt.",
        "Diese Seite ist nicht in OLLAMA_ORIGINS eingetragen (siehe Antwortmodus).");
    }
    if (!res.ok) throw new UserFacingError(`Ollama-Fehler ${res.status}.`, await safeText(res));
    const data = await res.json();
    return data?.message?.content ?? "";
  }

  async function callClaude(prompt) {
    const key = $("#claude-key").value.trim();
    const model = $("#claude-model").value.trim() || "claude-sonnet-5-5";
    if (!key) throw new UserFacingError("Es fehlt der API-Schlüssel.", "Trage ihn unter Antwortmodus ein oder wechsle auf Nur Suche.");
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model, max_tokens: 1024, system: window.Rag.SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch {
      throw new UserFacingError("Verbindung zu api.anthropic.com fehlgeschlagen.", "Prüfe deine Internetverbindung und Browser-Erweiterungen, die Anfragen blockieren.");
    }
    if (!res.ok) {
      let message = "";
      try { message = (await res.json())?.error?.message ?? ""; } catch { /* kein JSON */ }
      const hints = {
        401: "Der API-Schlüssel ist ungültig. Erstelle in der Anthropic Console einen neuen.",
        400: "Meist fehlt Guthaben oder die Anfrage ist ungültig.",
        404: `Das Modell „${model}“ ist für dein Konto nicht verfügbar. Trage unter Antwortmodus ein anderes ein.`,
        429: "Zu viele Anfragen. Warte kurz und versuche es erneut.",
      };
      throw new UserFacingError(`Claude-API-Fehler ${res.status}.`, [hints[res.status], message].filter(Boolean).join(" "));
    }
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }

  async function safeText(res) { try { return await res.text(); } catch { return ""; } }

  /* ---------- Darstellung ---------- */
  function currentMode() { return document.querySelector('input[name="mode"]:checked').value; }

  function renderAnswerNone(hits) {
    const box = $("#answer");
    box.replaceChildren(el("p", { className: "note" }, hits.length === 0
      ? "Dazu wurde nichts gefunden. Formuliere die Frage mit anderen Wörtern."
      : "Im Modus Nur Suche wird keine Antwort formuliert. Die passendsten Treffer stehen bei den gefundenen Abschnitten. Unter Antwortmodus kannst du ein Sprachmodell zuschalten."));
  }

  function renderAnswerNote(text) { $("#answer").replaceChildren(el("p", { className: "note" }, text)); }

  function renderAnswerError(err) {
    const title = err instanceof UserFacingError ? err.title : "Etwas ist schiefgelaufen.";
    const detail = err instanceof UserFacingError ? err.detail : String(err.message || err);
    $("#answer").replaceChildren(el("div", { className: "error" }, el("strong", {}, title), detail));
  }

  /** Writes the answer as text and turns [n] markers into links to the matching passage. */
  function renderAnswer(text, hitCount) {
    const box = $("#answer");
    const p = el("p");
    for (const part of text.trim().split(/(\[\d+\])/)) {
      const m = part.match(/^\[(\d+)\]$/);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= hitCount) {
        const a = el("a", { className: "cite", href: `#slip-${m[1]}`, textContent: part });
        a.setAttribute("aria-label", `Quelle ${m[1]}`);
        p.append(a);
      } else {
        p.append(part);
      }
    }
    box.replaceChildren(p);
  }

  function renderSources(hits, query) {
    const list = $("#sources");
    list.replaceChildren();
    if (hits.length === 0) {
      list.append(el("li", { className: "empty" }, "Keine passenden Abschnitte gefunden."));
      return;
    }
    const top = hits[0].score;
    hits.forEach((h, i) => {
      const n = i + 1;
      const display = h.chunk.text.replace(/^#+\s*/gm, "");
      const p = el("p", { className: "text" });
      for (const part of window.Rag.highlightParts(display, query)) {
        p.append(part.hit ? el("mark", {}, part.text) : part.text);
      }
      const bar = el("span", { className: "bar" }, el("i"));
      bar.firstChild.style.width = `${Math.max(4, Math.round((h.score / top) * 100))}%`;
      const meter = el("div", { className: "meter" }, bar, `Relevanz ${h.score.toFixed(2)}`);
      const li = el("li", { className: "slip", id: `slip-${n}` },
        el("span", { className: "tab", textContent: `[${n}] ${h.chunk.source}, Abschnitt ${h.chunk.index + 1}` }),
        p, meter);
      list.append(li);
    });
  }

  /* ---------- Start ---------- */
  function init() {
    const examples = $("#examples");
    for (const q of EXAMPLES) {
      const b = el("button", { type: "button", textContent: q });
      b.addEventListener("click", () => { $("#q").value = q; ask(q); });
      examples.append(el("li", {}, b));
    }

    $("#ask").addEventListener("submit", (e) => { e.preventDefault(); ask($("#q").value); });

    const savedMode = store.get("rag-mode", "none");
    const radio = document.querySelector(`input[name="mode"][value="${savedMode}"]`);
    if (radio) radio.checked = true;
    $("#ollama-model").value = store.get("rag-ollama-model", "llama3.2");
    $("#ollama-url").value = store.get("rag-ollama-url", "http://localhost:11434");

    const syncMode = () => {
      const mode = currentMode();
      $("#opts-ollama").hidden = mode !== "ollama";
      $("#opts-claude").hidden = mode !== "claude";
      store.set("rag-mode", mode);
      if (mode !== "none") $("#settings").open = true;
    };
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", syncMode));
    $("#ollama-model").addEventListener("change", (e) => store.set("rag-ollama-model", e.target.value));
    $("#ollama-url").addEventListener("change", (e) => store.set("rag-ollama-url", e.target.value));
    syncMode();

    $("#upload").addEventListener("change", async (e) => { await addFiles(e.target.files); e.target.value = ""; });
    $("#reset-docs").addEventListener("click", loadSamples);

    loadSamples();
  }

  init();
})();
