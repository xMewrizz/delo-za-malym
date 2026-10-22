export function originFor(sources: unknown, path: string): unknown {
  return sources && typeof sources === "object"
    ? (sources as Record<string, unknown>)[path]
    : undefined;
}
