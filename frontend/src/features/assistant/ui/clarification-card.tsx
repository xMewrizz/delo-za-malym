import { useId, useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/button";
import { FormField } from "@/shared/ui/form-field";
import type { Clarification } from "../api/chat";

export function ClarificationCard({
  card,
  busy,
  onAnswer,
  onFreeText,
}: {
  card: Clarification;
  busy: boolean;
  onAnswer: (answer: { choice_id: string } | { value: string }) => void;
  onFreeText: () => void;
}) {
  const [value, setValue] = useState("");
  const id = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim() && !busy) onAnswer({ value: value.trim() });
  }
  return (
    <section
      className="clarification-card"
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`} className="text-sm font-bold">
        {card.title}
      </h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {card.choices.map((choice) => (
          <Button
            key={choice.choice_id}
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onAnswer({ choice_id: choice.choice_id })}
          >
            {choice.label}
          </Button>
        ))}
      </div>
      {card.input_type && (
        <form onSubmit={submit} className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1"><FormField
            id={`${id}-answer`}
            aria-label={card.input_type === "money" ? "Своя сумма, ₽" : "Своя дата"}
            label={
              card.input_type === "money" ? "Своя сумма, ₽" : "Своя дата"
            }
            type={card.input_type === "date" ? "date" : "text"}
            inputMode={card.input_type === "money" ? "decimal" : undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
            placeholder={card.input_type === "money" ? "Например, 150 000" : undefined}
          /></div>
          <Button type="submit" size="sm" disabled={busy || !value.trim()}>
            Ответить
          </Button>
        </form>
      )}
      <Button
        className="mt-2"
        variant="ghost"
        size="sm"
        onClick={onFreeText}
        disabled={busy}
      >
        Отвечу своими словами
      </Button>
    </section>
  );
}
