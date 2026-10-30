import test from "node:test";
import assert from "node:assert/strict";
import { validateRule, evaluateRule, evaluateAll, applyOps, validateOps, repair, readRule, derive } from "../engine.mjs";
import { seed } from "../seed.mjs";

const { proposal, objections, revisions } = seed();
const rules = objections.map((o) => ({ id: o.id, rule: o.rule, weight: 1 + o.supporters.filter((n) => n !== o.author).length }));

test("every seed rule passes the validator unchanged", () => {
  for (const o of objections) assert.deepEqual(validateRule(o.rule), o.rule);
});
test("validator rejects unknown fields, ops, bad times and kinds", () => {
  assert.throws(() => validateRule({ kind: "forbid", where: { field: "colour", op: "==", value: "red" } }), /unknown field/);
  assert.throws(() => validateRule({ kind: "forbid", where: { field: "noise", op: "~", value: 1 } }), /unknown op/);
  assert.throws(() => validateRule({ kind: "forbid", where: { field: "end", op: ">", value: "9pm" } }), /bad time/);
  assert.throws(() => validateRule({ kind: "run", where: {} }), /kind must/);
  assert.throws(() => validateRule({ kind: "limit", agg: "sum", op: "<=", value: 5 }), /numeric/);
});
test("derive computes dayType and duration", () => {
  assert.equal(derive({ day: "Sat", start: "08:00", end: "13:00" }).dayType, "weekend");
  assert.equal(derive({ day: "Tue", start: "18:00", end: "20:00" }).duration, 2);
});
test("weeknight noise rule yields concrete counterexamples", () => {
  const r = evaluateRule(objections[0].rule, proposal.slots);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations.flatMap((v) => v.slotIds).sort(), ["s4", "s5"]);
  assert.match(r.violations[0].text, /Thu|Fri/);
});
test("no_overlap finds seniors vs noisy event in same facility", () => {
  const slots = [
    { id: "a", day: "Mon", start: "09:00", end: "10:30", facility: "Pavilion", activity: "Tai chi", group: "g", audience: "seniors", noise: 0, cost: 0, lights: false },
    { id: "b", day: "Mon", start: "10:00", end: "11:00", facility: "Pavilion", activity: "Band", group: "g", audience: "all", noise: 3, cost: 0, lights: false },
    { id: "c", day: "Mon", start: "10:00", end: "11:00", facility: "Court A", activity: "Hoops", group: "g", audience: "all", noise: 3, cost: 0, lights: false },
  ];
  const r = evaluateRule(objections[2].rule, slots);
  assert.equal(r.violations.length, 1);
  assert.deepEqual(r.violations[0].slotIds.sort(), ["a", "b"]);
});
test("limit rules: sum, count, group_by", () => {
  assert.equal(evaluateRule(objections[3].rule, proposal.slots).ok, false); // total is 1,510
  assert.equal(evaluateRule({ kind: "limit", agg: "sum", field: "cost", op: "<=", value: 1600 }, proposal.slots).ok, true);
  assert.equal(evaluateRule({ kind: "limit", agg: "sum", field: "cost", op: "<=", value: 1000 }, proposal.slots).ok, false);
  const sat = evaluateRule(objections[5].rule, proposal.slots); // Sat has 3 noise-3 events
  assert.equal(sat.ok, false);
  assert.match(sat.violations[0].text, /Sat/);
});
test("revision ops apply deterministically and are validated", () => {
  const ops = validateOps(revisions[1].ops, proposal.slots, proposal.facilities);
  const next = applyOps(proposal.slots, ops);
  assert.equal(next.find((s) => s.id === "s5").end, "21:00");
  assert.equal(proposal.slots.find((s) => s.id === "s5").end, "23:00"); // base untouched
  assert.throws(() => validateOps([{ op: "remove", slot: "nope" }], proposal.slots), /unknown slot/);
  assert.throws(() => validateOps([{ op: "set", slot: "s1", field: "day", value: "Mon" }], proposal.slots), /cannot set/);
});
test("authored revision 'Quiet evenings' beats the original on weighted score", () => {
  const base = evaluateAll(proposal.slots, rules);
  const quiet = evaluateAll(applyOps(proposal.slots, revisions[1].ops), rules);
  assert.ok(quiet.score > base.score);
});
test("greedy repair never lowers the score and reports its ops", () => {
  const base = evaluateAll(proposal.slots, rules);
  const r = repair(proposal.slots, rules, proposal.facilities);
  const after = evaluateAll(r.slots, rules);
  assert.ok(after.score >= base.score);
  assert.ok(r.ops.length > 0);
});
test("readRule gives a plain sentence", () => {
  assert.match(readRule(objections[0].rule), /No slot may have: day type is weekday and noise level \(0-3\) is at least 3/);
});
