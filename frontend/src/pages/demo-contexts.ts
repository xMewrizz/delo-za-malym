export type CabinetContexts = {manual:string|null;assistant:string|null};

/** Recover demo entry points only when the server still has those applications. */
export function resolveCabinetContexts(saved: CabinetContexts, available: readonly string[], examples: Partial<CabinetContexts> = {}, createdInSession: ReadonlySet<string> = new Set()): CabinetContexts {
  const ids = new Set(available);
  const next: CabinetContexts = {manual:null,assistant:null};
  for (const source of ["manual","assistant"] as const) {
    const id = saved[source];
    if (id && (ids.has(id) || createdInSession.has(id)) && id !== next.manual) next[source] = id;
  }
  for (const source of ["manual","assistant"] as const) {
    const id = examples[source];
    if (!next[source] && id && ids.has(id) && id !== next[source === "manual" ? "assistant" : "manual"]) next[source] = id;
  }
  return next;
}

export async function loadShowcaseContexts(signal: AbortSignal): Promise<Partial<CabinetContexts>> {
  try {
    const response = await fetch("/project-docs/demo-showcase.json", {signal});
    if (!response.ok) return {};
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("schema_version" in value) || value.schema_version !== 1 || !("contexts" in value)) return {};
    const contexts = value.contexts;
    if (!contexts || typeof contexts !== "object") return {};
    return Object.fromEntries(["manual","assistant"].flatMap(source => {
      const id = (contexts as Record<string,unknown>)[source];
      return typeof id === "string" && /^[a-f0-9-]{36}$/.test(id) ? [[source,id]] : [];
    }));
  } catch { return {}; }
}
