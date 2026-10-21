import { useState, type FormEvent } from "react";
import { useSavedDraft } from "@/shared/lib/saved-draft";
import { Button } from "@/shared/ui/button";
import { FormField } from "@/shared/ui/form-field";
import type { ApplicationView } from "../api/applications";
import { normalizeMoneyInput } from "../model/need";

const names = {
  operating_inflow: "Поступления",
  operating_outflow: "Расходы",
  taxes: "Налоги",
};
export function FinancialSupplement({
  view,
  busy,
  onSave,
}: {
  view: ApplicationView;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => void;
}) {
  const financials = view.application.financials;
  const missing = (financials.monthly || []).flatMap((row, index) =>
    (Object.keys(names) as (keyof typeof names)[])
      .filter((field) => row[field] == null)
      .map((field) => ({ field, index, month: row.month })),
  );
  const needsShare = financials.largest_buyer_share == null;
  const [values, setValues] = useSavedDraft<Record<string, string>>(
    `delo-financials:${view.application.application_id}:${view.application.application_version}`,
    {},
  );
  const [error, setError] = useState("");
  if (!missing.length && !needsShare) return null;
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const changes: Record<string, unknown> = {};
      if (missing.length) {
        const monthly = structuredClone(financials.monthly || []);
        for (const item of missing) {
          const amount = normalizeMoneyInput(
            values[`${item.index}:${item.field}`] || "",
            true,
          );
          if (amount === null)
            throw new Error(
              "Заполните недостающие показатели; если сумма нулевая, укажите 0.",
            );
          monthly[item.index][item.field] = amount;
        }
        changes["financials.monthly"] = monthly;
      }
      if (needsShare) {
        const share = (values.share || "").trim().replace(",", ".");
        if (!/^\d{1,3}(\.\d{1,2})?$/.test(share) || Number(share) > 100)
          throw new Error("Доля покупателя — от 0 до 100%.");
        changes["financials.largest_buyer_share"] = Number(share) / 100;
      }
      onSave(changes);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Проверьте показатели.",
      );
    }
  }
  return (
    <section className="rounded-2xl border border-primary/20 bg-card p-5">
      <h3 className="font-bold">Нужно дополнить данные бизнеса</h3>
      <p className="mt-2 text-xs text-muted-foreground">
        Показаны только сведения, которых сейчас нет у банка.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          {missing.map((item) => {
            const key = `${item.index}:${item.field}`;
            return (
              <FormField
                key={key}
                id={`financial-${key}`}
                label={`${names[item.field]}, ₽ · ${item.month}`}
                inputMode="decimal"
                value={values[key] || ""}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
              />
            );
          })}
          {needsShare && (
            <FormField
              id="buyer-share"
              label="Доля крупнейшего покупателя, %"
              hint="Какая часть выручки приходится на одного покупателя."
              inputMode="decimal"
              value={values.share || ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  share: event.target.value,
                }))
              }
            />
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button disabled={busy} type="submit">
          Сохранить дополнения
        </Button>
      </form>
    </section>
  );
}
