# Hackathon readiness report

Microsoft x Premier League **Inside the Game** developer hackathon. Source: [official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).

Last updated 2026-10-19.

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

## Challenge requirements (rules 4.1)

| Requirement | Status |
|---|---|
| Ingest synthetic events as they happen | Done: simulator and event-by-event crew |
| Interpret into stats and patterns (xG, pass difficulty, ball and shot speed, PPDA, momentum, chaos) | Done |
| Explain why a moment matters | Done: Tactician agent |
| Render on screen alongside the match | **Partial: timed overlay JSON exists, no visual front end yet** |
| Personalize: analyst vs casual, language, favourite club | Done. Favourite player / player-focus mode not built |
| Narratives and recaps | Done |
| Create or extend a synthetic dataset | Done: `data/`, `scripts/generate.js` |
| Multi-language output | Done |
| Auto-eventing from video | Not planned (optional) |

## Submission requirements (rules 4.4 and 4.8)

| Item | Status |
|---|---|
| Public GitHub repo, created after the hackathon started | Done |
| Short pitch: what it is, which Microsoft and Azure tech, what problem it solves | **To do** |
| Demo video under 2 minutes, public on YouTube or Vimeo, no third-party music or trademarks | **To do** |
| Link for judges to test the project, free and unrestricted until Nov 10 | **To do** |
| All materials in English | Done |

## Judging

Stage one is pass/fail: does the project fit the theme and reasonably apply the required technologies. Stage two scores five criteria at 20% each: technological implementation, agentic design and innovation, real-world impact, user experience and presentation, and adherence to the category.

Best category fit: **Best Multi-Agent System** (distinct agents, shared state, handoffs, recovery from failures, which the crew already has). Grand Prize once the front end and Azure parts are in. **Best Use of Microsoft Foundry** only with a working Foundry model.

## Risks and open work, by priority

1. **No Microsoft service is used at runtime yet.** Stage one could fail on this. Low-cost options:
   - Azure AI Translator (free tier) for multi-language output.
   - Azure Static Web Apps or Container Apps (free tiers) to host the demo, which also gives judges a test link.
   - GitHub Actions to run the tests on every push; mention GitHub Copilot if used.
   - A Foundry pay-per-token chat model such as gpt-4o-mini if any account allows it (cents per match, unlike GPU deployments).
2. **No visual front end.** UX is 20% of the score and Render is one of the five required stages. Needed: match view with overlays, analyst/casual toggle, language picker, favourite club and player.
3. **Recap size** on free tiers (see above).
4. **Pitch and video**, once the front end exists.
5. **Rotate the test API keys** after testing. Keys live only in `.env`, which git ignores.

## Suggested schedule

| Days | Work |
|---|---|
| 1-2 | Front end, recap size fix |
| 3-4 | Azure hosting, Translator, Foundry model if possible, GitHub Actions |
| 5 | README, pitch, record video |
| 6-8 | Buffer, submit early |
