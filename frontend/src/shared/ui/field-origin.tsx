export function FieldOrigin({ source }: { source: unknown }) {
  if (
    !source ||
    typeof source !== "object" ||
    !("document_id" in source) ||
    typeof source.document_id !== "string"
  )
    return null;
  const original =
    "original" in source &&
    source.original &&
    typeof source.original === "object" &&
    "page" in source.original
      ? source.original
      : null;
  const id = "document-" + source.document_id;
  return (
    <a
      className="mt-2 inline-block text-xs font-semibold text-primary underline"
      href={`#${id}`}
      onClick={(event) => {
        const target = document.getElementById(id);
        if (target instanceof HTMLDetailsElement) {
          event.preventDefault();
          target.open = true;
          target.scrollIntoView({
            block: "nearest",
            behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
              ?.matches
              ? "auto"
              : "smooth",
          });
        }
      }}
    >
      Из счёта{original ? `, стр. ${String(original.page)}` : ""}
      {"user_corrected" in source && source.user_corrected
        ? " · исправлено"
        : ""}
    </a>
  );
}
