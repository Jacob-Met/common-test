// node server.mjs  ->  http://localhost:4422
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { seed } from "./seed.mjs";
import { compileObjection, draftRevision, MODEL } from "./nemotron.mjs";
import { evaluateAll, applyOps, readRule, readOp, repair, validateRule } from "./engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 4422;
const DATA = process.env.DATA_FILE || join(here, "data", "state.json");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

let state = existsSync(DATA) ? JSON.parse(readFileSync(DATA, "utf8")) : seed();
const save = async () => { await mkdir(dirname(DATA), { recursive: true }); await writeFile(DATA, JSON.stringify(state, null, 1)); };
let nextId = Date.now() % 100000;
const uid = (p) => `${p}${(nextId++).toString(36)}`;

const weightOf = (o) => 1 + o.supporters.filter((n) => n !== o.author).length;
const rulesFor = () => state.objections.filter((o) => o.rule).map((o) => ({ id: o.id, rule: o.rule, weight: weightOf(o) }));

function view() {
  const base = state.proposal.slots;
  const rules = rulesFor();
  const evals = {};
  const revisions = state.revisions.map((r) => {
    const slots = applyOps(base, r.ops);
    const e = evaluateAll(slots, rules);
    evals[r.id] = { slots, score: e.score, total: e.total, violations: e.violations, broken: e.broken, results: Object.fromEntries(Object.entries(e.results).map(([k, v]) => [k, { ok: v.ok, violations: v.violations }])) };
    return { ...r, opsText: r.ops.map((o) => readOp(o, base)) };
  });
  const ranked = [...revisions].sort((a, b) => evals[b.id].score - evals[a.id].score || evals[a.id].violations - evals[b.id].violations || a.ops.length - b.ops.length);
  return {
    proposal: state.proposal, revisions, evals, bestId: ranked[0]?.id,
    objections: state.objections.map((o) => ({ ...o, weight: weightOf(o), reading: readRule(o.rule) })),
    nemotron: { live: !!process.env.NEBIUS_API_KEY, model: MODEL },
  };
}

async function compileInto(o) {
  try {
    const c = await compileObjection(o.text, state.proposal);
    Object.assign(o, { rule: c.rule, restatement: c.restatement, source: "nemotron", model: c.model, attempts: c.attempts, error: null });
  } catch (e) { o.error = e.message; if (e.code === "NO_KEY") o.rule = o.rule || null; }
}

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, no) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 50000) { no(new Error("too large")); req.destroy(); } }); req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(new Error("bad JSON")); } }); });

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p.startsWith("/api/")) {
      if (req.method === "GET" && p === "/api/state") return json(res, 200, view());
      const body = req.method === "POST" ? await readBody(req) : {};
      if (req.method === "POST" && p === "/api/objections") {
        const text = String(body.text || "").trim().slice(0, 400), author = String(body.author || "Anonymous").trim().slice(0, 40) || "Anonymous";
        if (text.length < 8) return json(res, 400, { error: "Write the objection in a full sentence." });
        const o = { id: uid("o"), author, text, supporters: [author], rule: null, restatement: "", source: null };
        state.objections.push(o);
        await compileInto(o); await save();
        return json(res, 200, { id: o.id, error: o.error || null, state: view() });
      }
      let m;
      if (req.method === "POST" && (m = /^\/api\/objections\/([^/]+)\/(support|compile|rule)$/.exec(p))) {
        const o = state.objections.find((x) => x.id === m[1]);
        if (!o) return json(res, 404, { error: "no such objection" });
        if (m[2] === "support") { const n = String(body.name || "Anonymous").slice(0, 40); o.supporters = o.supporters.includes(n) ? o.supporters.filter((x) => x !== n) : [...o.supporters, n]; }
        if (m[2] === "compile") await compileInto(o);
        if (m[2] === "rule") { try { o.rule = validateRule(body.rule); o.source = "edited"; o.restatement = readRule(o.rule); o.error = null; } catch (e) { return json(res, 400, { error: e.message }); } }
        await save();
        return json(res, 200, { error: o.error || null, state: view() });
      }
      if (req.method === "DELETE" && (m = /^\/api\/objections\/([^/]+)$/.exec(p))) {
        state.objections = state.objections.filter((x) => x.id !== m[1]); await save();
        return json(res, 200, { state: view() });
      }
      if (req.method === "POST" && p === "/api/revise") {
        const baseRev = state.revisions.find((r) => r.id === body.base) || state.revisions[0];
        const baseSlots = applyOps(state.proposal.slots, baseRev.ops);
        const rules = rulesFor();
        const fac = state.proposal.facilities;
        let rev;
        if (body.mode === "nemotron") {
          const e = evaluateAll(baseSlots, rules);
          const lines = state.objections.filter((o) => o.rule).map((o) => ({ weight: weightOf(o), ok: e.results[o.id].ok, reading: readRule(o.rule), examples: e.results[o.id].violations.slice(0, 3).map((v) => v.text) }));
          try {
            const d = await draftRevision(baseSlots, fac, lines);
            rev = { id: uid("r"), name: `Nemotron revision of ${baseRev.name}`, author: "nemotron", note: d.rationale, ops: [...baseRev.ops, ...d.ops], model: d.model };
          } catch (e) { return json(res, e.code === "NO_KEY" ? 503 : 502, { error: e.message }); }
        } else {
          const r = repair(baseSlots, rules, fac);
          rev = { id: uid("r"), name: `Engine repair of ${baseRev.name}`, author: "engine", note: r.ops.length ? "Greedy search over single edits, scored by the weighted conditions." : "No single edit improves the weighted score.", ops: [...baseRev.ops, ...r.ops] };
        }
        state.revisions.push(rev); await save();
        return json(res, 200, { id: rev.id, state: view() });
      }
      if (req.method === "POST" && p === "/api/reset") { state = seed(); await save(); return json(res, 200, { state: view() }); }
      return json(res, 404, { error: "not found" });
    }
    const file = p === "/" ? "index.html" : p.slice(1);
    if (file.includes("..") || !TYPES[extname(file)]) { res.writeHead(404); return res.end("not found"); }
    const buf = await readFile(join(here, "public", file));
    res.writeHead(200, { "content-type": TYPES[extname(file)], "cache-control": "no-store" });
    res.end(buf);
  } catch (e) {
    if (e.code === "ENOENT") { res.writeHead(404); return res.end("not found"); }
    json(res, 500, { error: e.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(PORT, () => console.log(`Common Test on http://localhost:${PORT}  (Nemotron ${process.env.NEBIUS_API_KEY ? "live" : "key not set"})`));
