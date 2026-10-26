import { ElapsedStatus } from "@/shared/ui/elapsed-status";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { formatMoney } from "@/shared/lib/format";
import { useSavedDraft } from "@/shared/lib/saved-draft";
import { Button } from "@/shared/ui/button";
import { Disclosure } from "@/shared/ui/disclosure";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import type { ApplicationView, Profile } from "../api/applications";
import { ExplorationPanel } from "./exploration-panel";
import { NeedForm } from "./need-form";
import {
  describeIssue,
  outcomeName,
  productName,
} from "../model/presentation";
import { OfferResults } from "./offer-results";
import { OverdraftPlanForm } from "./overdraft-plan-form";
import { FinancialSupplement } from "./financial-supplement";
import { BankDecisionTimeline } from "./bank-decision-timeline";
import { ApplicationFollowup } from "./application-followup";
import { ApplicationOverview } from "./application-overview";

export type ApplicationActions = {
  save: (changes: Record<string, unknown>, onSaved?: () => void) => void;
  version: (
    action: "preview" | "recommendations" | "retry" | "submit" | "cancel",
  ) => void;
  explore: (
    productId: "working_capital_loan" | "overdraft" | "refinancing" | "revolving_credit_line" | "investment_loan",
    preferences: Record<string, unknown>,
    delay?: { transaction_id: string; days: number },
  ) => void;
  apply: (explorationId: string, optionId: string) => void;
  select: (assessmentId: string, offerId: string) => void;
  complete: (code: string, offerId: string) => void;
  sign: (offerId: string) => void;
};

const editableStates = new Set([
  "draft",
  "waiting_for_data",
  "check_retry_pending",
  "offers_ready",
  "conditions_pending",
  "ready_to_sign",
  "offer_expired",
]);

