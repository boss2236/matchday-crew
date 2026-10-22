# How Nutmeg Desk is tested

Six layers, from a single function to a second AI model reading what the crew airs. Everything runs on synthetic data, and everything except the last layer needs no API key.

| Layer | What it proves | Run it | Where |
|---|---|---|---|
| 1. Type-check | Server, scripts, tests and the web app type-check in strict mode | `npm run typecheck` | CI, every push |
| 2. Unit and contract tests | The simulator, stats, crew and fact checker, model providers, Azure AI services, server, MCP, A2A and the players simulation behave as specified | `npm test` | CI on Node 22 and 24 |
| 3. Container smoke test | The production image starts, serves the app and streams a whole match in Arabic from the cache | CI only (`docker build`, `curl`) | CI |
| 4. Headless UI check | The app loads, kicks off and plays with **no console errors**, on the tactics board, the Players view and the 3D view, with screenshots | `npm run ui-check -- <url> <prefix> <seconds>` | CI, uploaded as artifacts |
| 5. Quality report | How many lines the model writes, how often it passes the fact check first time, why lines are rejected, and a **tamper test** | `npm run quality` | [QUALITY.md](QUALITY.md) |
| 6. Independent review | A model from a different family re-checks aired lines against their evidence, for what code cannot judge | `node scripts/review.ts 150` | [REVIEW.md](REVIEW.md) |

## 2. Unit and contract tests (`test/`, 65 tests)

| File | Tests | Covers |
|---|---|---|
| `engine.test.ts` | 7 | Same seed, same match; events in time order and on the pitch; both halves and a score that matches the goals; season-level stats that look like real football; xG and pass-difficulty curves |
| `matchState.test.ts` | 5 | Replayed score matches the simulator; possession adds up; every goal becomes a moment with evidence that exists; momentum and chaos stay in range; each event triggers only its own moments |
| `crew.test.ts` | 17 | The crew with no model, a grounded model, an inventing model (rejected, retried, replaced) and a failing one; every aired item cites real events; the fact checker on numbers in other scripts and decimal styles, signed numbers, precision, numbers with units, and **km or yards written for metres**; provider config, retries and backoff |
| `providers.test.ts` | 10 | Microsoft Foundry end to end and with a wrong key, OpenAI-compatible requests, the **GitHub Copilot SDK** (one session per call, every tool request rejected), the response cache (replay, provider-independent keys, refresh mode, unwritable folder), Azure AI Translator and the Translator agent |
| `app.test.ts` | 12 | The live session (order, pacing, stop, `from=`), favourite player and followed-metric coverage, recap prompt size, query validation, the HTTP server and SSE stream, session limits, the MCP server |
| `platform.test.ts` | 9 | Azure AI Speech (SSML, voices, request shape), Azure AI Content Safety and the Safety agent, Application Insights telemetry, rate limits, security headers, the A2A agent card and JSON-RPC endpoint |
| `players.test.ts` | 5 | The Players and 3D views' simulation, over whole simulated matches: everyone stays on the pitch, teams line up in their own half and swap ends, a pass reaches its receiver, a goal bulges the right net and teammates mob the scorer, keepers dive for saves |

Contract tests run against local fakes, so they need no key and no network.

## 4. Headless UI check

`scripts/ui-check.ts` drives Chrome over the DevTools protocol (no npm dependencies), lets a match play at 60×, and fails on any page error. CI runs it three times against the production container: `?view=` default, `players` and `3d`. Where WebGL is unavailable, the 3D view shows a notice instead of failing.

## 5. Quality report and tamper test

`scripts/quality.ts` replays every published match in all 16 languages from the response cache, as a visitor with no key would see it, and reads the traces of the real model runs. The tamper test takes lines the model wrote and corrupts them the ways models fail (shifted numbers, km for metres, invented players, fake citations) to measure how many the fact checker catches. Results: [QUALITY.md](QUALITY.md).

## 6. Independent review

The fact checker is code: it checks every number, name and cited event, and rejects lines before they air. It cannot tell whether the *words* claim more than the data shows. So a model from a different family than the writer reads a sample of aired lines next to the exact evidence each writer had, and lists anything unsupported. Results, including every flagged line: [REVIEW.md](REVIEW.md).

The first review found that some lines gave distances in **yards** while the data is in metres. That is now a fact-checker rule, with tests, and the affected lines were rewritten.

## Before a release

```bash
npm run check                               # type-check + 65 tests
npm run build && npm start                  # then, in another terminal:
npm run ui-check -- "http://localhost:3000/?autostart=1&speed=60&view=3d" out/ui-3d 20
npm run quality                             # refreshes docs/QUALITY.md
```
