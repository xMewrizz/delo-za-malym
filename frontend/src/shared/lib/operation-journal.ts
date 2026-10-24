import { useState } from "react";
import type { z } from "zod";

// Write before dispatch: a remount must retain the exact idempotency key.
export function useOperationJournal<T>(key: string, schema: z.ZodType<T>) {
  const storageKey = `delo-pending-operation:${key}`;
  const [pending, setPending] = useState<T | null>(() => {
    try { const result = schema.safeParse(JSON.parse(localStorage.getItem(storageKey) || "null")); return result.success ? result.data : null; } catch { return null; }
  });
  const [error, setError] = useState("");
  function save(payload: T) {
    try { localStorage.setItem(storageKey, JSON.stringify(payload)); setPending(payload); setError(""); return true; }
    catch { setError("Не удалось сохранить запрос в браузере. Разрешите локальное хранилище и повторите подтверждение."); return false; }
  }
  function clear() { try { localStorage.removeItem(storageKey); } catch { /* Server status remains authoritative. */ } setPending(null); }
  return { pending, save, clear, error };
}
