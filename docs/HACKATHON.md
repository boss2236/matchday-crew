# Hackathon readiness report

Microsoft x Premier League **Inside the Game** developer hackathon. Source: [official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).

Last updated 2026-10-19 (second pass: web app, Azure Translator, Container Apps deploy, MCP server, CI).

## Key dates

| What | When |
|---|---|
| Registration closes | Oct 20, 2026, 12:00 PM Pacific (done) |
| **Submission deadline** | **Oct 27, 2026, 11:59 PM Pacific** |
| Judging | Oct 27 to Nov 10, 2026 |

Eligibility: age of majority where you live, teams of up to 4.

## Model provider tests

Full match replay (seed 7, Harbour City 4-1 Ironvale Athletic), analyst in English and casual fan in Arabic.

| | Groq, `openai/gpt-oss-120b` | Gemini, `gemini-flash-latest` |
|---|---|---|
| Result | Full match completed | Stopped at minute 39 |
| Lines written by the model | 51 of 54 | 11 before the quota ran out |
| Latency per call | about 0.3 s | about 6 s |
| Free tier limit | 8,000 tokens per minute (client waits and retries) | 20 requests per day; a match needs about 95 |
| Verdict | Use for development and demos | Backup only |

Microsoft Foundry: the account has no pay-per-token chat models. GPU managed-compute deployments of gpt-oss failed with internal errors and bill hourly whether used or not, so they were deleted. The client still supports Foundry through `FOUNDRY_*` in `.env`.

Other findings:

- **Grounding check works.** About 25 model lines cited numbers or event IDs not in the evidence (for example citing a moment ID instead of event IDs). Each was retried with feedback or replaced by a template; nothing ungrounded aired.
- **Reasoning models need headroom.** Without `LLM_REASONING_EFFORT=low` and `LLM_MAX_TOKENS=1500`, gpt-oss spends the whole token budget thinking and returns empty JSON.
- **Recap is too large for Groq's free tier** (413, request too large), so the full-time recap fell back to a template. Fix: send a smaller recap evidence pack.
- GitHub Models was retired in July 2026, so it is not an option.
- Running a model locally (Ollama) is too heavy for the dev laptop.

Sample output for the same goal (29:03):

- Analyst: "Silvan's interception sparked a 7-pass build-up (pass difficulties 47, 45, 53) ending with Mbeki's 96.1 km/h shot (xG 0.188) for Ironvale's 0-1 lead at 30'."
- Casual (Arabic): "ماركو سيلفان قطع الكرة ثم مررها لزيك مبيكي، الذي سدد تسديدة 96.1 كم/س وسجل هدف 0‑1 في الدقيقة 30. يا له من هجمة خاطفة!"

### Final demo cache (after the fixes)

The demo match (seed 7) was generated on Groq for English and Arabic and stored in `data/llm-cache/`. Replayed with **no API key**:

| Language | Lines written by the model |
|---|---|
| English | 54 of 54 (53 Narrator, 1 Tactician fallback) |
| Arabic | 54 of 54 |

Fixes from this pass: recap prompt cut by about 70% (no more 413), dropped connections retried with backoff, fact checker accepts signed numbers written by size (momentum -27 as 27), event ids tidied out of on-screen text.

Other settings (favourite club, player, metric, other languages, other matches) are generated live when a model key is set and cached from then on; without a key they fall back to the Tactician's AI line or a template.

Known limitation: the fact checker verifies numbers, names and cited events, not units. One cached line says "8.7 km carry" where the evidence is 8.7 m.

## Challenge requirements (rules 4.1)

| Requirement | Status |
|---|---|
| Ingest synthetic events as they happen | Done: simulator and event-by-event crew |
| Interpret into stats and patterns (xG, pass difficulty, ball and shot speed, PPDA, momentum, chaos) | Done |
| Explain why a moment matters | Done: Tactician agent |
| Render on screen alongside the match | Done: second-screen web app draws each timed overlay over a live pitch |
| Personalize: analyst vs casual, language, favourite club, favourite player, a single metric the viewer cares about | Done: persona toggle, 16 languages, favourite club, player-focus card and coverage, follow-a-metric mode with live tracker |
| Narratives and recaps | Done |
| Create or extend a synthetic dataset | Done: `data/`, `scripts/generate.ts` |
| Multi-language output | Done |
| Auto-eventing from video | Not planned (optional) |

## Submission requirements (rules 4.4 and 4.8)

| Item | Status |
|---|---|
| Public GitHub repo, created after the hackathon started | Done |
| Short pitch: what it is, which Microsoft and Azure tech, what problem it solves | **To do** |
| Demo video under 2 minutes, public on YouTube or Vimeo, no third-party music or trademarks | **To do** |
| Link for judges to test the project, free and unrestricted until Nov 10 | **Ready to deploy**: `infra/deploy.sh` to Azure Container Apps, see docs/AZURE.md |
| All materials in English | Done |

## Judging

Stage one is pass/fail: does the project fit the theme and reasonably apply the required technologies. Stage two scores five criteria at 20% each: technological implementation, agentic design and innovation, real-world impact, user experience and presentation, and adherence to the category.

Best category fit: **Best Multi-Agent System** (distinct agents, shared state, handoffs, recovery from failures, which the crew already has). Grand Prize once the front end and Azure parts are in. **Best Use of Microsoft Foundry** only with a working Foundry model.

## Microsoft technology used

| Technology | How | Status |
|---|---|---|
| TypeScript | Whole codebase in strict mode; Node runs it directly, tsc checks it in CI | Done |
| Fluent UI React v9 | Second-screen app built on Microsoft's design system, light and dark | Done |
| Azure AI Speech | Voice commentary, neural voice per language | Built and contract-tested; needs a free F0 key (browser voice until then) |
| Agent2Agent (A2A) | Agent card and JSON-RPC endpoint for other agents | Built and tested |
| Azure AI Translator | Translator agent localises fallback lines into the viewer's language | Live: free F0 resource in Qatar Central, tested end to end (38 of 40 lines translated in a Spanish match, about 2,000 characters) |
| Azure Container Apps | Hosting with scale to zero, keys as secrets, health probes | Deploy script and workflow ready; needs a subscription |
| Microsoft Foundry | Model provider, used first when configured | Built and contract-tested against a mock Azure OpenAI API; account has no pay-per-token model |
| GitHub Actions | Strict type-check, tests on Node 22 and 24, web build, container build and smoke test, headless UI check, image publish | Runs on every push |
| GitHub Container Registry | Free image hosting for the deploy | Runs on push to main |
| MCP | Match tools for GitHub Copilot agent mode and other MCP clients | Built and tested |
| GitHub Copilot | Mention in the pitch if used while building | Up to you |

## Risks and open work, by priority

1. **Deploy to Azure Container Apps** for the judges' link (docs/AZURE.md, step 2). The Translator is already live.
2. **Optional: Azure Speech key** (docs/AZURE.md, step 1b) for neural voices in the video.
3. **Finish pre-generation** with `npm run prewarm` over the next day or two: Groq's free tier allows about 200,000 tokens a day per model, and a full match and language uses about 110,000. Then `npm run quality` and commit `data/llm-cache` and `docs/QUALITY.md`.
4. **Pitch and video** (under 2 minutes). Suggested flow: first-visit tour prompt, kick off, switch Analyst/Casual on the same goal, switch to Arabic with voice on, open Behind the broadcast to show a rejected line, show Studio mode over a pitch video, end on the recap.
5. **Rotate the test API keys** after testing. Keys live only in `.env`, which git ignores.
6. Optional: a Foundry chat model if any account allows one.
