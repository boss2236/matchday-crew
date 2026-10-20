// Live match data: one EventSource per kick-off, buffered and applied once per
// animation frame so a fast replay never floods React with renders.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { FeedItem, LiveEnd, LiveEvent, LiveMeta, LiveSnapshot, TraceEntry, TraceStatus } from '../../src/types.ts';

type Messages = {
  meta: LiveMeta;
  event: LiveEvent;
  state: LiveSnapshot;
  item: FeedItem;
  trace: TraceEntry;
  end: LiveEnd;
  error: { message: string };
};
type Message = { [K in keyof Messages]: { type: K; data: Messages[K] } }[keyof Messages];

export interface TickerEntry {
  id: string;
  clock: string;
  text: string;
  players: (string | undefined)[];
}

export interface TraceRow extends TraceEntry {
  key: number;
}

export interface LiveState {
  status: 'idle' | 'live' | 'ended' | 'error';
  meta: LiveMeta | null;
  snap: LiveSnapshot | null;
  clock: string;
  items: FeedItem[];
  trail: LiveEvent[];
  ticker: TickerEntry[];
  trace: TraceRow[];
  counts: Partial<Record<TraceStatus, number>>;
  summary: LiveEnd | null;
  error: string | null;
  runId: number;
  seq: number;
}

const initial: LiveState = {
  status: 'idle',
  meta: null,
  snap: null,
  clock: '00:00',
  items: [],
  trail: [],
  ticker: [],
  trace: [],
  counts: {},
  summary: null,
  error: null,
  runId: 0,
  seq: 0,
};

type Action = { type: 'reset' } | { type: 'error'; message: string } | { type: 'batch'; messages: Message[] };

const PLAYS = new Set(['pass', 'carry', 'shot']);

function describe(ev: LiveEvent): string | null {
  const p = ev.player?.name;
  switch (ev.type) {
    case 'pass':
      return ev.outcome === 'complete' ? `${p} → ${ev.recipient?.name ?? 'teammate'}` : `${p} pass misplaced`;
    case 'shot':
      return `${p} shoots (${(ev.outcome ?? '').replace('_', ' ')}, xG ${ev.xg})`;
    case 'goal':
      return `GOAL ${p}!`;
    case 'tackle':
      return `${p} tackle`;
    case 'interception':
      return `${p} intercepts`;
    case 'save':
      return `${p} saves`;
    case 'kickoff':
      return 'Kick-off';
    case 'half_time':
      return 'Half-time';
    case 'full_time':
      return 'Full-time';
    default:
      return null;
  }
}

function reducer(state: LiveState, action: Action): LiveState {
  if (action.type === 'reset') return { ...initial, status: 'live', runId: state.runId + 1 };
  if (action.type === 'error') return { ...state, status: 'error', error: action.message };
  const next = { ...state };
  let { items, trail, ticker, trace, counts, seq } = next;
  const copied = new Set<string>();
  const own = <T>(name: string, value: T[]): T[] => {
    if (copied.has(name)) return value;
    copied.add(name);
    return value.slice();
  };
  for (const msg of action.messages) {
    switch (msg.type) {
      case 'meta':
        next.meta = msg.data;
        break;
      case 'state':
        next.snap = msg.data;
        break;
      case 'event': {
        const ev = msg.data;
        next.clock = ev.type === 'full_time' ? 'FT' : ev.type === 'half_time' ? 'HT' : ev.clock;
        if (ev.x !== undefined && PLAYS.has(ev.type)) {
          trail = own('trail', trail);
          trail.push(ev);
          if (trail.length > 7) trail.shift();
        }
        const text = describe(ev);
        if (text) {
          ticker = own('ticker', ticker);
          ticker.unshift({ id: ev.id, clock: ev.clock, text, players: [ev.player?.id, ev.recipient?.id] });
          if (ticker.length > 10) ticker.pop();
        }
        break;
      }
      case 'item':
        items = own('items', items);
        items.push(msg.data);
        break;
      case 'trace':
        if (!copied.has('counts')) {
          copied.add('counts');
          counts = { ...counts };
        }
        counts[msg.data.status] = (counts[msg.data.status] ?? 0) + 1;
        if (msg.data.status !== 'skipped') {
          trace = own('trace', trace);
          trace.unshift({ ...msg.data, key: ++seq });
          if (trace.length > 150) trace.pop();
        }
        break;
      case 'end':
        next.status = 'ended';
        next.summary = msg.data;
        next.clock = 'FT';
        break;
      case 'error':
        next.status = 'error';
        next.error = msg.data.message;
        break;
    }
  }
  return { ...next, items, trail, ticker, trace, counts, seq };
}

export function useLiveMatch() {
  const [state, dispatch] = useReducer(reducer, initial);
  const source = useRef<EventSource | null>(null);
  const queue = useRef<Message[]>([]);
  const frame = useRef(0);
  // Positions of events by id, for drawing what a line cites. Not React state:
  // nothing renders from it directly.
  const events = useRef(new Map<string, LiveEvent>());

  const flush = useCallback(() => {
    frame.current = 0;
    const messages = queue.current;
    queue.current = [];
    if (messages.length) dispatch({ type: 'batch', messages });
  }, []);

  const push = useCallback(
    (msg: Message) => {
      queue.current.push(msg);
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const start = useCallback(
    (params: URLSearchParams) => {
      source.current?.close();
      queue.current = [];
      events.current = new Map();
      dispatch({ type: 'reset' });
      const es = new EventSource(`api/live?${params}`);
      source.current = es;
      let ended = false;
      const kinds: (keyof Messages)[] = ['meta', 'event', 'state', 'item', 'trace', 'end', 'error'];
      for (const type of kinds) {
        es.addEventListener(type, (e) => {
          const raw = (e as MessageEvent<string>).data;
          if (!raw) return; // the browser's own connection "error" has no data
          const msg = { type, data: JSON.parse(raw) } as Message;
          if (msg.type === 'event' && msg.data.x !== undefined) events.current.set(msg.data.id, msg.data);
          if (msg.type === 'end') {
            ended = true;
            es.close();
          }
          push(msg);
        });
      }
      es.onerror = () => {
        if (ended) return;
        es.close();
        dispatch({ type: 'error', message: 'Connection lost. Press Restart to try again.' });
      };
    },
    [push],
  );

  useEffect(
    () => () => {
      source.current?.close();
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { ...state, start, events: events.current };
}
