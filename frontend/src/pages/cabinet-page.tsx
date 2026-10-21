import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  FilePlus2,
  FolderOpen,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { AssistantPanel } from "@/features/assistant";
import {
  applicationKeys,
  applicationQueries,
  ApplicationWorkspace,
  applyExploration,
  completeCondition,
  createApplication,
  createScenario,
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
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import "./cabinet-page.css";

function labelFor(item: {
  need: { requested_amount?: string | null; purpose?: string | null };
  application_id: string;
}) {
  const purpose =
    item.need.purpose === "working_capital"
      ? "Оборотные расходы"
      : item.need.purpose === "investment"
        ? "Развитие бизнеса"
        : item.need.purpose === "contract_execution"
          ? "Исполнение контракта"
          : "Новая заявка";
  return item.need.requested_amount
    ? `${purpose} · ${Number(item.need.requested_amount).toLocaleString("ru-RU")} ₽`
    : `${purpose} · ${item.application_id.slice(0, 8)}`;
}

export function CabinetPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const list = useQuery(applicationQueries.list());
  const profile = useQuery(applicationQueries.profile());
  const scenarios = useQuery(applicationQueries.scenarios());
  const selectedId =
    search.get("application") || list.data?.[0]?.application_id || null;
  const detail = useQuery({
    ...applicationQueries.detail(selectedId || ""),
    enabled: Boolean(selectedId),
  });

  function select(id: string) {
    setSearch({ application: id });
  }
  function update(view: ApplicationView) {
    queryClient.setQueryData(
      applicationKeys.detail(view.application.application_id),
      view,
    );
    void queryClient.invalidateQueries({ queryKey: applicationKeys.list });
  }
  function failed(error: unknown) {
    if (error instanceof ApiError && error.status === 409 && selectedId) {
      void queryClient.invalidateQueries({
        queryKey: applicationKeys.detail(selectedId),
      });
      void queryClient.invalidateQueries({ queryKey: applicationKeys.list });
    }
  }
  const create = useMutation({
    mutationFn: createApplication,
    onSuccess: (view) => {
      update(view);
      select(view.application.application_id);
    },
  });
  const demo = useMutation({
    mutationFn: ({
      product,
      scenario,
    }: {
      product: string;
      scenario: string;
    }) => createScenario(product, scenario),
    onSuccess: (view) => {
      update(view);
      select(view.application.application_id);
    },
  });
  const action = useMutation({
    mutationFn: async (run: () => Promise<ApplicationView>) => run(),
    onSuccess: update,
    onError: failed,
  });
  const view = detail.data;
  const id = view?.application.application_id || "";
  const version = view?.application.application_version || 0;
  const actions: ApplicationActions = {
    save: (changes) =>
      action.mutate(() => patchApplication(id, version, changes)),
    version: (name) => action.mutate(() => versionAction(id, version, name)),
    explore: (product, preferences) =>
      action.mutate(() =>
        exploreApplication(id, version, product, preferences),
      ),
    apply: (explorationId, optionId) =>
      action.mutate(() =>
        applyExploration(id, version, explorationId, optionId),
      ),
    select: (assessmentId, offerId) =>
      action.mutate(() => selectOffer(id, version, assessmentId, offerId)),
    complete: (code, offerId) =>
      action.mutate(() => completeCondition(id, version, code, offerId)),
    sign: (offerId) => action.mutate(() => signOffer(id, version, offerId)),
  };
  const error = create.error || demo.error || action.error;
  const busy = create.isPending || demo.isPending || action.isPending;

  return (
    <section className="cabinet-page" aria-labelledby="cabinet-title">
      <div className="cabinet-heading">
        <div>
          <p className="cabinet-eyebrow">
            <Sparkles className="size-4" aria-hidden="true" /> Личный кабинет
          </p>
          <h1 id="cabinet-title">
            Планы бизнеса <span>начинаются здесь.</span>
          </h1>
          <p>
            Создайте заявку, посмотрите предварительный расчёт и пройдите
            оформление. Все результаты и статусы обновляются после ваших
            действий.
          </p>
        </div>
        <div className="cabinet-heading-mark" aria-hidden="true">
          <span>Дело за малым.</span>
          <ArrowRight />
        </div>
      </div>

      <div className="cabinet-grid">
        <aside className="cabinet-sidebar" aria-label="Заявки и примеры">
          <Card className="gap-0 border-border bg-card/80">
            <CardContent className="space-y-5 pt-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-primary">
                    Ваши заявки
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold">
                    Рабочее пространство
                  </h2>
                </div>
                <FolderOpen
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
              </div>
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => create.mutate()}
              >
                <Plus aria-hidden="true" />
                Новая заявка
              </Button>
              {list.isPending && (
                <div className="space-y-2">
                  <Skeleton className="h-20 rounded-2xl" />
                  <Skeleton className="h-20 rounded-2xl" />
                </div>
              )}
              {list.error && (
                <div
                  role="alert"
                  className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive"
                >
                  {getErrorMessage(list.error)}{" "}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void list.refetch()}
                  >
                    Повторить
                  </Button>
                </div>
              )}
              {list.data?.length === 0 && (
                <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  У вас пока нет заявок. Создайте черновик или начните с
                  примера.
                </p>
              )}
              {list.data && list.data.length > 0 && (
                <div className="cabinet-application-list">
                  {list.data.map((item) => (
                    <button
                      key={item.application_id}
                      type="button"
                      onClick={() => select(item.application_id)}
                      aria-current={
                        selectedId === item.application_id ? "page" : undefined
                      }
                      className="cabinet-application-item"
                    >
                      <span className="font-bold">{labelFor(item)}</span>
                      <span className="mt-1 text-xs text-muted-foreground">
                        {stateName(item.state.status)} ·{" "}
                        {item.state.updated_at
                          ? new Date(item.state.updated_at).toLocaleDateString(
                              "ru-RU",
                            )
                          : "Без даты"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="gap-0 border-border bg-background">
            <CardContent className="pt-6">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-primary">
                  <span className="flex items-center gap-2">
                    <FilePlus2 className="size-5" aria-hidden="true" />
                    <span className="text-xs font-bold uppercase tracking-widest">
                      Примеры для знакомства
                    </span>
                  </span>
                  <Plus
                    className="size-4 transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  />
                </summary>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Демонстрационные заявки с заполненными данными. Можно пройти
                  расчёт и оформление.
                </p>
                {scenarios.isPending && (
                  <Skeleton className="mt-4 h-24 rounded-xl" />
                )}
                {scenarios.error && (
                  <p role="alert" className="mt-3 text-xs text-destructive">
                    {getErrorMessage(scenarios.error)}
                  </p>
                )}
                {scenarios.data && (
                  <div className="mt-4 space-y-2">
                    {scenarios.data.map((item) => (
                      <Button
                        key={item.product_id + item.scenario_id}
                        variant="outline"
                        className="h-auto w-full justify-between whitespace-normal py-3 text-left text-xs"
                        title={item.description}
                        disabled={busy}
                        onClick={() =>
                          demo.mutate({
                            product: item.product_id,
                            scenario: item.scenario_id,
                          })
                        }
                      >
                        <span>
                          {item.title}
                          <small className="mt-1 block font-normal text-muted-foreground">
                            {item.product_id === "overdraft"
                              ? "Овердрафт"
                              : "Кредит"}
                          </small>
                        </span>
                        <ArrowRight className="shrink-0" aria-hidden="true" />
                      </Button>
                    ))}
                  </div>
                )}
              </details>
            </CardContent>
          </Card>
        </aside>

        <div className="cabinet-content">
          {Boolean(error) && (
            <div
              role="alert"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <span>{getErrorMessage(error)}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedId) void detail.refetch();
                  action.reset();
                  create.reset();
                  demo.reset();
                }}
              >
                <RefreshCw aria-hidden="true" />
                Обновить
              </Button>
            </div>
          )}
          {detail.isPending && selectedId && (
            <div className="space-y-4">
              <Skeleton className="h-24 rounded-[24px]" />
              <Skeleton className="h-52 rounded-[24px]" />
              <Skeleton className="h-96 rounded-[24px]" />
            </div>
          )}
          {detail.error && (
            <Card>
              <CardContent className="pt-6">
                <p role="alert" className="text-sm text-destructive">
                  {getErrorMessage(detail.error)}
                </p>
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => void detail.refetch()}
                >
                  Повторить загрузку
                </Button>
              </CardContent>
            </Card>
          )}
          {!selectedId && !list.isPending && (
            <Card className="border-dashed border-primary/25 bg-card">
              <CardContent className="flex min-h-80 flex-col items-center justify-center pt-6 text-center">
                <FilePlus2
                  className="size-12 text-primary"
                  aria-hidden="true"
                />
                <h2 className="mt-5 text-2xl font-extrabold">
                  Начнём с вашей задачи
                </h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Создайте заявку и расскажите, для чего бизнесу нужны деньги.
                  Сведения компании уже будут подставлены.
                </p>
                <Button
                  className="mt-6"
                  disabled={busy}
                  onClick={() => create.mutate()}
                >
                  Создать заявку
                  <ArrowRight aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          )}
          {view && (
            <div className="cabinet-workspace-grid">
              <ApplicationWorkspace
                view={view}
                profile={profile.data}
                busy={busy}
                actions={actions}
              />
              <AssistantPanel
                key={id}
                applicationId={id}
                onRecordUpdated={update}
              />
            </div>
          )}
          {profile.error && (
            <p role="alert" className="mt-4 text-xs text-destructive">
              Профиль не загрузился: {getErrorMessage(profile.error)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
