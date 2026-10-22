#!/usr/bin/env bash
# Deploy Nutmeg Desk to Azure Container Apps (consumption plan, scales to zero).
#
# Easiest: open Azure Cloud Shell (the >_ icon in portal.azure.com, choose Bash), then
#   git clone https://github.com/boss2236/nutmeg-desk && cd nutmeg-desk
#   LOCATION=switzerlandnorth bash infra/deploy.sh
#
# Keys can come from the environment (LLM_API_KEY, AZURE_TRANSLATOR_KEY, ...; see
# docs/AZURE.md), or the script can create and wire the Azure resources itself, so
# no key is ever copied by hand:
#   FOUNDRY_MODEL=gpt-4.1-mini        create a Microsoft Foundry (Azure AI Services)
#                                     resource and a Global Standard deployment of
#                                     this model; FOUNDRY_CAPACITY caps it in
#                                     thousands of tokens a minute (default 50)
#   TRANSLATOR_RESOURCE=name          use an existing Translator resource
#   SPEECH_RESOURCE=name              use an existing Speech resource
#                                     (TRANSLATOR_RG, SPEECH_RG: their resource
#                                     groups, default $RG)
#   CONTENT_SAFETY=1                  create Azure AI Content Safety (free F0)
#   APP_INSIGHTS=1                    create Application Insights
#
# MIN_REPLICAS=1 keeps one copy running (no cold start, small cost); the default 0
# scales to zero. MAX_LIVE_SESSIONS caps concurrent live matches (default 30).
#
# Image: by default the free GitHub Container Registry image built by CI
# (ghcr.io/<owner>/nutmeg-desk:latest, make the package public once).
# Set SOURCE_BUILD=1 to build from this folder in Azure instead (creates an
# Azure Container Registry, about 5 USD a month).
set -euo pipefail

RG=${RG:-nutmeg-desk-rg}
LOCATION=${LOCATION:-westeurope}
APP=${APP:-nutmeg-desk}
ENV_NAME=${ENV_NAME:-nutmeg-desk-env}
IMAGE=${IMAGE:-ghcr.io/boss2236/nutmeg-desk:latest}

echo "==> Preparing subscription"
az extension add --name containerapp --upgrade --only-show-errors -y >/dev/null
az provider register --namespace Microsoft.App --wait >/dev/null
az provider register --namespace Microsoft.OperationalInsights --wait >/dev/null
az group create --name "$RG" --location "$LOCATION" --only-show-errors >/dev/null

echo "==> Creating or updating the container app"
if [[ "${SOURCE_BUILD:-0}" == "1" ]]; then
  az containerapp up --name "$APP" --resource-group "$RG" --location "$LOCATION" --environment "$ENV_NAME" \
    --source . --ingress external --target-port 8080
else
  az containerapp up --name "$APP" --resource-group "$RG" --location "$LOCATION" --environment "$ENV_NAME" \
    --image "$IMAGE" --ingress external --target-port 8080
fi

# Azure AI resource names are global (they become <name>.cognitiveservices.azure.com),
# so they carry a short, stable suffix from the subscription.
SUFFIX=$(az account show --query id -o tsv | tr -d '-' | cut -c1-6)
ai_account() { # name kind sku: create the account unless it exists
  if ! az cognitiveservices account show --name "$1" --resource-group "$RG" --only-show-errors >/dev/null 2>&1; then
    az cognitiveservices account create --name "$1" --resource-group "$RG" --location "$LOCATION" \
      --kind "$2" --sku "$3" --custom-domain "$1" --yes --only-show-errors >/dev/null
  fi
}
key_of() { az cognitiveservices account keys list --name "$1" --resource-group "$2" --query key1 -o tsv; }

if [[ -n "${FOUNDRY_MODEL:-}" ]]; then
  echo "==> Microsoft Foundry: $FOUNDRY_MODEL"
  AI="$APP-ai-$SUFFIX"
  ai_account "$AI" AIServices S0
  if ! az cognitiveservices account deployment show --name "$AI" --resource-group "$RG" --deployment-name "$FOUNDRY_MODEL" --only-show-errors >/dev/null 2>&1; then
    version=$(az cognitiveservices model list --location "$LOCATION" \
      --query "[?model.format=='OpenAI' && model.name=='$FOUNDRY_MODEL'].model.version | sort(@) | [-1]" -o tsv)
    az cognitiveservices account deployment create --name "$AI" --resource-group "$RG" \
      --deployment-name "$FOUNDRY_MODEL" --model-name "$FOUNDRY_MODEL" --model-version "$version" --model-format OpenAI \
      --sku-name GlobalStandard --sku-capacity "${FOUNDRY_CAPACITY:-50}" --only-show-errors >/dev/null
  fi
  FOUNDRY_ENDPOINT=$(az cognitiveservices account show --name "$AI" --resource-group "$RG" --query properties.endpoint -o tsv)
  FOUNDRY_DEPLOYMENT=$FOUNDRY_MODEL
  FOUNDRY_API_KEY=$(key_of "$AI" "$RG")
fi

