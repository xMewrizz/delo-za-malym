import { AlertDialog } from "radix-ui";
import { Button } from "./button";

export function ConfirmAction({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled = false,
  variant = "default",
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "destructive";
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button variant={variant} disabled={disabled}>
          {label}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/45 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-border bg-background p-7 shadow-2xl">
          <AlertDialog.Title className="text-xl font-bold tracking-tight">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">Вернуться</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button onClick={onConfirm}>{confirmLabel}</Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
