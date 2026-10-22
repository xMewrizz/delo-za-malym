import { Check, Clock3, FileCheck2, ShieldCheck } from "lucide-react";
import { formatMoney } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import type { ApplicationView, Offer } from "../api/applications";
import { describeIssue, outcomeName, productName } from "../model/presentation";

import { RefinancingEffect } from "./refinancing-comparison";

function OfferCard({
  offer,
  final,
  selected,
  busy,
  canSelect,
  onSelect,
}: {
  offer: Offer;
  final: boolean;
  selected: boolean;
  busy: boolean;
  canSelect: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="rounded-[22px] border border-border bg-background p-5 sm:p-6">
      {offer.product_id === "refinancing" && <RefinancingEffect offer={offer} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-primary">
            {productName(offer.product_id)}
          </p>
          <h4 className="mt-1 text-2xl font-extrabold tracking-tight">
            {formatMoney(offer.amount)}
          </h4>
        </div>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
          {selected ? "Выбрано" : final ? "Итоговое" : "Предварительное"}
        </span>
      </div>
      <dl className="mt-5 grid gap-3 border-t border-border pt-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Срок</dt>
          <dd className="mt-1 font-bold">
            {offer.term_months
              ? offer.term_months + " мес."
              : "По условиям продукта"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Платёж в месяц</dt>
          <dd className="mt-1 font-bold">
            {offer.monthly_payment
              ? formatMoney(offer.monthly_payment)
              : "По факту использования"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ставка</dt>
          <dd className="mt-1 font-bold">
            {offer.annual_rate_percent
              ? Number(offer.annual_rate_percent).toLocaleString("ru-RU") +
                "% годовых"
              : "Уточняется"}
          </dd>
        </div>
      </dl>
      {offer.total_repayment && (
        <p className="mt-4 text-xs text-muted-foreground">
          Всего к возврату:{" "}
          <strong className="text-foreground">
            {formatMoney(offer.total_repayment)}
          </strong>
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Комиссии: {formatMoney(offer.fees_total || "0")}.{" "}
        {offer.conditions?.length
          ? "Требуется поручительство."
          : "Без поручительства и залога."}
      </p>
      {final && canSelect && !selected && (
        <Button className="mt-5" disabled={busy} onClick={onSelect}>
          Выбрать предложение
        </Button>
      )}
    </div>
  );
}

function conditionCode(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "code" in value &&
    typeof value.code === "string"
  )
    return value.code;
  return null;
}

export function OfferResults({
  view,
  busy,
  onSelect,
  onSign,
  onComplete,
}: {
  view: ApplicationView;
  busy: boolean;
  onSelect: (assessmentId: string, offerId: string) => void;
  onSign: (offerId: string) => void;
  onComplete: (code: string, offerId: string) => void;
}) {
  const assessment = view.result?.assessment;
  const final = assessment?.stage === "final";
  const selectedId = view.state.selected_offer_id;
  const selected = assessment?.offers.find(
    (item) => item.offer_id === selectedId,
  );
  const pending = view.readiness?.pending_conditions || [];

  return (
    <Card className="gap-0 border border-border bg-card/70">
      <CardHeader className="pb-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileCheck2 className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">
              Результат
            </p>
            <h3 className="text-xl font-extrabold tracking-tight">
              Предложения и оформление
            </h3>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {view.result && (
          <p className="text-xs text-muted-foreground">
            {(
              {
                calculated: "Расчёт выполнен",
                needs_checks: "Ожидаются внешние проверки",
                check_retry_pending: "Внешняя проверка временно недоступна",
                invalid_data: "Нужно исправить данные",
                needs_information: "Нужны дополнительные сведения",
              } as Record<string, string>
            )[view.result.status] || "Результат обработки получен"}
          </p>
        )}
        {(view.result?.issues || []).map((issue, index) => (
          <p
            key={`technical-${index}`}
            role="alert"
            className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          >
            {describeIssue(issue)}
          </p>
        ))}
        {!assessment && !view.completion && (
          <div className="rounded-2xl border border-dashed border-border bg-background px-5 py-8 text-sm text-muted-foreground">
            {view.result
              ? "Завершите указанные проверки или дополните сведения, чтобы получить предложения."
              : "После расчёта здесь появятся предложения, причины решения и доступные действия."}
          </div>
        )}
        {assessment && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/10 px-3 py-1 font-bold text-primary">
                {final ? "Итоговое рассмотрение" : "Предварительный расчёт"}
              </span>
              <span className="text-muted-foreground">
                Результат: {outcomeName(assessment.outcome)}
              </span>
            </div>
            {(assessment.reasons || []).map((reason, index) => (
              <p
                key={reason.code || index}
                className="rounded-xl bg-background px-4 py-3 text-sm text-muted-foreground"
              >
                {reason.message}
              </p>
            ))}
            {(assessment.required_information || []).map((issue, index) => (
              <p
                key={"required-" + index}
                className="rounded-xl bg-background px-4 py-3 text-sm text-muted-foreground"
              >
                {describeIssue(issue)}
              </p>
            ))}
            {assessment.offers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Предложений пока нет. Следующее действие:{" "}
                {view.state.next_action.label}.
              </p>
            )}
            <div className="grid gap-3">
              {assessment.offers.map((offer) => (
                <OfferCard
                  key={offer.offer_id}
                  offer={offer}
                  final={final}
                  selected={offer.offer_id === selectedId}
                  busy={busy}
                  canSelect={[
                    "offers_ready",
                    "conditions_pending",
                    "ready_to_sign",
                  ].includes(view.state.status)}
                  onSelect={() =>
                    onSelect(assessment.assessment_id, offer.offer_id)
                  }
                />
              ))}
            </div>
          </>
        )}
        {selected && pending.length > 0 && (
          <div className="rounded-2xl border border-primary/20 bg-background p-5">
            <p className="mb-3 font-bold">Дополнительные условия</p>
            <div className="flex flex-wrap gap-2">
              {pending.map((item, index) => {
                const code = conditionCode(item);
                return (
                  code && (
                    <ConfirmAction
                      key={code + index}
                      label="Подтвердить поручительство"
                      title="Выполнить условие?"
                      description="В демонстрационном процессе это действие отметит условие выполненным. Проверьте выбранное предложение перед продолжением."
                      confirmLabel="Подтвердить"
                      disabled={busy}
                      onConfirm={() => onComplete(code, selected.offer_id)}
                    />
                  )
                );
              })}
            </div>
          </div>
        )}
        {selected && view.state.status === "ready_to_sign" && (
          <div className="rounded-2xl border border-success/30 bg-success/10 p-5">
            <p className="flex items-center gap-2 font-bold">
              <ShieldCheck className="size-5 text-success" />
              Предложение готово к подписанию
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Подписание и выдача в этом проекте моделируются.
            </p>
            <ConfirmAction
              label="Подписать и завершить"
              title="Подписать предложение?"
              description="Демонстрационное оформление выбранного предложения будет завершено и сохранено. Действие запускается только после вашего подтверждения."
              confirmLabel="Подписать"
              disabled={busy}
              onConfirm={() => onSign(selected.offer_id)}
            />
          </div>
        )}
        {view.completion && (
          <div className="rounded-2xl border border-success/30 bg-success/10 p-5">
            <p className="flex items-center gap-2 text-lg font-extrabold">
              <Check className="size-5 text-success" />
              {view.completion.refinanced_by ? "Кредит погашен рефинансированием" : view.completion.product_id === "refinancing" ? "Рефинансирование завершено" : view.state.status === "limit_opened"
                ? "Лимит открыт"
                : "Кредит выдан"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {view.completion.amount
                ? formatMoney(view.completion.amount) + " · "
                : ""}
              Операция выполнена в демонстрационном режиме.
            </p>
            {view.completion.product_id === "refinancing" && <p className="mt-3 text-sm">Выбранные кредиты погашены. В календаре и следующих заявках учитывается новый кредит. Дополнительные деньги на счёт не зачислялись.</p>}
            {typeof view.completion.refinanced_by === "string" && <a className="mt-3 block font-semibold text-primary underline" href={`/cabinet?mode=applications&application=${encodeURIComponent(view.completion.refinanced_by)}`}>Открыть заменивший кредит</a>}
            {view.completion.schedule && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-primary">
                  {view.completion.refinanced_by ? "Прежний график — будущие платежи заменены новым кредитом" : "Посмотреть график платежей"}
                </summary>
                <div className="mt-3 max-h-72 overflow-auto rounded-xl bg-background">
                  <table aria-label="График погашения выбранного кредита" className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="p-3">Дата</th>
                        <th className="p-3">Платёж</th>
                        <th className="p-3">Остаток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.completion.schedule.map((row, index) => (
                        <tr key={index} className="border-b border-border/70">
                          <td className="p-3">
                            {typeof row.date === "string"
                              ? new Date(
                                  row.date + "T12:00:00",
                                ).toLocaleDateString("ru-RU")
                              : `Месяц ${String(row.month_number || index + 1)}`}
                          </td>
                          <td className="p-3">
                            {typeof row.total_payment === "string"
                              ? formatMoney(row.total_payment)
                              : "—"}
                          </td>
                          <td className="p-3">
                            {typeof row.closing_balance === "string"
                              ? formatMoney(row.closing_balance)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}
        {view.state.status === "check_retry_pending" && (
          <p className="flex items-center gap-2 rounded-xl bg-background px-4 py-3 text-sm text-muted-foreground">
            <Clock3 className="size-4 text-primary" />
            Техническая проверка не завершилась. Её можно повторить отдельным
            действием.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
