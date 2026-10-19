// Minimal Model Context Protocol server over stdio (JSON-RPC 2.0, one message
// per line). Implements initialize, ping, tools/list and tools/call, which is
// all a client needs to use the match tools.

import { createInterface } from 'node:readline';
import { TOOLS, callTool } from './tools.js';

export const PROTOCOL_VERSION = '2025-06-18';

export async function handle(msg, ctx = {}) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'matchday-crew', version: '0.2.0' },
        instructions: 'Synthetic football match intelligence. Start with list_fixtures, then match_summary or key_moments, then explain_moment.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call':
      try {
        const out = await callTool(msg.params?.name, msg.params?.arguments ?? {}, ctx);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
      } catch (err) {
        return reply({ content: [{ type: 'text', text: err.message }], isError: true });
      }
    default:
      if (msg.id === undefined) return null; // notification, e.g. notifications/initialized
      return fail(-32601, `method not found: ${msg.method}`);
  }
}

export function serveStdio(ctx = {}, input = process.stdin, output = process.stdout) {
  const rl = createInterface({ input });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      return;
    }
    const res = await handle(msg, ctx);
    if (res) output.write(JSON.stringify(res) + '\n');
  });
  return rl;
}
