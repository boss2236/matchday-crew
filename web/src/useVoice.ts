// Voice commentary: reads each new line aloud. Azure AI Speech (neural voice per
// language, via /api/speak) when the server has a key; otherwise the browser's
// own speech synthesis. Stays live: if lines arrive faster than they can be
// read, older ones are dropped and the newest is read next.
import { useEffect, useRef } from 'react';
import type { FeedItem } from '../../src/types.ts';

const BCP47: Record<string, string> = {
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

export const browserVoiceAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

function speakInBrowser(text: string, language: string): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[language] ?? 'en-GB';
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

function speakWithAzure(text: string, language: string, audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    audio.src = `api/speak?${new URLSearchParams({ text, language })}`;
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

export function useVoice({ enabled, items, language, azure }: { enabled: boolean; items: FeedItem[]; language: string; azure: boolean }) {
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const seen = useRef(items.length);
  const audio = useRef<HTMLAudioElement | null>(null);
  const settings = useRef({ enabled, language, azure });
  settings.current = { enabled, language, azure };

  // Turning voice on reads only what airs from now on.
  useEffect(() => {
    seen.current = items.length;
    queue.current = [];
    if (!enabled) {
      if (browserVoiceAvailable) speechSynthesis.cancel();
      audio.current?.pause();
    }
    // items is read once on toggle, not tracked.
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

    const next = async () => {
      if (busy.current) return;
      const text = queue.current.shift();
      if (!text || !settings.current.enabled) return;
      busy.current = true;
      const { language: lang, azure: useAzure } = settings.current;
      if (useAzure) {
        audio.current ??= new Audio();
        await speakWithAzure(text, lang, audio.current);
      } else if (browserVoiceAvailable) {
        await speakInBrowser(text, lang);
      }
      busy.current = false;
      void next();
    };
    void next();
  }, [items, enabled]);

  useEffect(
    () => () => {
      if (browserVoiceAvailable) speechSynthesis.cancel();
      audio.current?.pause();
    },
    [],
  );
}
