# Nutmeg Desk: plan to submission

Hackathon: Microsoft x Premier League **Inside the Game**. Category to enter: **Best Multi-Agent Orchestration** (plus Grand Prize consideration).

## Deadlines

| When | What |
|---|---|
| **Oct 20, 12:00 PM Pacific** (10:00 PM Qatar) | Registration closes. Every teammate must have their own registration before this |
| **Oct 27, 11:59 PM Pacific** | Submissions close |
| Nov 20 | Winners announced |

## Team

- Teams of up to 4. Each member registers on the hackathon site; the representative creates the project and adds the others as project members.
- If the site will not add someone, contact "Email Help & Support" under *Learn more* before the deadline.
- Prizes are split equally between members.

## Decisions already made

- **Name: Nutmeg Desk.** "Matchday Crew" collided with another entry (same name and a similar idea), and the "Touchline" names are taken four times. Nutmeg Desk had no football matches on GitHub or on the hackathon's project list. The GitHub repository is still called `matchday-crew`; renaming it is listed below.
- **Synthetic data only.** The crew reads an event feed from our simulator; it does not watch video. We do not overlay it on real match footage (rules and copyright). The broadcast view draws the synthetic match itself.
- **Demo recording:** screen capture with voice-over; OBS window capture of the app or broadcast view. The OBS browser source (Flatpak) crashed on this laptop's AMD graphics and was removed.
- **Model:** Groq free tier (gpt-oss-120b, gpt-oss-20b) because this Azure account offers no pay-per-token chat models. Microsoft Foundry is supported by configuration. Groq allows about 200,000 tokens a day per model; a full match in one language uses about 110,000.

## To do before submitting

### Must

1. **Merge to `main`** so judges see the current code (done with this commit).
2. **Deploy to Azure Container Apps** (docs/AZURE.md, step 2) for the judges' link. Recommended: response cache plus Translator plus Speech, without a model key, so nobody can use up quota. Delete the resource group after Nov 20.
3. **Pitch** (to be drafted): what it is, the Microsoft technologies, the problem it solves.
4. **Demo video under 2 minutes**: screen recording with narration, uploaded to YouTube as Unlisted. No Premier League logos (including the hackathon banner), no copyrighted music. Shot list to be written: tour prompt, kick off, analyst vs casual on the same goal, Arabic with Azure voice, a line rejected by the fact checker in *Behind the broadcast*, player and metric focus, broadcast view, recap.
5. **Create the project** on the hackathon site, link the challenge, choose the category, add teammates, paste pitch, video, GitHub and Azure links.
6. **Rotate the test API keys** (Groq, Gemini, Translator, Speech) after judging.

### Should

7. **Azure AI Content Safety agent** (free F0): a Safety agent that checks every line before it airs. Needs a Content Safety resource (portal → Content Safety → Free F0 → Keys and Endpoint).
8. **Azure Application Insights** (free tier): request, model-call and error telemetry on the hosted app, for production readiness.
9. **Finish pre-generation**: `npm run prewarm` once a day until all four matches have model lines in English, Arabic and Spanish (seeds 9 and 10 still to do), then `npm run quality` and commit `data/llm-cache` and `docs/QUALITY.md`.
10. **Rename the GitHub repository** to `nutmeg-desk` and update the links in README, docs/AZURE.md and infra/deploy.sh (the container image path follows the repository name).

### Could

11. **A Microsoft-hosted model** (Foundry or Azure OpenAI, e.g. gpt-4o-mini, Standard deployment) if any account or region allows it. Only a `.env` change; it strengthens the Grand Prize and Foundry stories.
12. **Players on the pitch**: show the players involved in recent events, not only the ball.
13. **Tighter number checks**: tie whole numbers to the fields they describe (the tamper test catches 74% of shifted whole numbers today; see docs/QUALITY.md).

## Already done

Five-stage pipeline, seven agents with a fact checker, response cache with pre-generated lines, Azure AI Translator and Azure AI Speech (tested live), Fluent UI app with tour, voice, player and metric focus and broadcast view, strict TypeScript, 52 tests, CI, Docker, Container Apps deploy script, MCP and A2A, rate limits and security headers, quality report. See README.md and docs/HACKATHON.md.
