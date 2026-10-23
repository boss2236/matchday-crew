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

## 1c. Azure AI Content Safety (free tier F0, optional)

The Safety agent screens every line the model writes before it airs. Free tier: 5,000 text records a month; replays are screened once per server run.

1. Portal top bar: search **Content Safety** → **Create**.
2. Same resource group and region as the Translator. Pricing tier: **Free F0**.
3. **Go to resource** → **Keys and Endpoint**. Copy:

| Portal field | `.env` |
|---|---|
| Endpoint (e.g. `https://my-safety.cognitiveservices.azure.com/`) | `AZURE_CONTENT_SAFETY_ENDPOINT=` |
| KEY 1 | `AZURE_CONTENT_SAFETY_KEY=` |

Restart `npm start`; the startup line says *Safety: Azure AI Content Safety*, and *Behind the broadcast* shows a **Safety** agent passing each line.

## 1d. Azure Application Insights (free tier, optional)

Monitoring for the hosted app: requests, every model, Translator, Speech and Content Safety call with its duration, a summary event per match, and errors. Free tier: 5 GB of data a month.

1. Portal top bar: search **Application Insights** → **Create**.
2. Same resource group and region. Leave *Workspace-based* and the suggested Log Analytics workspace.
3. **Go to resource** → **Overview** → copy **Connection String** (top right) into `.env` as `APPLICATIONINSIGHTS_CONNECTION_STRING=` (the whole string, it contains semicolons; no quotes needed).

Restart `npm start`; the startup line says *Telemetry: Application Insights*. Data shows up under **Live metrics**, **Transaction search** and **Application map** within a couple of minutes.

## 2. Host the app on Azure Container Apps (free monthly grant)

This gives the judges a public link. Container Apps on the consumption plan has a monthly free grant (vCPU-seconds, memory and requests) that a demo stays well inside. The image is built for free by GitHub Actions and stored in GitHub Container Registry, so no Azure Container Registry (about 5 USD a month) is needed.

**One-time on GitHub:** after CI has run once on `main`, open your GitHub profile → **Packages** → `nutmeg-desk` → **Package settings** → **Change visibility** → **Public**.

**Deploy from Azure Cloud Shell** (nothing to install):

1. In the portal, click the **>_** icon (top bar). If it opens in PowerShell, click **Switch to Bash**.
2. Pick a region your subscription allows and that has Container Apps:

```bash
az policy assignment list --query "[].parameters.listOfAllowedLocations.value[]" -o tsv   # student subscriptions allow a short list
az provider show -n Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations" -o tsv
```

3. Deploy. The script can create and connect every Azure AI service itself, so no key is copied by hand:

```bash
git clone https://github.com/boss2236/nutmeg-desk && cd nutmeg-desk
RG=nutmeg-desk-ch LOCATION=switzerlandnorth \
FOUNDRY_MODEL=gpt-4.1-mini \
TRANSLATOR_RESOURCE=<your Translator> TRANSLATOR_RG=<its resource group> \
SPEECH_RESOURCE=<your Speech resource> SPEECH_RG=<its resource group> \
CONTENT_SAFETY=1 APP_INSIGHTS=1 MIN_REPLICAS=1 \
bash infra/deploy.sh
```

| Setting | What the script does |
|---|---|
| `FOUNDRY_MODEL=gpt-4.1-mini` | Creates a Microsoft Foundry (Azure AI Services) resource and a Global Standard deployment of the model. `FOUNDRY_CAPACITY` caps it, in thousands of tokens a minute (default 50) |
| `TRANSLATOR_RESOURCE`, `SPEECH_RESOURCE` | Reads the key and region of the resources from steps 1 and 1b |
| `CONTENT_SAFETY=1` | Creates Azure AI Content Safety on the free F0 tier (`CONTENT_SAFETY_SKU=S0` if the subscription already has a free one) |
| `APP_INSIGHTS=1` | Creates Application Insights on the environment's Log Analytics workspace |
| `MIN_REPLICAS=1` | Keeps one copy running, so nobody waits for a cold start (a few dollars a month). The default, 0, scales to zero |
| `MAX_LIVE_SESSIONS` | Live matches at once, default 30. In a load test, 24 at once used about 3% of a CPU core and 150 MB |

Keys go straight from Azure into Container Apps **secrets**: never printed, never in the image or the repo. You can also pass keys yourself, for example a Groq `LLM_API_KEY` from your `.env` (`set -a; source .env; set +a` first).

