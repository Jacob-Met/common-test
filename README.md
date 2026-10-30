# Common Test

Neighbours object to a community plan in plain words. **Common Test** turns each objection into a rule the computer can run, shows the exact events that break it, and finds the revision that satisfies the most people.

Built for the Nebius x NVIDIA hackathon, common test: *turn participant-authored objections into inspectable conditions, explore concrete counterexamples, and revise proposals around the concerns that matter.*

The sample proposal is a fictional weekly schedule for "Maple Park" (18 events, five facilities). The same engine would work for any list of time slots with a cost, such as a shared budget or a hall booking.

## Quick start

Needs Node 22 or newer. No npm install: there are no runtime dependencies.

```sh
export NEBIUS_API_KEY=...        # Nebius Token Factory key; the server reads it, the browser never sees it
node server.mjs                  # http://localhost:4422
node --test test/                # 22 tests, no network needed
```

Open http://localhost:4422. Without a key the app still opens: the seed objections ship with hand-written rules, the engine repair works, and typing a new objection saves it with a message that it needs the key to compile.

Optional env: `PORT` (default 4422), `NEMOTRON_MODEL` (default `nvidia/nemotron-3-super-120b-a12b`), `NEBIUS_BASE_URL`, `DATA_FILE` (default `data/state.json`).

## How to use it

1. Pick a revision along the top (start with "Original draft"). The week grid shows every event; striped blocks break at least one condition.
2. Type an objection in the box on the left, in your own words, and press Compile. A moment later it appears in the list with the rule Nemotron wrote, a plain-English reading of that rule, and its raw JSON.
3. Click any objection to see **counterexamples**: the concrete events (or pairs of events, or day totals) that break it. Click one to highlight those blocks on the grid.
4. Others can add their support; each extra supporter raises the condition's weight.
5. Press **Ask Nemotron to revise** or **Engine repair** to create a new revision. The table at the bottom scores every revision against every condition and marks the one that satisfies the most weight.

## How it uses NVIDIA Nemotron on Nebius Token Factory

Every model call is a server-side `POST https://api.tokenfactory.nebius.com/v1/chat/completions` from `nemotron.mjs` with `NEBIUS_API_KEY`. Default model: **`nvidia/nemotron-3-super-120b-a12b`**.

Why that model: compiling a sentence into a rule is a small structured task, but it needs reliable reading of times, days, "loud" and "kids" and a valid JSON answer; the 120B-total/12B-active Super model does that quickly enough for an interactive form. `NEMOTRON_MODEL` switches to another Nemotron on Token Factory.

Two uses:

1. **Objection to condition.** The prompt describes the rule DSL and the schedule fields (`day`, `dayType`, `start`, `end`, `noise`, `cost`, `lights`, `audience`, `facility`, ...). Nemotron returns `{rule, restatement}`. Rule kinds: `forbid`, `require`, `limit` (count / sum / max, optionally per day or facility) and `no_overlap`.
2. **Proposal revision.** Nemotron gets the schedule plus every condition's weight and its current counterexamples, and returns a short list of edits (move, set, remove).

**The model proposes; the engine decides.** Nothing the model says is trusted:

- Each rule goes through `validateRule` in `engine.mjs` (known fields, known operators, valid times, right value types). If it is rejected, the validator's message is sent back to Nemotron once for a correction; after a second rejection the app shows the failure and keeps the objection uncompiled.
- Evaluation of rules is plain deterministic code, so the counterexamples are real events from the schedule, not model text.
- Revision edits go through `validateOps` (real slot ids, real facilities, editable fields only), are applied by the engine, and the new revision is **re-scored by the engine** against all conditions. Nemotron's own claim of improvement is shown as a note, never as the score.
- Every compiled rule is displayed in plain English and as JSON next to the objection, and can be recompiled.

`engine.mjs` also has a deterministic greedy repair search (the "Engine repair" button) as an offline baseline to compare Nemotron's revisions against.

## Files

- `engine.mjs` rule DSL, validator, evaluator with counterexamples, plain-English reader, revision ops, repair search
- `nemotron.mjs` Token Factory client, prompts, compile and revise calls
- `seed.mjs` the Maple Park proposal, three authored revisions, six objections with hand-written rules
- `server.mjs` HTTP server and JSON API (`/api/state`, `/api/objections`, `/api/revise`, ...)
- `public/index.html` the UI (no framework, no external assets)
- `test/` engine, adapter (mocked fetch, no network) and server tests

## Limits

- The seed proposal and neighbours are invented. Noise is a 0-3 rating on each event, not a measurement.
- The DSL is deliberately small. An objection it cannot express (for example about parking or smell) will fail to compile rather than be guessed at.
- Nemotron can pick a wrong but valid reading ("loud" as noise 2 instead of 3). The validator catches malformed rules, not misreadings; that is why the plain-English reading and the counterexamples are shown, so people can see the rule did what they meant and recompile if not.
- Revisions are scored by weighted count of satisfied conditions. Supporters are typed names, not verified identities. This is a deliberation aid, not a voting system.
- State is one JSON file on the server; no accounts.

## License

MIT, see `LICENSE`.
