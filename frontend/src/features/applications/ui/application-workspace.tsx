import type { ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  CircleCheck,
  Clock3,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { formatMoney } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import type { ApplicationView, Profile } from "../api/applications";
import { ExplorationPanel } from "./exploration-panel";
import { NeedForm } from "./need-form";
import { productName, stateName } from "../model/presentation";
import { OfferResults } from "./offer-results";
import { OverdraftPlanForm } from "./overdraft-plan-form";

export type ApplicationActions = {
  save: (changes: Record<string, unknown>) => void;
  version: (
    action: "preview" | "recommendations" | "retry" | "submit" | "cancel",
  ) => void;
  explore: (
    productId: "working_capital_loan" | "overdraft",
    preferences: Record<string, unknown>,
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

export function ApplicationWorkspace({
  view,
  profile,
  busy,
  actions,
}: {
  view: ApplicationView;
  profile?: Profile;
  busy: boolean;
  actions: ApplicationActions;
}) {
  const id = view.application.application_id;
  const status = view.state.status;
  const editable = editableStates.has(status);
  const name =
    view.client_data.company_name || profile?.company_name || "Компания";
  const bank = view.client_data.bank_financials || profile?.financials;
  const recommendation = view.recommendation;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            Заявка {id.slice(0, 8)} · версия{" "}
            {view.application.application_version}
          </p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
            {name}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {view.state.next_action.label}
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-4 py-2 text-xs font-bold text-primary">
          {stateName(status)}
        </span>
      </div>

      <Card className="gap-0 border border-border bg-card/70">
        <CardHeader className="pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-success/15 text-success">
              <Building2 className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-success">
                Данные банка
              </p>
              <h3 className="text-xl font-extrabold tracking-tight">
                О компании уже известно
              </h3>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact
            icon={<Wallet className="size-4" />}
            label="Остаток на счёте"
            value={
              bank?.cash_balance ? formatMoney(bank.cash_balance) : "Нет данных"
            }
          />
          <Fact
            icon={<ChartNoAxesCombined className="size-4" />}
            label="История операций"
            value={
              bank?.monthly?.length
                ? bank.monthly.length + " мес."
                : "Нет данных"
            }
          />
          <Fact
            icon={<Clock3 className="size-4" />}
            label="Действующие кредиты"
            value={
              bank?.existing_loans?.length
                ? String(bank.existing_loans.length)
                : "Нет"
            }
          />
          <Fact
            icon={<CircleCheck className="size-4" />}
            label="Кредитная история"
            value={
              view.client_data.credit_history?.category === "good"
                ? "Без просрочек"
                : view.client_data.credit_history?.status || "Уточняется"
            }
          />
        </CardContent>
      </Card>

      <Card className="gap-0 border border-border bg-background">
        <CardHeader className="pb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            Шаг 01
          </p>
          <h3 className="text-xl font-extrabold tracking-tight">
            Потребность в финансировании
          </h3>
          <p className="text-xs text-muted-foreground">
            Заполните только то, что знаете сейчас. Черновик можно продолжить
            позже.
          </p>
        </CardHeader>
        <CardContent>
          <NeedForm
            key={id + ":" + view.application.application_version}
            view={view}
            busy={busy || !editable}
            onSave={actions.save}
          />
        </CardContent>
      </Card>

      <Card className="gap-0 border border-border bg-card/70">
        <CardHeader className="pb-5">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            Шаг 02
          </p>
          <h3 className="text-xl font-extrabold tracking-tight">
            Подбор и предварительный расчёт
          </h3>
          <p className="text-xs text-muted-foreground">
            Предварительный расчёт использует сохранённую версию заявки и не
            отправляет её на рассмотрение.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={busy || !editable}
              onClick={() => actions.version("recommendations")}
            >
              Подобрать продукт
              <ArrowRight aria-hidden="true" />
            </Button>
            <Button
              disabled={busy || status !== "draft"}
              onClick={() => actions.version("preview")}
            >
              Рассчитать черновик
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          {recommendation && (
            <div className="mt-5 rounded-[22px] border border-border bg-background p-5">
              <p className="text-sm font-bold">
                Рекомендация:{" "}
                {recommendation.recommended_product_id
                  ? productName(recommendation.recommended_product_id)
                  : "нужны уточнения"}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(recommendation.candidates || []).map((candidate) => (
                  <div
                    key={candidate.product_id}
                    className="rounded-xl bg-secondary/65 p-4"
                  >
                    <p className="font-bold">
                      {productName(candidate.product_id)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {candidate.reasons?.[0]?.message ||
                        candidate.eligibility ||
                        "Проверка условий"}
                    </p>
                    {editable && (
                      <Button
                        className="mt-3"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          actions.save({
                            "need.preferred_product": candidate.product_id,
                          })
                        }
                      >
                        Выбрать продукт
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <OverdraftPlanForm
        key={id + ":plan:" + view.application.application_version}
        view={view}
        busy={busy || !editable}
        onSave={actions.save}
      />
      <ExplorationPanel
        key={id + ":explore"}
        view={view}
        busy={busy || !editable}
        onExplore={actions.explore}
        onApply={actions.apply}
      />

      <Card className="gap-0 border border-border bg-background">
        <CardHeader className="pb-5">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            Шаг 03
          </p>
          <h3 className="text-xl font-extrabold tracking-tight">
            Отправка на рассмотрение
          </h3>
          <p className="text-xs text-muted-foreground">
            Отправка запускает проверку и сохранит подтверждённую версию заявки.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {status === "draft" && (
            <ConfirmAction
              label="Проверить и отправить"
              title="Отправить заявку?"
              description="Проверьте потребность, сумму и выбранный продукт. Backend рассмотрит сохранённую версию заявки; результат появится на этой странице."
              confirmLabel="Отправить заявку"
              disabled={busy}
              onConfirm={() => actions.version("submit")}
            />
          )}
          {(status === "check_retry_pending" || status === "offer_expired") && (
            <Button disabled={busy} onClick={() => actions.version("retry")}>
              <RefreshCw aria-hidden="true" />
              Повторить проверку
            </Button>
          )}
          {editable && (
            <ConfirmAction
              label="Отменить заявку"
              title="Отменить заявку?"
              description="Текущая заявка перейдёт в состояние отмены. Для новой задачи можно будет создать другой черновик."
              confirmLabel="Отменить"
              variant="outline"
              disabled={busy}
              onConfirm={() => actions.version("cancel")}
            />
          )}
          {!editable && status !== "draft" && (
            <p className="text-sm text-muted-foreground">
              Состояние заявки: {stateName(status)}.
            </p>
          )}
        </CardContent>
      </Card>

      <OfferResults
        view={view}
        busy={busy}
        onSelect={actions.select}
        onSign={actions.sign}
        onComplete={actions.complete}
      />

      <details className="rounded-[24px] border border-border bg-background p-5">
        <summary className="cursor-pointer text-sm font-bold">
          История заявки · {view.events.length} событий
        </summary>
        <ol className="mt-5 space-y-3 border-l border-border pl-5">
          {[...view.events].reverse().map((event) => (
            <li
              key={event.event_id}
              className="relative text-xs text-muted-foreground before:absolute before:-left-[25px] before:top-1 before:size-2 before:rounded-full before:bg-primary"
            >
              <span className="font-semibold text-foreground">
                {event.type.replaceAll("_", " ")}
              </span>
              <span className="ml-2 inline-flex items-center gap-1">
                <CalendarDays className="size-3" />
                {new Date(event.created_at).toLocaleString("ru-RU")}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <p className="mt-3 text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-extrabold tracking-tight">{value}</p>
    </div>
  );
}
