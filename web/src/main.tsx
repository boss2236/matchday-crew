import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import App from './App.tsx';
import './app.css';

export type ThemeName = 'dark' | 'light';

function readTheme(): ThemeName {
  try {
    return localStorage.getItem('mc-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

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
      <div className="app-root">
        <App theme={theme} onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
      </div>
    </FluentProvider>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
