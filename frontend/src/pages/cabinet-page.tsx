import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import { AssistantPanel, chatKeys, getChat } from "@/features/assistant";
import { InvoicePanel } from "@/features/documents";
import { PaymentCalendar } from "@/features/calendar/payment-calendar";
import { calendarKey } from "@/features/calendar/keys";
import {
  applicationKeys,
  applicationQueries,
  ApplicationWorkspace,
  applyExploration,
  completeCondition,
  createApplication,
  exploreApplication,
  patchApplication,
  selectOffer,
  signOffer,
  stateName,
  versionAction,
  type ApplicationActions,
  type ApplicationView,
} from "@/features/applications";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { formatMoney } from "@/shared/lib/format";
import { readSaved } from "@/shared/lib/saved-draft";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { LumaMark } from "@/shared/ui/luma-mark";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { financingName } from "@/shared/lib/product-directions";
import "./cabinet-page.css";
import "./cabinet-workspace.css";
import { CabinetNavigation, type CabinetMode } from "./cabinet-navigation";
import { BusinessProfile, CabinetOverview, FinancingPortfolio } from "./cabinet-insights";

type Mode = CabinetMode;
type WorkspaceSource = "manual" | "assistant" | "applications";
type Contexts = { manual: string | null; assistant: string | null };
const modeNames: Record<Mode, string> = {
  overview: "Обзор",
  business: "Данные бизнеса",
  manual: "Подобрать продукт",
  assistant: "С Лумой",
  applications: "Заявки",
  calendar: "Платёжный календарь",
  portfolio: "Моё финансирование",
};
function savedContexts(): Contexts {
  const value = readSaved<Partial<Contexts>>("delo-react-contexts", {});
  return {
    manual: typeof value.manual === "string" ? value.manual : null,
    assistant:
      typeof value.assistant === "string" && value.assistant !== value.manual
        ? value.assistant
        : null,
  };
}