if [[ -n "${TRANSLATOR_RESOURCE:-}" ]]; then
  echo "==> Azure AI Translator: $TRANSLATOR_RESOURCE"
  AZURE_TRANSLATOR_REGION=$(az cognitiveservices account show --name "$TRANSLATOR_RESOURCE" --resource-group "${TRANSLATOR_RG:-$RG}" --query location -o tsv)
  AZURE_TRANSLATOR_KEY=$(key_of "$TRANSLATOR_RESOURCE" "${TRANSLATOR_RG:-$RG}")
fi

if [[ -n "${SPEECH_RESOURCE:-}" ]]; then
  echo "==> Azure AI Speech: $SPEECH_RESOURCE"
  AZURE_SPEECH_REGION=$(az cognitiveservices account show --name "$SPEECH_RESOURCE" --resource-group "${SPEECH_RG:-$RG}" --query location -o tsv)
  AZURE_SPEECH_KEY=$(key_of "$SPEECH_RESOURCE" "${SPEECH_RG:-$RG}")
fi

if [[ "${CONTENT_SAFETY:-0}" == "1" ]]; then
  echo "==> Azure AI Content Safety"
  CS="$APP-safety-$SUFFIX"
  ai_account "$CS" ContentSafety "${CONTENT_SAFETY_SKU:-F0}"
  AZURE_CONTENT_SAFETY_ENDPOINT=$(az cognitiveservices account show --name "$CS" --resource-group "$RG" --query properties.endpoint -o tsv)
  AZURE_CONTENT_SAFETY_KEY=$(key_of "$CS" "$RG")
fi

if [[ "${APP_INSIGHTS:-0}" == "1" ]]; then
  echo "==> Application Insights"
  az extension add --name application-insights --upgrade --only-show-errors -y >/dev/null
  if ! az monitor app-insights component show --app "$APP-insights" --resource-group "$RG" --only-show-errors >/dev/null 2>&1; then
    # Reuse the Log Analytics workspace the Container Apps environment writes to.
    workspace=$(az monitor log-analytics workspace list --resource-group "$RG" --query "[0].id" -o tsv)
    if [[ -z "$workspace" ]]; then
      az monitor log-analytics workspace create --resource-group "$RG" --workspace-name "$APP-logs" --location "$LOCATION" --only-show-errors >/dev/null
      workspace=$(az monitor log-analytics workspace show --resource-group "$RG" --workspace-name "$APP-logs" --query id -o tsv)
    fi
    az monitor app-insights component create --app "$APP-insights" --resource-group "$RG" --location "$LOCATION" \
      --kind web --application-type web --workspace "$workspace" --only-show-errors >/dev/null
  fi
  APPLICATIONINSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show --app "$APP-insights" --resource-group "$RG" --query connectionString -o tsv)
fi

echo "==> Settings and secrets"
secrets=()
envs=("PORT=8080" "LLM_CACHE=read" "MAX_LIVE_SESSIONS=${MAX_LIVE_SESSIONS:-30}")
secret() { local name=$1 var=$2; if [[ -n "${!var:-}" ]]; then secrets+=("$name=${!var}"); envs+=("$var=secretref:$name"); fi; }
plain() { local var=$1; if [[ -n "${!var:-}" ]]; then envs+=("$var=${!var}"); fi; }
secret llm-api-key LLM_API_KEY
secret foundry-api-key FOUNDRY_API_KEY
secret translator-key AZURE_TRANSLATOR_KEY
secret speech-key AZURE_SPEECH_KEY
secret safety-key AZURE_CONTENT_SAFETY_KEY
secret appinsights APPLICATIONINSIGHTS_CONNECTION_STRING
for v in LLM_BASE_URL LLM_MODEL LLM_REASONING_EFFORT LLM_MAX_TOKENS LLM_RETRIES FOUNDRY_ENDPOINT FOUNDRY_DEPLOYMENT AZURE_TRANSLATOR_REGION AZURE_SPEECH_REGION AZURE_CONTENT_SAFETY_ENDPOINT CONTENT_SAFETY_MAX_SEVERITY; do plain "$v"; done
if [[ -n "${LLM_API_KEY:-}" && -z "${LLM_MODEL:-}" ]]; then
  envs+=("LLM_BASE_URL=https://api.groq.com/openai/v1" "LLM_MODEL=openai/gpt-oss-120b" "LLM_REASONING_EFFORT=low" "LLM_MAX_TOKENS=1500" "LLM_RETRIES=10")
fi
if (( ${#secrets[@]} )); then
  az containerapp secret set --name "$APP" --resource-group "$RG" --secrets "${secrets[@]}" --only-show-errors >/dev/null
fi
az containerapp update --name "$APP" --resource-group "$RG" --set-env-vars "${envs[@]}" \
  --min-replicas "${MIN_REPLICAS:-0}" --max-replicas "${MAX_REPLICAS:-1}" --only-show-errors >/dev/null

FQDN=$(az containerapp show --name "$APP" --resource-group "$RG" --query properties.configuration.ingress.fqdn -o tsv)
echo "==> Live at https://$FQDN"
echo "    Health: https://$FQDN/healthz"
