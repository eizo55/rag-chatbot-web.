/*
 * UI and model backends. Retrieval itself lives in rag.js.
 * All user-visible text is German; code and comments are English.
 */
(function () {
  "use strict";

  const TOP_K = 4;
  const EXAMPLES = [
    "Wie hoch darf eine Mietkaution sein?",
    "Bis wann muss die Betriebskostenabrechnung kommen?",
    "Was macht eine Hausverwaltung?",
    "Darf die Kaution in Raten gezahlt werden?",
  ];
  const DEFAULT_OLLAMA_URL = "http://localhost:11434";
  const DEFAULT_OLLAMA_MODEL = "llama3.2";
  const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";
  const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of children) node.append(c);
    return node;
  };

  const state = { docs: [], bm25: null, requestId: 0 };

  /* ---------- Persisted preferences (never the API key) ---------- */
  const store = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable, e.g. private mode */ } },
  };

  /* ---------- Documents and index ---------- */
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
    $("#docs-count").textContent = `(${state.docs.length} Dateien, ${chunks.length} Abschnitte)`;
    if (state.docs.length === 0) {
      list.append(el("li", { className: "empty" }, "Keine Dokumente geladen. Eigene Dateien hinzufügen oder die Beispiele zurücksetzen."));
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

  /* ---------- Asking ---------- */
  async function ask(question) {
    const q = question.trim();
    if (!q) return;
    const myId = ++state.requestId; // ignore responses that arrive after a newer question
    const hits = state.bm25.retrieve(q, TOP_K);
    renderSources(hits, q);

    const mode = currentMode();
    if (mode === "none") { renderAnswerNone(hits); return; }

    const button = $("#ask button");
    button.disabled = true;
    renderLoading(mode === "ollama"
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

  /* ---------- Language model backends ---------- */
  class UserFacingError extends Error {
    constructor(title, detail) { super(title); this.title = title; this.detail = detail; }
  }

  function callModel(mode, question, hits) {
    const prompt = window.Rag.buildUserPrompt(question, hits);
    if (mode === "ollama") return callOllama(prompt);
    if (mode === "openai") return callOpenAI(prompt);
    return callClaude(prompt);
  }

  /** The origin Ollama has to allow: this page's origin, or "*" when opened from a file. */
  function ollamaOrigin() {
    return /^https?:\/\//.test(location.origin) ? location.origin : "*";
  }

  async function callOllama(prompt) {
    const base = ($("#ollama-url").value.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
    const model = $("#ollama-model").value.trim() || DEFAULT_OLLAMA_MODEL;
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
      // A blocked cross-origin request and a stopped server look the same to the browser.
      throw new UserFacingError("Ollama ist nicht erreichbar.",
        `Läuft Ollama unter ${base}? Falls ja, fehlt die Freigabe für diese Seite: Ollama mit OLLAMA_ORIGINS="${ollamaOrigin()}" starten (siehe „Einrichtung von Ollama“).`);
    }
    if (res.status === 404) {
      throw new UserFacingError(`Ollama kennt das Modell „${model}“ nicht.`, `Das Modell laden mit: ollama pull ${model}`);
    }
    if (res.status === 403) {
      throw new UserFacingError("Ollama hat die Anfrage abgelehnt.",
        `Diese Seite ist nicht freigegeben. Ollama mit OLLAMA_ORIGINS="${ollamaOrigin()}" starten.`);
    }
    if (!res.ok) throw new UserFacingError(`Ollama-Fehler ${res.status}.`, await safeText(res));
    const data = await res.json();
    return data?.message?.content ?? "";
  }

  async function callClaude(prompt) {
    const key = $("#claude-key").value.trim();
    const model = $("#claude-model").value.trim() || DEFAULT_CLAUDE_MODEL;
    if (!key) {
      throw new UserFacingError("Es fehlt der API-Schlüssel.", "Schlüssel im Feld „API-Schlüssel“ eintragen oder auf „Nur Suche“ wechseln.");
    }
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          // Required by the API for calls made directly from a browser.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model, max_tokens: 1024, system: window.Rag.SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch {
      throw new UserFacingError("Verbindung zu api.anthropic.com fehlgeschlagen.",
        "Internetverbindung prüfen und Browser-Erweiterungen deaktivieren, die Anfragen blockieren.");
    }
    if (!res.ok) {
      let message = "";
      try { message = (await res.json())?.error?.message ?? ""; } catch { /* body is not JSON */ }
      const hints = {
        401: "Der API-Schlüssel ist ungültig.",
        400: "Meist fehlt Guthaben, oder die Anfrage ist ungültig.",
        404: `Das Modell „${model}“ ist für dieses Konto nicht verfügbar. Im Feld „Modell“ ein anderes eintragen.`,
        429: "Zu viele Anfragen. Kurz warten und erneut versuchen.",
      };
      throw new UserFacingError(`Claude-API-Fehler ${res.status}.`, [hints[res.status], message].filter(Boolean).join(" "));
    }
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }

  /**
   * OpenAI via the Responses API (/v1/responses). It is used instead of Chat Completions because
   * the latter has been unreliable for direct browser calls (missing CORS headers).
   */
  async function callOpenAI(prompt) {
    const key = $("#openai-key").value.trim();
    const model = $("#openai-model").value.trim() || DEFAULT_OPENAI_MODEL;
    if (!key) {
      throw new UserFacingError("Es fehlt der API-Schlüssel.", "Schlüssel im Feld „API-Schlüssel“ eintragen oder auf „Nur Suche“ wechseln.");
    }
    let res;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          instructions: window.Rag.SYSTEM_PROMPT,
          input: [{ role: "user", content: prompt }],
          max_output_tokens: 1024,
          store: false, // do not keep the conversation on OpenAI's side
        }),
      });
    } catch {
      throw new UserFacingError("Verbindung zu api.openai.com fehlgeschlagen.",
        "Internetverbindung prüfen. Auch Browser-Erweiterungen, Firmennetzwerke oder eine Browser-Sperre des Anbieters können die Anfrage blockieren.");
    }
    if (!res.ok) {
      let message = "";
      try { message = (await res.json())?.error?.message ?? ""; } catch { /* body is not JSON */ }
      const hints = {
        401: "Der API-Schlüssel ist ungültig.",
        404: `Das Modell „${model}“ ist für dieses Konto nicht verfügbar. Im Feld „Modell“ ein anderes eintragen.`,
        429: "Kontingent erschöpft oder zu viele Anfragen. Guthaben und Limits in der OpenAI-Plattform prüfen.",
      };
      throw new UserFacingError(`OpenAI-API-Fehler ${res.status}.`, [hints[res.status], message].filter(Boolean).join(" "));
    }
    const data = await res.json();
    // The raw response lists output items; the text sits in "output_text" parts of "message" items.
    const parts = (data.output || [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text);
    return parts.join("");
  }

  async function safeText(res) { try { return await res.text(); } catch { return ""; } }

  /* ---------- Rendering ---------- */
  function currentMode() { return document.querySelector('input[name="mode"]:checked').value; }

  function modeLabel() {
    const mode = currentMode();
    if (mode === "ollama") return `Ollama (${$("#ollama-model").value.trim() || DEFAULT_OLLAMA_MODEL})`;
    if (mode === "claude") return `Claude (${$("#claude-model").value.trim() || DEFAULT_CLAUDE_MODEL})`;
    if (mode === "openai") return `OpenAI (${$("#openai-model").value.trim() || DEFAULT_OPENAI_MODEL})`;
    return "Nur Suche";
  }

  function renderAnswerNone(hits) {
    $("#answer").replaceChildren(el("p", { className: "note" }, hits.length === 0
      ? "Dazu wurde nichts gefunden. Die Frage mit anderen Wörtern formulieren."
      : "Im Modus „Nur Suche“ wird keine Antwort formuliert. Die passendsten Treffer stehen unter „Gefundene Abschnitte“. Mit Ollama, Claude oder OpenAI formuliert ein Sprachmodell daraus eine Antwort."));
  }

  function renderLoading(text) {
    const skeleton = el("div", { className: "skeleton" }, el("i"), el("i"), el("i"));
    skeleton.setAttribute("aria-hidden", "true");
    $("#answer").replaceChildren(skeleton, el("p", { className: "note" }, text));
  }

  function renderAnswerError(err) {
    const known = err instanceof UserFacingError;
    $("#answer").replaceChildren(el("div", { className: "error" },
      el("strong", {}, known ? err.title : "Etwas ist schiefgelaufen."),
      known ? err.detail : String(err.message || err)));
  }

  /** Shows the answer as text and turns [n] markers into links to the matching passage. */
  function renderAnswer(text, hitCount) {
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
    $("#answer").replaceChildren(p);
  }

  function renderSources(hits, query) {
    const list = $("#sources");
    const count = $("#hit-count");
    list.replaceChildren();
    count.hidden = hits.length === 0;
    count.textContent = `${hits.length} Treffer`;
    if (hits.length === 0) {
      list.append(el("li", { className: "empty" }, "Keine passenden Abschnitte gefunden."));
      return;
    }
    const top = hits[0].score;
    hits.forEach((h, i) => {
      const n = i + 1;
      const display = h.chunk.text.replace(/^#+\s*/gm, ""); // drop markdown heading marks for display
      const body = el("p", { className: "text" });
      for (const part of window.Rag.highlightParts(display, query)) {
        body.append(part.hit ? el("mark", {}, part.text) : part.text);
      }
      const fill = el("i");
      fill.style.width = `${Math.max(4, Math.round((h.score / top) * 100))}%`;
      const meter = el("div", { className: "meter", title: "Relevanz (BM25-Wert)" },
        el("span", { className: "bar" }, fill), h.score.toFixed(2));
      list.append(el("li", { className: "slip", id: `slip-${n}` },
        el("div", { className: "slip-head" },
          el("span", { className: "badge", textContent: String(n) }),
          el("div", { className: "slip-title" },
            el("b", { textContent: h.chunk.source }),
            el("span", { textContent: `Abschnitt ${h.chunk.index + 1}` })),
          meter),
        body));
    });
  }

  /* ---------- Setup ---------- */
  /** Link to this page's repository when hosted on GitHub Pages, otherwise to the profile. */
  function sourceUrl() {
    const host = location.hostname.match(/^([^.]+)\.github\.io$/);
    const repo = location.pathname.split("/").filter(Boolean)[0];
    if (host && repo && !repo.includes(".")) return `https://github.com/${host[1]}/${repo}`;
    return "https://github.com/eizo55";
  }

  function init() {
    const examples = $("#examples");
    for (const q of EXAMPLES) {
      const b = el("button", { type: "button", textContent: q });
      b.addEventListener("click", () => { $("#q").value = q; ask(q); });
      examples.append(el("li", {}, b));
    }
    $("#ask").addEventListener("submit", (e) => { e.preventDefault(); ask($("#q").value); });

    document.querySelectorAll(".origin-value").forEach((n) => { n.textContent = ollamaOrigin(); });
    $("#source-link").href = sourceUrl();

    const savedMode = store.get("rag-mode", "none");
    const radio = document.querySelector(`input[name="mode"][value="${savedMode}"]`);
    if (radio) radio.checked = true;
    $("#ollama-model").value = store.get("rag-ollama-model", DEFAULT_OLLAMA_MODEL);
    $("#ollama-url").value = store.get("rag-ollama-url", DEFAULT_OLLAMA_URL);

    const syncMode = () => {
      const mode = currentMode();
      $("#opts-ollama").hidden = mode !== "ollama";
      $("#opts-claude").hidden = mode !== "claude";
      $("#opts-openai").hidden = mode !== "openai";
      $("#mode-chip").textContent = modeLabel();
      store.set("rag-mode", mode);
    };
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", syncMode));
    $("#ollama-model").addEventListener("input", () => { store.set("rag-ollama-model", $("#ollama-model").value); syncMode(); });
    $("#ollama-url").addEventListener("input", () => store.set("rag-ollama-url", $("#ollama-url").value));
    $("#claude-model").addEventListener("input", syncMode);
    $("#openai-model").addEventListener("input", syncMode);
    syncMode();

    $("#upload").addEventListener("change", async (e) => { await addFiles(e.target.files); e.target.value = ""; });
    $("#reset-docs").addEventListener("click", loadSamples);

    loadSamples();

    // Show a first result right away, so the page is not empty. Only without a model:
    // a model call should never start before the visitor asks.
    if (currentMode() === "none") { $("#q").value = EXAMPLES[0]; ask(EXAMPLES[0]); }
  }

  init();
})();