export function CabinetPage() {
  const queryClient = useQueryClient(),
    [search, setSearch] = useSearchParams();
  const location = useLocation();
  const modeNavigation = useRef<HTMLDivElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const [allApplications, setAllApplications] = useState(false);
  const requestedMode =
    search.get("mode") ||
    (search.has("application")
      ? "applications"
      : location.hash.slice(1) || "overview");
  const mode: Mode = Object.hasOwn(modeNames, requestedMode)
    ? (requestedMode as Mode)
    : "overview";
  const activeMode = useRef<Mode>(mode);
  useEffect(() => {
    activeMode.current = mode;
  }, [mode]);
  const [storedContexts, setContexts] = useState<Contexts>(savedContexts);
  const legacy = useQuery({
    queryKey: ["legacy-workspaces"],
    enabled: !storedContexts.manual || !storedContexts.assistant,
    queryFn: async () => {
      const saved = readSaved<
        Partial<Record<"manual" | "assistant", { chat_id?: string }>>
      >("delo-workspace-contexts", {});
      const restored = await Promise.allSettled(
        (["manual", "assistant"] as const).map(async (source) => {
          const chatId = saved[source]?.chat_id;
          return typeof chatId === "string"
            ? { source, view: await getChat(chatId) }
            : null;
        }),
      );
      return restored.flatMap((item) =>
        item.status === "fulfilled" && item.value ? [item.value] : [],
      );
    },
  });
  const contexts = useMemo(() => {
    const next = { ...storedContexts };
    for (const item of legacy.data || [])
      if (
        !next[item.source] &&
        next[item.source === "manual" ? "assistant" : "manual"] !==
          item.view.record.application.application_id
      )
        next[item.source] = item.view.record.application.application_id;
    return next;
  }, [storedContexts, legacy.data]);
  const activeContexts = useRef(contexts);
  useEffect(() => {
    activeContexts.current = contexts;
    try {
      localStorage.setItem("delo-react-contexts", JSON.stringify(contexts));
    } catch {
      /* Optional local persistence. */
    }
  }, [contexts]);
  useEffect(() => {
    if (!legacy.data?.length) return;
    for (const item of legacy.data) {
      queryClient.setQueryData(
        applicationKeys.detail(item.view.record.application.application_id),
        item.view.record,
      );
      queryClient.setQueryData(
        chatKeys.detail(item.view.chat.chat_id),
        item.view,
      );
      try {
        const key = `delo-chat:${item.view.record.application.application_id}`;
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(item.view.chat.chat_id));
      } catch {
        /* Optional local persistence. */
      }
    }
  }, [legacy.data, queryClient]);
  const list = useQuery(applicationQueries.list()),
    profile = useQuery(applicationQueries.profile());
  const applications =
    list.data?.filter(
      (item) => item.ready_for_application || item.state.status !== "draft",
    ) || [];
  const selectedId =
    search.get("application") || applications[0]?.application_id || null;
  const recentApplications = allApplications ? applications : applications.filter((item, index) => index < 6 || item.application_id === selectedId);
  const focusLocation = `${mode}:${search.get("application") || ""}`;
  const previousLocation = useRef(focusLocation);
  useEffect(() => {
    if (previousLocation.current !== focusLocation) {
      pageHeading.current?.focus({ preventScroll: true });
      modeNavigation.current?.scrollIntoView({ block: "start" });
    }
    previousLocation.current = focusLocation;
  }, [focusLocation]);
  const manual = useQuery({
    ...applicationQueries.detail(contexts.manual || ""),
    enabled: Boolean(contexts.manual),
  });
  const assistant = useQuery({
    ...applicationQueries.detail(contexts.assistant || ""),
    enabled: Boolean(contexts.assistant),
  });
  const detail = useQuery({
    ...applicationQueries.detail(selectedId || ""),
    enabled: mode === "applications" && Boolean(selectedId),
  });
  function update(view: ApplicationView) {
    const id = view.application.application_id;
    queryClient.setQueryData<ApplicationView>(
      applicationKeys.detail(id),
      (current) =>
        current &&
        (current.application.application_version >
          view.application.application_version ||
          (current.application.application_version ===
            view.application.application_version &&
            current.events.length > view.events.length))
          ? current
          : view,
    );
    void queryClient.invalidateQueries({ queryKey: applicationKeys.list });
    void queryClient.invalidateQueries({ queryKey: calendarKey });
    if (view.completion) {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.all });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.profile });
    }
  }
  function navigate(next: Mode, id?: string) {
    activeMode.current = next;
    setSearch({ mode: next, ...(id ? { application: id } : {}) });
  }
  const create = useMutation({
    mutationFn: (_source: "manual" | "assistant") => createApplication(),
    onSuccess: (view, source) => {
      update(view);
      setContexts((current) => {
        const next = { ...current, [source]: view.application.application_id };
        try {
          localStorage.setItem("delo-react-contexts", JSON.stringify(next));
        } catch {
          /* Optional local persistence. */
        }
        return next;
      });
      if (activeMode.current === source) {
        pageHeading.current?.focus({ preventScroll: true });
        modeNavigation.current?.scrollIntoView({ block: "start" });
      }
    },
  });
  const action = useMutation({
    mutationFn: (task: {
      run: () => Promise<ApplicationView>;
      source: WorkspaceSource;
      applied?: boolean;
      onSaved?: () => void;
      id: string;
    }) => task.run(),
    onSuccess: (view, task) => {
      update(view);
      task.onSaved?.();
      if (
        task.applied &&
        activeMode.current === task.source &&
        (task.source === "applications" ||
          activeContexts.current[task.source] === task.id)
      )
        navigate("applications", view.application.application_id);
    },
    onError: (error, task) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({
          queryKey: applicationKeys.detail(task.id),
        });
        void queryClient.invalidateQueries({ queryKey: applicationKeys.list });
      }
    },
  });
  function actionsFor(view: ApplicationView, source: WorkspaceSource): ApplicationActions {
    const id = view.application.application_id,
      version = view.application.application_version;
    const run = (request: () => Promise<ApplicationView>, extra = {}) =>
      action.mutate({ run: request, source, id, ...extra });
    return {
      save: (changes, onSaved) =>
        run(() => patchApplication(id, version, changes), { onSaved }),
      version: (name) => run(() => versionAction(id, version, name)),
      explore: (product, preferences, delay) =>
        run(() => exploreApplication(id, version, product, preferences, delay)),
      apply: (explorationId, optionId) =>
        run(() => applyExploration(id, version, explorationId, optionId), {
          applied: true,
        }),
      select: (assessmentId, offerId) =>
        run(() => selectOffer(id, version, assessmentId, offerId)),
      complete: (code, offerId) =>
        run(() => completeCondition(id, version, code, offerId)),
      sign: (offerId) => run(() => signOffer(id, version, offerId)),
    };
  }
  const error = action.error || create.error;
  const activeDetail =
    mode === "manual" ? manual : mode === "assistant" ? assistant : detail;
  const copy = {
    overview: ["Пульс вашего бизнеса", "Деньги, обязательства и следующий шаг. В одном пространстве."],
    business: ["Данные вашего бизнеса", "Сведения, которые уже есть у банка. Без повторного ввода и лишних анкет."],
    portfolio: ["Моё финансирование", "Полученные кредиты, открытые лимиты и обязательства вашего бизнеса."],
    manual: [
      "Финансирование под вашу задачу",
      "Выберите цель, проверьте параметры и сравните условия по данным бизнеса.",
    ],
    assistant: [
      "Расскажите о своём деле",
      "Лума поможет разобраться. Суммы, даты и варианты будут появляться рядом с разговором.",
    ],
    applications: [
      "Ваши заявки",
      "Выбранные условия, отправка и ход рассмотрения.",
    ],
    calendar: ["Платёжный календарь", "Поступления, расходы и платежи по всем полученным кредитам."],
  }[mode];
  return (
    <section className="cabinet-page" aria-labelledby="cabinet-title">
      <CabinetNavigation mode={mode} company={profile.data?.company_name} applications={applications.length} navigate={navigate} />
      <div className="workspace-body">
      <div className="workspace-topbar"><p>Личный кабинет<span>/</span>{mode === "assistant" ? "Получить финансирование" : mode === "manual" ? "Получить финансирование" : modeNames[mode]}</p><div className="workspace-topbar-actions"><ThemeToggle /><span className="workspace-profile-avatar" aria-label={profile.data?.company_name || "Ваш бизнес"}>С</span></div></div>
      <div ref={modeNavigation} className="cabinet-heading">
        <div>
          <p className="cabinet-eyebrow">
            <Sparkles className="size-4" />
            {profile.data?.company_name || "Ваш бизнес"}
          </p>
          <h1 ref={pageHeading} tabIndex={-1} id="cabinet-title">{copy[0]}</h1>
          <p>{copy[1]}</p>
        </div>
      </div>
      {(mode === "manual" || mode === "assistant") && <nav className="cabinet-modes" aria-label="Способ подбора финансирования">
        {(["manual", "assistant"] as const).map((name) => (
          <Button
            key={name}
            variant={name === mode ? "default" : "outline"}
            aria-current={name === mode ? "page" : undefined}
            onClick={() => navigate(name)}
          >
            {name === "assistant" && <LumaMark size={16} />}
            {modeNames[name]}
          </Button>
        ))}
        {(mode === "manual" || mode === "assistant") && (
          <Button
            className="ml-auto"
            variant="ghost"
            disabled={create.isPending}
            onClick={() => create.mutate(mode)}
          >
            <Plus />
            Новый подбор
          </Button>
        )}
      </nav>}
      {mode === "overview" && <CabinetOverview applications={applications} loading={list.isPending} error={list.error} />}
      {mode === "business" && <BusinessProfile profile={profile.data} loading={profile.isPending} />}
      {mode === "portfolio" && <FinancingPortfolio />}
      {mode === "calendar" && <PaymentCalendar initialPlanId={contexts.manual} assistantPlanId={contexts.assistant} />}
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {getErrorMessage(error)}{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void activeDetail.refetch();
              action.reset();
              create.reset();
            }}
          >
            <RefreshCw />
            Обновить
          </Button>
        </div>
      )}
      {activeDetail.isFetching && <Skeleton className="mb-4 h-8 rounded-xl" />}
      {activeDetail.error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {getErrorMessage(activeDetail.error)}{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void activeDetail.refetch()}
          >
            Повторить
          </Button>
        </p>
      )}
      <div hidden={mode !== "manual"}>
        {mode === "manual" &&
          (manual.data ? (
            <ApplicationWorkspace
              key={manual.data.application.application_id}
              mode="selection"
              renderDocuments={(onUsed) => (
                <InvoicePanel
                  view={manual.data!}
                  onUpdated={update}
                  onUsed={onUsed}
                />
              )}
              view={manual.data}
              profile={profile.data}
              busy={action.isPending}
              actions={actionsFor(manual.data, "manual")}
            />
          ) : (
            !manual.isFetching && (
              <StartCard
                title="Начнём с вашей задачи"
                text="Заполните потребность. Профиль компании и данные банка уже подставлены."
                busy={create.isPending}
                onStart={() => create.mutate("manual")}
              />
            )
          ))}
      </div>
      <div hidden={mode !== "assistant"}>
        {assistant.data ? (
          <AssistantPanel
            key={assistant.data.application.application_id}
            applicationId={assistant.data.application.application_id}
            record={assistant.data}
            onRecordUpdated={update}
            renderDocuments={(chat, onChatUpdated) => (
              <InvoicePanel
                view={chat.record}
                chat={chat}
                onUpdated={update}
                onChatUpdated={onChatUpdated}
              />
            )}
            actions={actionsFor(assistant.data, "assistant")}
          />
        ) : (
          !assistant.isFetching && (
            <StartCard
              title="Подберём финансирование в разговоре"
              text="Расскажите о задаче обычными словами. Лума уточнит детали и соберёт отдельный вариант."
              busy={create.isPending}
              onStart={() => create.mutate("assistant")}
            />
          )
        )}
      </div>
      {mode === "applications" && (
        <div className="cabinet-grid">
          {Boolean(applications.length) && <label className="application-mobile-picker text-sm font-semibold">Открытая заявка
            <select aria-label="Выбрать заявку" className="mt-2 min-h-11 w-full rounded-xl border border-border bg-background p-3 text-sm font-normal" value={selectedId || ""} onChange={event => navigate("applications", event.target.value)}>
              {applications.map(item => <option key={item.application_id} value={item.application_id}>{financingName(item.need.preferred_product)}{item.need.requested_amount ? ` · ${formatMoney(item.need.requested_amount)}` : ""} · {stateName(item.state.status)} · {item.application_id.slice(0, 6)}</option>)}
            </select>
          </label>}
          <aside className="cabinet-sidebar">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <FolderOpen className="text-primary" />
                  Заявки
                </h2>
                {list.isFetching && <Skeleton className="h-20 rounded-xl" />}
                {list.error && (
                  <p role="alert" className="text-xs text-destructive">
                    {getErrorMessage(list.error)}{" "}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void list.refetch()}
                    >
                      Повторить
                    </Button>
                  </p>
                )}
                <div className="cabinet-application-list">
                  {recentApplications.map((item) => (
                    <button
                      className="cabinet-application-item"
                      key={item.application_id}
                      type="button"
                      aria-current={
                        selectedId === item.application_id ? "page" : undefined
                      }
                      onClick={() =>
                        navigate("applications", item.application_id)
                      }
                    >
                      <strong>
                        {financingName(item.need.preferred_product)}
                        {item.need.requested_amount
                          ? ` · ${formatMoney(item.need.requested_amount)}`
                          : ""}
                      </strong>
                      <span className="mt-1 text-xs text-muted-foreground">
                        {stateName(item.state.status)} · {item.application_id.slice(0, 6)}
                      </span>
                    </button>
                  ))}
                </div>
                {applications.length > 6 && <Button variant="ghost" size="sm" className="mt-3" onClick={() => setAllApplications(current => !current)}>{allApplications ? "Только последние" : `Все заявки · ${applications.length}`}</Button>}
                {!applications.length && !list.isFetching && (
                  <p className="text-sm text-muted-foreground">
                    Выберите условия в подборе — заявка появится здесь.
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>
          <div className="min-w-0">
            {detail.data ? (
              <ApplicationWorkspace
                key={detail.data.application.application_id}
                view={detail.data}
                profile={profile.data}
                busy={action.isPending}
                actions={actionsFor(detail.data, "applications")}
                renderDocuments={() =>
                  Array.isArray(detail.data?.documents) &&
                  detail.data.documents.length > 0 ? (
                    <InvoicePanel
                      readOnly
                      view={detail.data!}
                      onUpdated={update}
                    />
                  ) : null
                }
              />
            ) : (
              !selectedId && (
                <StartCard
                  title="Сначала выберите финансирование"
                  text="Готовый вариант попадёт сюда после вашего подтверждения."
                  onStart={() => navigate("manual")}
                  busy={false}
                />
              )
            )}
          </div>
        </div>
      )}
      {profile.error && (
        <p className="mt-4 text-xs text-destructive" role="alert">
          {getErrorMessage(profile.error)}
        </p>
      )}
      </div>
    </section>
  );
}

function StartCard({
  title,
  text,
  busy,
  onStart,
}: {
  title: string;
  text: string;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 pt-6 text-center">
        <h2 className="text-2xl font-extrabold">{title}</h2>
        <p className="max-w-lg text-sm text-muted-foreground">{text}</p>
        <Button disabled={busy} onClick={onStart}>
          Начать подбор
        </Button>
      </CardContent>
    </Card>
  );
}
