import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const getTheme = (): Theme => typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
const subscribe = (listener: () => void) => {
  window.addEventListener("delo-theme-change", listener);
  return () => window.removeEventListener("delo-theme-change", listener);
};

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "dark" as const);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#101014" : "#f6f6f2");
    try { localStorage.setItem("delo-theme", next); } catch { /* The theme still works without storage. */ }
    window.dispatchEvent(new Event("delo-theme-change"));
  }
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={`Переключить на ${theme === "dark" ? "светлую" : "тёмную"} тему`} title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}<span>{theme === "dark" ? "Светлая" : "Тёмная"}</span></button>;
}
