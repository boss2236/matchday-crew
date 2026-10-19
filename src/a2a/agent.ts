// Agent2Agent (A2A) interface: an agent card at /.well-known/agent-card.json and
// a JSON-RPC endpoint that other agents can call. The crew's skills are the
// same match tools the MCP server exposes.
//
// Supported: message/send (a data part {"skill": "...", "arguments": {...}} or
// plain text naming a skill) and tasks/get. Every task completes synchronously.
import { randomUUID } from 'node:crypto';
import { TOOLS, callTool } from '../mcp/tools.ts';
import type { ToolArgs, ToolContext } from '../mcp/tools.ts';

export const A2A_PROTOCOL_VERSION = '0.3.0';

export function agentCard(baseUrl: string) {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: 'Matchday Crew',
    description:
      'Multi-agent broadcast crew for synthetic football matches: stats, key moments with evidence, player stats, and fact-checked explanations of why a moment matters, for an analyst or a casual fan, in many languages.',
    url: `${baseUrl}/a2a`,
    preferredTransport: 'JSONRPC',
    version: '0.4.0',
    provider: { organization: 'Matchday Crew', url: baseUrl },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json'],
    skills: TOOLS.map((t) => ({
      id: t.name,
      name: t.name.replace(/_/g, ' '),
      description: t.description,
      tags: ['football', 'synthetic-data', 'match-intelligence'],
      examples: [JSON.stringify({ skill: t.name, arguments: t.name === 'explain_moment' ? { seed: 7, momentId: 'm004', persona: 'casual', language: 'Arabic' } : { seed: 7 } })],
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['application/json'],
    })),
  };
}

interface Part {
  kind: 'text' | 'data';
  text?: string;
  data?: Record<string, unknown>;
}

interface Message {
  role: string;
  parts: Part[];
  messageId?: string;
  contextId?: string;
}

export interface A2ARequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: { message?: Message; id?: string };
}

type Task = {
  kind: 'task';
  id: string;
  contextId: string;
  status: { state: 'completed' | 'failed'; timestamp: string; message?: { role: 'agent'; parts: Part[]; messageId: string } };
  artifacts?: { artifactId: string; name: string; parts: Part[] }[];
};

const tasks = new Map<string, Task>();

// Plain text: pick the skill it names, else a summary of the match it mentions.
function fromText(text: string): { skill: string; args: ToolArgs } {
  const seed = Number(text.match(/seed\s*(\d+)/i)?.[1] ?? 7);
  const named = TOOLS.find((t) => text.toLowerCase().includes(t.name) || text.toLowerCase().includes(t.name.replace(/_/g, ' ')));
  if (named) return { skill: named.name, args: { seed } };
  if (/moment|goal|chance/i.test(text)) return { skill: 'key_moments', args: { seed } };
  if (/fixture|match(es)? available|list/i.test(text)) return { skill: 'list_fixtures', args: {} };
  return { skill: 'match_summary', args: { seed } };
}

export async function handleA2A(req: A2ARequest, ctx: ToolContext = {}) {
  const id = req.id ?? null;
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });
  if (req.method === 'tasks/get') {
    const task = req.params?.id ? tasks.get(req.params.id) : undefined;
    return task ? { jsonrpc: '2.0' as const, id, result: task } : fail(-32001, 'task not found');
  }
  if (req.method !== 'message/send') return fail(-32601, `method not found: ${req.method}`);
  const message = req.params?.message;
  if (!message || !Array.isArray(message.parts) || message.parts.length === 0) return fail(-32602, 'params.message.parts is required');

  const data = message.parts.find((p) => p.kind === 'data')?.data;
  const text = message.parts.find((p) => p.kind === 'text')?.text ?? '';
  const { skill, args } = data && typeof data.skill === 'string' ? { skill: data.skill, args: (data.arguments ?? {}) as ToolArgs } : fromText(text);

  const task: Task = { kind: 'task', id: randomUUID(), contextId: message.contextId ?? randomUUID(), status: { state: 'completed', timestamp: new Date().toISOString() } };
  try {
    const result = await callTool(skill, args, ctx);
    task.artifacts = [{ artifactId: randomUUID(), name: skill, parts: [{ kind: 'data', data: { skill, result } as Record<string, unknown> }] }];
  } catch (err) {
    task.status = {
      state: 'failed',
      timestamp: new Date().toISOString(),
      message: { role: 'agent', parts: [{ kind: 'text', text: err instanceof Error ? err.message : String(err) }], messageId: randomUUID() },
    };
  }
  tasks.set(task.id, task);
  if (tasks.size > 200) tasks.delete(tasks.keys().next().value as string);
  return { jsonrpc: '2.0' as const, id, result: task };
}
