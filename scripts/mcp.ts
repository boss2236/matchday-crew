// MCP server for match intelligence (stdio). Add it to an MCP client, e.g. VS Code
// (.vscode/mcp.json in this repo) for GitHub Copilot agent mode:
//
//   { "servers": { "matchday-crew": { "command": "node", "args": ["scripts/mcp.ts"] } } }
//
// Uses the same .env as the app; explain_moment goes through the response cache.
import { existsSync } from 'node:fs';
import { ChatClient, llmConfigFromEnv } from '../src/ai/llm.ts';
import { CachedChat } from '../src/ai/cache.ts';
import { Translator, translatorConfigFromEnv } from '../src/ai/translator.ts';
import { serveStdio } from '../src/mcp/server.ts';

const root = new URL('..', import.meta.url).pathname;
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);

const config = llmConfigFromEnv();
const llm = new CachedChat(config ? new ChatClient(config) : null);
const translatorConfig = translatorConfigFromEnv();
serveStdio({ llm, translator: translatorConfig ? new Translator(translatorConfig) : null });
