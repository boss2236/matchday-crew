#!/usr/bin/env bash
# Deploy Nutmeg Desk to Azure Container Apps (consumption plan, scales to zero).
#
# Easiest: open Azure Cloud Shell (the >_ icon in portal.azure.com), then
#   git clone https://github.com/boss2236/nutmeg-desk && cd nutmeg-desk
#   LLM_API_KEY=... AZURE_TRANSLATOR_KEY=... AZURE_TRANSLATOR_REGION=... bash infra/deploy.sh
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
    --source . --ingress external --target-port 8080 --only-show-errors
else
  az containerapp up --name "$APP" --resource-group "$RG" --location "$LOCATION" --environment "$ENV_NAME" \
    --image "$IMAGE" --ingress external --target-port 8080 --only-show-errors
fi

echo "==> Settings and secrets"
secrets=()
envs=("PORT=8080" "LLM_CACHE=read")
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
  --min-replicas 0 --max-replicas 1 --only-show-errors >/dev/null

FQDN=$(az containerapp show --name "$APP" --resource-group "$RG" --query properties.configuration.ingress.fqdn -o tsv)
echo "==> Live at https://$FQDN"
echo "    Health: https://$FQDN/healthz"
