import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "ct-")), "state.json");
delete process.env.NEBIUS_API_KEY;
const { server } = await import("../server.mjs");
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, method = "GET", body) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
test.after(() => server.close());

test("state endpoint ranks revisions and evaluates every objection", async () => {
  const { j } = await call("/api/state");
  assert.equal(j.objections.length, 6);
  assert.equal(j.nemotron.live, false);
  assert.ok(j.evals[j.bestId].score >= j.evals.r0.score);
  assert.ok(j.evals.r0.results.o1.violations.length > 0);
});
test("without a key, a typed objection is saved with a clear message, not lost", async () => {
  const { status, j } = await call("/api/objections", "POST", { text: "No amplified music on Sundays please", author: "Test" });
  assert.equal(status, 200);
  assert.match(j.error, /NEBIUS_API_KEY/);
  assert.ok(j.state.objections.some((o) => o.id === j.id && !o.rule));
});
test("short objections are rejected", async () => assert.equal((await call("/api/objections", "POST", { text: "no" })).status, 400));
test("nemotron revise without a key gives 503; engine repair works offline", async () => {
  assert.equal((await call("/api/revise", "POST", { mode: "nemotron", base: "r0" })).status, 503);
  const r = await call("/api/revise", "POST", { mode: "engine", base: "r0" });
  assert.equal(r.status, 200);
  assert.ok(r.j.state.evals[r.j.id].score >= r.j.state.evals.r0.score);
});
test("hand-edited rules are validated", async () => {
  assert.equal((await call("/api/objections/o1/rule", "POST", { rule: { kind: "nope" } })).status, 400);
});
test("static page is served", async () => {
  const r = await fetch(base + "/"); assert.equal(r.status, 200); assert.match(await r.text(), /Common Test/);
});
