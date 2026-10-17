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

| Agent crew | `src/agents/crew.js` | Analyst (picks moments), Tactician (explains why, on Microsoft Foundry), Narrator (rewrites per audience: persona, language, favourite club or player), Producer (timed overlay JSON), Recap (full-time story). |
| Grounding check | `src/agents/evidence.js` | Every number, player name and cited event in AI output must come from the moment's evidence pack. Failures get one retry with feedback, then a deterministic template. |
| Foundry client | `src/ai/llm.js` | Plain `fetch` client for a Foundry model deployment. |

## Run

```bash
npm test                    # 12 tests, no dependencies
node scripts/generate.js 4  # write 4 matches to data/
```

### With Microsoft Foundry

```bash
cp .env.example .env        # then fill in endpoint, deployment name and key
npm run crew                # replay a match through the agent crew
```

Without a `.env` the crew runs on templates, so everything works offline.

Needs Node 20.12 or newer.

## Coming next

A live second-screen web app with persona, club, player and language modes, and deployment on Azure.
