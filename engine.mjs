// Common Test engine: a small JSON rule DSL, a validator, an evaluator that returns
// concrete counterexamples, a plain-English reader, revision ops, and a greedy repair search.
// Everything here is deterministic. Nemotron only proposes rules and edits; this file decides.

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const FIELDS = {
  day: "str", dayType: "str", facility: "str", activity: "str", group: "str", audience: "str",
  start: "time", end: "time", duration: "num", noise: "num", cost: "num", lights: "bool",
};
export const EDITABLE = ["noise", "cost", "lights", "facility", "audience"];
const OPS = ["==", "!=", "<", "<=", ">", ">=", "in", "contains"];
const KINDS = ["forbid", "require", "limit", "no_overlap"];

export const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t));
  if (!m) throw new Error(`bad time "${t}" (use HH:MM)`);
  const v = +m[1] * 60 + +m[2];
  if (+m[1] > 24 || +m[2] > 59 || v > 1440) throw new Error(`bad time "${t}"`);
  return v;
};
export const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

export function derive(s) {
  const d = { ...s };
  d.dayType = DAYS.indexOf(s.day) >= 5 ? "weekend" : "weekday";
  d.duration = (toMin(s.end) - toMin(s.start)) / 60;
  return d;
}

// ---- predicates -------------------------------------------------------------
function validatePred(p, path = "where") {
  if (!p || typeof p !== "object") throw new Error(`${path}: expected an object`);
  if (p.all || p.any) {
    const key = p.all ? "all" : "any";
    if (!Array.isArray(p[key]) || !p[key].length) throw new Error(`${path}.${key}: expected a non-empty list`);
    return { [key]: p[key].map((q, i) => validatePred(q, `${path}.${key}[${i}]`)) };
  }
  if (p.not) return { not: validatePred(p.not, `${path}.not`) };
  if (!(p.field in FIELDS)) throw new Error(`${path}: unknown field "${p.field}" (known: ${Object.keys(FIELDS).join(", ")})`);
  if (!OPS.includes(p.op)) throw new Error(`${path}: unknown op "${p.op}"`);
  const t = FIELDS[p.field];
  let value = p.value;
  if (p.op === "in") {
    if (!Array.isArray(value) || !value.length) throw new Error(`${path}: "in" needs a list`);
  } else if (Array.isArray(value)) throw new Error(`${path}: value must not be a list`);
  if (t === "time") for (const v of [].concat(value)) toMin(v);
  if (t === "num" && ![].concat(value).every((v) => typeof v === "number")) throw new Error(`${path}: ${p.field} needs a number`);
  if (t === "bool") { if (typeof value === "string") value = value === "true"; if (typeof value !== "boolean") throw new Error(`${path}: ${p.field} needs true/false`); if (!["==", "!="].includes(p.op)) throw new Error(`${path}: bool fields use == or !=`); }
  if (t === "str" && ["<", "<=", ">", ">="].includes(p.op)) throw new Error(`${path}: text fields cannot use ${p.op}`);
  if (p.field === "day") for (const v of [].concat(value)) if (!DAYS.includes(v)) throw new Error(`${path}: day must be one of ${DAYS.join(", ")}`);
  if (p.op === "contains" && t !== "str") throw new Error(`${path}: contains is for text fields`);
  return { field: p.field, op: p.op, value };
}

export function evalPred(p, slot) {
  if (!p) return true;
  if (p.all) return p.all.every((q) => evalPred(q, slot));
  if (p.any) return p.any.some((q) => evalPred(q, slot));
  if (p.not) return !evalPred(p.not, slot);
  const t = FIELDS[p.field];
  let a = slot[p.field];
  const norm = (v) => (t === "time" ? toMin(v) : t === "str" ? String(v).toLowerCase() : v);
  a = norm(a);
  if (p.op === "in") return p.value.map(norm).includes(a);
  const b = norm(p.value);
  switch (p.op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "contains": return String(a).includes(String(b));
  }
  return false;
}

