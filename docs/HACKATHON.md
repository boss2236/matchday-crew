# Hackathon readiness report

Microsoft x Premier League **Inside the Game** developer hackathon. Source: [official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).

Last updated 2026-10-23 (fourth pass: live on Azure Container Apps with a Microsoft Foundry model, Translator, Speech, Content Safety and Application Insights; full review against the rules). Earlier: Players and 3D views, GitHub Copilot SDK pre-generation in all 16 languages, independent review, testing guide, web app, MCP server, CI.

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

Microsoft Foundry: the hosted app runs on a **gpt-4.1-mini** Global Standard deployment in Switzerland North, created by `infra/deploy.sh` (`FOUNDRY_MODEL=gpt-4.1-mini`). The first look, in Qatar Central, found no pay-per-token chat models; GPU managed-compute deployments of gpt-oss failed with internal errors and bill hourly whether used or not, so they were deleted. The subscription does have Global Standard quota in Switzerland North and Germany West Central.

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

Since fixed: the fact checker now checks units too (km and yards written for metres are rejected), and the line was regenerated. Current numbers for every match and language: [QUALITY.md](QUALITY.md); a second model's review: [REVIEW.md](REVIEW.md).

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
| Short pitch: what it is, which Microsoft and Azure tech, what problem it solves | Done: project page on the Hackathon Website (category, pitch, tech, testing instructions) |
| Demo video under 2 minutes, public on YouTube or Vimeo, no third-party music or trademarks | Ready: `V7-players-and-3d.mp4`, 1:58.6. Narration is an Azure AI Speech neural voice, the music was generated for the video. **To do: upload to YouTube, add the link to the project page** |
| Link for judges to test the project, free and unrestricted until Nov 10 | Done: on the project page only (not in the repo), no login, one replica kept warm until judging ends |
| All materials in English | Done |

## Judging

Stage one is pass/fail: does the project fit the theme and reasonably apply the required technologies. Stage two scores five criteria at 20% each: technological implementation, agentic design and innovation, real-world impact, user experience and presentation, and adherence to the category.

Best category fit: **Best Multi-Agent System** (distinct agents, shared state, handoffs, recovery from failures, which the crew already has). Grand Prize once the front end and Azure parts are in. **Best Use of Microsoft Foundry** only with a working Foundry model.

## Microsoft technology used

| Technology | How | Status |
|---|---|---|
| TypeScript | Whole codebase in strict mode; Node runs it directly, tsc checks it in CI | Done |
| Fluent UI React v9 | Second-screen app built on Microsoft's design system, light and dark | Done |
| Azure AI Speech | Voice commentary, neural voice per language, browser voice as fallback | Live on the hosted app (free F0 resource in Qatar Central) |
| Agent2Agent (A2A) | Agent card and JSON-RPC endpoint for other agents | Built and tested |
| Azure AI Content Safety | Safety agent screens every model-written line before it airs | Live on the hosted app (free F0, created by the deploy script) |
| Azure Application Insights | Requests, model and Azure AI calls, match sessions, errors | Live on the hosted app (created by the deploy script) |
| Azure AI Translator | Translator agent localises fallback lines and English headlines into the viewer's language | Live on the hosted app (free F0 resource in Qatar Central) |
| Azure Container Apps | Hosting with scale to zero, keys as secrets, health probes | Live in Switzerland North; the deploy script creates and wires every Azure AI resource |
| Microsoft Foundry | Model provider, used first when configured | Live: the hosted app's model is gpt-4.1-mini (Global Standard) |
| GitHub Actions | Strict type-check, tests on Node 22 and 24, web build, container build and smoke test, headless UI check, image publish | Runs on every push |
| GitHub Container Registry | Free image hosting for the deploy | Runs on push to main |
| MCP | Match tools for GitHub Copilot agent mode and other MCP clients | Built and tested |
| GitHub Copilot SDK | Model provider for pre-generation: every shipped line in all 16 languages (Claude Sonnet 5.5 and Opus 5.5), and the independent review (GPT-6.1) | Used; see QUALITY.md and REVIEW.md |

## Open work

1. **Upload V7 to YouTube** (public or unlisted, with the thumbnail and description in the Pitch folder) and add the link to the project page under Images/Video.
2. **During judging (Oct 27 to Nov 10):** leave the app as it is. One replica stays warm; the Foundry deployment is capped at 50,000 tokens a minute.
3. **After Nov 10:** `az containerapp update -n nutmeg-desk -g nutmeg-desk-ch --min-replicas 0`, rotate the Translator, Speech and Groq keys, or delete the resource group.
