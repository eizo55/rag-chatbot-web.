# Frag die Akte – RAG-Chatbot im Browser

Browser-Version meines Java-RAG-Chatbots. Die Seite zerlegt Texte in Abschnitte, bewertet sie mit BM25 (inklusive deutscher Komposita: „Kaution“ findet „Mietkaution“) und zeigt die Treffer mit markierten Suchwörtern. Optional formuliert ein Sprachmodell eine Antwort mit Quellenangaben.

- **Nur Suche:** läuft komplett im Browser, ohne Server und ohne Kosten.
- **Ollama (lokal):** kostenlose Antworten von einem Modell auf dem eigenen Rechner.
- **Claude:** Antworten über die Anthropic API mit dem eigenen Schlüssel des Besuchers. Der Schlüssel wird nicht gespeichert.

Eigene `.txt`- und `.md`-Dateien lassen sich unter „Dokumente“ hinzufügen. Sie bleiben im Browser.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css` | Seite und Gestaltung |
| `rag.js` | Tokenizer, Chunker, BM25, Hervorhebung, Prompt (Port der Java-Klassen) |
| `app.js` | Oberfläche, Anbindung von Ollama und Claude |
| `docs.js` | Drei Beispieltexte (Demo-Inhalte, keine Rechtsberatung) |
| `tests.js` | Tests für `rag.js`: `node tests.js` |

## Auf GitHub Pages veröffentlichen

1. Auf github.com ein neues Repository anlegen, z. B. `rag-chatbot-web` (public).
2. Alle Dateien dieses Ordners hochladen („Add file → Upload files“) und committen.
3. Im Repository: **Settings → Pages → Build and deployment**, Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)**, speichern.
4. Nach ein bis zwei Minuten läuft die Seite unter `https://DEIN-NAME.github.io/rag-chatbot-web/`.

## Ollama mit der veröffentlichten Seite nutzen

Der Browser darf Ollama nur ansprechen, wenn Ollama die Seite zulässt. Auf dem Mac:

```bash
launchctl setenv OLLAMA_ORIGINS "https://DEIN-NAME.github.io"
```

Danach die Ollama-App beenden und neu starten. Das Modell einmalig laden: `ollama pull llama3.2`. Safari blockiert Anfragen von https-Seiten an `http://localhost` teils; Chrome und Firefox funktionieren.

## Grenzen

- Es ist ein Frage-Antwort-Fenster ohne Gesprächsverlauf. Die Java-Version merkt sich die letzten Nachrichten.
- GitHub Pages hostet nur statische Dateien. Die Java-Anwendung selbst läuft dort nicht.