export function ApplicationWorkspace({
  view,
  busy,
  actions,
  mode = "application",
  renderDocuments,
  onNewSelection,
  reviewing = false,
}: {
  view: ApplicationView;
  profile?: Profile;
  busy: boolean;
  actions: ApplicationActions;
  onNewSelection?: () => void;
  reviewing?: boolean;
  mode?: "selection" | "application";
  renderDocuments?: (onUsed: (target: string) => void) => ReactNode;
}) {
  const id = view.application.application_id,
    version = view.application.application_version,
    status = view.state.status;
  const editable = editableStates.has(status),
    need = view.application.need;
  const [step, setStep] = useSavedDraft<"need" | "plan" | "options">(
    `delo-step:${id}`,
    "need",
  );
  const selection = mode === "selection";
  const wantsPlan =
    need.preferred_product === "overdraft" ||
    need.financing_pattern === "cash_gap";
  const calculateAfterSave = useRef(false);
  const submitAfterSave = useRef<{id: string; version: number} | null>(null);
  useEffect(() => {
    const pending = submitAfterSave.current;
    if (!pending || busy) return;
    if (pending.id !== id) { submitAfterSave.current = null; return; }
    if (version > pending.version && status === "draft") {
      submitAfterSave.current = null;
      actions.version("submit");
    }
  }, [id, version, status, busy, actions]);
  const contentRef = useRef<HTMLDivElement>(null);
  const wasReviewing = useRef(reviewing);
  useEffect(() => {
    if (wasReviewing.current && !reviewing) { contentRef.current?.focus({preventScroll:true}); contentRef.current?.scrollIntoView?.({block:"start"}); }
    wasReviewing.current = reviewing;
  }, [reviewing]);
  const stepsRef = useRef<HTMLDivElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) {
      stepHeading.current?.focus({ preventScroll: true });
      stepsRef.current?.scrollIntoView({ block: "start" });
    }
    previousStep.current = step;
  }, [step]);
  useEffect(() => {
    if (!calculateAfterSave.current || busy) return;
    calculateAfterSave.current = false;
    actions.explore(need.preferred_product === "investment_loan" ? "investment_loan" : need.preferred_product === "revolving_credit_line" ? "revolving_credit_line" : need.preferred_product === "refinancing" ? "refinancing" : need.preferred_product === "working_capital_loan" ? "working_capital_loan" : wantsPlan ? "overdraft" : "working_capital_loan", need.minimum_acceptable_amount && need.requested_amount && Number(need.minimum_acceptable_amount) < Number(need.requested_amount) ? {preserve_amount:false} : {});
  }, [step, busy, actions, wantsPlan, need.preferred_product, need.minimum_acceptable_amount, need.requested_amount]);
  const saveNeed = (changes: Record<string, unknown>) =>
    actions.save(changes, () => { calculateAfterSave.current = true; setStep("options"); });
  if (reviewing) return <div className="space-y-6"><ApplicationOverview view={view} reviewing/><Card><CardContent><ElapsedStatus title="Демо-банк рассматривает заявку" description="Проверяем сведения и рассчитываем доступные условия." focus/></CardContent></Card></div>;
  if (!selection && status === "waiting_for_data") return <div ref={contentRef} tabIndex={-1} className="space-y-6">
    <ApplicationOverview view={view}/>
    <ApplicationFollowup key={`${id}:${version}`} view={view} busy={busy} onSave={changes => actions.save(changes, () => { submitAfterSave.current = {id, version}; })}/>
    <BankDecisionTimeline view={view}/>
    <Disclosure title="Другие действия">
      <div className="mt-6"><ConfirmAction label="Отменить заявку" title="Отменить заявку?" description="Заявка будет закрыта. Для новой потребности можно начать отдельный подбор." confirmLabel="Отменить заявку" variant="outline" disabled={busy} onConfirm={() => actions.version("cancel")}/></div>
    </Disclosure>
  </div>;
  return (
    <div ref={contentRef} tabIndex={-1} className={`space-y-6 ${selection ? "selection-workspace" : ""}`}>
      {selection ? (
        <>
          <div ref={stepsRef} hidden={step !== "options"} className="selection-step-anchor"><SelectionSteps current={step === "options" ? "options" : "need"} busy={busy}
            onNeed={() => setStep("need")} onOptions={need.purpose ? () => setStep("options") : undefined} /></div>
          {step !== "options" && (
            <>
            <Card>
              <CardContent>
                <NeedForm continueToNextStep key={`${id}:${version}`} view={view}
                  busy={busy || !editable} onSave={saveNeed} expenseImport={renderDocuments?.(() => setStep("need"))} />
              </CardContent>
            </Card>
            </>
          )}
          {step === "options" && (
            <>
              {busy && <p role="status" className="rounded-xl bg-primary/10 p-4 text-sm text-primary">Подбираем подходящие условия…</p>}
              <Card className="selection-request-summary">
                <CardHeader>
                  <h2 ref={stepHeading} tabIndex={-1} className="text-xl font-semibold">Ваш запрос</h2>
                  <p className="text-sm text-muted-foreground">
                    Сравниваем условия по этим параметрам.
                  </p>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {need.preferred_product === "revolving_credit_line" ? "Запрошенный лимит" : need.preferred_product === "refinancing" ? "На погашение выбранных долгов" : "Запрошенная сумма"}
                      </dt>
                      <dd className="mt-1 font-bold">
                        {need.requested_amount
                          ? formatMoney(need.requested_amount)
                          : wantsPlan
                            ? "Рассчитаем по платежам и остатку"
                            : "Нужно указать"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Как возвращать
                      </dt>
                      <dd className="mt-1 font-bold">
                        {need.financing_pattern === "cash_gap"
                          ? "После поступления денег"
                          : need.financing_pattern === "gradual_repayment"
                            ? "Постепенно из выручки"
                            : "Уточним при подборе"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Желаемый срок
                      </dt>
                      <dd className="mt-1 font-bold">
                        {need.term_months
                          ? `${need.term_months} мес.`
                          : "Подберём подходящий"}
                      </dd>
                    </div>
                  </dl>
                  <Button
                    className="mt-4"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setStep("need")}
                  >
                    Изменить задачу
                  </Button>
                </CardContent>
              </Card>
              <FinancialSupplement
                key={`${id}:financials:${version}`}
                view={view}
                busy={busy || !editable}
                onSave={actions.save}
              />
              <ExplorationPanel
                key={id}
                compact
                view={view}
                onEditNeed={() => { localStorage.setItem(`delo-need-page:${id}`, "1"); setStep("need"); }}
                busy={busy || !editable}
                onExplore={actions.explore}
                onSavePlan={(plan) =>
                  actions.save({ "product_details.overdraft": plan })
                }
                onApply={actions.apply}
              />
              <Disclosure title="Дополнительная проверка потребности">
                <p className="mt-3 text-xs text-muted-foreground">
                  Можно отдельно проверить соответствие задачи продуктам или
                  оценить точные параметры без сравнения вариантов.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    disabled={busy || !editable}
                    variant="secondary"
                    onClick={() => actions.version("recommendations")}
                  >
                    Подобрать продукт
                    <ArrowRight />
                  </Button>
                  <Button
                    disabled={busy || status !== "draft"}
                    variant="outline"
                    onClick={() => actions.version("preview")}
                  >
                    Проверить выбранные параметры
                  </Button>
                </div>
              </Disclosure>
              {view.recommendation && (
                <Card>
                  <CardContent className="space-y-3">
                    <h3 className="font-bold">
                      {view.recommendation.recommended_product_id
                        ? `Подходит: ${productName(view.recommendation.recommended_product_id)}`
                        : outcomeName(view.recommendation.status)}
                    </h3>
                    {view.recommendation.reasons?.map((reason, index) => (
                      <p
                        key={reason.code || index}
                        className="text-sm text-muted-foreground"
                      >
                        {reason.message}
                      </p>
                    ))}
                    {view.recommendation.required_information?.map(
                      (issue, index) => (
                        <p
                          key={`required-${index}`}
                          className="text-sm text-muted-foreground"
                        >
                          {describeIssue(issue)}
                        </p>
                      ),
                    )}
                    {view.recommendation.candidates?.map((candidate) => (
                      <div key={candidate.product_id}>
                        <p className="text-sm font-semibold">
                          {productName(candidate.product_id)}
                        </p>
                        {candidate.reasons?.map((reason, index) => (
                          <p
                            key={reason.code || index}
                            className="text-xs text-muted-foreground"
                          >
                            {reason.message}
                          </p>
                        ))}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {view.result && (
                <OfferResults onNewSelection={onNewSelection}
                  view={view}
                  busy={busy}
                  onSelect={actions.select}
                  onSign={actions.sign}
                  onComplete={actions.complete}
                />
              )}
            </>
          )}
        </>
      ) : (
        <>
          <ApplicationOverview view={view}/>
          {status === "draft" && <SelectionSteps current="review" busy={busy} />}
          {status !== "draft" && <OfferResults onNewSelection={onNewSelection} view={view} busy={busy} onSelect={actions.select} onSign={actions.sign} onComplete={actions.complete} />}
          {status !== "draft" && <BankDecisionTimeline view={view} />}
          {renderDocuments?.(() => undefined)}
          {editable && <Disclosure title={status === "draft" ? "Проверка и отправка" : ["check_retry_pending", "offer_expired"].includes(status) ? "Повторная проверка" : "Другие действия"} open={["draft", "check_retry_pending", "offer_expired"].includes(status)}>
              <p className="text-sm text-muted-foreground">{view.state.next_action.label}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                {status === "draft" && (
                  <ConfirmAction
                    label="Проверить и отправить"
                    title="Отправить заявку?"
                    description="На рассмотрение уйдут подтверждённые потребность, данные бизнеса и выбранные условия."
                    confirmLabel="Отправить заявку"
                    disabled={busy}
                    onConfirm={() => actions.version("submit")}
                  />
                )}
                {["check_retry_pending", "offer_expired"].includes(status) && (
                  <Button
                    disabled={busy}
                    onClick={() => actions.version("retry")}
                  >
                    <RefreshCw />
                    Повторить проверку
                  </Button>
                )}
                {editable && (
                  <ConfirmAction
                    label="Отменить заявку"
                    title="Отменить заявку?"
                    description="Заявка будет закрыта. Для новой потребности можно начать отдельный подбор."
                    confirmLabel="Отменить заявку"
                    variant="outline"
                    disabled={busy}
                    onConfirm={() => actions.version("cancel")}
                  />
                )}
              </div>
          </Disclosure>}
          {editable && (
            <details
              className="rounded-2xl border border-border p-5"
              open={status === "waiting_for_data"}
            >
              <summary className="cursor-pointer text-sm font-bold">
                {status === "waiting_for_data"
                  ? "Дополнить сведения"
                  : "Исправить данные заявки"}
              </summary>
              <div className="mt-5 space-y-5">
                <NeedForm
                  key={`${id}:${version}`}
                  view={view}
                  busy={busy}
                  onSave={actions.save}
                />
                <OverdraftPlanForm
                  key={`${id}:plan:${version}`}
                  view={view}
                  busy={busy}
                  onSave={actions.save}
                />
              </div>
            </details>
          )}
          {editable && (
            <FinancialSupplement
              key={`${id}:financials:${version}`}
              view={view}
              busy={busy}
              onSave={actions.save}
            />
          )}
          {status === "draft" && view.result && <OfferResults onNewSelection={onNewSelection} view={view} busy={busy} onSelect={actions.select} onSign={actions.sign} onComplete={actions.complete} />}
        </>
      )}
    </div>
  );
}

function SelectionSteps({ current, busy, onNeed, onOptions }: {
  current: "need" | "options" | "review";
  busy: boolean;
  onNeed?: () => void;
  onOptions?: () => void;
}) {
  const steps = [
    { id: "need", title: "Задача", action: onNeed },
    { id: "options", title: "Предложения", action: onOptions },
    { id: "review", title: "Проверка и отправка", action: undefined },
  ];
  return <nav aria-label="Шаги подбора и оформления"><ol className="manual-steps">
    {steps.map(item => <li key={item.id}>
      {item.action ? <Button className="manual-step-control h-auto min-h-11 whitespace-normal text-left" variant="ghost"
        aria-current={current === item.id ? "step" : undefined} disabled={busy} onClick={item.action}>{item.title}</Button>
        : <span className={`manual-step-label ${current === item.id ? "manual-step-current" : ""}`} aria-current={current === item.id ? "step" : undefined}>{item.title}</span>}
    </li>)}
  </ol></nav>;
}
