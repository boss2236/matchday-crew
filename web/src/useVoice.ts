// Voice commentary: reads each new line aloud. Azure AI Speech (neural voice per
// language, via /api/speak) when the server has a key; otherwise the browser's
// own speech synthesis, if it has a voice for the language. Stays live: if lines
// arrive faster than they can be read, older ones are dropped.
import { useEffect, useRef, useState } from 'react';
import type { FeedItem } from '../../src/types.ts';

export const BCP47: Record<string, string> = {
  English: 'en-GB',
  Arabic: 'ar-SA',
  Spanish: 'es-ES',
  French: 'fr-FR',
  Portuguese: 'pt-BR',
  German: 'de-DE',
  Italian: 'it-IT',
  Turkish: 'tr-TR',
  Hindi: 'hi-IN',
  Bengali: 'bn-IN',
  Urdu: 'ur-PK',
  Indonesian: 'id-ID',
  Swahili: 'sw-KE',
  Japanese: 'ja-JP',
  Korean: 'ko-KR',
  'Chinese (Simplified)': 'zh-CN',
};

const hasBrowserSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;

// The best installed browser voice for a language: exact locale, then same language.
export function browserVoiceFor(language: string): SpeechSynthesisVoice | null {
  if (!hasBrowserSpeech) return null;
  const tag = BCP47[language] ?? 'en-GB';
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === tag) ?? voices.find((v) => v.lang.split('-')[0] === tag.split('-')[0]) ?? null;
}

// Browser voices load asynchronously; re-render when they arrive.
export function useBrowserVoices(): number {
  const [count, setCount] = useState(() => (hasBrowserSpeech ? speechSynthesis.getVoices().length : 0));
  useEffect(() => {
    if (!hasBrowserSpeech) return;
    const update = () => setCount(speechSynthesis.getVoices().length);
    update();
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return count;
}

export type VoiceSupport = { ok: true; engine: 'azure' | 'browser'; voice?: string } | { ok: false; reason: string };

export function voiceSupport(language: string, azure: boolean): VoiceSupport {
  if (azure) return { ok: true, engine: 'azure' };
  const voice = browserVoiceFor(language);
  if (voice) return { ok: true, engine: 'browser', voice: voice.name };
  return {
    ok: false,
    reason: `This browser has no ${language} voice. Add a free Azure AI Speech key on the server for neural voices in every language.`,
  };
}

// Chrome can drop an utterance's end event (it garbage-collects utterances that
// nothing references), which would stall the queue. Keep references, and give
// every line a deadline based on its length.
const live = new Set<SpeechSynthesisUtterance>();

function speakInBrowser(text: string, language: string): Promise<'ok' | 'blocked'> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[language] ?? 'en-GB';
    const voice = browserVoiceFor(language);
    if (voice) u.voice = voice;
    u.rate = 1.05;
    live.add(u);
    const done = (result: 'ok' | 'blocked') => {
      clearTimeout(deadline);
      live.delete(u);
      resolve(result);
    };
    const deadline = window.setTimeout(() => {
      speechSynthesis.cancel();
      done('ok');
    }, 4000 + text.length * 90);
    u.onend = () => done('ok');
    u.onerror = (e) => done(e.error === 'not-allowed' ? 'blocked' : 'ok');
    speechSynthesis.speak(u);
  });
}

function speakWithAzure(text: string, language: string, audio: HTMLAudioElement): Promise<'ok' | 'blocked'> {
  return new Promise((resolve) => {
    const deadline = window.setTimeout(() => resolve('ok'), 8000 + text.length * 90);
    const done = (r: 'ok' | 'blocked') => {
      clearTimeout(deadline);
      resolve(r);
    };
    audio.src = `api/speak?${new URLSearchParams({ text, language })}`;
    audio.onended = () => done('ok');
    audio.onerror = () => done('ok');
    audio.play().catch((err: unknown) => done(err instanceof DOMException && err.name === 'NotAllowedError' ? 'blocked' : 'ok'));
  });
}

// Returns blocked = true when the browser refused to play sound before any click
// (autoplay rules); call unblock() from a click handler to retry.
export function useVoice({ enabled, items, language, azure }: { enabled: boolean; items: FeedItem[]; language: string; azure: boolean }) {
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const seen = useRef(items.length);
  const audio = useRef<HTMLAudioElement | null>(null);
  const settings = useRef({ enabled, language, azure });
  settings.current = { enabled, language, azure };
  const [blocked, setBlocked] = useState(false);
  const pump = useRef<() => void>(() => {});

  pump.current = async () => {
    if (busy.current) return;
    const text = queue.current[0];
    if (!text || !settings.current.enabled) return;
    busy.current = true;
    const { language: lang, azure: useAzure } = settings.current;
    let result: 'ok' | 'blocked' = 'ok';
    if (useAzure) {
      audio.current ??= new Audio();
      result = await speakWithAzure(text, lang, audio.current);
    } else if (browserVoiceFor(lang)) {
      result = await speakInBrowser(text, lang);
    }
    busy.current = false;
    if (result === 'blocked') {
      setBlocked(true); // keep the line queued until the visitor allows sound
      return;
    }
    queue.current.shift();
    void pump.current();
  };

  // Turning voice on reads only what airs from now on.
  useEffect(() => {
    seen.current = items.length;
    queue.current = [];
    if (!enabled) {
      if (hasBrowserSpeech) speechSynthesis.cancel();
      audio.current?.pause();
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      seen.current = items.length;
      return;
    }
    const fresh = items.slice(seen.current);
    seen.current = items.length;
    for (const item of fresh) queue.current.push(`${item.headline}. ${item.text}`);
    if (queue.current.length > 2) queue.current = queue.current.slice(-1);
    if (!blocked) void pump.current();
  }, [items, enabled, blocked]);

  useEffect(
    () => () => {
      if (hasBrowserSpeech) speechSynthesis.cancel();
      audio.current?.pause();
    },
    [],
  );

  const unblock = () => {
    setBlocked(false);
    void pump.current();
  };
  return { blocked, unblock };
}
