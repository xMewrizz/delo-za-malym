import { ArrowRight, Building2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { formatMoney } from "@/shared/lib/format";
import { useSavedDraft } from "@/shared/lib/saved-draft";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import type { ApplicationView, Profile } from "../api/applications";
import { ExplorationPanel } from "./exploration-panel";
import { NeedForm } from "./need-form";
import {
  describeIssue,
  outcomeName,
  productName,
  stateName,
} from "../model/presentation";
import { OfferResults } from "./offer-results";
import { OverdraftPlanForm } from "./overdraft-plan-form";
import { FinancialSupplement } from "./financial-supplement";

export type ApplicationActions = {
  save: (changes: Record<string, unknown>, onSaved?: () => void) => void;
  version: (
    action: "preview" | "recommendations" | "retry" | "submit" | "cancel",
  ) => void;
  explore: (
    productId: "working_capital_loan" | "overdraft",
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
  "declined",
  "out_of_policy",
]);
const eventNames: Record<string, string> = {
  application_created: "Создан черновик",
  application_updated: "Обновлены сведения",
  application_submitted: "Заявка отправлена",
  review_started: "Начаты банковские проверки",
  assessment_completed: "Рассмотрение завершено",
  options_explored: "Рассчитаны варианты",
  explored_option_applied: "Выбраны условия",
  offer_selected: "Выбрано предложение банка",
  condition_completed: "Подтверждено условие",
  offer_signed: "Подписан договор",
  application_cancelled: "Заявка отменена",
  recommendations_calculated: "Подобран продукт",
  invoice_uploaded: "Загружен счёт поставщика",
  invoice_reviewed: "Проверены данные счёта",
};

export function ApplicationWorkspace({
  view,
  profile,
  busy,
  actions,
  mode = "application",
  renderDocuments,
}: {
  view: ApplicationView;
  profile?: Profile;
  busy: boolean;
  actions: ApplicationActions;
  mode?: "selection" | "application";
  renderDocuments?: (onUsed: (target: string) => void) => ReactNode;
}) {
  const id = view.application.application_id,
    version = view.application.application_version,
    status = view.state.status;
  const editable = editableStates.has(status),
    need = view.application.need;
  const bank = view.client_data.bank_financials || profile?.financials;
  const history = view.client_data.credit_history;
  const historyName =
    (
      {
        good: "без просрочек",
        no_history: "пока нет истории",
        minor_delinquency: "были небольшие просрочки",
        serious_delinquency: "есть серьёзные просрочки",
      } as Record<string, string>
    )[history?.category || ""] ||
    (history?.status === "error" ? "временно недоступна" : "проверяется");
  const [step, setStep] = useSavedDraft<"need" | "plan" | "options">(
    `delo-step:${id}`,
    "need",
  );
  const selection = mode === "selection";
  const wantsPlan =
    need.preferred_product === "overdraft" ||
    need.financing_pattern === "cash_gap";
  const saveNeed = (changes: Record<string, unknown>) =>
    actions.save(changes, () =>
      setStep(
        changes["need.preferred_product"] === "overdraft" ||
          changes["need.financing_pattern"] === "cash_gap"
          ? "plan"
          : "options",
      ),
    );
  return (
    <div className="space-y-5">
      <details className="rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-bold">
          <Building2 className="mr-2 inline size-4 text-primary" />
          {view.client_data.company_name ||
            profile?.company_name ||
            "Компания"}{" "}
          · данные уже известны банку
        </summary>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Остаток на счёте</dt>
            <dd className="mt-1 font-bold">
              {bank?.cash_balance
                ? formatMoney(bank.cash_balance)
                : "Уточняется"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">История операций</dt>
            <dd className="mt-1 font-bold">
              {bank?.monthly?.length || 0} мес.
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Действующие кредиты
            </dt>
            <dd className="mt-1 font-bold">
              {bank?.existing_loans?.length || 0}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Кредитная история: {historyName}.
        </p>
      </details>
      {selection ? (
        <>
          <nav
            className="manual-steps"
            aria-label="Шаги самостоятельного подбора"
          >
            {(
              [
                ["need", "1. Потребность"],
                [
                  "plan",
                  wantsPlan
                    ? "2. Денежный план"
                    : "2. Денежный план · по желанию",
                ],
                ["options", "3. Варианты"],
              ] as [typeof step, string][]
            ).map(([name, title]) => (
              <Button
                variant={step === name ? "default" : "outline"}
                key={name}
                aria-current={step === name ? "step" : undefined}
                disabled={busy}
                onClick={() => setStep(name)}
              >
                {title}
              </Button>
            ))}
          </nav>
          {renderDocuments?.((target) => {
            if (target === "planned_expense") setStep("plan");
          })}
          {step === "need" && (
            <Card>
              <CardHeader>
                <h2 className="text-xl font-extrabold">
                  Для какой задачи нужны деньги?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Расскажите о потребности. Данные бизнеса повторно вводить не
                  нужно.
                </p>
              </CardHeader>
              <CardContent>
                <NeedForm
                  continueToNextStep
                  key={`${id}:${version}`}
                  view={view}
                  busy={busy || !editable}
                  onSave={saveNeed}
                />
              </CardContent>
            </Card>
          )}
          {step === "plan" && (
            <>
              <OverdraftPlanForm
                submitLabel="Продолжить к вариантам"
                forceVisible
                key={`${id}:plan:${version}`}
                view={view}
                busy={busy || !editable}
                onSave={(changes) =>
                  actions.save(changes, () => setStep("options"))
                }
              />
              <Button variant="outline" onClick={() => setStep("need")}>
                Вернуться к потребности
              </Button>
            </>
          )}
          {step === "options" && (
            <>
              <Card>
                <CardHeader>
                  <h2 className="text-xl font-extrabold">Ваш запрос</h2>
                  <p className="text-sm text-muted-foreground">
                    Эти данные уже учтены. Настройки расчёта можно изменить ниже.
                  </p>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Запрошенная сумма
                      </dt>
                      <dd className="mt-1 font-bold">
                        {need.requested_amount
                          ? formatMoney(need.requested_amount)
                          : wantsPlan
                            ? "Определим по денежному плану"
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
                    Изменить потребность
                  </Button>
                  {wantsPlan && (
                    <Button
                      className="ml-2 mt-4"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setStep("plan")}
                    >
                      Изменить денежный план
                    </Button>
                  )}
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
                busy={busy || !editable}
                onExplore={actions.explore}
                onSavePlan={(plan) =>
                  actions.save({ "product_details.overdraft": plan })
                }
                onApply={actions.apply}
              />
              <details className="rounded-xl border border-border p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  Дополнительная проверка потребности
                </summary>
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
              </details>
              {view.recommendation && (
                <Card>
                  <CardContent className="space-y-3 pt-6">
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
                <OfferResults
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
          {renderDocuments?.(() => undefined)}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-extrabold">Проверьте заявку</h2>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  {stateName(status)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {view.state.next_action.label}
              </p>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Продукт</dt>
                  <dd className="mt-1 font-bold">
                    {need.preferred_product
                      ? productName(need.preferred_product)
                      : "Не выбран"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Сумма</dt>
                  <dd className="mt-1 text-xl font-extrabold">
                    {need.requested_amount
                      ? formatMoney(need.requested_amount)
                      : "Нужно уточнить"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Срок</dt>
                  <dd className="mt-1 font-bold">
                    {need.term_months
                      ? `${need.term_months} мес.`
                      : "По условиям продукта"}
                  </dd>
                </div>
              </dl>
              <p className="mt-5 text-xs text-muted-foreground">
                Банковские проверки, подписание и выдача выполняются в
                симуляторе.
              </p>
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
            </CardContent>
          </Card>
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
          <OfferResults
            view={view}
            busy={busy}
            onSelect={actions.select}
            onSign={actions.sign}
            onComplete={actions.complete}
          />
          <details className="rounded-2xl border border-border p-5">
            <summary className="cursor-pointer text-sm font-bold">
              История заявки · {view.events.length} событий
            </summary>
            <ol className="mt-4 space-y-3">
              {view.events.toReversed().map((item) => (
                <li
                  key={item.event_id}
                  className="border-l-2 border-primary/30 pl-4 text-xs"
                >
                  <p className="font-semibold">
                    {eventNames[item.type] || "Обновлён этап заявки"}
                  </p>
                  <time className="text-muted-foreground">
                    {new Date(item.created_at).toLocaleString("ru-RU")}
                  </time>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </div>
  );
}
