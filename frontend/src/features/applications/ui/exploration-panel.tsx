import { useState, type FormEvent } from "react";
import { ArrowUpRight, GitCompareArrows } from "lucide-react";
import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { ChoiceField, FormField } from "@/shared/ui/form-field";
import type { ApplicationView } from "../api/applications";
import { normalizeMoneyInput } from "../model/need";
import { describeIssue, outcomeName, productName } from "../model/presentation";

type ProductId = "working_capital_loan" | "overdraft";

export function ExplorationPanel({
  view,
  busy,
  onExplore,
  onApply,
}: {
  view: ApplicationView;
  busy: boolean;
  onExplore: (
    productId: ProductId,
    preferences: Record<string, unknown>,
  ) => void;
  onApply: (explorationId: string, optionId: string) => void;
}) {
  const [product, setProduct] = useState<ProductId>(
    view.application.need.preferred_product === "overdraft"
      ? "overdraft"
      : "working_capital_loan",
  );
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("");
  const [minTerm, setMinTerm] = useState("6");
  const [maxTerm, setMaxTerm] = useState("36");
  const [priority, setPriority] = useState("preserve_amount");
  const [preserveAmount, setPreserveAmount] = useState(true);
  const [error, setError] = useState("");
  const latest = view.explorations.at(-1);
  const current =
    latest?.application_version === view.application.application_version;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (product === "overdraft") {
        onExplore(product, {});
        setError("");
        return;
      }
      const minimum = Number(minTerm),
        maximum = Number(maxTerm);
      if (
        !Number.isInteger(minimum) ||
        !Number.isInteger(maximum) ||
        minimum < 1 ||
        maximum > 120 ||
        minimum > maximum
      )
        throw new Error("Проверьте диапазон сроков: от 1 до 120 месяцев.");
      const preferences: Record<string, unknown> = {
        minimum_term: minimum,
        maximum_term: maximum,
        preserve_amount: preserveAmount,
        priority,
      };
      const requested = normalizeMoneyInput(amount);
      const maximumPayment = normalizeMoneyInput(payment);
      if (requested) preferences.requested_amount = requested;
      if (maximumPayment) preferences.maximum_monthly_payment = maximumPayment;
      onExplore(product, preferences);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Проверьте параметры сравнения.",
      );
    }
  }

  return (
    <Card className="gap-0 border border-border bg-card/70">
      <CardHeader className="pb-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <GitCompareArrows className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">
              А если?
            </p>
            <h3 className="text-xl font-extrabold tracking-tight">
              Сравните варианты
            </h3>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Отдельный расчёт не меняет заявку. Подходящий вариант можно применить
          после подтверждения.
        </p>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={submit}
          className="space-y-5 rounded-[22px] border border-border bg-background p-5"
        >
          <ChoiceField
            id="compare-product"
            label="Продукт"
            value={product}
            onValueChange={(value) => setProduct(value as ProductId)}
            options={[
              {
                value: "working_capital_loan",
                label: "Кредит на оборотные цели",
              },
              { value: "overdraft", label: "Овердрафт по денежному плану" },
            ]}
          />
          {product === "working_capital_loan" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="compare-amount"
                  label="Сумма для сравнения, ₽"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="Как в заявке"
                  inputMode="decimal"
                />
                <FormField
                  id="compare-payment"
                  label="Комфортный платёж до, ₽"
                  value={payment}
                  onChange={(event) => setPayment(event.target.value)}
                  placeholder="Без ограничения"
                  inputMode="decimal"
                />
                <FormField
                  id="compare-min"
                  label="Срок от, мес."
                  value={minTerm}
                  onChange={(event) => setMinTerm(event.target.value)}
                  inputMode="numeric"
                />
                <FormField
                  id="compare-max"
                  label="Срок до, мес."
                  value={maxTerm}
                  onChange={(event) => setMaxTerm(event.target.value)}
                  inputMode="numeric"
                />
              </div>
              <ChoiceField
                id="compare-priority"
                label="Что важнее"
                value={priority}
                onValueChange={setPriority}
                options={[
                  { value: "preserve_amount", label: "Сохранить сумму" },
                  { value: "lowest_payment", label: "Уменьшить платёж" },
                  { value: "lowest_total_cost", label: "Уменьшить переплату" },
                ]}
              />
              <label className="flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
                <input
                  type="checkbox"
                  checked={preserveAmount}
                  onChange={(event) => setPreserveAmount(event.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                Не уменьшать запрошенную сумму без подтверждённого минимума
              </label>
            </>
          ) : (
            <p className="rounded-xl bg-secondary p-4 text-xs leading-relaxed text-muted-foreground">
              Для овердрафта расчёт использует денежный план, сохранённый в
              заявке. Если плана нет, вы увидите, какие данные нужно добавить.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            Показать варианты
            <ArrowUpRight aria-hidden="true" />
          </Button>
        </form>
        {latest && (
          <div className="mt-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Последний расчёт · {productName(latest.product_id)}{" "}
              {current ? "" : "· для предыдущей версии заявки"}
            </p>
            {latest.product_id === "overdraft" && latest.result.calculation && (
              <div className="rounded-[20px] border border-primary/20 bg-background p-5">
                <p className="text-sm font-bold">Денежный план по дням</p>
                <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Нужный лимит</dt>
                    <dd className="mt-1 text-lg font-extrabold">
                      {formatMoney(latest.result.calculation.required_limit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Использовано</dt>
                    <dd className="mt-1 text-lg font-extrabold">
                      {formatMoney(latest.result.calculation.total_drawn)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Проценты по плану</dt>
                    <dd className="mt-1 text-lg font-extrabold">
                      {formatMoneyPrecise(
                        latest.result.calculation.total_interest,
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs text-muted-foreground">
                  {latest.result.calculation.feasible
                    ? "План укладывается в рассчитанный лимит и показывает погашение."
                    : "План требует уточнения; смотрите причины ниже."}
                </p>
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-bold text-primary">
                    Показать движение по дням
                  </summary>
                  <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[690px] text-left text-xs">
                      <thead className="bg-secondary">
                        <tr>
                          <th className="p-3">Дата</th>
                          <th className="p-3">Поступило</th>
                          <th className="p-3">Расход</th>
                          <th className="p-3">Использовано</th>
                          <th className="p-3">Погашено</th>
                          <th className="p-3">Проценты</th>
                          <th className="p-3">Долг</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latest.result.calculation.daily.map((day) => (
                          <tr key={day.date} className="border-t border-border">
                            <td className="p-3">
                              {new Date(
                                day.date + "T00:00:00",
                              ).toLocaleDateString("ru-RU")}
                            </td>
                            <td className="p-3">{formatMoney(day.inflow)}</td>
                            <td className="p-3">{formatMoney(day.outflow)}</td>
                            <td className="p-3">{formatMoney(day.drawn)}</td>
                            <td className="p-3">
                              {formatMoney(day.principal_repaid)}
                            </td>
                            <td className="p-3">
                              {formatMoneyPrecise(day.interest_accrued)}
                            </td>
                            <td className="p-3">
                              {formatMoney(day.closing_principal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            )}
            {(latest.result.reasons || []).map((reason, index) => (
              <p
                key={reason.code || index}
                className="rounded-xl bg-background px-4 py-3 text-sm text-muted-foreground"
              >
                {reason.message}
              </p>
            ))}
            {(latest.result.required_information || []).map((issue, index) => (
              <p
                key={"required-" + index}
                className="rounded-xl bg-background px-4 py-3 text-sm text-muted-foreground"
              >
                {describeIssue(issue)}
              </p>
            ))}
            {(!latest.result.options || latest.result.options.length === 0) && (
              <p className="rounded-xl bg-background px-4 py-5 text-sm text-muted-foreground">
                Вариантов пока нет. Статус расчёта:{" "}
                {outcomeName(latest.result.status)}.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {(latest.result.options || []).map((option) => (
                <div
                  key={option.option_id || option.offer_id}
                  className="rounded-[20px] border border-border bg-background p-5"
                >
                  <p className="text-xs font-bold text-primary">
                    {productName(option.product_id)}
                  </p>
                  <p className="mt-1 text-2xl font-extrabold tracking-tight">
                    {formatMoney(option.amount)}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {option.term_months ? option.term_months + " мес. · " : ""}
                    {option.monthly_payment
                      ? "Платёж " + formatMoney(option.monthly_payment)
                      : "По денежному плану"}
                  </p>
                  {option.total_repayment && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Всего к возврату: {formatMoney(option.total_repayment)}
                    </p>
                  )}
                  {current && option.option_id && (
                    <div className="mt-5">
                      <ConfirmAction
                        label="Применить к черновику"
                        title="Применить этот вариант?"
                        description="Параметры варианта станут новой версией черновика. Для отправки заявки потребуется отдельное действие."
                        confirmLabel="Применить"
                        disabled={busy}
                        onConfirm={() =>
                          onApply(latest.exploration_id, option.option_id!)
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