// ---- rules ------------------------------------------------------------------
export function validateRule(r) {
  if (!r || typeof r !== "object") throw new Error("rule must be an object");
  if (!KINDS.includes(r.kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  const out = { kind: r.kind };
  if (r.kind === "forbid") out.where = validatePred(r.where, "where");
  if (r.kind === "require") { if (r.where) out.where = validatePred(r.where, "where"); out.require = validatePred(r.require, "require"); }
  if (r.kind === "limit") {
    if (r.where) out.where = validatePred(r.where, "where");
    out.agg = r.agg || "count";
    if (!["count", "sum", "max"].includes(out.agg)) throw new Error("agg must be count, sum or max");
    if (out.agg !== "count") { if (FIELDS[r.field] !== "num") throw new Error("sum/max need a numeric field (noise, cost, duration)"); out.field = r.field; }
    if (r.group_by) { if (!(r.group_by in FIELDS) || FIELDS[r.group_by] !== "str") throw new Error("group_by must be a text field such as day, facility, audience"); out.group_by = r.group_by; }
    if (!["<=", ">=", "<", ">", "=="].includes(r.op)) throw new Error("limit op must be <=, >=, <, > or ==");
    if (typeof r.value !== "number") throw new Error("limit value must be a number");
    out.op = r.op; out.value = r.value;
  }
  if (r.kind === "no_overlap") {
    out.where = validatePred(r.where, "where");
    if (r.where_b) out.where_b = validatePred(r.where_b, "where_b");
    if (r.same) { if (!(r.same in FIELDS) || FIELDS[r.same] !== "str") throw new Error("same must be a text field such as facility"); out.same = r.same; }
  }
  return out;
}

const cmp = (a, op, b) => ({ "<=": a <= b, ">=": a >= b, "<": a < b, ">": a > b, "==": a === b })[op];
export const slotLabel = (s) => `${s.day} ${s.start}-${s.end} ${s.activity} (${s.facility}, noise ${s.noise}${s.lights ? ", lit" : ""}, $${s.cost})`;
const overlaps = (a, b) => a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

export function evaluateRule(rule, rawSlots) {
  const slots = rawSlots.map(derive);
  const v = [];
  if (rule.kind === "forbid") {
    for (const s of slots) if (evalPred(rule.where, s)) v.push({ slotIds: [s.id], text: `${slotLabel(s)} is exactly what this rule forbids.` });
  } else if (rule.kind === "require") {
    for (const s of slots) if (evalPred(rule.where, s) && !evalPred(rule.require, s)) v.push({ slotIds: [s.id], text: `${slotLabel(s)} is in scope but does not meet the requirement.` });
  } else if (rule.kind === "limit") {
    const groups = rule.group_by ? [...new Set(slots.map((s) => s[rule.group_by]))] : [null];
    for (const g of groups) {
      const inScope = slots.filter((s) => (g === null || s[rule.group_by] === g) && evalPred(rule.where, s));
      const val = rule.agg === "count" ? inScope.length : rule.agg === "sum" ? inScope.reduce((a, s) => a + s[rule.field], 0) : Math.max(0, ...inScope.map((s) => s[rule.field]));
      if (!cmp(val, rule.op, rule.value)) {
        const what = rule.agg === "count" ? "count" : `${rule.agg} of ${rule.field}`;
        v.push({ gap: Math.abs(val - rule.value) / Math.max(1, Math.abs(rule.value)), slotIds: inScope.map((s) => s.id), text: `${g === null ? "Whole schedule" : `${rule.group_by} ${g}`}: ${what} is ${Math.round(val * 100) / 100}, but it must be ${rule.op} ${rule.value}.${inScope.length ? " Slots involved: " + inScope.map((s) => `${s.day} ${s.start} ${s.activity}`).join("; ") + "." : " No qualifying slots exist."}` });
      }
    }
  } else if (rule.kind === "no_overlap") {
    const A = slots.filter((s) => evalPred(rule.where, s));
    const B = rule.where_b ? slots.filter((s) => evalPred(rule.where_b, s)) : A;
    const seen = new Set();
    for (const a of A) for (const b of B) {
      if (a.id === b.id || !overlaps(a, b)) continue;
      if (rule.same && a[rule.same] !== b[rule.same]) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue; seen.add(key);
      v.push({ slotIds: [a.id, b.id], text: `${a.day} ${a.activity} (${a.start}-${a.end}) overlaps ${b.activity} (${b.start}-${b.end})${rule.same ? ` in the same ${rule.same}` : ""}.` });
    }
  }
  return { ok: v.length === 0, violations: v };
}

// ---- plain-English reading of a rule (the inspectable part) ------------------
const FW = { day: "day", dayType: "day type", facility: "facility", activity: "activity", group: "group", audience: "audience", start: "start time", end: "end time", duration: "length (hours)", noise: "noise level (0-3)", cost: "cost ($)", lights: "uses lights" };
function opWords(field, op) {
  if (FIELDS[field] === "time") return { "<": "is before", "<=": "is at or before", ">": "is after", ">=": "is at or after", "==": "is", "!=": "is not" }[op];
  return { "==": "is", "!=": "is not", "<": "is below", "<=": "is at most", ">": "is above", ">=": "is at least", in: "is one of", contains: "contains" }[op];
}
export function readPred(p) {
  if (!p) return "any slot";
  if (p.all) return p.all.map(readPred).join(" and ");
  if (p.any) return "(" + p.any.map(readPred).join(" or ") + ")";
  if (p.not) return `not (${readPred(p.not)})`;
  const val = Array.isArray(p.value) ? p.value.join(" / ") : String(p.value);
  return `${FW[p.field]} ${opWords(p.field, p.op)} ${val}`;
}
export function readRule(r) {
  if (!r) return "";
  const w = r.where ? readPred(r.where) : "any slot";
  if (r.kind === "forbid") return `No slot may have: ${w}.`;
  if (r.kind === "require") return `Every slot with ${w} must have: ${readPred(r.require)}.`;
  if (r.kind === "limit") {
    const what = r.agg === "count" ? "the number of slots" : `the ${r.agg} of ${FW[r.field]}`;
    return `${r.group_by ? `For each ${r.group_by}, ` : "Across the schedule, "}${what} where ${w} must be ${r.op} ${r.value}.`;
  }
  return `No two slots may overlap in time when one has ${w}${r.where_b ? ` and the other has ${readPred(r.where_b)}` : " and the other matches too"}${r.same ? `, in the same ${r.same}` : ""}.`;
}

// ---- scoring ----------------------------------------------------------------
// rules: [{id, rule, weight}] ; returns per-rule results and a weighted score
export function evaluateAll(slots, rules) {
  const results = {};
  let score = 0, total = 0, violations = 0, broken = 0, gap = 0;
  for (const r of rules) {
    if (!r.rule) continue;
    const res = evaluateRule(r.rule, slots);
    results[r.id] = res;
    total += r.weight;
    if (res.ok) score += r.weight; else { violations += res.violations.length; broken++; gap += res.violations.reduce((a, x) => a + (x.gap || 0), 0); }
  }
  return { results, score, total, violations, broken, gap };
}

// ---- revisions: ops over the base schedule -----------------------------------
export function validateOps(ops, slots, facilities) {
  if (!Array.isArray(ops)) throw new Error("ops must be a list");
  if (ops.length > 12) throw new Error("at most 12 ops");
  const ids = new Set(slots.map((s) => s.id));
  return ops.map((o, i) => {
    if (!ids.has(o.slot)) throw new Error(`op ${i}: unknown slot "${o.slot}"`);
    if (o.op === "remove") return { op: "remove", slot: o.slot };
    if (o.op === "move") {
      const out = { op: "move", slot: o.slot };
      if (o.day !== undefined) { if (!DAYS.includes(o.day)) throw new Error(`op ${i}: bad day`); out.day = o.day; }
      if (o.start !== undefined) { toMin(o.start); out.start = o.start; }
      if (o.end !== undefined) { toMin(o.end); out.end = o.end; }
      if (o.facility !== undefined) { if (facilities && !facilities.includes(o.facility)) throw new Error(`op ${i}: unknown facility`); out.facility = o.facility; }
      return out;
    }
    if (o.op === "set") {
      if (!EDITABLE.includes(o.field)) throw new Error(`op ${i}: cannot set ${o.field}`);
      if (o.field === "facility" && facilities && !facilities.includes(o.value)) throw new Error(`op ${i}: unknown facility`);
      return { op: "set", slot: o.slot, field: o.field, value: o.value };
    }
    throw new Error(`op ${i}: unknown op "${o.op}"`);
  });
}
export function applyOps(slots, ops) {
  let cur = slots.map((s) => ({ ...s }));
  for (const o of ops) {
    const i = cur.findIndex((s) => s.id === o.slot);
    if (i < 0) continue;
    if (o.op === "remove") cur.splice(i, 1);
    else if (o.op === "move") {
      const s = cur[i];
      const dur = toMin(s.end) - toMin(s.start);
      if (o.day) s.day = o.day;
      if (o.facility) s.facility = o.facility;
      if (o.start && !o.end) { s.start = o.start; s.end = fromMin(Math.min(1440, toMin(o.start) + dur)); }
      else { if (o.start) s.start = o.start; if (o.end) s.end = o.end; }
      if (toMin(s.end) <= toMin(s.start)) s.end = fromMin(Math.min(1440, toMin(s.start) + 30));
    } else if (o.op === "set") cur[i][o.field] = o.value;
  }
  return cur;
}
export function readOp(o, slots) {
  const s = slots.find((x) => x.id === o.slot);
  const name = s ? `${s.activity} (${s.day} ${s.start})` : o.slot;
  if (o.op === "remove") return `Remove ${name}`;
  if (o.op === "set") return `Set ${o.field} of ${name} to ${o.value}`;
  return `Move ${name} to ${[o.day, o.start && o.end ? `${o.start}-${o.end}` : o.start && `start ${o.start}`, o.end && !o.start ? `end ${o.end}` : "", o.facility].filter(Boolean).join(" ")}`;
}

// ---- greedy repair search ----------------------------------------------------
// Tries every single-slot edit (shift day/time, shorten, change facility, remove), keeps the
// edit that most improves (weighted rules satisfied, then fewer violations, then fewer changes).
export function repair(baseSlots, rules, facilities, { maxSteps = 14 } = {}) {
  const objective = (slots, nOps, nRemoved) => {
    const e = evaluateAll(slots, rules);
    return e.score * 10000 - e.violations * 50 - e.gap * 400 - nOps * 8 - nRemoved * 40;
  };
  let cur = baseSlots, ops = [], removed = 0;
  let best = objective(cur, 0, 0);
  const starts = []; for (let m = 7 * 60; m <= 21 * 60; m += 30) starts.push(fromMin(m));
  for (let step = 0; step < maxSteps; step++) {
    let bestOp = null, bestVal = best;
    for (const s of cur) {
      const cands = [{ op: "remove", slot: s.id }];
      for (const d of DAYS) for (const st of starts) if (!(d === s.day && st === s.start) && Math.abs(toMin(st) - toMin(s.start)) <= 90 && (DAYS.indexOf(d) >= 5) === (DAYS.indexOf(s.day) >= 5)) cands.push({ op: "move", slot: s.id, day: d, start: st });
      const len = toMin(s.end) - toMin(s.start);
      for (const cut of [30, 60, 90, 120]) if (len - cut >= 60) cands.push({ op: "move", slot: s.id, end: fromMin(toMin(s.end) - cut) });
      for (const f of facilities || []) if (f !== s.facility) cands.push({ op: "move", slot: s.id, facility: f });
      for (const c of cands) {
        const next = applyOps(cur, [c]);
        const val = objective(next, ops.length + 1, removed + (c.op === "remove" ? 1 : 0));
        if (val > bestVal) { bestVal = val; bestOp = c; }
      }
    }
    if (!bestOp) break;
    cur = applyOps(cur, [bestOp]); ops.push(bestOp); if (bestOp.op === "remove") removed++;
    best = bestVal;
  }
  return { ops, slots: cur };
}
