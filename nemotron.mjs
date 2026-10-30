// Nemotron on Nebius Token Factory adapter. Server-side only: the browser never sees the key.
// The model proposes (a rule, or a revision); engine.mjs validates and decides.
import { FIELDS, DAYS, validateRule, validateOps, readRule } from "./engine.mjs";

export const BASE_URL = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
export const MODEL = process.env.NEMOTRON_MODEL || "nvidia/nemotron-3-super-120b-a12b";

export class NoKeyError extends Error { constructor() { super("NEBIUS_API_KEY is not set on the server. Objections are saved and can be compiled once it is."); this.code = "NO_KEY"; } }

export async function chat(messages, opts = {}) {
  try { return await chatOnce(messages, opts); }
  catch (e) { if (/empty answer/.test(e.message)) return chatOnce(messages, { ...opts, maxTokens: 6000 }); throw e; }
}

async function chatOnce(messages, { fetchImpl = fetch, apiKey = process.env.NEBIUS_API_KEY, baseUrl = BASE_URL, model = MODEL, maxTokens = 3500 } = {}) {
  if (!apiKey) throw new NoKeyError();
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.1 }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Token Factory returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  let content = j.choices?.[0]?.message?.content || "";
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!content) throw new Error("Nemotron returned an empty answer (token budget used on reasoning). Try again.");
  return { content, model: j.model || model };
}

export function extractJson(text) {
  const t = text.replace(/```(?:json)?/g, "");
  for (let i = t.indexOf("{"); i >= 0; i = t.indexOf("{", i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let k = i; k < t.length; k++) {
      const c = t[k];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { try { return JSON.parse(t.slice(i, k + 1)); } catch { break; } }
    }
  }
  throw new Error("no JSON object found in the model's answer");
}

const DSL_HELP = `You turn a resident's plain-English objection to a community schedule into ONE executable rule in a JSON DSL.
Each schedule slot has fields: ${Object.entries(FIELDS).map(([k, v]) => `${k}:${v}`).join(", ")}.
 day is one of ${DAYS.join(",")}; dayType is "weekday" (Mon-Fri) or "weekend" (Sat,Sun); times are "HH:MM" 24h strings;
 noise is 0 (silent) to 3 (loud amplified/competitive); cost is dollars per week; lights is true/false; audience is one of kids, adults, seniors, all.
Predicate: {"field":F,"op":"==|!=|<|<=|>|>=|in|contains","value":V} or {"all":[P,...]} or {"any":[P,...]} or {"not":P}.
Rule kinds:
 {"kind":"forbid","where":P}                      no slot may match P
 {"kind":"require","where":P,"require":Q}         every slot matching P must also match Q (where optional)
 {"kind":"limit","where":P,"group_by":"day","agg":"count|sum|max","field":"cost","op":"<=|>=|<|>|==","value":N}   (where, group_by, field optional; field needed for sum/max)
 {"kind":"no_overlap","where":P,"where_b":Q,"same":"facility"}   no two slots (one matching P, the other Q) overlap in time on the same day; where_b and same optional
Answer with ONLY a JSON object: {"rule": <rule>, "restatement": "<one plain sentence saying exactly what the rule checks>"}.
Noise guide: 3 = amplified or competitive (live music, leagues, parties, tournaments, boot camp); 2 = moderate (practice, markets); 1 = quiet; 0 = silent. "Loud", "amplified", "noisy" map to the noise field, not to a named activity.
Never filter on a specific activity or group name unless the resident names that exact activity. Describe slots by time, day, noise, audience, lights, facility or cost.
Pick the most literal reading of the words. "past 9pm" means end > "21:00". Do not add conditions the resident did not say.`;

export async function compileObjection(text, proposal, opts = {}) {
  const vocab = `Facilities: ${proposal.facilities.join(", ")}. Activities now: ${[...new Set(proposal.slots.map((s) => s.activity))].join(", ")}.`;
  const messages = [{ role: "system", content: DSL_HELP }, { role: "user", content: `${vocab}\nObjection: "${text}"` }];
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { content, model } = await chat(messages, opts);
    try {
      const j = extractJson(content);
      const rule = validateRule(j.rule || j);
      return { rule, restatement: String(j.restatement || readRule(rule)).slice(0, 300), model, attempts: attempt };
    } catch (e) {
      lastErr = e;
      messages.push({ role: "assistant", content: content.slice(0, 1500) }, { role: "user", content: `That rule was rejected by the validator: ${e.message}. Reply again with only the corrected JSON object.` });
    }
  }
  throw new Error(`Nemotron's rule did not pass validation twice (${lastErr.message}).`);
}

export async function draftRevision(slots, facilities, broken, opts = {}) {
  const sys = `You revise a community schedule so it satisfies more of the residents' conditions, favouring conditions with higher weight (more supporters). Do not break conditions that already hold.
Answer ONLY with JSON: {"rationale":"<two sentences>","ops":[...]} with at most 8 ops. Op forms:
 {"op":"move","slot":ID,"day":"Mon..Sun"?, "start":"HH:MM"?, "end":"HH:MM"?, "facility":NAME?}   (giving only start keeps the length)
 {"op":"set","slot":ID,"field":"noise|cost|lights|facility|audience","value":V}
 {"op":"remove","slot":ID}
Facilities: ${facilities.join(", ")}.`;
  const user = `Schedule:\n${slots.map((s) => `${s.id} | ${s.day} ${s.start}-${s.end} | ${s.facility} | ${s.activity} | audience ${s.audience} | noise ${s.noise} | $${s.cost} | lights ${s.lights}`).join("\n")}\n\nConditions (weight, status):\n${broken.map((b) => `- [w${b.weight}] ${b.ok ? "HOLDS" : "BROKEN"}: ${b.reading}${b.ok ? "" : "  Counterexamples: " + b.examples.join(" / ")}`).join("\n")}`;
  const { content, model } = await chat([{ role: "system", content: sys }, { role: "user", content: user }], opts);
  const j = extractJson(content);
  const ops = validateOps(j.ops, slots, facilities);
  return { ops, rationale: String(j.rationale || "").slice(0, 400), model };
}
