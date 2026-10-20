import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import App from './App.tsx';
import Studio from './Studio.tsx';
import { ThemeContext } from './teamColors.ts';
import type { ThemeName } from './teamColors.ts';
import './app.css';

function readTheme(): ThemeName {
  try {
    return localStorage.getItem('mc-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const isStudio = location.pathname.replace(/\/+$/, '').endsWith('/studio');

function Root() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('mc-theme', theme);
    } catch {
      // Private mode: the toggle still works for this visit.
    }
  }, [theme]);
  return (
    // Style an inner wrapper, not the provider: Fluent copies the provider's
    // className onto its portal mount nodes (tooltips), which would then cover the page.
    <FluentProvider theme={theme === 'dark' ? webDarkTheme : webLightTheme}>
      {isStudio ? (
        <Studio />
      ) : (
        <ThemeContext.Provider value={theme}>
          <div className="app-root">
            <App theme={theme} onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
          </div>
        </ThemeContext.Provider>
      )}
    </FluentProvider>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
