import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "@/shared/api/client";
import { formatMoney } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import type { ApplicationView, Offer } from "../api/applications";
import { getLoanCashFlow } from "../api/cashflow";
import { CashFlowChart } from "./cash-flow-chart";

const dateLabel = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("ru-RU");

export function LoanOptionDetails({
  view,
  explorationId,
  option,
  current,
  onSavePlan,
}: {
  view: ApplicationView;
  explorationId: string;
  option: Offer;
  current: boolean;
  onSavePlan?: (plan: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0);
  const [inflowId, setInflowId] = useState(""),
    [days, setDays] = useState("7");
  const [delay, setDelay] = useState<
    { transaction_id: string; days: number } | undefined
  >();
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: [
      "loan-cash-flow",
      view.application.application_id,
      view.application.application_version,
      explorationId,
      option.option_id,
      delay,
    ],
    queryFn: () => getLoanCashFlow(view, explorationId, option, delay),
    enabled: open && current,
    retry: false,
  });
  const result = query.data,
    flow = result?.cash_flow,
    scenario = result?.scenario_cash_flow;
  const plan = view.application.product_details?.overdraft;
  const inflows =
    plan &&
    typeof plan === "object" &&
    "transactions" in plan &&
    Array.isArray(plan.transactions)
      ? plan.transactions.filter(
          (
            row,
          ): row is { transaction_id: string; date: string; amount: string } =>
            row?.direction === "inflow" &&
            typeof row.transaction_id === "string" &&
            typeof row.date === "string" &&
            typeof row.amount === "string",
        )
      : [];
  return (
    <details
      className="loan-calendar mt-4 border-t border-border pt-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs font-bold text-primary">
        Платежи по датам и остаток денег
      </summary>
      <div className="mt-3 space-y-4">
        {!current && (
          <p className="text-xs text-muted-foreground">
            Данные изменились. Пересчитайте варианты для нового графика.
          </p>
        )}
        {query.isFetching && (
          <p role="status" className="text-xs text-muted-foreground">
            Считаем календарь…
          </p>
        )}
        {query.error && (
          <p role="alert" className="text-xs text-destructive">
            {getErrorMessage(query.error)}{" "}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Повторить
            </Button>
          </p>
        )}
        {result && (
          <>
            <p className="text-xs text-muted-foreground">
              Расчётная дата выдачи: {dateLabel(result.funding_date)} ·{" "}
              {formatMoney(option.amount)}. Комиссия:{" "}
              {formatMoney(option.fees_total || "0.00")}.
            </p>
            <ol
              className="divide-y divide-border"
              aria-label="Календарь платежей по кредиту"
            >
              {result.schedule.slice(page * 6, page * 6 + 6).map((row) => (
                <li key={row.month_number} className="py-3 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <time dateTime={row.date}>{dateLabel(row.date)}</time>
                    <strong>{formatMoney(row.total_payment)}</strong>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Проценты {formatMoney(row.interest_payment)} · остаток долга{" "}
                    {formatMoney(row.closing_balance)}
                  </p>
                </li>
              ))}
            </ol>
            {result.schedule.length > 6 && (
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Назад
                </Button>
                <span className="text-xs">
                  {page * 6 + 1}–
                  {Math.min(result.schedule.length, page * 6 + 6)} из{" "}
                  {result.schedule.length}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={(page + 1) * 6 >= result.schedule.length}
                  onClick={() => setPage(page + 1)}
                >
                  Далее
                </Button>
              </div>
            )}
            {flow?.issues?.map((issue, index) => (
              <p
                key={index}
                className="rounded-xl bg-card p-3 text-xs text-muted-foreground"
              >
                {issue.message}
              </p>
            ))}
            {flow && flow.daily.length > 0 && (
              <div
                className={
                  scenario?.daily.length ? "grid gap-4 xl:grid-cols-2" : ""
                }
              >
                <div>
                  <p className="mb-2 text-xs font-bold">
                    {scenario ? "С текущими датами поступлений" : "С учётом ваших платежей и поступлений"}
                  </p>
                  <CashFlowChart days={flow.daily} />
                  <p className="mt-2 text-xs">
                    Минимальный остаток: {formatMoney(flow.minimum_cash!)}.
                  </p>
                  {flow.status === "cash_shortfall" && (
                    <p className="mt-1 text-xs text-destructive">
                      Даже с этим кредитом в плане остаётся нехватка денег.
                      Измените сумму или сроки расходов.
                    </p>
                  )}
                  {flow.status === "below_reserve" && (
                    <p className="mt-1 text-xs text-destructive">
                      Остаток опускается ниже выбранного резерва.
                    </p>
                  )}
                </div>
                {scenario && (
                  <div>
                    <p className="mb-2 text-xs font-bold">
                      Покупатель заплатит позже
                    </p>
                    {scenario.daily.length > 0 && (
                      <>
                        <CashFlowChart days={scenario.daily} />
                        <p className="mt-2 text-xs">
                          Минимальный остаток:{" "}
                          {formatMoney(scenario.minimum_cash!)}.
                        </p>
                        {scenario.status === "cash_shortfall" && (
                          <p className="mt-1 text-xs text-destructive">
                            После переноса возникает нехватка денег.
                          </p>
                        )}
                      </>
                    )}
                    {scenario.issues?.map((issue, index) => (
                      <p key={index} className="text-xs text-destructive">
                        {issue.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {flow && flow.daily.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Показан остаток конца дня в пределах заданного периода. Учтены
                указанные поступления и расходы, выдача кредита и его платежи по
                календарю.
              </p>
            )}
            {inflows.length > 0 && Boolean(flow?.daily.length) && (
              <fieldset className="space-y-2 rounded-xl bg-card p-3">
                <legend className="px-1 text-xs font-bold">
                  Если поступление задержится
                </legend>
                <label className="grid gap-1 text-xs">
                  Поступление
                  <select
                    aria-label="Поступление для переноса"
                    className="min-w-0 rounded-lg border border-border bg-background p-2"
                    value={inflowId}
                    onChange={(event) => setInflowId(event.target.value)}
                  >
                    <option value="">Выберите поступление</option>
                    {inflows.map((row) => (
                      <option
                        key={row.transaction_id}
                        value={row.transaction_id}
                      >
                        {dateLabel(row.date)} · {formatMoney(row.amount)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs">
                  На сколько дней
                  <input
                    aria-label="Задержка поступления, дней"
                    type="number"
                    min="1"
                    max="30"
                    className="rounded-lg border border-border bg-background p-2"
                    value={days}
                    onChange={(event) => setDays(event.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!inflowId || query.isFetching || !current}
                  onClick={() => {
                    const count = Number(days);
                    if (!Number.isInteger(count) || count < 1 || count > 30) {
                      setError("Укажите от 1 до 30 дней.");
                      return;
                    }
                    setError("");
                    setDelay({ transaction_id: inflowId, days: count });
                  }}
                >
                  Сравнить с задержкой
                </Button>
                {delay && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDelay(undefined)}
                  >
                    Убрать сравнение
                  </Button>
                )}
                {error && (
                  <p role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </fieldset>
            )}
            {delay &&
            result.projected_plan &&
            scenario?.daily.length &&
            current &&
            onSavePlan ? (
              <ConfirmAction
                label="Применить перенос"
                title="Изменить дату поступления в денежном плане?"
                description="Исходный план изменится. После этого нужно пересчитать варианты кредита."
                confirmLabel="Изменить дату"
                onConfirm={() => onSavePlan(result.projected_plan!)}
              />
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}