4. It prints `Live at https://nutmeg-desk.<something>.azurecontainerapps.io`. That is the **testing link** for the submission; `/healthz` shows which services are on.

**If it fails.** All of these happened on an Azure for Students subscription:

| Message | Fix |
|---|---|
| A `Supply values for the following parameters` prompt | Cloud Shell is in PowerShell: **Switch to Bash** |
| `RequestDisallowedByAzure` ... `best available regions` | The subscription does not allow that region: pick one from the policy list above |
| `Location '...' is not currently supported` | That region has no Container Apps (Qatar Central, for one): pick another allowed region |
| `Invalid resource group location` | A resource group cannot change region: use a new `RG=` name, or `az group delete -n <group> -y` first |
| `There is not enough space on the disk` while creating the environment, then `ManagedEnvironmentNotProvisioned` | A failure on Azure's side in that region (the Cloud Shell disk is fine): delete the group and deploy to another allowed region |
| An uploaded `.env` has disappeared | Cloud Shell sessions can be ephemeral: upload it again, or use the resource settings above instead |

To update after new commits: wait for CI on `main` to finish, then rerun the same command (it reuses everything that exists), or in the portal open the container app → **Revisions and replicas** → **Create new revision**.

After judging: `az containerapp update -n nutmeg-desk -g nutmeg-desk-ch --min-replicas 0` goes back to scale to zero, and deleting the resource group (portal → Resource groups → Delete) stops all cost.

## 3. Microsoft Foundry model

`FOUNDRY_MODEL` in step 2 does all of this for the hosted app. For local runs, check your quota first; an Azure for Students subscription had Global Standard quota for gpt-4.1-mini, gpt-4o-mini and the gpt-5 family in Switzerland North and Germany West Central:

```bash
az cognitiveservices usage list -l switzerlandnorth --query "[?starts_with(name.value,'OpenAI.GlobalStandard.') && limit>\`0\`].[name.value,limit]" -o tsv
```

Use a model that accepts `max_tokens` and `temperature`, such as gpt-4.1-mini or gpt-4o-mini; the gpt-5 and o-series reasoning models expect different parameters. Do **not** use *Managed compute* / GPU deployments: they bill every hour even when idle.

1. <https://ai.azure.com> → your project → **Models + endpoints** → **Deploy model** → **Deploy base model**.
2. Pick `gpt-4.1-mini` with deployment type **Global Standard**.
3. After it deploys, copy:

| Foundry field | `.env` |
|---|---|
| Endpoint target URI, up to `.com` (e.g. `https://x-resource.services.ai.azure.com`) | `FOUNDRY_ENDPOINT=` |
| Deployment name (Name column) | `FOUNDRY_DEPLOYMENT=` |
| Key | `FOUNDRY_API_KEY=` |

Foundry takes priority over `LLM_*` when all three are set. The request format is covered by tests against a mock of the Azure OpenAI API (`test/providers.test.ts`). A `404 DeploymentNotFound` means the deployment name is wrong; `401` means the key is wrong.

## 4. Optional: deploy from GitHub Actions instead of Cloud Shell

`.github/workflows/deploy-azure.yml` runs `infra/deploy.sh` from GitHub. It needs a Microsoft Entra app registration with a federated credential for this repo, which is more setup than Cloud Shell. Only worth it if you will redeploy often. Steps: <https://learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect>. Secrets and variables it reads are listed at the top of the workflow file.

## Summary: what goes where

| Value | From | Used as |
|---|---|---|
| Translator KEY 1 | Translator resource → Keys and Endpoint | `AZURE_TRANSLATOR_KEY` |
| Translator region | same page | `AZURE_TRANSLATOR_REGION` |
| Speech KEY 1 and region (optional) | Speech resource → Keys and Endpoint | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Content Safety endpoint and KEY 1 (optional) | Content Safety resource → Keys and Endpoint | `AZURE_CONTENT_SAFETY_ENDPOINT`, `AZURE_CONTENT_SAFETY_KEY` |
| Application Insights connection string (optional) | Application Insights → Overview | `APPLICATIONINSIGHTS_CONNECTION_STRING` |
| Container app URL | output of `infra/deploy.sh` | Submission testing link |
| Foundry endpoint, deployment, key | `FOUNDRY_MODEL` in step 2, or ai.azure.com → Models + endpoints | `FOUNDRY_*` |
