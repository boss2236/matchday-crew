# Matchday Crew

A multi-agent AI broadcast crew for synthetic football matches, built for the Microsoft x Premier League **Inside the Game** developer hackathon.

> All data is synthetic. The clubs, players and matches are made up. No real league data, footage or branding is used.

## What's here so far

| Part | Path | What it does |
|---|---|---|
| Match simulator | `src/engine/simulate.js` | Seeded, reproducible matches between fictional clubs with style profiles (high press, deep block, possession, wing play). Emits timestamped passes, carries, pressure, tackles, interceptions, shots, saves, goals and possession changes with pitch coordinates. |
| Clubs | `src/engine/teams.js` | Four fictional clubs and squads in a 4-3-3. |
| Live stats engine | `src/stats/matchState.js` | Consumes events one by one. Tracks possession, xG, pass accuracy and difficulty, progressive passes, PPDA, ball and shot speed, player stats, **momentum** (-100..100) and **chaos** (0..100). Detects key moments (goal, big chance, great pass, sprint, pressing spell, momentum swing), each with the event IDs that prove it. |
| Dataset generator | `scripts/generate.js` | Writes matches with summary and moments to `data/`. |

Simulator output over many seeds averages about 3 goals, 25 shots and 83% pass accuracy per match. Tests check this.

| Agent crew | `src/agents/crew.js` | Analyst (picks moments), Tactician (explains why), Narrator (rewrites per audience: persona, language, favourite club or player), Producer (timed overlay JSON), Recap (full-time story). |
| Grounding check | `src/agents/evidence.js` | Every number, player name and cited event in AI output must come from the moment's evidence pack. Failures get one retry with feedback, then a deterministic template. |
| Model client | `src/ai/llm.js` | Plain `fetch` client. Talks to a Microsoft Foundry deployment or any OpenAI-compatible API (Groq, Gemini, Ollama), chosen in `.env`. Waits and retries on rate limits. |

## Run

```bash
npm test                    # 20 tests, no dependencies
node scripts/generate.js 4  # write 4 matches to data/
```

### With a model

```bash
cp .env.example .env        # pick ONE provider and fill in its key
npm run crew                # replay a match through the agent crew
CREW_LANGUAGES=English,Arabic npm run crew   # analyst in English, casual fan in Arabic
```

Providers (see `.env.example` for every setting):

| Provider | Set in `.env` | Notes |
|---|---|---|
| Microsoft Foundry | `FOUNDRY_ENDPOINT`, `FOUNDRY_DEPLOYMENT`, `FOUNDRY_API_KEY` | Azure OpenAI compatible deployment, e.g. gpt-4o-mini. Used first when set. |
| Groq (free tier) | `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Tested: 51 of 54 lines model-written on a full match. |
| Google Gemini (free tier) | same `LLM_*` vars | Works, but the free tier allows only 20 requests a day; a match needs about 95. |

Reasoning models (gpt-oss, Gemini) need `LLM_REASONING_EFFORT=low` and `LLM_MAX_TOKENS=1500`, otherwise they spend the whole budget thinking and return empty JSON.

Without any model config the crew runs on templates, so everything works offline.

Hackathon requirements, test results and open work: [docs/HACKATHON.md](docs/HACKATHON.md).

Needs Node 20.12 or newer.

## Coming next

A live second-screen web app with persona, club, player and language modes, and deployment on Azure.
