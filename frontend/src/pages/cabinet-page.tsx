import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Sparkles } from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import { AssistantPanel, chatKeys, getChat } from "@/features/assistant";
import { SupplierPaymentEntry } from "@/features/supplier-payments/supplier-payment";
import { SupplierFinancingContext } from "@/features/supplier-payments/financing-context";
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
  repeatApplication,
  deleteDraftApplication,
  exploreApplication,
  patchApplication,
  selectOffer,
  signOffer,
  versionAction,
  type ApplicationActions,
  type ApplicationView,
  type ApplicationSummary,
} from "@/features/applications";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { readSaved } from "@/shared/lib/saved-draft";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { LumaMark } from "@/shared/ui/luma-mark";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { ApplicationsHub, ApplicationBack, ApplicationMoreActions, DeleteDraftAction } from "@/features/applications/ui/applications-hub";
import {forgetDraftStorage} from "@/features/applications/model/deleted-draft";
import "./cabinet-page.css";
import "./cabinet-workspace.css";
import { CabinetNavigation, type CabinetMode } from "./cabinet-navigation";
import { BusinessProfile, CabinetOverview, FinancingPortfolio } from "./cabinet-insights";
import { loadShowcaseContexts, resolveCabinetContexts } from "./demo-contexts";
import {SavedSelectionEntry} from "./selection-entry";
import {useSelectionAdmission} from "./use-selection-admission";

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
  const requestedMode =
    search.get("mode") ||
    (search.has("application")
      ? "applications"
      : location.hash.slice(1) || "overview");
  const mode: Mode = Object.hasOwn(modeNames, requestedMode)
    ? (requestedMode as Mode)
    : "overview";
  const selectionAdmission = useSelectionAdmission();
  const activeMode = useRef<Mode>(mode);
  useEffect(() => {
    activeMode.current = mode;
  }, [mode]);
  const [storedContexts, setContexts] = useState<Contexts>(savedContexts);
  const [createdInSession, setCreatedInSession] = useState<ReadonlySet<string>>(() => new Set());
  const list = useQuery(applicationQueries.list()),
    profile = useQuery(applicationQueries.profile());
  const showcase = useQuery({queryKey:["showcase-contexts"],queryFn:({signal})=>loadShowcaseContexts(signal),staleTime:Infinity,retry:false});
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
    return list.data ? resolveCabinetContexts(next, list.data.map(item=>item.application_id), showcase.data, createdInSession) : next;
  }, [storedContexts, legacy.data, list.data, showcase.data, createdInSession]);
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
  const applications = list.data || [];
  const selectedId = search.get("application");
  const focusLocation = `${mode}:${search.get("application") || ""}`;
  const previousLocation = useRef(focusLocation);
  useEffect(() => {
    if (previousLocation.current !== focusLocation) {
      pageHeading.current?.focus({ preventScroll: true });
      modeNavigation.current?.scrollIntoView({ block: "start" });
    }
    previousLocation.current = focusLocation;
  }, [focusLocation]);
  const invoiceFinancingId = mode === "manual" ? search.get("invoice-financing") : null;
  const manualId = invoiceFinancingId || contexts.manual;
  const manual = useQuery({
    ...applicationQueries.detail(manualId || ""),
    enabled: Boolean(manualId),
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
    setCreatedInSession(current => current.has(id) ? current : new Set([...current,id]));
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
    if (next !== "manual" && next !== "assistant") selectionAdmission.reset();
    activeMode.current = next;
    setSearch(current => {
      const params = next === "applications" && current.get("mode") === "applications" ? new URLSearchParams(current) : new URLSearchParams();
      params.set("mode", next);
      if (id) params.set("application", id); else params.delete("application");
      return params;
    });
  }
  const create = useMutation({
    mutationFn: ({ repeatId }: { source: "manual" | "assistant"; repeatId?: string }) => repeatId ? repeatApplication(repeatId) : createApplication(),
    onSuccess: (view, { source }) => {
      update(view);
      selectionAdmission.allow(view.application.application_id);
      setContexts((current) => {
        const next = { ...current, [source]: view.application.application_id };
        try {
          localStorage.setItem("delo-react-contexts", JSON.stringify(next));
        } catch {
          /* Optional local persistence. */
        }
        return next;
      });
      if (source === "manual" && search.has("invoice-financing")) setSearch(current => {const next = new URLSearchParams(current); next.delete("invoice-financing"); return next;}, {replace: true});
      if (activeMode.current === "applications") navigate(source);
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
      review?: boolean;
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
  const deletion=useMutation({
    mutationFn:(item:Pick<ApplicationSummary,"application_id"|"state">)=>deleteDraftApplication(item.application_id,item.state.application_version),
    onSuccess:async({application_id:id})=>{
      await Promise.all([queryClient.cancelQueries({queryKey:applicationKeys.detail(id)}),queryClient.cancelQueries({queryKey:applicationKeys.list}),queryClient.cancelQueries({queryKey:["legacy-workspaces"]})]);
      forgetDraftStorage(id);
      setContexts(current=>({manual:current.manual===id?null:current.manual,assistant:current.assistant===id?null:current.assistant}));
      setCreatedInSession(current=>new Set([...current].filter(value=>value!==id)));
      queryClient.setQueryData(applicationKeys.list,(current:ApplicationSummary[]|undefined)=>current?.filter(item=>item.application_id!==id));
      queryClient.setQueryData(["legacy-workspaces"],(current:typeof legacy.data)=>current?.filter(item=>item.view.record.application.application_id!==id)||[]);
      queryClient.removeQueries({queryKey:applicationKeys.detail(id)});
      queryClient.removeQueries({queryKey:chatKeys.list(id)});
      queryClient.removeQueries({predicate:query=>{
        if(query.queryKey[0]!=="chats")return false;
        const data=query.state.data as {record?:{application?:{application_id?:string}}}|undefined;
        return data?.record?.application?.application_id===id;
      }});
      if(selectedId===id)navigate("applications");
      void queryClient.invalidateQueries({queryKey:applicationKeys.list});
      void queryClient.invalidateQueries({queryKey:calendarKey});
    },
    onError:(error,item)=>{
      if(error instanceof ApiError && [404,409].includes(error.status)){
        void queryClient.invalidateQueries({queryKey:applicationKeys.list});
        void queryClient.invalidateQueries({queryKey:applicationKeys.detail(item.application_id)});
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
      version: (name) => run(() => versionAction(id, version, name), { review: name === "submit" || name === "retry" }),
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
  const error = action.error || create.error || deletion.error;
  const activeDetail =
    mode === "manual" ? manual : mode === "assistant" ? assistant : detail;
  const savedEntry = (view: ApplicationView) => <SavedSelectionEntry view={view} busy={create.isPending || action.isPending}
    onContinue={() => { if (view.state.status === "draft") selectionAdmission.allow(view.application.application_id); else navigate("applications",view.application.application_id); }}
    onNew={() => create.mutate({source:mode === "assistant" ? "assistant" : "manual"})}/>;
  const entryView = mode === "manual" ? manual.data : mode === "assistant" ? assistant.data : undefined;
  const showSavedEntry = Boolean(entryView && !selectionAdmission.opened.has(entryView.application.application_id) && !invoiceFinancingId);
  function openApplication(id:string) {
    const item=list.data?.find(record=>record.application_id===id);
    if(item?.state.status === "draft" && !item.ready_for_application) {
      const source=contexts.assistant === id ? "assistant" : "manual";
      setContexts(current=>({...current,[source]:id}));selectionAdmission.allow(id);navigate(source);
    } else navigate("applications",id);
  }
  const copy = {
    overview: ["Пульс вашего бизнеса", "Деньги, обязательства и следующий шаг. В одном пространстве."],
    business: ["Ваш бизнес", ""],
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
    <SupplierFinancingContext.Provider value={view => {update(view); setContexts(current => ({...current, manual: view.application.application_id}));}}>
    <section className="cabinet-page" aria-labelledby="cabinet-title">
      <CabinetNavigation mode={mode} company={profile.data?.company_name} applications={applications.length} navigate={next => {if(next === "manual" || next === "assistant") selectionAdmission.reset();navigate(next);}} />
      <div className="workspace-body">
      <div className="workspace-topbar"><p>Личный кабинет<span>/</span>{mode === "assistant" ? "Получить финансирование" : mode === "manual" ? "Получить финансирование" : modeNames[mode]}</p><div className="workspace-topbar-actions"><SupplierPaymentEntry /><ThemeToggle /><span className="workspace-profile-avatar" aria-label={profile.data?.company_name || "Ваш бизнес"}>С</span></div></div>
      <div ref={modeNavigation} className="cabinet-heading">
        <div>
          <p className="cabinet-eyebrow">
            <Sparkles className="size-4" />
            {profile.data?.company_name || "Ваш бизнес"}
          </p>
          <h1 ref={pageHeading} tabIndex={-1} id="cabinet-title">{copy[0]}</h1>
          {copy[1] && <p>{copy[1]}</p>}
        </div>
      </div>
      {(mode === "manual" || mode === "assistant") && <nav className="cabinet-modes" aria-label="Способ подбора финансирования">
        <div className="cabinet-mode-options">
        {(["manual", "assistant"] as const).map((name) => (
          <Button
            key={name}
            variant={name === mode ? "default" : "outline"}
            aria-current={name === mode ? "page" : undefined}
            onClick={() => navigate(name)}
          >
            {name === "assistant" && <LumaMark size={24} />}
            {modeNames[name]}
          </Button>
        ))}
        </div>
        {!showSavedEntry && (
          <Button
            className="cabinet-new-selection"
            variant="ghost"
            disabled={create.isPending}
            onClick={() => create.mutate({ source: mode })}
          >
            <Plus />
            Новый подбор
          </Button>
        )}
      </nav>}
      {mode === "overview" && <CabinetOverview applications={applications} loading={list.isPending} error={list.error} />}
      {mode === "business" && <BusinessProfile profile={profile.data} loading={profile.isPending} />}
      {mode === "portfolio" && <FinancingPortfolio />}
      {mode === "calendar" && <PaymentCalendar />}
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
              if(mode==="applications"&&!selectedId) void list.refetch(); else void activeDetail.refetch();
              action.reset();
              create.reset();
              deletion.reset();
            }}
          >
            <RefreshCw />
            Обновить
          </Button>
        </div>
      )}
      {activeDetail.isPending && activeDetail.fetchStatus !== "idle" && <Skeleton className="mb-4 h-8 rounded-xl" />}
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
        {mode === "manual" && invoiceFinancingId && <Button className="mb-4" variant="outline" onClick={() => setSearch(current => {const next = new URLSearchParams(current); next.set("pay", "supplier"); return next;})}>Вернуться к счёту поставщика</Button>}
        {mode === "manual" &&
          (manual.data ? (
            showSavedEntry ? savedEntry(manual.data) : <ApplicationWorkspace
              key={manual.data.application.application_id}
              mode="selection"
              onNewSelection={() => create.mutate({ source: "manual" })}
              renderDocuments={(onUsed) => (
                <InvoicePanel
                  view={manual.data!}
                  onUpdated={update}
                  onUsed={onUsed}
                />
              )}
              view={manual.data}
              profile={profile.data}
              busy={action.isPending || create.isPending}
              actions={actionsFor(manual.data, "manual")}
            />
          ) : (
            !manual.isFetching && (
              <StartCard
                title="Начнём с вашей задачи"
                text="Заполните потребность. Профиль компании и данные банка уже подставлены."
                busy={create.isPending}
                onStart={() => create.mutate({ source: "manual" })}
              />
            )
          ))}
      </div>
      <div hidden={mode !== "assistant"}>
        {assistant.data ? (
          !selectionAdmission.opened.has(assistant.data.application.application_id) ? savedEntry(assistant.data) : <AssistantPanel
            key={assistant.data.application.application_id}
            applicationId={assistant.data.application.application_id}
            record={assistant.data}
            onRecordUpdated={update}
            onNewTask={() => {
              if (!create.isPending) create.mutate({ source: "assistant" });
            }}
            startingTask={create.isPending}
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
              onStart={() => create.mutate({ source: "assistant" })}
            />
          )
        )}
      </div>
      {mode==="applications" && deletion.isSuccess && <p role="status" className="mb-5 text-sm text-muted-foreground">Черновик удалён</p>}
      {mode === "applications" && (!selectedId ? <ApplicationsHub applications={applications} loading={list.isPending} error={list.error} refresh={() => void list.refetch()} open={openApplication} creating={create.isPending} create={() => create.mutate({ source: "manual" })} onDelete={item=>deletion.mutate(item)} deleting={deletion.isPending} /> : <div className="application-detail-page">
        <ApplicationBack back={() => navigate("applications")} actions={detail.data ? <><DeleteDraftAction application={{...detail.data.application,state:detail.data.state}} busy={create.isPending||action.isPending||deletion.isPending} onDelete={()=>{if(detail.data)deletion.mutate({application_id:detail.data.application.application_id,state:detail.data.state});}}/><ApplicationMoreActions busy={create.isPending || action.isPending || deletion.isPending} onRepeat={() => { if (detail.data) create.mutate({ source: "manual", repeatId: detail.data.application.application_id }); }} /></> : undefined}/>
        {detail.data && <ApplicationWorkspace onNewSelection={() => create.mutate({ source: "manual" })} key={detail.data.application.application_id} view={detail.data} profile={profile.data} reviewing={action.isPending && Boolean(action.variables?.review) && action.variables?.id === detail.data.application.application_id} busy={action.isPending || create.isPending} actions={actionsFor(detail.data, "applications")} renderDocuments={() => Array.isArray(detail.data?.documents) && detail.data.documents.length > 0 ? <InvoicePanel readOnly view={detail.data!} onUpdated={update} /> : null} />}
      </div>)}
      {profile.error && (
        <p className="mt-4 text-xs text-destructive" role="alert">
          {getErrorMessage(profile.error)}
        </p>
      )}
      </div>
    </section>
    </SupplierFinancingContext.Provider>
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
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="max-w-lg text-sm text-muted-foreground">{text}</p>
        <Button disabled={busy} onClick={onStart}>
          Начать подбор
        </Button>
      </CardContent>
    </Card>
  );
}
