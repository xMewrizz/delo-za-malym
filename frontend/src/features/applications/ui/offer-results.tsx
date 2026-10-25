import { PenaltyTermsNote } from "@/shared/ui/penalty-terms-note";
import { ArrowRight, Check, Clock3, FileCheck2 } from "lucide-react";
import { Link } from "react-router";
import { formatMoney } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import type { ApplicationView, Offer } from "../api/applications";
import { describeIssue, outcomeName, productName } from "../model/presentation";
import { completionLifecycle } from "../model/completion-lifecycle";
import { SigningPanel } from "./signing-panel";

import { InvestmentTerms } from "./investment-terms";
import { RefinancingEffect } from "./refinancing-comparison";
import { RevolvingTerms } from "@/features/credit-line/credit-line-panel";
import "./offer-results.css";

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
    <article className="application-offer-card" aria-label={productName(offer.product_id)}>
      <div className="application-offer-heading">
        <div>
          <p className="application-offer-product">
            {productName(offer.product_id)}
          </p>
          <h4>
            {formatMoney(offer.amount)}
          </h4>
        </div>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
          {selected ? "Выбрано" : final ? "Итоговое" : "Предварительное"}
        </span>
      </div>
      <dl className="application-offer-figures">
        <div>
          <dt className="text-xs text-muted-foreground">Срок</dt>
          <dd className="mt-1 font-bold">
            {offer.term_months
              ? offer.term_months + " мес."
              : "По условиям продукта"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{offer.product_id === "investment_loan" ? "Максимальный платёж" : "Платёж в месяц"}</dt>
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
      {offer.product_id === "investment_loan" && <InvestmentTerms offer={offer} />}
      {offer.product_id === "refinancing" && <RefinancingEffect offer={offer} />}
      {offer.product_id === "revolving_credit_line" && <RevolvingTerms value={offer.revolving} />}
      <dl className="application-offer-costs">
        {offer.total_repayment && <div><dt>Всего к возврату</dt><dd>{formatMoney(offer.total_repayment)}</dd></div>}
        <div><dt>Комиссии</dt><dd>{formatMoney(offer.fees_total || "0")}</dd></div>
      </dl>
      <p className="application-offer-security">{offer.conditions?.length ? "Требуется поручительство" : "Без поручительства и залога"}</p>
      <PenaltyTermsNote value={offer.penalty_terms} compact />
      {final && canSelect && !selected && (
        <Button className="application-offer-select" disabled={busy} onClick={onSelect}>
          Выбрать предложение<ArrowRight size={16} aria-hidden="true"/>
        </Button>
      )}
    </article>
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
  onNewSelection,
  busy,
  onSelect,
  onSign,
  onComplete,
}: {
  onNewSelection?: () => void;
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

  if (view.completion) {
    const { replacementId, closed } = completionLifecycle(view.completion);
    return <Card>
      <CardHeader>
        <p className="section-kicker">{closed ? "КРЕДИТ ЗАКРЫТ" : "ОФОРМЛЕНИЕ ЗАВЕРШЕНО"}</p>
        <h2 className="flex items-center gap-3 text-2xl font-semibold"><Check className="shrink-0 text-primary" />{replacementId ? "Кредит погашен рефинансированием" : closed ? "Кредит погашен" : view.completion.product_id === "refinancing" ? "Рефинансирование завершено" : view.state.status === "limit_opened" ? "Лимит открыт" : "Кредит выдан"}</h2>
        <p className="text-sm text-muted-foreground">{replacementId ? "По этому договору будущих платежей нет. Условия и график нового кредита доступны в заявке на рефинансирование." : closed ? "Долг погашен полностью. Условия и история заявки сохранены." : "Заявка сохранена в истории. Текущий долг, платежи и операции — в разделе «Моё финансирование»."}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>{closed && <p className="mb-2 text-xs text-muted-foreground">Первоначальная сумма кредита</p>}<p className="text-2xl font-semibold">{formatMoney(view.completion.amount || "0")}</p></div>
        {!closed && <p className="text-sm text-muted-foreground">{view.completion.product_id === "refinancing" ? "Деньги направлены на погашение выбранных кредитов. Остаток расчётного счёта не увеличился." : view.completion.type === "limit_opening" ? "Открытие лимита не увеличивает остаток на счёте. По кредитной линии деньги зачисляются после выборки." : "Деньги зачислены на расчётный счёт. Остаток счёта увеличился, одновременно возник кредитный долг."}</p>}
        <div className="flex flex-wrap gap-3">
          {replacementId && <Button asChild><Link to={`/cabinet?mode=applications&application=${encodeURIComponent(replacementId)}`}>Открыть новый кредит<ArrowRight size={16}/></Link></Button>}
          <Button asChild variant={replacementId ? "outline" : "default"}><Link to="/cabinet?mode=portfolio">Моё финансирование{!replacementId && <ArrowRight size={16}/>}</Link></Button>
          {!closed && <Button asChild variant="outline"><Link to={`/cabinet?mode=calendar&product=app:${view.application.application_id}`}>Актуальный график</Link></Button>}
        </div>
        {selected && <details><summary className="cursor-pointer py-3 text-sm text-primary">Условия при оформлении</summary><p className="mb-3 text-xs text-muted-foreground">{closed ? "Исходные условия закрытого кредита. Будущих платежей по этому договору нет." : "Снимок исходного предложения. Досрочные платежи и новый график доступны в управлении продуктом."}</p><OfferCard offer={selected} final selected busy={false} canSelect={false} onSelect={() => undefined}/></details>}
      </CardContent>
    </Card>;
  }
  if (view.state.status === "cancelled") return <Card><CardHeader><p className="section-kicker">ЗАЯВКА ЗАКРЫТА</p><h2 className="text-2xl font-semibold">Вы отменили заявку</h2><p className="text-sm text-muted-foreground">Её условия и история сохранены. Для новой задачи начните отдельный подбор.</p></CardHeader><CardContent>{onNewSelection ? <Button variant="outline" disabled={busy} onClick={onNewSelection}>Новый подбор<ArrowRight size={16}/></Button> : <Button asChild variant="outline"><Link to="/cabinet?mode=applications">Все заявки<ArrowRight size={16}/></Link></Button>}</CardContent></Card>;

  return (
    <Card className="application-offer-results gap-0 border border-border bg-card/70">
      <CardHeader className="application-result-header" data-tone={final && assessment?.outcome === "approved" ? "approved" : undefined}>
        <div className="flex items-center gap-3">
          <span className="application-result-icon">
            {final && assessment?.outcome === "approved" ? <Check size={23} aria-hidden="true"/> : <FileCheck2 size={23} aria-hidden="true"/>}
          </span>
          <div>
            <p className="application-result-kicker">
              {assessment ? final ? "Решение банка" : "Предварительный расчёт" : "Результат"}
            </p>
            <h3>
              {assessment ? !final && assessment.offers.length ? "Подходящие условия" : outcomeName(assessment.outcome) : "Предложения и оформление"}
            </h3>
          </div>
        </div>
        {assessment && assessment.offers.length > 0 && <p className="application-result-next">{final ? selected ? "Проверьте выбранные условия и завершите оформление." : "Выберите предложение, чтобы перейти к оформлению." : "Сравните условия перед отправкой заявки в банк."}</p>}
      </CardHeader>
      <CardContent className="space-y-5">
        {view.result && !assessment && (
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
            {(assessment.reasons || []).map((reason, index) => (
              <p
                key={reason.code || index}
                className="application-result-reason"
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
                {["declined", "out_of_policy"].includes(view.state.status) ? "Рассмотрение завершено. Условия и решение этой заявки больше не меняются. Для другой задачи можно начать новый подбор." : `Предложений пока нет. ${view.state.next_action.label}.`}
              </p>
            )}
            <div className="grid gap-3">
              {(selected ? [selected] : assessment.offers).map((offer) => (
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
            {selected && assessment.offers.length > 1 && <details><summary className="cursor-pointer py-3 text-sm text-primary">Другие предложения · {assessment.offers.length - 1}</summary><div className="grid gap-3">{assessment.offers.filter(offer => offer.offer_id !== selectedId).map(offer => <OfferCard key={offer.offer_id} offer={offer} final={final} selected={false} busy={busy} canSelect={["offers_ready", "conditions_pending", "ready_to_sign"].includes(view.state.status)} onSelect={() => onSelect(assessment.assessment_id, offer.offer_id)} />)}</div></details>}
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
                      description="Подтвердите поручительство по выбранному предложению. Операция в демо-кабинете."
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
          <SigningPanel offer={selected} busy={busy} onSign={onSign} />
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
