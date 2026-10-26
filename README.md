# Frag die Akte – RAG-Chatbot im Browser

Ein Retrieval-Augmented-Generation-Chatbot über kurze Texte zum Mietrecht. Die Seite zerlegt Dokumente in Abschnitte, findet zu einer Frage die passendsten per BM25 und zeigt sie mit markierten Suchwörtern. Ein Sprachmodell kann daraus eine Antwort mit nummerierten Quellenangaben formulieren.

Die Dokumentensuche läuft vollständig im Browser, ohne Server. Für Antworten stehen drei Modelle zur Wahl: Ollama (lokal und kostenlos), Claude oder OpenAI (jeweils mit eigenem API-Schlüssel).

Es gibt auch eine Java-Version des Projekts: [rag-chatbot-java](https://github.com/eizo55/rag-chatbot-java).

## Funktionen

- **Dokumentensuche im Browser:** Chunking mit Überlappung, deutsche Normalisierung (Umlaute, Stoppwörter) und Teilwörter zusammengesetzter Wörter, sodass „Kaution“ auch „Mietkaution“ findet.
- **Antworten mit Quellen:** Die besten vier Abschnitte gehen als nummerierte Quellen an das Modell. Zitate wie `[1]` in der Antwort verlinken auf den jeweiligen Abschnitt.
- **Austauschbares Modell:** Ollama, Claude (Anthropic Messages API) oder OpenAI (Responses API). API-Schlüssel bleiben im Arbeitsspeicher des Tabs und werden nicht gespeichert.
- **Eigene Dokumente:** `.txt`- und `.md`-Dateien lassen sich im Browser hinzufügen und werden nicht hochgeladen.
- **Verständliche Fehlermeldungen:** zum Beispiel bei nicht erreichbarem Ollama, unbekanntem Modell oder ungültigem Schlüssel.
- Bedienung per Tastatur mit sichtbarem Fokus, responsives Layout, helles und dunkles Design.

## Technik

- Reines HTML, CSS und JavaScript ohne Build-Schritt und ohne Abhängigkeiten
- Eigene Implementierung von Okapi BM25 mit invertiertem Index im Speicher
- Anbindung von Ollama (`/api/chat`), der Anthropic Messages API und der OpenAI Responses API über `fetch`
- Der Prompt weist das Modell an, nur aus den Quellen zu antworten und deren Inhalt als Daten zu behandeln, nicht als Anweisungen
- Unit-Tests mit dem eingebauten Node-Testwerkzeug (`assert`)

Die Suchlogik ist an die Java-Version des Projekts (Maven, JUnit) angelehnt.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html`, `style.css` | Seite und Gestaltung |
| `rag.js` | Tokenizer, Chunker, BM25, Hervorhebung, Prompt |
| `app.js` | Oberfläche und Anbindung der Sprachmodelle |
| `docs.js` | Drei Beispieltexte (Demo-Inhalte, keine Rechtsberatung) |
| `tests.js` | Tests für `rag.js` |

## Starten

Für die Suche genügt es, `index.html` im Browser zu öffnen.

**Ollama (lokal):**

```bash
ollama pull llama3.2                      # Modell einmalig laden
OLLAMA_ORIGINS="https://eizo55.github.io" ollama serve
```

Der Browser darf Ollama nur ansprechen, wenn die Seite freigegeben ist. Die Herkunft in `OLLAMA_ORIGINS` muss zur Adresse der Seite passen. Wird `index.html` direkt aus dem Dateisystem geöffnet, steht dort `"*"`. Die Seite zeigt unter „Ollama“ die passende Zeile an.

**Claude oder OpenAI:** Modus wählen, API-Schlüssel eintragen, Frage stellen. Die Anfragen gehen direkt vom Browser an den jeweiligen Anbieter.

## Tests

```bash
node tests.js
```

Geprüft werden Tokenizer, Chunking, BM25-Ranking, Hervorhebung und Prompt-Aufbau.

## Grenzen

- Frage und Antwort ohne Gesprächsverlauf
- Direkte Browser-Aufrufe der Anbieter-APIs funktionieren nur, solange der Anbieter sie zulässt (CORS). Für den produktiven Einsatz gehören API-Schlüssel auf einen Server.
- Die Beispieltexte sind kurze Demo-Inhalte und keine Rechtsberatung
- Kleine lokale Modelle antworten auf Deutsch weniger zuverlässig als große und halten die Zitierregeln nicht immer ein; die angezeigten Quellen sind davon unabhängig
