// Azure AI Speech text-to-speech (REST, no SDK): the crew's lines read aloud in
// the viewer's language, with a neural voice per language.
//
//   AZURE_SPEECH_KEY     key from the Speech resource ("Keys and Endpoint")
//   AZURE_SPEECH_REGION  the resource's region, e.g. qatarcentral
//
// Without a key the web app falls back to the browser's own speech synthesis.
import type { FetchLike } from './llm.ts';
import { languageCode } from './translator.ts';

export interface SpeechConfig {
  key: string;
  region: string;
}

// One neural voice per supported language (Translator code -> Azure voice).
export const VOICES: Record<string, string> = {
  en: 'en-GB-RyanNeural',
  ar: 'ar-SA-HamedNeural',
  es: 'es-ES-AlvaroNeural',
  fr: 'fr-FR-HenriNeural',
  pt: 'pt-BR-AntonioNeural',
  de: 'de-DE-ConradNeural',
  it: 'it-IT-DiegoNeural',
  tr: 'tr-TR-AhmetNeural',
  hi: 'hi-IN-MadhurNeural',
  bn: 'bn-IN-BashkarNeural',
  ur: 'ur-PK-AsadNeural',
  id: 'id-ID-ArdiNeural',
  sw: 'sw-KE-RafikiNeural',
  ja: 'ja-JP-KeitaNeural',
  ko: 'ko-KR-InJoonNeural',
  'zh-Hans': 'zh-CN-YunxiNeural',
};

export const MAX_SPEECH_CHARS = 600;

export function speechConfigFromEnv(env: Record<string, string | undefined> = process.env): SpeechConfig | null {
  if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION) return null;
  return { key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION };
}

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

export function ssml(text: string, language: string): string {
  const code = languageCode(language) ?? 'en';
  const voice = VOICES[code] ?? (VOICES.en as string);
  const lang = voice.split('-').slice(0, 2).join('-');
  return `<speak version='1.0' xml:lang='${lang}'><voice name='${voice}'>${escapeXml(text.slice(0, MAX_SPEECH_CHARS))}</voice></speak>`;
}

export class Speech {
  config: SpeechConfig;
  fetch: FetchLike;
  memo: Map<string, Buffer>;
  usage: { calls: number; characters: number };

  constructor(config: SpeechConfig, { fetchImpl = globalThis.fetch }: { fetchImpl?: FetchLike } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.memo = new Map();
    this.usage = { calls: 0, characters: 0 };
  }

  // MP3 audio for one line. Repeated lines (replays, two viewers) come from memory.
  async synthesize(text: string, language: string): Promise<Buffer> {
    const key = `${language}\u0000${text}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const res = await this.fetch(`https://${this.config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.config.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'matchday-crew',
      },
      body: ssml(text, language),
    });
    if (!res.ok) throw new Error(`speech ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const audio = Buffer.from(await (res as unknown as Response).arrayBuffer());
    this.usage.calls += 1;
    this.usage.characters += Math.min(text.length, MAX_SPEECH_CHARS);
    this.memo.set(key, audio);
    if (this.memo.size > 300) this.memo.delete(this.memo.keys().next().value as string);
    return audio;
  }
}
