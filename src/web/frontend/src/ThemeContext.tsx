import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  /** Adopt a theme pushed by the server (WebSocket) without echoing it back. */
  applyRemoteTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'fabric-theme';

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // Initialize theme from localStorage or system preference
  const [theme, setThemeState] = useState<Theme>(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(savedTheme)) {
      return savedTheme;
    }
    // Fall back to system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark'; // Default to dark
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only auto-switch if no saved preference
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (!savedTheme) {
        setThemeState(e.matches ? 'light' : 'dark');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Adopt the shared theme from the server. The server-side config
  // (~/.fabric/theme.json, also written by `fabric config theme` and the
  // TUI) is the source of truth, so a theme set on any surface is picked
  // up here on load. localStorage stays as the fallback when the API is
  // unreachable.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/theme')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data && isTheme(data.theme)) {
          setThemeState(data.theme);
        }
      })
      .catch(() => {
        // API unavailable — keep the local preference
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Push a theme change to the shared server config. Fire-and-forget: when
  // the server rejects the write (e.g. auth-token-protected deployments,
  // where browser requests carry no token), the change still applies
  // locally for this browser.
  const persistTheme = useCallback((newTheme: Theme) => {
    fetch('/api/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: newTheme }),
    }).catch(err => {
      console.warn('Failed to persist theme to server:', err);
    });
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    persistTheme(next);
  }, [theme, persistTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    persistTheme(newTheme);
  }, [persistTheme]);

  const applyRemoteTheme = useCallback((remoteTheme: Theme) => {
    setThemeState(remoteTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, applyRemoteTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export default ThemeContext;
