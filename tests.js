// Run with: node tests.js   (no dependencies)
const assert = require("node:assert/strict");
const Rag = require("./rag.js");
global.window = {};
require("./docs.js");
const docs = global.window.SAMPLE_DOCS;

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n  ", e.message); }
}

test("tokenizer folds umlauts and drops stop words", () => {
  assert.deepEqual(Rag.tokenize("Die Küche ist groß"), ["kueche", "gross"]);
});

test("compound expansion yields 'kaution' from 'mietkaution'", () => {
  assert.ok(Rag.expandCompounds(["mietkaution"]).includes("kaution"));
  assert.deepEqual(Rag.expandCompounds(["miete"]), ["miete"]);
});

test("short text is one chunk", () => {
  const c = Rag.chunk("a.md", "Erster Absatz.\n\nZweiter Absatz.", 200, 20);
  assert.equal(c.length, 1);
  assert.ok(c[0].text.includes("Zweiter"));
});

test("long text is split and respects the size limit", () => {
  const c = Rag.chunk("b.txt", "Dies ist ein Satz mit einigen Woertern. ".repeat(50), 200, 40);
  assert.ok(c.length > 1);
  for (const x of c) assert.ok(x.text.length <= 200 + 2 + 40, "too long: " + x.text.length);
});

test("overlap carries context into next chunk", () => {
  const c = Rag.chunk("c.txt", "alpha ".repeat(30).trim() + "\n\n" + "omega ".repeat(30).trim(), 200, 50);
  assert.equal(c.length, 2);
  assert.ok(c[1].text.startsWith("alpha"));
});

const small = [
  { source: "kaution.md", index: 0, text: "Die Mietkaution beträgt höchstens drei Nettokaltmieten." },
  { source: "betrieb.md", index: 0, text: "Die Betriebskostenabrechnung muss innerhalb von zwölf Monaten zugehen." },
  { source: "verwaltung.txt", index: 0, text: "Eine Hausverwaltung kümmert sich um Instandhaltung und Mahnwesen." },
];

test("bm25 finds Kaution inside Mietkaution", () => {
  const hits = new Rag.Bm25(small).retrieve("Wie hoch darf die Kaution sein?", 3);
  assert.equal(hits[0].chunk.source, "kaution.md");
});

test("bm25 umlaut and case folding", () => {
  assert.equal(new Rag.Bm25(small).retrieve("KUEMMERT Instandhaltung", 1)[0].chunk.source, "verwaltung.txt");
});

test("bm25 topK and irrelevant query", () => {
  const r = new Rag.Bm25(small);
  assert.equal(r.retrieve("Kaution Betriebskostenabrechnung", 1).length, 1);
  assert.equal(r.retrieve("Raumschiff", 3).length, 0);
});

test("bm25 on empty index", () => {
  assert.equal(new Rag.Bm25([]).retrieve("irgendwas", 3).length, 0);
});

test("sample docs: the right file ranks first", () => {
  const chunks = docs.flatMap((d) => Rag.chunk(d.name, d.text));
  const r = new Rag.Bm25(chunks);
  const cases = [
    ["Wie hoch darf eine Mietkaution sein?", "mietkaution.md"],
    ["Wie hoch darf die Kaution sein?", "mietkaution.md"],
    ["Bis wann muss die Betriebskostenabrechnung beim Mieter sein?", "betriebskostenabrechnung.md"],
    ["Was macht eine Hausverwaltung?", "hausverwaltung.txt"],
    ["Wann kommt die Abrechnung?", "betriebskostenabrechnung.md"],
  ];
  for (const [q, file] of cases) assert.equal(r.retrieve(q, 1)[0].chunk.source, file, q);
});

test("highlight marks matching words, including compounds", () => {
  const parts = Rag.highlightParts("Die Mietkaution beträgt drei Monatsmieten.", "Wie hoch darf die Kaution sein?");
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ["Mietkaution"]);
  assert.equal(parts.map((p) => p.text).join(""), "Die Mietkaution beträgt drei Monatsmieten.");
});

test("question words are not highlighted", () => {
  const parts = Rag.highlightParts("Der Mieter darf die Kaution zahlen.", "Wie hoch darf die Kaution sein?");
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ["Kaution"]);
});

test("prompt has numbered sources and ends with the question", () => {
  const hits = new Rag.Bm25(small).retrieve("Kaution", 2);
  const p = Rag.buildUserPrompt("Kaution?", hits);
  assert.ok(p.includes("[1] (kaution.md#0)"));
  assert.ok(p.endsWith("Frage: Kaution?"));
  assert.ok(Rag.buildUserPrompt("x", []).includes("keine passenden Quellen"));
});

console.log(failed === 0 ? "ALL PASS" : failed + " FAILED");
process.exit(failed ? 1 : 0);
