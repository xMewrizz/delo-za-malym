import type { ComponentProps, ReactNode } from "react";
import { Input } from "./input";
import { Label } from "./label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

export function FormField({
  id,
  label,
  hint,
  error,
  "aria-describedby": describedBy,
  ...props
}: ComponentProps<typeof Input> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="form-field">
      <Label htmlFor={id} className="text-xs font-semibold text-foreground">
        {label}
      </Label>
      <Input
        id={id}
        className="h-11 rounded-xl border-input bg-background px-3"
        {...props}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={[describedBy, hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
      />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ChoiceField({
  id,
  label,
  value,
  onValueChange,
  options,
  hint,
  disabled,
  error,
  emptyLabel = "Не указано",
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: ReactNode;
  disabled?: boolean;
  error?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="form-field">
      <Label htmlFor={id} className="text-xs font-semibold text-foreground">
        {label}
      </Label>
      <Select
        value={value || "__empty__"}
        onValueChange={(next) =>
          onValueChange(next === "__empty__" ? "" : next)
        }
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
          className="h-11 w-full rounded-xl border-input bg-background px-3 text-left"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="max-h-72 rounded-xl border border-border p-1"
        >
          <SelectItem value="__empty__">{emptyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
