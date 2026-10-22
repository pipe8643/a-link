import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface ThemeContextValue {
  dark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const KEY = "alink-theme";

function initialDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(initialDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEY, next ? "dark" : "light");
      } catch {
        /* sin almacenamiento: el tema solo dura la sesión */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ dark, toggle }), [dark, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de ThemeProvider");
  return ctx;
}
