import { PenaltyTermsNote } from "@/shared/ui/penalty-terms-note";
import { useState, useRef, type FormEvent, type ReactNode } from "react";
import { CircleHelp, GitCompareArrows } from "lucide-react";
import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { ChoiceField, FormField } from "@/shared/ui/form-field";
import { Disclosure } from "@/shared/ui/disclosure";
import type { ApplicationView } from "../api/applications";
import { normalizeMoneyInput } from "../model/need";
import { describeIssue, productName } from "../model/presentation";
import { flowDaysSchema } from "../api/applications";
import { CashFlowChart } from "./cash-flow-chart";
import { LoanOptionDetails } from "./loan-option-details";
import { OfferKeyFigures } from "./offer-key-figures";
import { InvestmentTerms } from "./investment-terms";
import { RefinancingBaseline, RefinancingEffect } from "./refinancing-comparison";
import { RevolvingTerms } from "@/features/credit-line/credit-line-panel";
import { z } from "zod";
import "./offer-comparison.css";

type ProductId = "working_capital_loan" | "overdraft" | "refinancing" | "revolving_credit_line" | "investment_loan";

export function ExplorationPanel({
  view,
  busy,
  onExplore,
  onApply,
  compact = false,
  focused = false,
  onSavePlan,
  onEditNeed,
}: {
  view: ApplicationView;
  busy: boolean;
  onExplore: (
    productId: ProductId,
    preferences: Record<string, unknown>,
    delay?: { transaction_id: string; days: number },
  ) => void;
  onApply: (explorationId: string, optionId: string) => void;
  compact?: boolean;
  focused?: boolean;
  onSavePlan?: (plan: Record<string, unknown>) => void;
  onEditNeed?: () => void;
}) {
  const need = view.application.need;
  const productContext = JSON.stringify([
    view.application.application_id,
    need.preferred_product,
    need.financing_pattern,
  ]);
  const [productOverride, setProductOverride] = useState<{
    context: string;
    product: ProductId;
  } | null>(null);
  const product: ProductId =
    productOverride?.context === productContext
      ? productOverride.product
      : need.preferred_product === "investment_loan" ? "investment_loan" : need.preferred_product === "revolving_credit_line" ? "revolving_credit_line" : need.preferred_product === "refinancing" ? "refinancing" : need.preferred_product === "overdraft" ||
          (!need.preferred_product && need.financing_pattern === "cash_gap")
        ? "overdraft"
        : "working_capital_loan";
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("");
  const [minTerm, setMinTerm] = useState("6");
  const [maxTerm, setMaxTerm] = useState(need.preferred_product === "investment_loan" ? "60" : need.preferred_product === "revolving_credit_line" ? "12" : need.preferred_product === "investment_loan" ? "60" : product === "refinancing" ? "48" : "36");
  const [priority, setPriority] = useState("preserve_amount");
  const amountContext = JSON.stringify([view.application.application_id, need.requested_amount, need.minimum_acceptable_amount]);
  const [amountPreference, setAmountPreference] = useState<{context:string;value:boolean} | null>(null);
  const preserveAmount = amountPreference?.context === amountContext ? amountPreference.value : !(need.minimum_acceptable_amount && need.requested_amount && Number(need.minimum_acceptable_amount) < Number(need.requested_amount));
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState<string[]>([]);
  const [delayId, setDelayId] = useState(""),
    [delayDays, setDelayDays] = useState("7");
  const latest = view.explorations.at(-1);
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
            row &&
            row.direction === "inflow" &&
            typeof row.transaction_id === "string" &&
            typeof row.date === "string" &&
            typeof row.amount === "string",
        )
      : [];
  const days = flowDaysSchema.safeParse(latest?.result.daily);
  const baselineDays = flowDaysSchema.safeParse(latest?.result.baseline_daily);
  const current =
    latest?.application_version === view.application.application_version;
  const baseline = z.object({ monthly_payment: z.string() }).safeParse(latest?.result.baseline);
  const options = latest?.result.options || [];
  const minimumRequired = latest?.result.required_information?.some(issue => issue && typeof issue === "object" && "code" in issue && issue.code === "minimum_acceptable_amount_required");
  const settings = useRef<HTMLDetailsElement>(null);
  const capacity = options.find(option => typeof option.available_monthly_payment === "string")?.available_monthly_payment;
  const debts = view.application.financials.existing_loans || [];
  const debtLoadKnown = debts.every(loan => loan.monthly_payment != null);
  const debtLoad = debts.reduce((total, loan) => total + Number(loan.monthly_payment || 0), 0);
  const changedTerm = current && need.term_months && options.length > 0 &&
    !options.some(option => option.term_months === need.term_months && option.amount === need.requested_amount);
  const originalOverdraft = z.object({ required_limit: z.string(), total_interest: z.string() }).safeParse(latest?.result.baseline);
  const scenarioNeedsPeriod = Boolean(latest?.result.delay) && Boolean(latest?.result.required_information?.some(issue =>
    issue && typeof issue === "object" && "code" in issue && issue.code === "delay_outside_horizon"));

  const calculationContext = latest && (<>
    {latest.product_id === "refinancing" && <RefinancingBaseline value={latest.result.refinancing} />}
    {current && latest.product_id !== "refinancing" && debts.length > 0 && (
      <section aria-label="Учтённые кредиты" className="rounded-xl border border-border bg-background p-4 text-sm">
        <h4 className="font-semibold">Действующие кредиты уже учтены</h4>
        <p className="mt-2 text-muted-foreground">{debtLoadKnown ? `Платежи и резервы по открытым лимитам — ${formatMoneyPrecise(String(debtLoad))} в месяц.` : "По части обязательств нужно уточнить платёж."}{typeof capacity === "string" ? ` На новый кредит доступно до ${formatMoneyPrecise(capacity)} в месяц.` : ""}</p>
        <Disclosure className="mt-3" title={`Учтённые обязательства · ${debts.length}`}>
          <ul className="mt-3 space-y-3">{debts.map((loan, index) => {
            const firstPayment = loan.schedule?.[0]?.total_payment;
            const grace = loan.product_id === "investment_loan" && firstPayment && loan.monthly_payment && Number(firstPayment) < Number(loan.monthly_payment);
            return <li key={loan.loan_id} className="border-t border-border pt-3">
              <p className="font-semibold">{loan.product_id ? productName(loan.product_id) : `Кредит из банковского профиля ${index + 1}`}</p>
              <p className="mt-1 text-xs text-muted-foreground">Остаток долга: {loan.outstanding_principal != null ? formatMoneyPrecise(loan.outstanding_principal) : "уточняется"}. {loan.is_commitment ? "Резерв нагрузки" : "Максимальный платёж"}: {loan.monthly_payment != null ? `${formatMoneyPrecise(loan.monthly_payment)} в месяц` : "уточняется"}.</p>
              {grace && <p className="mt-2 text-xs text-muted-foreground">В начале графика — {formatMoneyPrecise(firstPayment)} в месяц, только проценты. Для нового кредита учитываем максимальный платёж после отсрочки, когда начнётся погашение основного долга.</p>}
            </li>;
          })}</ul>
        </Disclosure>
      </section>
    )}
    {changedTerm && baseline.success && typeof capacity === "string" && Number(baseline.data.monthly_payment) > Number(capacity) && (
      <p className="rounded-xl bg-primary/10 p-4 text-sm">На запрошенные {need.term_months} мес. платёж составил бы {formatMoney(baseline.data.monthly_payment)} в месяц. С учётом действующих кредитов доступно до {formatMoney(capacity)}. Ниже — условия с посильным платежом.</p>
    )}
    {!scenarioNeedsPeriod && days.success && days.data.length > 0 && (
      <div
        className={
          latest.result.delay ? "grid gap-4 xl:grid-cols-2" : ""
        }
      >
        {Boolean(latest.result.delay) && baselineDays.success && (
          <div>
            <p className="mb-2 text-xs font-bold">Исходный план</p>
            <CashFlowChart days={baselineDays.data} />
          </div>
        )}
        <div>
          {latest.result.delay ? (
            <p className="mb-2 text-xs font-bold">
              При задержке поступления
            </p>
          ) : null}
          <CashFlowChart days={days.data} />
        </div>
      </div>
    )}
    {!scenarioNeedsPeriod && latest.product_id === "overdraft" && latest.result.calculation && (
      <div className="rounded-[20px] border border-primary/20 bg-background p-5">
        <p className="text-sm font-bold">Сколько нужно занять до поступления денег</p>
        <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Нужный лимит</dt>
            <dd className="mt-1 text-lg font-extrabold">
              {formatMoney(latest.result.calculation.required_limit)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Потребуется использовать</dt>
            <dd className="mt-1 text-lg font-extrabold">
              {formatMoney(latest.result.calculation.total_drawn)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Проценты за использование</dt>
            <dd className="mt-1 text-lg font-extrabold">
              {formatMoneyPrecise(
                latest.result.calculation.total_interest,
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          {latest.result.calculation.feasible
            ? Number(latest.result.calculation.required_limit) === 0
              ? "По этому плану недостатка денег нет: кредит для этих платежей не нужен."
              : "По денежному плану ожидаемых поступлений хватило бы на возврат расчётного долга и процентов."
            : "Нужно уточнить платежи или поступления; причины указаны ниже."}
        </p>
        <Disclosure className="mt-4" title="Движение денег по дням">
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table aria-label="Движение денег по дням при использовании овердрафта" className="w-full min-w-[690px] text-left text-xs">
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
        </Disclosure>
      </div>
    )}
  </>);

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
      if (requested && product !== "refinancing" && product !== "investment_loan") preferences.requested_amount = requested;
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

  function compareDelay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const count = Number(delayDays);
    if (!delayId || !Number.isInteger(count) || count < 1 || count > 30) {
      setError("Выберите поступление и задержку от 1 до 30 дней.");
      return;
    }
    setError("");
    onExplore("overdraft", {}, { transaction_id: delayId, days: count });
  }

  return (
    <Card className="comparison-panel gap-0 border border-border bg-card/70">
      <CardHeader className="comparison-header pb-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <GitCompareArrows className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">
              Сравнение условий
            </p>
            <h3 className="text-xl font-semibold tracking-tight">
              {latest && current && !options.length ? "Уточним условия подбора" : "Подходящие предложения"}
            </h3>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {latest && current && !options.length ? "" : product === "revolving_credit_line" ? "Сравните лимит и срок. Проценты зависят от того, сколько денег вы используете." : options.length > 1 ? "Подобрали несколько вариантов по вашей задаче и данным бизнеса. Сравните платёж и полную стоимость." : "Покажем доступные условия по вашей задаче и данным бизнеса."}
          {(!latest || options.length > 0) && " Выберите предложение и проверьте заявку перед отправкой."}
        </p>
      </CardHeader>
      <CardContent className="comparison-body">
        {error && <p role="alert" className="my-3 text-sm text-destructive">{error}</p>}
        {latest && (
          <ExplorationResult current={current} busy={busy} refresh={() => onExplore(product, preserveAmount ? {} : {preserve_amount:false})}><div className="mt-5 space-y-3">
            {!current && <p className="text-xs text-muted-foreground">Условия для предыдущей версии заявки</p>}
            {Boolean(latest.result.delay) && (
              <div className="rounded-xl border border-primary/30 p-4">
                <p className="text-sm font-bold">Проверка задержки поступления</p>
                <p className="mt-2 text-xs text-muted-foreground">Сохранённый план не изменён. Чтобы оставить новые даты, нужно отдельно выбрать условия.</p>
                {scenarioNeedsPeriod && <p className="my-3 text-sm">Задержка выходит за известный период. Сначала дополните платежи и поступления до новой даты через «Изменить задачу» — затем сравним результат.</p>}
                {!scenarioNeedsPeriod && originalOverdraft.success && latest.result.calculation && <dl className="my-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div><dt>С текущими датами</dt><dd>Нехватка {formatMoney(originalOverdraft.data.required_limit)} · проценты {formatMoneyPrecise(originalOverdraft.data.total_interest)}</dd></div>
                  <div><dt>При задержке</dt><dd>Нехватка {formatMoney(latest.result.calculation.required_limit)} · проценты {formatMoneyPrecise(latest.result.calculation.total_interest)}</dd></div>
                </dl>}
                <Button variant="outline" size="sm" disabled={busy || !current} onClick={() => onExplore("overdraft", {})}>Вернуться к основным предложениям</Button>
              </div>
            )}
            {!focused && !compact && calculationContext}
            {!options.length ? <ExplorationEmpty result={latest.result} busy={busy} onEdit={onEditNeed} onRetry={() => onExplore(product, preserveAmount ? {} : {preserve_amount:false})} onSettings={() => { if (settings.current) { settings.current.open = true; settings.current.scrollIntoView?.({block:"nearest"}); settings.current.querySelector("summary")?.focus(); } }} /> : <>
              {latest.result.reasons?.length ? <p className="exploration-explanation">{latest.result.reasons.map(reason => reason.message).join(" ")}</p> : null}
            </>}
            {current && options.length > 1 && <div className="offer-compare-guide"><p>Отметьте до трёх вариантов для сравнения рядом.</p></div>}
            {current && options.filter(option => comparison.includes(option.option_id || option.offer_id)).length > 0 && <section className="offer-compare-tray" aria-label="Выбранные варианты для сравнения"><header><strong>Сравнение вариантов</strong><Button variant="ghost" size="sm" onClick={() => setComparison([])}>Очистить сравнение</Button></header><div className="offer-compare-scroll"><table><caption className="sr-only">Сумма, платёж и стоимость отмеченных вариантов</caption><thead><tr><th scope="col">Параметр</th>{options.filter(option => comparison.includes(option.option_id || option.offer_id)).map(option => <th scope="col" key={option.option_id || option.offer_id}>{option.term_months ? `${option.term_months} мес.` : productName(option.product_id)}</th>)}</tr></thead><tbody>{([ ["Сумма", "amount"], ["В месяц", "monthly_payment"], ["Всего к возврату", "total_repayment"], ["Переплата", "total_interest"] ] as const).map(([label, key]) => <tr key={key}><th scope="row">{label}</th>{options.filter(option => comparison.includes(option.option_id || option.offer_id)).map(option => <td key={option.option_id || option.offer_id}>{typeof option[key] === "string" ? formatMoney(option[key] as string) : "По использованию"}</td>)}</tr>)}</tbody></table></div></section>}
            <div className="offer-comparison-grid" aria-label="Готовые предложения">
              {(latest.result.options || []).map((option) => (
                <div
                  key={option.option_id || option.offer_id}
                  className="exploration-option rounded-[20px] border border-border bg-background p-5"
                >
                  {current && options.length > 1 && <label className="offer-compare-choice"><input type="checkbox" checked={comparison.includes(option.option_id || option.offer_id)} disabled={busy || options.filter(item => comparison.includes(item.option_id || item.offer_id)).length >= 3 && !comparison.includes(option.option_id || option.offer_id)} onChange={event => setComparison(previous => event.target.checked ? [...previous.filter(id => options.some(item => (item.option_id || item.offer_id) === id)), option.option_id || option.offer_id] : previous.filter(id => id !== (option.option_id || option.offer_id)))} />Сравнить {option.term_months ? `· ${option.term_months} мес.` : "вариант"}</label>}
                  <div className="offer-heading"><p>{productName(option.product_id)}</p>{option.term_months != null && <span className="offer-term">{option.term_months} мес.</span>}</div>
                  <OfferKeyFigures option={option} />
                  {Array.isArray(option.labels) && option.labels.length > 0 && <div className="offer-labels">{option.labels.filter((label): label is string => typeof label === "string").map(label => <span key={label}>{label}</span>)}</div>}
                  <dl className="offer-costs">
                    {typeof option.total_interest === "string" && <div><dt>Переплата</dt><dd>{formatMoney(option.total_interest)}</dd></div>}
                    {option.total_repayment && <div><dt>Всего к возврату</dt><dd>{formatMoney(option.total_repayment)}</dd></div>}
                    <div><dt>Ставка в год</dt><dd>{option.annual_rate_percent ? Number(option.annual_rate_percent).toLocaleString("ru-RU") : "—"}%</dd></div>
                    <div><dt>Комиссии</dt><dd>{formatMoney(option.fees_total || "0")}</dd></div>
                  </dl>
                  <PenaltyTermsNote value={option.penalty_terms} />
                  {option.conditions?.length ? (
                    <p className="mt-2 text-xs font-semibold text-primary">
                      Требуется поручительство
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Без поручительства и залога
                    </p>
                  )}
                  {option.product_id === "investment_loan" && <InvestmentTerms offer={option} />}
                  {option.product_id === "refinancing" && <RefinancingEffect offer={option} />}
                  {option.product_id === "revolving_credit_line" && <RevolvingTerms value={option.revolving} />}
                  <div className="offer-actions">
                  {option.product_id === "working_capital_loan" &&
                    option.option_id && (
                      <LoanOptionDetails
                        key={`${latest.exploration_id}:${option.option_id}`}
                        view={view}
                        explorationId={latest.exploration_id}
                        option={option}
                        current={current}
                        onSavePlan={onSavePlan}
                      />
                    )}
                  {current && option.option_id && (
                    <div className="offer-select-action">
                      <ConfirmAction
                        label="Выбрать условия"
                        title="Перейти к заявке с этими условиями?"
                        description="Собранная заявка появится в разделе «Заявки». Перед отправкой вы сможете проверить данные."
                        confirmLabel="Перейти к заявке"
                        disabled={busy}
                        onConfirm={() =>
                          onApply(latest.exploration_id, option.option_id!)
                        }
                      />
                    </div>
                  )}
                  </div>
                </div>
              ))}
            </div>
            {(focused || compact) && options.length > 0 && <Disclosure className="exploration-context mt-5" title="Что учтено в расчёте" description="Обязательства бизнеса, доступный платёж и условия продукта.">
              <div className="space-y-4">{calculationContext}</div>
            </Disclosure>}
          </div></ExplorationResult>
        )}
        {!minimumRequired && <Disclosure ref={settings} className="exploration-settings mt-5" open={!latest && !compact} title="Изменить параметры сравнения" description="Уточните платёж или диапазон сроков и получите другие варианты.">
          <form
          onSubmit={submit}
          className="space-y-5"
        >
          <p className="text-sm font-semibold">
            Рассчитаем: {productName(product)}
          </p>
          <p className="text-xs text-muted-foreground">
            {product === "investment_loan" ? "Сумма равна стоимости проекта минус ваш взнос. Платёж проверяем после отсрочки; сравниваем полную переплату." : product === "refinancing" ? "Сумма равна остатку выбранных долгов. Сравним несколько сроков, платежи и оставшуюся стоимость." : product === "overdraft"
              ? "Лимит и проценты определим по сохранённым поступлениям и расходам."
              : amount.trim()
                ? `Сумма для сравнения: ${amount} ₽. Исходный запрос не меняется.`
                : "Сумма уже взята из вашего запроса. Покажем доступные сроки и платежи."}
          </p>
          {product !== "overdraft" && payment.trim() && (
            <p className="text-xs text-muted-foreground">
              Ограничение платежа: до {payment} ₽ в месяц.
            </p>
          )}
          <div>
            <fieldset disabled={busy} className="mt-4 space-y-5">
              {need.purpose !== "refinancing" && need.preferred_product !== "refinancing" && product !== "investment_loan" && <ChoiceField
                id="compare-product"
                label="Продукт"
                value={product}
                onValueChange={(value) => {
                  if (value === "overdraft" || value === "working_capital_loan" || value === "refinancing" || value === "revolving_credit_line")
                    setProductOverride({ context: productContext, product: value });
                }}
                options={[
                  {
                    value: "working_capital_loan",
                    label: "Кредит на оборотные цели",
                  },
                  { value: "overdraft", label: "Овердрафт до поступления денег" },
                  { value: "revolving_credit_line", label: "Возобновляемая кредитная линия" },
                ]}
              />}
              {product !== "overdraft" ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {product !== "refinancing" && product !== "investment_loan" && (
                    <FormField
                      id="compare-amount"
                      label="Сумма для сравнения, ₽"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="Как в заявке"
                      inputMode="decimal"
                    />
                    )}
                    <FormField
                      id="compare-payment"
                      label={product === "revolving_credit_line" ? "Резерв нагрузки до, ₽/мес." : "Комфортный платёж до, ₽"}
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
                  {product !== "revolving_credit_line" && <ChoiceField
                    id="compare-priority"
                    label="Что важнее"
                    value={priority}
                    onValueChange={setPriority}
                    options={[
                      { value: "preserve_amount", label: "Сохранить сумму" },
                      { value: "lowest_payment", label: "Уменьшить платёж" },
                      {
                        value: "lowest_total_cost",
                        label: "Уменьшить переплату",
                      },
                    ]}
                  />}
                  {product !== "refinancing" && product !== "investment_loan" && (
                  <label className="flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={preserveAmount}
                      onChange={(event) =>
                        setAmountPreference({context:amountContext,value:event.target.checked})
                      }
                      className="mt-0.5 size-4 accent-primary"
                    />
                    Не уменьшать запрошенную сумму без подтверждённого минимума
                  </label>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <p className="rounded-xl bg-secondary p-4 text-xs leading-relaxed text-muted-foreground">
                    Учтём остаток на счёте и указанные даты платежей и поступлений.
                    Если сведений не хватает, покажем, что нужно уточнить.
                  </p>

                </div>
              )}
            </fieldset>
          </div>
          <Button type="submit" disabled={busy}>
            Показать варианты

          </Button>
        </form>
        </Disclosure>}
        {product === "overdraft" && latest && inflows.length > 0 && (
          <Disclosure className="mt-4" title="Если поступление задержится" description="Сравните исходный план с более поздним поступлением денег.">
            <p className="my-3 text-xs text-muted-foreground">Проверим, хватит ли лимита и как изменятся проценты. Сохранённые даты останутся прежними до выбора условий.</p>
            <form onSubmit={compareDelay} className="space-y-4">

                    <div className="grid gap-4 sm:grid-cols-2">
                      <ChoiceField
                        id="delay-inflow"
                        label="Какое поступление задержится"
                        value={delayId}
                        onValueChange={setDelayId}
                        options={inflows.map((row) => ({
                          value: row.transaction_id,
                          label: `${formatMoney(row.amount)} · ${new Date(row.date + "T12:00:00").toLocaleDateString("ru-RU")}`,
                        }))}
                        hint="Без выбора сохраняем исходные даты."
                      />
                      <FormField
                        id="delay-days"
                        label="На сколько дней позже"
                        inputMode="numeric"
                        value={delayDays}
                        onChange={(event) => setDelayDays(event.target.value)}
                      />
                    </div>
              <Button type="submit" disabled={busy || !delayId || !current}>Сравнить с задержкой</Button>
            </form>
          </Disclosure>
        )}
      </CardContent>
    </Card>
  );
}

function ExplorationResult({ current, busy, refresh, children }: { current: boolean; busy: boolean; refresh: () => void; children: ReactNode }) {
  if (current) return children;
  return <><div className="exploration-stale" role="status"><div><strong>Условия нужно обновить</strong><p>Данные заявки или обязательства изменились. Прежние предложения сохранены в истории.</p></div><Button disabled={busy} onClick={refresh}>{busy ? "Пересчитываем…" : "Пересчитать условия"}</Button></div><Disclosure className="exploration-context mt-4" title="Предыдущий расчёт" description="Сохранён для справки, выбрать эти условия уже нельзя.">{children}</Disclosure></>;
}

function ExplorationEmpty({ result, busy, onEdit, onRetry, onSettings }: {
  result: ApplicationView["explorations"][number]["result"];
  busy: boolean;
  onEdit?: () => void;
  onRetry: () => void;
  onSettings: () => void;
}) {
  const questions = result.required_information || [];
  const minimum = questions.some(issue => issue && typeof issue === "object" && "code" in issue && issue.code === "minimum_acceptable_amount_required");
  const filtered = result.status === "no_matching_options";
  const checking = ["check_retry_pending", "needs_checks"].includes(result.status);
  const needsData = ["needs_information", "invalid_data"].includes(result.status);
  const title = minimum ? "Подойдёт ли сумма меньше?" : filtered ? "Измените ограничения сравнения" : checking ? "Проверка ещё не завершена" : needsData ? "Уточним данные для расчёта" : "На эту сумму не нашли подходящих условий";
  const text = minimum ? "На всю запрошенную сумму подходящих условий нет. Если задачу можно решить с меньшей суммой, укажите свой минимум. Если нужна вся сумма — так и отметьте." : filtered ? "Доступные предложения не укладываются в выбранный платёж или срок. Попробуйте расширить диапазон." : checking ? "Данные сохранены. Повторите проверку, чтобы получить актуальный результат." : needsData ? "Для продолжения нужны только сведения ниже. Уже заполненные данные сохранены." : "Платёж или сумма не укладываются в условия продукта с учётом текущей нагрузки бизнеса. Можно изменить запрос и попробовать другие параметры.";
  const issues = minimum ? [] : [...questions, ...(Array.isArray(result.issues) ? result.issues : [])];
  const reasons = needsData || checking || filtered || minimum ? [] : (result.reasons || []).filter(reason => reason.code !== "no_eligible_offer").map(reason => reason.message);
  const messages = [...new Set([...issues.map(describeIssue), ...reasons])];
  return <section className="exploration-empty-state" aria-label="Следующий шаг подбора">
    <span className="exploration-empty-icon" aria-hidden="true"><CircleHelp size={25} /></span>
    <div><h4>{title}</h4><p>{text}</p>
      {messages.length > 0 && <ul>{messages.map(message => <li key={message}>{message}</li>)}</ul>}
      <div className="exploration-empty-actions">
        {checking ? <Button disabled={busy} onClick={onRetry}>Повторить проверку</Button> : filtered ? <><Button disabled={busy} onClick={onSettings}>Изменить ограничения</Button><Button variant="outline" disabled={busy} onClick={onRetry}>Без ограничений сравнения</Button></> : onEdit ? <Button disabled={busy} onClick={onEdit}>{minimum ? "Уточнить сумму" : "Изменить данные"}</Button> : <Button variant="outline" disabled={busy} onClick={onSettings}>Изменить параметры</Button>}
      </div>
    </div>
  </section>;
}
