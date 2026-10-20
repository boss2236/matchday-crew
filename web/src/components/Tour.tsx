// First-visit guide. A new visitor is asked whether they want a tour; the tour
// walks through the app with Fluent teaching popovers anchored to each part.
// The choice is remembered in this browser, and the tour can be replayed from
// the header at any time.
import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  TeachingPopover,
  TeachingPopoverBody,
  TeachingPopoverFooter,
  TeachingPopoverHeader,
  TeachingPopoverSurface,
  TeachingPopoverTitle,
  Text,
} from '@fluentui/react-components';

export interface TourStep {
  target: string; // value of a data-tour attribute
  title: string;
  body: string;
}

export const STEPS: TourStep[] = [
  { target: 'controls', title: 'Set up your match', body: 'Pick a match, a speed, your language, your favourite club, a player to follow and one metric you care about.' },
  { target: 'kickoff', title: 'Kick off', body: 'Starts the match. Events stream in live, sped up, and the AI crew starts covering it.' },
  { target: 'scoreboard', title: 'Score and game state', body: 'Momentum shows who is on top right now. Control vs chaos shows how scrappy the game is.' },
  { target: 'persona', title: 'Analyst or casual fan', body: 'The same moment, told two ways: numbers and tactics for analysts, plain and warm for fans. Switch any time.' },
  { target: 'pitch', title: 'Broadcast overlays', body: 'Key moments appear as on-screen graphics where a TV producer would put them, with the passes and shots behind them highlighted.' },
  { target: 'voice', title: 'Voice commentary', body: 'Turn this on to hear every line read aloud in your language.' },
  { target: 'feed', title: 'The story so far', body: 'Every line the AI writes. Open Evidence to see the exact match events it is based on. Badges show whether the AI wrote it.' },
  { target: 'crew', title: 'Behind the broadcast', body: 'Each AI agent at work. Lines that state anything not in the match data are rejected before they air.' },
  { target: 'studio', title: 'Broadcast view', body: 'What a viewer at home would see: the match full-screen with the crew’s graphics and a scorebug, and no controls.' },
];

const STORAGE_KEY = 'mc-tour';

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return 'unavailable';
  }
}

function remember(value: 'done' | 'skipped') {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Private mode: the visitor may be asked again next time, which is fine.
  }
}

// suppress: do not offer the tour (deep links that autostart a match, broadcast view).
export function useTour(suppress: boolean) {
  const [offer, setOffer] = useState(false);
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (!suppress && remembered() === null) setOffer(true);
  }, [suppress]);

  const start = useCallback(() => {
    setOffer(false);
    setStep(0);
  }, []);
  const skip = useCallback(() => {
    setOffer(false);
    setStep(-1);
    remember('skipped');
  }, []);
  const finish = useCallback(() => {
    setStep(-1);
    remember('done');
  }, []);

  return { offer, step, setStep, start, skip, finish };
}

export function TourOffer({ open, onStart, onSkip }: { open: boolean; onStart: () => void; onSkip: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onSkip()}>
      <DialogSurface aria-describedby="tour-offer-text">
        <DialogBody>
          <DialogTitle>Welcome to Nutmeg Desk</DialogTitle>
          <DialogContent>
            <Text id="tour-offer-text" block>
              An AI broadcast crew covers a synthetic football match live, explains why moments matter, and tells the story your way. Want a one-minute tour?
            </Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onSkip}>
              Skip
            </Button>
            <Button appearance="primary" onClick={onStart}>
              Take the tour
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function TourSteps({ step, setStep, onFinish }: { step: number; setStep: (n: number) => void; onFinish: () => void }) {
  const current = STEPS[step];
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!current) return setTarget(null);
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
    if (!el) {
      // A step whose part is hidden (e.g. player focus not chosen): move on.
      if (step < STEPS.length - 1) setStep(step + 1);
      else onFinish();
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('tour-target');
    setTarget(el);
    return () => el.classList.remove('tour-target');
  }, [current, step, setStep, onFinish]);

  if (!current || !target) return null;
  const last = step === STEPS.length - 1;
  return (
    <TeachingPopover open onOpenChange={(_, d) => !d.open && onFinish()} positioning={{ target, position: 'below', align: 'center' }} withArrow>
      <TeachingPopoverSurface className="tour-surface">
        <TeachingPopoverHeader>
          Tour · {step + 1} of {STEPS.length}
        </TeachingPopoverHeader>
        <TeachingPopoverBody>
          <TeachingPopoverTitle>{current.title}</TeachingPopoverTitle>
          <Text block>{current.body}</Text>
        </TeachingPopoverBody>
        <TeachingPopoverFooter
          primary={{ children: last ? 'Done' : 'Next', onClick: () => (last ? onFinish() : setStep(step + 1)) }}
          secondary={step > 0 ? { children: 'Back', onClick: () => setStep(step - 1) } : { children: 'Skip tour', onClick: onFinish }}
        />
      </TeachingPopoverSurface>
    </TeachingPopover>
  );
}
