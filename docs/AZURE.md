# Azure setup: what to grab from the portal

Everything here uses free tiers. Nothing below needs a credit card beyond what your subscription already has. Work through it in order; each step says exactly what to copy and where it goes.

## 0. Check you have access (2 minutes)

1. Go to <https://portal.azure.com> and sign in with the account you used for Foundry.
2. Search **Subscriptions** in the top bar. You should see at least one subscription with status **Active**.
   - Note its name and type (for example *Azure for Students*). Student subscriptions only allow some regions; if a step fails with a region or policy error, try another region from the list it suggests.
3. If you see no subscription, you cannot create resources. Ask whoever gave you the Foundry access, or activate *Azure for Students* at <https://azure.microsoft.com/free/students> (no card needed with a university email).

## 1. Azure AI Translator (free tier F0)

Used by the Translator agent: any line that falls back to an English template is translated into the viewer's language. Free tier: 2 million characters a month, far more than a demo needs.

1. Portal top bar: search **Translator** and open **Translators**. Click **Create**.
2. Fill in:
   - Resource group: **Create new** → `nutmeg-desk-rg`
   - Region: one near you that the form accepts, e.g. `West Europe`, `Sweden Central` or `UAE North`
   - Name: anything unique, e.g. `nutmeg-translator-<yourname>`
   - Pricing tier: **Free F0**
3. **Review + create** → **Create**. Wait for "Deployment complete" → **Go to resource**.
4. Left menu: **Keys and Endpoint**. Copy:

| Portal field | Put it in `.env` as |
|---|---|
| KEY 1 | `AZURE_TRANSLATOR_KEY=` |
| Location/Region (e.g. `westeurope`) | `AZURE_TRANSLATOR_REGION=` |

Leave the endpoint alone; the app uses the global one by default.

Check it works: `npm start`, open <http://localhost:3000>, the footer should say *Translator: Azure AI Translator*. Pick **Arabic**, kick off, and look for lines tagged **Translated** in the feed.

## 1b. Azure AI Speech (free tier F0, optional)

Voice commentary with a neural voice per language. Without it the app uses the browser's built-in voice, so this is optional but sounds much better in the demo video. Free tier: 500,000 characters a month.

1. Portal top bar: search **Speech services** → **Create**.
2. Resource group: the same one as the Translator (e.g. `test_group`). Region: the same as the Translator (e.g. `Qatar Central`). Name: anything unique. Pricing tier: **Free F0**.
3. **Review + create** → **Create** → **Go to resource** → **Keys and Endpoint**. Copy:

| Portal field | Put it in `.env` as |
|---|---|
| KEY 1 | `AZURE_SPEECH_KEY=` |
| Location/Region | `AZURE_SPEECH_REGION=` |

Check it works: restart `npm start`; the startup line says *Voice: Azure AI Speech*. Turn on **Voice commentary** in the app.

## 2. Host the app on Azure Container Apps (free monthly grant)

This gives the judges a public link. Container Apps on the consumption plan has a monthly free grant (vCPU-seconds, memory and requests) that a demo stays well inside, and the app scales to zero when nobody is watching.

The image is built for free by GitHub Actions and stored in GitHub Container Registry, so no Azure Container Registry (about 5 USD a month) is needed.

**One-time on GitHub:** after CI has run once on `main`, open your GitHub profile → **Packages** → `matchday-crew` → **Package settings** → **Change visibility** → **Public**.

**Deploy from Azure Cloud Shell** (nothing to install):

1. In the portal, click the **>_** icon (top bar) → **Bash**. If asked, create the storage it suggests.
2. Run, with your own values:

```bash
git clone https://github.com/boss2236/matchday-crew && cd matchday-crew
export LLM_API_KEY=gsk_...              # Groq key (or skip and use Foundry below)
export AZURE_TRANSLATOR_KEY=...         # from step 1
export AZURE_TRANSLATOR_REGION=westeurope
export AZURE_SPEECH_KEY=...             # optional, from step 1b
export AZURE_SPEECH_REGION=westeurope
export LOCATION=westeurope              # a region your subscription allows
bash infra/deploy.sh
```

3. It prints `Live at https://nutmeg-desk.<something>.azurecontainerapps.io`. That is the **testing link** for the submission. Check `/healthz` on it.

Keys are stored as Container Apps **secrets**, never in the image or the repo.

To update after new commits: wait for CI on `main` to finish, then in the portal open the container app → **Revisions and replicas** → **Create new revision** (same image tag `latest`), or rerun `bash infra/deploy.sh`.

To stop all cost later: delete the resource group `nutmeg-desk-rg` (portal → Resource groups → Delete).

## 3. Optional: Microsoft Foundry model

Only if a pay-per-token chat model becomes available (your account showed none). Do **not** use *Managed compute* / GPU deployments: they bill every hour even when idle.

1. <https://ai.azure.com> → your project → **Models + endpoints** → **Deploy model** → **Deploy base model**.
2. Pick `gpt-4o-mini` (or another chat model) with deployment type **Global Standard** or **Standard**. If neither appears, this account cannot do it; skip this step.
3. After it deploys, copy:

| Foundry field | `.env` |
|---|---|
| Endpoint target URI, up to `.com` (e.g. `https://x-resource.services.ai.azure.com`) | `FOUNDRY_ENDPOINT=` |
| Deployment name (Name column) | `FOUNDRY_DEPLOYMENT=` |
| Key | `FOUNDRY_API_KEY=` |

Foundry takes priority over `LLM_*` when all three are set. The request format is covered by tests against a mock of the Azure OpenAI API (`test/providers.test.js`), so it should work first time. If you get a `404 DeploymentNotFound`, the deployment name is wrong; `401` means the key is wrong.

## 4. Optional: deploy from GitHub Actions instead of Cloud Shell

`.github/workflows/deploy-azure.yml` runs `infra/deploy.sh` from GitHub. It needs a Microsoft Entra app registration with a federated credential for this repo, which is more setup than Cloud Shell. Only worth it if you will redeploy often. Steps: <https://learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect>. Secrets and variables it reads are listed at the top of the workflow file.

## Summary: what goes where

| Value | From | Used as |
|---|---|---|
| Translator KEY 1 | Translator resource → Keys and Endpoint | `AZURE_TRANSLATOR_KEY` |
| Translator region | same page | `AZURE_TRANSLATOR_REGION` |
| Speech KEY 1 and region (optional) | Speech resource → Keys and Endpoint | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Container app URL | output of `infra/deploy.sh` | Submission testing link |
| Foundry endpoint, deployment, key (optional) | ai.azure.com → Models + endpoints | `FOUNDRY_*` |
