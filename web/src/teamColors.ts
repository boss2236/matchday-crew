// Club colours for the current theme: each club has a light-surface and a
// dark-surface step of the same identity (validated together as a chart palette).
import { createContext, useContext } from 'react';
import type { LiveMeta } from '../../src/types.ts';

export type ThemeName = 'dark' | 'light';

export const ThemeContext = createContext<ThemeName>('dark');

export function useTeamColors(meta: LiveMeta | null | undefined): { home: string; away: string } {
  const theme = useContext(ThemeContext);
  const pick = (side: 'home' | 'away', fallback: string) => {
    const c = meta?.[side].colors;
    return c ? (theme === 'dark' ? c.dark : c.primary) : fallback;
  };
  return { home: pick('home', 'var(--colorBrandBackground)'), away: pick('away', 'var(--colorPaletteDarkOrangeBackground3)') };
}
