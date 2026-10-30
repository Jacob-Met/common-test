import test from "node:test";
import assert from "node:assert/strict";
import { chat, extractJson, compileObjection, draftRevision, NoKeyError } from "../nemotron.mjs";
import { seed } from "../seed.mjs";

const { proposal } = seed();
const reply = (content) => async (url, init) => ({ ok: true, status: 200, json: async () => ({ model: "nvidia/test", choices: [{ message: { content } }] }), text: async () => "", _url: url, _init: init });

test("chat without a key throws NoKeyError and never calls the network", async () => {
  let called = false;
  await assert.rejects(chat([{ role: "user", content: "x" }], { apiKey: "", fetchImpl: async () => { called = true; } }), NoKeyError);
  assert.equal(called, false);
});
test("chat posts to Token Factory chat/completions with bearer auth and a Nemotron model", async () => {
  let seen;
  const r = await chat([{ role: "user", content: "hi" }], { apiKey: "k-test", fetchImpl: async (u, i) => { seen = { u, i }; return reply("ok")(u, i); } });
  assert.equal(seen.u, "https://api.tokenfactory.nebius.com/v1/chat/completions");
  assert.equal(seen.i.headers.authorization, "Bearer k-test");
  const body = JSON.parse(seen.i.body);
  assert.match(body.model, /^nvidia\//);
  assert.ok(body.max_tokens >= 1500);
  assert.equal(r.content, "ok");
});
test("extractJson survives fences, prose and <think> leftovers", () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":{"b":"}"}}\n```'), { a: { b: "}" } });
});
test("compileObjection accepts a valid rule and returns the restatement", async () => {
  const good = JSON.stringify({ rule: { kind: "forbid", where: { all: [{ field: "end", op: ">", value: "21:00" }, { field: "dayType", op: "==", value: "weekday" }] } }, restatement: "No weekday event ends after 21:00." });
  const c = await compileObjection("Nothing after 9pm on weeknights", proposal, { apiKey: "k", fetchImpl: reply(good) });
  assert.equal(c.rule.kind, "forbid");
  assert.equal(c.attempts, 1);
  assert.match(c.restatement, /21:00/);
});
test("compileObjection retries once when the validator rejects, then fails honestly", async () => {
  const bad = JSON.stringify({ rule: { kind: "forbid", where: { field: "mood", op: "==", value: "x" } } });
  let n = 0;
  await assert.rejects(compileObjection("x y z w", proposal, { apiKey: "k", fetchImpl: async (u, i) => { n++; return reply(bad)(u, i); } }), /did not pass validation/);
  assert.equal(n, 2);
  const good = JSON.stringify({ rule: { kind: "limit", agg: "count", op: ">=", value: 10 } });
  let k = 0;
  const c = await compileObjection("keep ten", proposal, { apiKey: "k", fetchImpl: async (u, i) => reply(++k === 1 ? bad : good)(u, i) });
  assert.equal(c.attempts, 2);
});
test("draftRevision validates the model's ops against the schedule", async () => {
  const ok = JSON.stringify({ rationale: "Move it earlier.", ops: [{ op: "move", slot: "s5", start: "18:00", end: "21:00" }] });
  const d = await draftRevision(proposal.slots, proposal.facilities, [], { apiKey: "k", fetchImpl: reply(ok) });
  assert.equal(d.ops.length, 1);
  const evil = JSON.stringify({ rationale: "x", ops: [{ op: "remove", slot: "zzz" }] });
  await assert.rejects(draftRevision(proposal.slots, proposal.facilities, [], { apiKey: "k", fetchImpl: reply(evil) }), /unknown slot/);
});
