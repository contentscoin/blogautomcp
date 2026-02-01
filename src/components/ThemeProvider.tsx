"use client";

import { useState, useEffect, createContext, useContext, ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: "light" | "dark";
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within ThemeProvider");
    }
    return context;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>("system");
    const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

    useEffect(() => {
        // 저장된 테마 불러오기
        const saved = localStorage.getItem("theme") as Theme | null;
        if (saved) {
            setThemeState(saved);
        }
    }, []);

    useEffect(() => {
        // 시스템 테마 감지
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

        const updateResolvedTheme = () => {
            if (theme === "system") {
                setResolvedTheme(mediaQuery.matches ? "dark" : "light");
            } else {
                setResolvedTheme(theme);
            }
        };

        updateResolvedTheme();
        mediaQuery.addEventListener("change", updateResolvedTheme);

        return () => mediaQuery.removeEventListener("change", updateResolvedTheme);
    }, [theme]);

    useEffect(() => {
        // 다크모드 클래스 적용
        if (resolvedTheme === "dark") {
            document.documentElement.classList.add("dark");
        } else {
            document.documentElement.classList.remove("dark");
        }
    }, [resolvedTheme]);

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem("theme", newTheme);
    };

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();

    return (
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
                onClick={() => setTheme("light")}
                className={`p-2 rounded ${theme === "light"
                        ? "bg-white dark:bg-slate-700 shadow-sm"
                        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                title="라이트 모드"
            >
                ☀️
            </button>
            <button
                onClick={() => setTheme("dark")}
                className={`p-2 rounded ${theme === "dark"
                        ? "bg-white dark:bg-slate-700 shadow-sm"
                        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                title="다크 모드"
            >
                🌙
            </button>
            <button
                onClick={() => setTheme("system")}
                className={`p-2 rounded ${theme === "system"
                        ? "bg-white dark:bg-slate-700 shadow-sm"
                        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                title="시스템 설정"
            >
                💻
            </button>
        </div>
    );
}
