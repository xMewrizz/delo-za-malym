// @vitest-environment jsdom
import { act } from "react";
import { env } from "node:process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CabinetPage } from "@/pages/cabinet-page";
import { isDebtObligation, type CalendarData } from "@/features/calendar/api";

const base = env.CABINET_TEST_URL,
  nativeFetch = globalThis.fetch;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(condition: () => unknown, label: string) {
  for (let index = 0; index < 200; index++) {
    await act(async () => {
      await wait(20);
    });
    if (await condition()) return;
  }
  throw new Error(
    `Timeout: ${label}; ${document.body.textContent?.slice(-2000)}`,
  );
}
function visible(element: HTMLElement) {
  return (
    !element.closest("[hidden]") &&
    !element.closest('[aria-hidden="true"]') &&
    !element.closest("details:not([open]) > :not(summary)")
  );
}
function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => visible(item) && ((item.getAttribute("aria-label") || item.textContent?.trim()) === label || label === "Новый подбор" && item.textContent?.trim() === "Начать новый подбор"),
  );
}
async function click(label: string) {
  if (["Закупить товар", "Дождаться выручки", "Купить оборудование", "Объединить кредиты", "Регулярные закупки"].includes(label)
    && document.querySelector(".need-progress")) await needPage(0);
  if (label === "3 месяца" && document.querySelector(".need-progress")) await needPage(2);
  if (label === "Посмотреть подходящие предложения" && document.querySelector(".need-progress")) {
    if (document.querySelector('.need-amount-choice:not([hidden])') && !document.querySelector('.need-amount-choice [aria-pressed="true"]')) await click("Нужна вся сумма");
    for (let index=0;index<2 && button("Продолжить");index++) {
      const page = document.querySelector(".need-progress [aria-current]")?.textContent;
      await click("Продолжить");
      if (document.querySelector(".need-progress [aria-current]")?.textContent === page) return;
    }
  }
  await until(() => {
    const item = button(label);
    return item && !item.disabled;
  }, `ready button: ${label}`);
  const item = button(label);
  expect(item, `Missing button: ${label}`).toBeTruthy();
  expect(item!.disabled, `Disabled button: ${label}`).toBe(false);
  await act(async () => {
    item!.click();
  });
  // Navigation now asks explicitly whether to resume a draft. These journeys
  // continue their saved task; selection-entry tests cover both entry choices.
  if (["Получить финансирование", "С Лумой", "Подобрать продукт"].includes(label)) {
    await act(async () => { await wait(80); });
    if (button("Продолжить подбор")) await click("Продолжить подбор");
  }
}
async function needPage(target: number) {
  const current = () => [...document.querySelectorAll(".need-progress button")].findIndex(item => item.hasAttribute("aria-current"));
  while(current() > target) await click("Назад");
  while(current() >= 0 && current() < target) {
    if (current() === 1 && document.querySelector('.need-amount-choice:not([hidden])') && !document.querySelector('.need-amount-choice [aria-pressed="true"]')) await click("Нужна вся сумма");
    const before = current(); await click("Продолжить");
    expect(current(), "The preceding form step must be valid").toBeGreaterThan(before);
  }
}
async function input(selector: string, value: string) {
  if (document.querySelector(".need-progress")) {
    if (["#need-amount", "#need-project-cost", "#need-own"].includes(selector)) await needPage(1);
    if (selector === "#need-term") await needPage(2);
  }
  const element = document.querySelector<
    HTMLInputElement | HTMLTextAreaElement
  >(selector)!;
  expect(element).toBeTruthy();
  await act(async () => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function chooseOption(option: Element) {
  const select = [...option.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === "Выбрать условия");
  expect(select, "Missing offer selection action").toBeTruthy();
  expect(select!.disabled).toBe(false);
  await act(async () => { select!.click(); });
}

async function openAssistant() {
  await click("Получить финансирование");
  await click("С Лумой");
}

describe.skipIf(!base)("React cabinet with real FastAPI", () => {
  let root: Root, host: HTMLDivElement;
  const requests: string[] = [];
  const messageRequests: { request_id: string; text: string }[] = [];
  let holdMessages = false;
  let failMessageResponse = false;
  let createChatFailure: "before" | "after" | null = null;
  let releaseMessage: (() => void) | undefined;
  function releaseHeldMessage() {
    releaseMessage?.();
    releaseMessage = undefined;
  }
  beforeAll(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", async (url: string | URL, options?: RequestInit) => {
      requests.push(String(url));
      const failingCreation = String(url).endsWith("/chats") && options?.method === "POST"
        ? createChatFailure : null;
      if (failingCreation) createChatFailure = null;
      if (failingCreation === "before") throw new TypeError("Failed to fetch");
      if (String(url).endsWith("/messages"))
        messageRequests.push(JSON.parse(String(options?.body)));
      const response = await nativeFetch(new URL(url, base), options);
      if (failingCreation === "after") throw new TypeError("Failed to fetch");
      if (holdMessages && String(url).endsWith("/messages"))
        await new Promise<void>((resolve) => {
          releaseMessage = resolve;
        });
      if (failMessageResponse && String(url).endsWith("/messages")) {
        failMessageResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return response;
    });
    HTMLElement.prototype.scrollIntoView = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    host = document.createElement("div");
    document.body.append(host);
  });
  afterAll(async () => {
    if (root) await act(async () => root.unmount());
    host?.remove();
    vi.unstubAllGlobals();
  });
  async function render() {
    const resume = Boolean(localStorage.getItem("delo-react-contexts") || localStorage.getItem("delo-workspace-contexts"));
    root = createRoot(host);
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 30_000 },
        mutations: { retry: false },
      },
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/cabinet?mode=manual"]}>
            <CabinetPage />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
      if (resume) {
        await until(() => button("Продолжить подбор") || button("Открыть заявку"), "saved task entry");
        if (button("Продолжить подбор")) await click("Продолжить подбор");
      }
  }
  it("completes a manual loan, independently collects the assistant plan and restores unsaved input", async () => {
    await render();
    await until(() => button("Начать подбор"), "initial screen");
    await click("Начать подбор");
    await until(
      () => document.querySelector("#need-amount"),
      "manual need form",
    );
    expect(document.activeElement?.id).toBe("cabinet-title");
    const manualId = JSON.parse(
      localStorage.getItem("delo-react-contexts")!,
    ).manual;
    await click("Закупить товар");
    await input("#need-amount", "500000");
    await input("#need-term", "12");
    await click("Посмотреть подходящие предложения");
    await until(() => button("Выбрать условия"), "real loan options");
    expect(document.querySelectorAll(".exploration-option").length).toBeGreaterThan(1);
    const settings = document.querySelector<HTMLDetailsElement>(".exploration-settings")!;
    expect(settings.open).toBe(false);
    expect(document.querySelector('.exploration-option')!.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Ваш запрос");
    await click("Изменить задачу");
    expect(document.querySelector(".need-step-heading h2")?.textContent).toBe("Как удобно возвращать?");
    await click("Посмотреть подходящие предложения");
    await until(() => button("Выбрать условия"), "reopened loan options");
    await until(() => requests.filter(path => path.endsWith(`/applications/${manualId}/explorations`)).length === 2, "second options calculation");
    const twelveMonthOption = [...document.querySelectorAll(".exploration-option")].find(item => item.textContent?.includes("12 мес."))!;
    expect(twelveMonthOption).toBeTruthy();
    await chooseOption(twelveMonthOption);
    await until(() => button("Перейти к заявке"), "apply confirmation");
    await click("Перейти к заявке");
    await until(() => button("Проверить и отправить"), "application review");
    expect(document.querySelector('.manual-step-label[aria-current="step"]')?.textContent).toBe("Проверка и отправка");
    await click("Проверить и отправить");
    await until(() => button("Отправить заявку"), "submission confirmation");
    await click("Отправить заявку");
    await until(() => button("Выбрать предложение"), "bank offers");
    await click("Выбрать предложение");
    await until(() => button("Подписать договор"), "signing readiness");
    await click("Подписать договор");
    await until(() => button("Подписать"), "signing confirmation");
    await click("Подписать");
    await until(
      () => document.querySelector(".application-detail-page")?.textContent?.includes("Кредит выдан"),
      "completed loan",
    );
    expect(
      (
        await nativeFetch(`${base}/api/applications/${manualId}`).then(
          (response) => response.json(),
        )
      ).state.status,
    ).toBe("disbursed");

    await click("Платёжный календарь");
    await until(() => document.querySelector(".calendar-day"), "payment calendar loaded");
    const calendar = await nativeFetch(`${base}/api/calendar`).then(response => response.json());
    const firstPayment = calendar.events.find((item: { application_id: string; kind: string }) => item.application_id === manualId && item.kind === "loan_payment");
    expect(firstPayment).toBeTruthy();
    await click("К ближайшему платежу");
    await until(() => document.querySelector(`[data-date="${firstPayment.date}"]`), "issued loan payment month");
    const paymentDay = document.querySelector<HTMLButtonElement>(`[data-date="${firstPayment.date}"]`)!;
    expect(paymentDay.textContent).toContain("Платёж по кредиту");
    await act(async () => paymentDay.click());
    expect(document.querySelector(".calendar-day-details")?.textContent).toContain("проценты");

    const afterPayment = new Date(firstPayment.date + "T12:00:00Z");
    afterPayment.setUTCDate(afterPayment.getUTCDate() + 1);
    const penaltyDate = afterPayment.toISOString().slice(0,10);
    await act(async () => document.querySelector<HTMLButtonElement>(`[data-date="${penaltyDate}"]`)!.click());
    await click("Рассчитать штраф");
    await until(() => button("Рассчитать пени") && !button("Рассчитать пени")!.disabled, "automatic penalty conditions");
    expect(document.querySelector("#penalty-rate")).toBeNull();
    expect(document.querySelector(".penalty-contract-rates")?.textContent).toContain("Условия демо-договора");
    const cashBeforePenalty = (await nativeFetch(`${base}/api/profile`).then(response => response.json())).financials.cash_balance;
    await click("Рассчитать пени");
    await until(() => document.querySelector(".penalty-result-total"), "contract-based penalty result");
    expect(document.querySelector(".penalty-result")?.textContent).toContain("0,05% в день");
    expect((await nativeFetch(`${base}/api/profile`).then(response => response.json())).financials.cash_balance).toBe(cashBeforePenalty);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Закрыть расчёт штрафа"]')!.click());

    await click("Моё финансирование");
    await until(() => document.querySelectorAll(".funding-card").length === 1, "only the newly issued product");
    const loanFields = [...document.querySelectorAll(".funding-card")].map(card => [...card.querySelectorAll("dt")].map(field => field.textContent));
    expect(loanFields[0]).toEqual(["Ставка", "Проценты на сегодня", "Ближайший платёж", "Дата платежа", "Окончание договора"]);
    expect(document.querySelector(".cash-balance-total dd")?.textContent?.replace(/\s/g, " ")).toBe("800 000,00 ₽");
    const productCalendar = [...document.querySelectorAll<HTMLAnchorElement>(".funding-card a")].find(link => new URL(link.getAttribute("href")!, "http://test").searchParams.get("product") === `app:${manualId}`)!;
    expect(productCalendar).toBeTruthy();
    await act(async () => productCalendar.click());
    await until(() => document.querySelector<HTMLSelectElement>('[aria-label="Продукт в календаре"]')?.value === `app:${manualId}`, "calendar opened for issued product");
    await click("К ближайшему платежу");
    await until(() => document.querySelector(".payment-calendar-grid")?.textContent?.includes("Платёж по кредиту"), "selected product schedule");
    expect(document.querySelector(".payment-calendar-grid")?.textContent).not.toContain("Платёж по действующему кредиту");
    const productFilter = document.querySelector<HTMLSelectElement>('[aria-label="Продукт в календаре"]')!;
    expect([...productFilter.options].some(option => option.value.startsWith("loan:"))).toBe(false);
    await act(async () => {
      productFilter.focus();
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(productFilter, "all");
      productFilter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => document.querySelector<HTMLSelectElement>('[aria-label="Продукт в календаре"]')?.value === "all", "all actual products selected");
    expect(document.activeElement).toBe(productFilter);
    expect(document.querySelector(".payment-calendar-grid")?.textContent).not.toContain("Платёж по действующему кредиту");

    await openAssistant();
    await until(() => button("Начать подбор"), "assistant start");
    await click("Начать подбор");
    await until(
      () => button("Заплатить до поступления денег"),
      "first clarification",
    );
    const assistantId = JSON.parse(
      localStorage.getItem("delo-react-contexts")!,
    ).assistant;
    expect(assistantId).not.toBe(manualId);
    await click("Заплатить до поступления денег");
    await until(
      () => document.querySelector('[aria-label="Своя сумма, ₽"]'),
      "expense amount card",
    );
    await input('[aria-label="Своя сумма, ₽"]', "0");
    await click("Ответить");
    await until(
      () => document.querySelector('[role="alert"]'),
      "invalid amount feedback",
    );
    expect(
      (
        document.querySelector(
          '[aria-label="Своя сумма, ₽"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("0");
    await click("Отвечу своими словами");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Сообщение ассистенту",
    );
    await input('[aria-label="Своя сумма, ₽"]', "950 000");
    const expenseQuestion = document.querySelector(".clarification-card h3")!.textContent;
    await click("Ответить");
    await until(() => button("Завтра"), "expense date card");
    const savedAnswer = [...document.querySelectorAll(".luma-clarification-answer")].at(-1)!;
    expect(savedAnswer.textContent?.replace(/\s/g, " ")).toBe("950 000 ₽");
    expect(savedAnswer.previousElementSibling?.textContent).toBe(expenseQuestion);
    expect(document.querySelector('[role="log"]')?.textContent).not.toContain("Учёл ответ в черновике.");
    expect(document.querySelector('[role="log"]')?.textContent).not.toContain("Учла ответ в черновике.");
    await click("Завтра");
    await until(
      () => document.querySelector('[aria-label="Своя сумма, ₽"]'),
      "receipt amount card",
    );
    await input('[aria-label="Своя сумма, ₽"]', "1000000");
    await click("Ответить");
    await until(() => button("Через неделю"), "receipt date card");
    await click("Через неделю");
    await until(
      () => button("В эти даты платежей нет"),
      "known loan payment clarification",
    );
    await click("В эти даты платежей нет");
    await until(
      () =>
        !document.querySelector(".clarification-card") &&
        !button("Подтвердить данные и подобрать")?.disabled,
      "complete pending plan",
    );
    expect(document.querySelectorAll(".collected-operation")).toHaveLength(2);
    await until(
      () => document.querySelector(".cash-flow-chart"),
      "live cash flow chart",
    );
    expect(requests.filter((path) => path.endsWith("/messages"))).toHaveLength(
      0,
    );
    const before = await nativeFetch(
      `${base}/api/applications/${assistantId}`,
    ).then((response) => response.json());
    expect(before.application.application_version).toBe(1);
    await click("Проверить собранные данные");
    expect(document.querySelector(".assistant-layout")?.getAttribute("data-mobile-panel")).toBe("workspace");
    await input('[aria-label="Сообщение ассистенту"]', "Неотправленный вопрос");
    await click("Диалог");
    expect(document.querySelector(".assistant-layout")?.getAttribute("data-mobile-panel")).toBe("conversation");
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')?.value).toBe("Неотправленный вопрос");
    const pageScroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    const comparisonScroll = document.querySelector<HTMLElement>('.assistant-workspace-scroll[aria-label="Сравнение предложений"]')!;
    comparisonScroll.scrollTop = 240;
    await click("Подтвердить данные и подобрать");
    await until(() => button("Выбрать условия"), "confirmed overdraft option");
    expect(document.querySelector('.assistant-workspace-navigation [data-state="active"]')?.textContent).toBe("Предложения");
    expect(document.querySelector(".assistant-layout")?.getAttribute("data-mobile-panel")).toBe("workspace");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Сравнение предложений");
    expect(document.querySelector('.assistant-workspace-scroll[aria-label="Сравнение предложений"]')?.scrollTop).toBe(0);
    expect(pageScroll).not.toHaveBeenCalled();
    pageScroll.mockRestore();
    const comparisonContext = document.querySelector(".assistant-workspace .exploration-context")!;
    expect(comparisonContext.hasAttribute("open")).toBe(false);
    expect(Boolean(document.querySelector(".assistant-workspace .offer-comparison-grid")!.compareDocumentPosition(comparisonContext) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    const after = await nativeFetch(
      `${base}/api/applications/${assistantId}`,
    ).then((response) => response.json());
    expect(after.application.application_version).toBe(2);
    expect(after.application.financials.cash_balance).toBe("800000.00");

    await click("Получить финансирование");
    await until(() => button("Новый подбор"), "manual mode");
    await click("Новый подбор");
    await until(
      () =>
        document.querySelector("#need-amount") &&
        !(document.querySelector("#need-amount") as HTMLInputElement).disabled,
      "fresh independent manual draft",
    );
    await click("Закупить товар");
    await input("#need-amount", "600000");
    await openAssistant();
    await click("Получить финансирование");
    await until(
      () =>
        (document.querySelector("#need-amount") as HTMLInputElement)?.value ===
        "600000",
      "unsaved value after switching",
    );
    await act(async () => root.unmount());
    await render();
    await until(
      () =>
        (document.querySelector("#need-amount") as HTMLInputElement)?.value ===
        "600000",
      "unsaved value after reload",
    );
    const draftId = JSON.parse(
      localStorage.getItem("delo-react-contexts")!,
    ).manual;
    expect(
      (
        await nativeFetch(`${base}/api/applications/${draftId}`).then(
          (response) => response.json(),
        )
      ).application.need.requested_amount,
    ).toBeNull();
    await openAssistant();
    await until(
      () => document.querySelector('[aria-label="Сообщение ассистенту"]'),
      "restored assistant",
    );
    holdMessages = true;
    await input('[aria-label="Сообщение ассистенту"]', "Лучше на 18 месяцев");
    const submitMessage = document.querySelector<HTMLButtonElement>(
      '[aria-label="Отправить сообщение"]',
    )!;
    await until(() => !submitMessage.disabled, "restored conversation ready");
    await act(async () => submitMessage.click());
    expect(document.querySelector(".assistant-message-outgoing")?.textContent).toContain("Лучше на 18 месяцев");
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')?.value).toBe("");
    expect(submitMessage.disabled).toBe(true);
    await until(() => releaseMessage, "held model response");
    await input(
      '[aria-label="Сообщение ассистенту"]',
      "Следующий вопрос ещё не отправлен",
    );
    await click("Получить финансирование");
    await act(async () => {
      holdMessages = false;
      releaseMessage!();
    });
    await until(async () => (await nativeFetch(`${base}/api/applications/${assistantId}/chats`).then(response => response.json())).length > 0, "saved assistant history");
    expect(
      (document.querySelector("#need-amount") as HTMLInputElement).value,
    ).toBe("600000");
    expect(button("Подобрать продукт")?.getAttribute("aria-current")).toBe(
      "page",
    );
    await openAssistant();
    await until(() => document.body.textContent?.includes("Предлагаю изменить только срок"), "late assistant response restored after resume");
    expect(document.querySelector(".assistant-message-outgoing")).toBeNull();
    expect(
      (
        document.querySelector(
          '[aria-label="Сообщение ассистенту"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Следующий вопрос ещё не отправлен");
  }, 30_000);
  it("retries a lost assistant response without duplicating the message or losing the next draft", async () => {
    if (root) await act(async () => root.unmount());
    localStorage.clear();
    await render();
    await openAssistant();
    await until(() => button("Начать подбор"), "new assistant start");
    await click("Начать подбор");
    await until(() => document.querySelector(".clarification-card"), "new conversation ready");
    const text = "Мне нужен кредит 500 тысяч на закупку товара на 12 месяцев";
    const nextDraft = "А какие будут платежи?";
    const initialRequests = messageRequests.length;
    holdMessages = true;
    failMessageResponse = true;
    releaseMessage = undefined;
    try {
      await input('[aria-label="Сообщение ассистенту"]', text);
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Отправить сообщение"]')!.click());
      await until(() => releaseMessage, "processed message awaiting delivery");
      expect(document.querySelector(".assistant-message-outgoing")?.textContent).toContain(text);
      await input('[aria-label="Сообщение ассистенту"]', nextDraft);
      await act(async () => {
        holdMessages = false;
        releaseMessage!();
      });
      await until(() => button("Повторить запрос"), "recoverable message error");
      expect(document.querySelector(".assistant-message-outgoing")?.textContent).toContain("Ответ не получен");
      expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')?.value).toBe(nextDraft);
      await click("Повторить запрос");
      await until(() => !button("Повторить запрос") && !document.querySelector(".assistant-message-outgoing"), "successful retry");
      expect(messageRequests.slice(initialRequests)).toHaveLength(2);
      expect(messageRequests[initialRequests + 1]).toEqual(messageRequests[initialRequests]);
      expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')?.value).toBe(nextDraft);
      expect([...document.querySelectorAll(".assistant-message-user")].filter((item) => item.textContent?.includes(text))).toHaveLength(1);
      const id = JSON.parse(localStorage.getItem("delo-react-contexts")!).assistant;
      const chatId = JSON.parse(localStorage.getItem(`delo-chat:${id}`)!);
      const saved = await nativeFetch(`${base}/api/chats/${chatId}`).then((response) => response.json());
      expect(saved.chat.messages.filter((item: { role: string; text: string }) => item.role === "user" && item.text === text)).toHaveLength(1);
      expect(saved.record.application.application_version).toBe(1);

      failMessageResponse = true;
      const composer = document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Сообщение ассистенту"]',
      )!;
      await act(async () => {
        composer.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter", shiftKey: true, bubbles: true, cancelable: true,
        }));
        composer.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter", isComposing: true, bubbles: true, cancelable: true,
        }));
      });
      expect(messageRequests.slice(initialRequests)).toHaveLength(2);
      await act(async () => {
        composer.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter", bubbles: true, cancelable: true,
        }));
      });
      await until(() => button("Повторить запрос"), "second lost response");
      expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')?.value).toBe(nextDraft);
      await click("Повторить запрос");
      await until(() => !button("Повторить запрос"), "second retry complete");
      expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')?.value).toBe("");
    } finally {
      holdMessages = false;
      failMessageResponse = false;
      releaseHeldMessage();
    }
  }, 20_000);
  it("guides a manual cash gap to overdraft options without repeating product selection", async () => {
    if (root) await act(async () => root.unmount());
    localStorage.clear();
    const initialRequests = requests.length;
    await render();
    await until(() => button("Начать подбор"), "manual cash gap start");
    await click("Начать подбор");
    await until(() => document.querySelector("#need-amount"), "cash gap need form");
    await click("Посмотреть подходящие предложения");
    await until(() => document.activeElement?.id === "need-purpose", "focus on missing purpose");
    expect(document.querySelector("#need-purpose")?.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector("#need-purpose")?.getAttribute("aria-describedby")).toContain("need-purpose-error");
    await click("Закупить товар");
    await input("#need-amount", "не сумма");
    await click("Посмотреть подходящие предложения");
    await until(() => document.activeElement?.id === "need-amount", "focus on invalid amount");
    expect(document.querySelector<HTMLInputElement>("#need-amount")?.value).toBe("не сумма");
    expect(document.querySelector("#need-amount")?.getAttribute("aria-invalid")).toBe("true");
    await input("#need-amount", "");
    await click("Дождаться выручки");
    await click("Продолжить");
    expect(document.querySelector("#need-amount")).toBeNull();
    const manualId = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    const needKey = `delo-need:${manualId}:1`;
    expect(JSON.parse(localStorage.getItem(needKey)!).financingPattern).toBe("cash_gap");
    expect(document.querySelector('.need-progress [aria-current="step"]')?.textContent).toContain("Предстоящий платёж");
    expect(document.querySelector(".selection-step-anchor")?.hasAttribute("hidden")).toBe(true);
    expect(document.body.textContent).not.toContain("2. Денежный план");
    const start = document.querySelector<HTMLInputElement>('[id^="operation-date-"]')!.value;
    const date = (offset: number) => {
      const value = new Date(start + "T12:00:00Z");
      value.setUTCDate(value.getUTCDate() + offset);
      return value.toISOString().slice(0, 10);
    };
    const dates = document.querySelectorAll<HTMLInputElement>('[id^="operation-date-"]');
    const amounts = document.querySelectorAll<HTMLInputElement>('[id^="operation-amount-"]');
    await input(`#${dates[0].id}`, date(1));
    await input(`#${amounts[0].id}`, "950000");
    await click("Продолжить");
    const incomeDate = document.querySelector<HTMLInputElement>('[id^="operation-date-"]')!;
    const incomeAmount = document.querySelector<HTMLInputElement>('[id^="operation-amount-"]')!;
    await input(`#${incomeDate.id}`, date(7));
    await input(`#${incomeAmount.id}`, "1000000");
    // Both the need and its payment dates must survive leaving the page before saving.
    await act(async () => root.unmount());
    await render();
    await until(() => document.querySelector(`#${incomeAmount.id}`), "restored payment fields");
    expect(document.querySelector<HTMLInputElement>(`#${incomeAmount.id}`)?.value).toBe("1000000");
    await click("Назад");
    expect(document.querySelector<HTMLInputElement>(`#${amounts[0].id}`)?.value).toBe("950000");
    await click("Продолжить");
    expect(JSON.parse(localStorage.getItem(needKey)!).financingPattern).toBe("cash_gap");
    const debtConfirmation = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((item) => item.parentElement?.textContent?.includes("Я учёл в расходах"));
    if (debtConfirmation) await act(async () => debtConfirmation.click());
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector(".exploration-settings"), "cash gap options step");
    await until(() => button("Предложения")?.getAttribute("aria-current") === "step", "cash gap calculation completed");
    expect(document.body.textContent).toContain("Рассчитаем: Овердрафт");
    expect(document.querySelector("#compare-amount")).toBeNull();
    const settings = document.querySelector("#compare-product")!.closest("details")!;
    expect(settings.open).toBe(false);
    expect(button("Показать варианты")).toBeUndefined();
    await until(() => button("Выбрать условия"), "real overdraft options");
    const id = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    const read = () => nativeFetch(`${base}/api/applications/${id}`)
      .then((response) => response.json());
    const view = await read();
    expect(view.application.need.preferred_product).toBeNull();
    expect(view.application.application_version).toBe(2);
    expect(view.application.product_details.overdraft.end_date).toBe(date(7));
    expect(view.explorations.at(-1).product_id).toBe("overdraft");
    expect(view.explorations.at(-1).result.options[0].amount).toBe("150000.00");
    expect(view.explorations).toHaveLength(1);
    expect(requests.slice(initialRequests).some((url) => url.includes("/chats"))).toBe(false);

    const delayDetails = document.querySelector("#delay-inflow")!.closest("details")!;
    await act(async () => (delayDetails.querySelector("summary") as HTMLElement).click());
    await act(async () => (document.querySelector("#delay-inflow") as HTMLElement).click());
    await until(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].some(item => item.textContent !== "Не указано"), "receipt choices");
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent !== "Не указано")!.click());
    await click("Сравнить с задержкой");
    await until(() => button("Вернуться к основным предложениям"), "independent delay scenario");
    expect((await read()).application).toEqual(view.application);
    expect(document.body.textContent).toContain("Сохранённый план не изменён");
    expect(document.body.textContent).toContain("Сначала дополните платежи и поступления");
    expect(document.querySelector('.cash-flow-chart')).toBeNull();
    expect(button("Выбрать условия")).toBeUndefined();
    await click("Вернуться к основным предложениям");
    await until(() => button("Выбрать условия"), "original offers restored");
    expect((await read()).application).toEqual(view.application);

    await click("Изменить задачу");
    await until(() => document.querySelector(".need-progress"), "edit saved need");
    const receiptDate = document.querySelector<HTMLInputElement>('[id^="operation-date-"]')!;
    await input(`#${receiptDate.id}`, date(8));
    const confirmation = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find(item => item.parentElement?.textContent?.includes("Я учёл в расходах"));
    if (confirmation) await act(async () => confirmation.click());
    await click("Посмотреть подходящие предложения");
    await until(() => button("Выбрать условия"), "recalculated edited dates");
    await until(async () => (await read()).application.application_version === 3, "saved new receipt date");
    expect((await read()).application.product_details.overdraft.end_date).toBe(date(8));
    await click("Изменить задачу");
    await until(() => document.querySelector(".need-progress"), "edit after date correction");
    await click("Закупить товар");
    await input("#need-amount", "500000");
    await input("#need-term", "12");
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector(".exploration-settings"), "updated loan selection");
    await until(() => document.body.textContent?.includes("Рассчитаем: Кредит на оборотные цели"), "working capital settings after saved selection");
    await act(async () => (document.querySelector(".exploration-settings summary") as HTMLElement).click());
    await click("Показать варианты");
    await until(() => document.querySelector(".loan-calendar-trigger"), "updated loan options");
    expect((await read()).explorations.at(-1).product_id).toBe("working_capital_loan");
  }, 20_000);

  it("restores separate conversations created in the previous cabinet", async () => {
    if (root) await act(async () => root.unmount());
    localStorage.clear();
    const create = async (path: string, body = {}) =>
      nativeFetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((response) => response.json());
    const manual = await create("/api/applications"),
      assistant = await create("/api/applications");
    const manualChat = await create("/api/chats", {
      application_id: manual.application.application_id,
    });
    const assistantChat = await create("/api/chats", {
      application_id: assistant.application.application_id,
    });
    localStorage.setItem(
      "delo-workspace-contexts",
      JSON.stringify({
        manual: { chat_id: manualChat.chat.chat_id },
        assistant: { chat_id: assistantChat.chat.chat_id },
      }),
    );
    await render();
    await until(
      () => document.querySelector("#need-amount"),
      "legacy manual draft",
    );
    const contexts = JSON.parse(localStorage.getItem("delo-react-contexts")!);
    expect(contexts.manual).toBe(manual.application.application_id);
    expect(contexts.assistant).toBe(assistant.application.application_id);
    await openAssistant();
    await until(
      () => document.querySelector(".clarification-card"),
      "legacy assistant conversation",
    );
    expect(
      JSON.parse(localStorage.getItem(`delo-chat:${contexts.assistant}`)!),
    ).toBe(assistantChat.chat.chat_id);
  });

  it("uses a real invoice as a future expense without overwriting the credit amount or bank data", async () => {
    if (root) await act(async () => root.unmount());
    localStorage.clear();
    await render();
    await until(() => button("Начать подбор"), "fresh manual screen");
    await click("Начать подбор");
    await until(
      () => document.querySelector("#need-amount"),
      "fresh manual form",
    );
    await click("Закупить товар");
    await input("#need-amount", "500000");
    await input("#need-term", "12");
    const planToggle = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find(item => item.parentElement?.textContent?.includes("Показать, как кредит"))!;
    // The optional financial forecast no longer has a separate enable checkbox.
    expect(planToggle).toBeUndefined();
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector(".exploration-settings"), "saved manual form");
    await click("Изменить задачу");
    await input("#need-term", "24");
    await needPage(1);
    await act(async () => document.querySelector<HTMLElement>(".invoice-panel > summary")!.click());
    const file = new File(
      [
        new Uint8Array(
          await readFile(
            resolve("../contracts/documents/supplier-invoice.pdf"),
          ),
        ),
      ],
      "счёт.pdf",
      { type: "application/pdf" },
    );
    const upload = document.querySelector<HTMLInputElement>(
      '[aria-label="Загрузить счёт PDF"]',
    )!;
    await act(async () => {
      Object.defineProperty(upload, "files", {
        value: [file],
        configurable: true,
      });
      upload.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(
      () => document.querySelector('[id^="invoice-amount-"]'),
      "extracted invoice",
    );
    expect(
      (document.querySelector('[id^="invoice-amount-"]') as HTMLInputElement)
        .value,
    ).toBe("450000.00");
    expect(
      (document.querySelector('[id^="invoice-date-"]') as HTMLInputElement)
        .value,
    ).toBe("2026-11-05");
    const useAs = document.querySelector(
      '[aria-label="Как использовать счёт"]',
    ) as HTMLSelectElement;
    expect(useAs.value).toBe("planned_expense");
    expect([...useAs.options].some(item => item.value === "loan_amount")).toBe(false);
    expect(button("Учесть оплату счёта")!.disabled).toBe(false);
    expect(
      (document.querySelector("#need-amount") as HTMLInputElement).value,
    ).toBe("500000.00");
    await click("Показать источник");
    expect(document.body.textContent).toContain(
      "Итого к оплате: 450 000,00 руб.",
    );
    await click("Учесть оплату счёта");
    const contexts = JSON.parse(localStorage.getItem("delo-react-contexts")!);
    const readInvoiceRecord = () => nativeFetch(`${base}/api/applications/${contexts.manual}`).then(response => response.json());
    await until(async () => (await readInvoiceRecord()).application.product_details?.overdraft?.transactions.some((row: {amount:string}) => row.amount === "450000.00"), "invoice applied to expense");
    await until(() => document.querySelector<HTMLInputElement>("#need-term")?.value === "24", "local term retained after invoice import");
    expect((document.querySelector("#need-term") as HTMLInputElement).value).toBe("24");
    const record = await readInvoiceRecord();
    expect(record.application.financials.cash_balance).toBe("800000.00");
    expect(record.application.need.requested_amount).toBe("500000.00");
    const expense = record.application.product_details.overdraft.transactions.find((row: {direction: string}) => row.direction === "outflow");
    expect(expense.amount).toBe("450000.00");
    expect(expense.date).toBe("2026-11-05");
    expect(Object.values(record.field_sources).some((source: unknown) => (source as { original?: { value: string } }).original?.value === "450000.00")).toBe(true);
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector(".exploration-settings"), "updated loan need");
    await act(async () => (document.querySelector(".exploration-settings summary") as HTMLElement).click());
    await click("Показать варианты");
    await until(() => button("Выбрать условия"), "invoice-backed options");
    await click("Выбрать условия");
    await click("Перейти к заявке");
    await until(
      () => button("Проверить и отправить"),
      "invoice-backed application",
    );
    expect(
      document.querySelector('a[href*="/documents/"][href$="/file"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[aria-label="Загрузить счёт PDF"]'),
    ).toBeNull();
  }, 20_000);

  it("shows dated loan payments and compares delayed revenue before explicitly applying it", async () => {
    if (root) await act(async () => root.unmount());
    localStorage.clear();
    const day = (offset: number) => {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Europe/Moscow",
      });
      const value = new Date(today + "T12:00:00Z");
      value.setUTCDate(value.getUTCDate() + offset);
      return value.toISOString().slice(0, 10);
    };
    const post = (path: string, body: unknown, method = "POST") =>
      nativeFetch(base + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((response) => {
        expect(response.ok).toBe(true);
        return response.json();
      });
    const record = await post("/api/applications", {
      need: {
        purpose: "working_capital",
        preferred_product: "working_capital_loan",
        financing_pattern: "gradual_repayment",
        requested_amount: "500000.00",
        term_months: 12,
        needed_by: day(0),
      },
    });
    const id = record.application.application_id;
    const transactions = [
      {
        transaction_id: "purchase",
        date: day(1),
        amount: "450000.00",
        direction: "outflow",
      },
      {
        transaction_id: "receipt",
        date: day(7),
        amount: "500000.00",
        direction: "inflow",
      },
      {
        transaction_id: "next-purchase",
        date: day(9),
        amount: "1100000.00",
        direction: "outflow",
      },
    ];
    const links: { loan_id: string; transaction_id: string }[] = [];
    for (let offset = 0; offset <= 50; offset++) {
      if (day(offset).slice(-2) !== "15") continue;
      for (const loan of record.application.financials.existing_loans) {
        const transactionId = `${loan.loan_id}-${day(offset)}`;
        transactions.push({
          transaction_id: transactionId,
          date: day(offset),
          amount: loan.monthly_payment,
          direction: "outflow",
        });
        links.push({ loan_id: loan.loan_id, transaction_id: transactionId });
      }
    }
    await post(
      `/api/applications/${id}`,
      {
        base_application_version: 1,
        changes: {
          "product_details.overdraft": {
            start_date: day(0),
            end_date: day(50),
            opening_cash_balance: "300000.00",
            cash_reserve: "0.00",
            transactions,
            existing_debt_payments: links,
          },
        },
      },
      "PATCH",
    );
    await post(`/api/applications/${id}/explorations`, {
      base_application_version: 2,
      product_id: "working_capital_loan",
    });
    localStorage.setItem(
      "delo-react-contexts",
      JSON.stringify({ manual: id, assistant: null }),
    );
    localStorage.setItem(`delo-step:${id}`, JSON.stringify("options"));
    await render();
    await until(
      () => document.querySelector(".loan-calendar-trigger"),
      "loan options",
    );
    await act(async () =>
      (document.querySelector(".loan-calendar-trigger") as HTMLElement).click(),
    );
    await until(
      () =>
        document.querySelector(
          '[aria-label="Календарь платежей по кредиту"] time',
        ),
      "dated calendar",
    );
    expect(document.body.textContent).toContain("Минимальный остаток:");
    const calendarDialog = document.querySelector('[role="dialog"]')!;
    expect(calendarDialog.getAttribute("aria-modal")).toBe("true");
    expect(calendarDialog.closest(".exploration-option")).toBeNull();
    expect(calendarDialog.querySelector('[role="region"][tabindex="0"]')).toBeTruthy();
    const calendarTrigger = document.querySelector(".loan-calendar-trigger");
    await act(async () => (document.querySelector('[aria-label="Закрыть график платежей"]') as HTMLButtonElement).click());
    await until(() => !document.querySelector('[role="dialog"]'), "calendar closed");
    await until(() => document.activeElement === calendarTrigger, "calendar returns focus to its offer");
    await act(async () => (calendarTrigger as HTMLButtonElement).click());
    await until(() => document.querySelector('[aria-label="Календарь платежей по кредиту"] time'), "calendar reopened");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await until(() => !document.querySelector('[role="dialog"]'), "calendar dismissed with Escape");
    await act(async () => (calendarTrigger as HTMLButtonElement).click());
    await until(() => document.querySelector('[aria-label="Календарь платежей по кредиту"] time'), "calendar ready for scenario");
    const select = document.querySelector(
      '[aria-label="Поступление для переноса"]',
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = "receipt";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await input('[aria-label="Задержка поступления, дней"]', "10");
    await click("Сравнить с задержкой");
    await until(
      () =>
        document.body.textContent?.includes(
          "После переноса возникает нехватка денег.",
        ),
      "scenario shortfall",
    );
    const read = () =>
      nativeFetch(`${base}/api/applications/${id}`).then((response) =>
        response.json(),
      );
    expect(
      (await read()).application.product_details.overdraft.transactions.find(
        (row: { transaction_id: string }) => row.transaction_id === "receipt",
      ).date,
    ).toBe(day(7));
    await click("Применить перенос");
    await click("Изменить дату");
    await until(
      () =>
        document.body.textContent?.includes(
          "Условия нужно обновить",
        ),
      "saved changed plan",
    );
    const saved = await read();
    expect(saved.application.application_version).toBe(3);
    expect(saved.application.need.requested_amount).toBe("500000.00");
    expect(
      saved.application.product_details.overdraft.transactions.find(
        (row: { transaction_id: string }) => row.transaction_id === "receipt",
      ).date,
    ).toBe(day(17));
  }, 20_000);
  it("refinances selected bank loans through comparison, signing and the shared calendar", async () => {
    if (root) await act(async () => root.unmount());
    localStorage.clear();
    const before = await nativeFetch(`${base}/api/profile`).then(response => response.json());
    await render();
    await until(() => button("Начать подбор"), "refinancing start");
    await click("Начать подбор");
    await until(() => button("Объединить кредиты"), "refinancing task");
    await click("Объединить кредиты");
    await click("Продолжить");
    expect(document.querySelector("#need-amount")).toBeNull();
    const checkboxes = document.querySelectorAll<HTMLInputElement>('[aria-label^="Рефинансировать кредит"]');
    expect(checkboxes.length).toBeGreaterThan(0);
    for (const checkbox of checkboxes) await act(async () => checkbox.click());
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector('[aria-label="Текущие кредиты для сравнения"]'), "current schedules compared");
    await until(() => document.querySelectorAll('.exploration-option').length > 1, "multiple refinancing terms");
    expect(document.body.textContent).toContain("Пиковая нагрузка меньше, но общая стоимость выше");
    expect(document.querySelector('#compare-amount')).toBeNull();
    const option = [...document.querySelectorAll('.exploration-option')].find(item => item.textContent?.includes("24 мес."))!;
    expect(option).toBeTruthy();
    const id = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    const original = await nativeFetch(`${base}/api/applications/${id}`).then(response => response.json());
    expect(original.application.financials).toEqual(before.financials);
    await chooseOption(option);
    await click("Перейти к заявке");
    await until(() => button("Проверить и отправить"), "refinancing review");
    await click("Проверить и отправить");
    await click("Отправить заявку");
    await until(() => button("Выбрать предложение"), "refinancing final offer");
    await click("Выбрать предложение");
    await until(() => button("Подписать договор"), "refinancing ready");
    await click("Подписать договор");
    await click("Подписать");
    await until(() => document.body.textContent?.includes("Рефинансирование завершено"), "refinancing complete");
    const after = await nativeFetch(`${base}/api/profile`).then(response => response.json());
    expect(after.financials.cash_balance).toBe(before.financials.cash_balance);
    expect(after.financials.existing_loans).toHaveLength(1);
    expect(after.financials.existing_loans[0].application_id).toBe(id);
    await click("Платёжный календарь");
    await until(() => document.querySelector('.payment-calendar-grid'), "refinanced calendar");
    const calendar = await nativeFetch(`${base}/api/calendar`).then(response => response.json());
    expect(calendar.events.some((event: {kind: string}) => event.kind === "refinancing_completed")).toBe(true);
    expect(calendar.events.some((event: {kind: string}) => event.kind === "existing_loan_payment")).toBe(false);
    expect(calendar.accounts.filter((account: {status: string}) => account.status === "active")).toHaveLength(1);
    await click("Моё финансирование");
    await until(() => document.querySelector('.funding-filter'), "portfolio filters");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.funding-filter button')].find(item => item.textContent?.startsWith("Закрытые"))!.click());
    await until(() => document.querySelector('.funding-card-status')?.textContent?.includes("Рефинансирован"), "old product visibly repaid in archive");
  }, 20_000);

  it("opens a revolving line, draws and repays money while restoring the limit", async () => {
    await act(async () => { root.unmount(); });
    localStorage.clear();
    const before = await nativeFetch(base + "/api/profile").then(response => response.json());
    root = createRoot(host);
    await act(async () => { root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={["/cabinet?mode=manual"]}><CabinetPage /></MemoryRouter></QueryClientProvider>); });
    await click("Начать подбор");
    await click("Регулярные закупки");
    await input("#need-amount", "200000");
    await click("Посмотреть подходящие предложения");
    await until(() => [...document.querySelectorAll<HTMLElement>(".exploration-option")].some(item => item.textContent?.includes("12 мес.")), "line offers");
    expect(document.body.textContent).toContain("Погашение основного долга восстанавливает доступный лимит");
    const offer = [...document.querySelectorAll<HTMLElement>(".exploration-option")].find(item => item.textContent?.includes("12 мес."))!;
    await chooseOption(offer);
    await click("Перейти к заявке");
    await click("Проверить и отправить");
    await click("Отправить заявку");
    await click("Выбрать предложение");
    await click("Подписать договор");
    await click("Подписать");
    await until(() => document.querySelector(".application-detail-page")?.textContent?.includes("Лимит открыт"), "opened line");
    const opened = await nativeFetch(base + "/api/profile").then(response => response.json());
    expect(opened.financials.cash_balance).toBe(before.financials.cash_balance);
    const loan = opened.financials.existing_loans.find((item: {product_id?: string}) => item.product_id === "revolving_credit_line");
    expect(loan).toBeTruthy();
    await click("Моё финансирование");
    await until(() => button("Получить деньги"), "line action in portfolio");
    await click("Получить деньги");
    await until(() => document.querySelector("[aria-label='Управление кредитной линией'] input"), "line controls in portfolio");
    await input("[aria-label='Управление кредитной линией'] input", "50000");
    await click("Получить деньги по линии");
    await click("Подтвердить выборку");
    await until(() => document.querySelector(".operation-result")?.textContent?.includes("Деньги зачислены на счёт"), "draw receipt");
    expect(document.querySelector("[aria-label='Управление кредитной линией'] input")).toBeNull();
    const url = base + "/api/applications/" + loan.application_id + "/credit-line";
    expect((await nativeFetch(url).then(response => response.json())).available_limit).toBe("150000.00");
    await click("Другая операция");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("[aria-label='Управление кредитной линией'] .funding-operation-switch button")].find(item => item.textContent === "Внести платёж")!.click());
    await input("[aria-label='Управление кредитной линией'] input", "20000");
    await click("Внести платёж по линии");
    await click("Подтвердить платёж");
    await until(async () => (await nativeFetch(url).then(response => response.json())).available_limit === "170000.00", "limit restored");
    const profile = await nativeFetch(base + "/api/profile").then(response => response.json());
    expect(Number(profile.financials.cash_balance)).toBe(Number(before.financials.cash_balance) + 30000);
    const lineState = await nativeFetch(url).then(response => response.json());
    await until(() => document.querySelector(".operation-result")?.textContent?.includes("Платёж выполнен"), "repayment receipt");
    await click("Готово");
    await until(() => !document.querySelector('[role="dialog"]'), "line management closed");
    await until(() => {
      const card = [...document.querySelectorAll<HTMLElement>(".funding-card")].find(item => item.textContent?.includes("Возобновляемая кредитная линия"));
      const payment = [...card?.querySelectorAll("dt") || []].find(item => item.textContent === "Ближайший платёж")?.nextElementSibling?.querySelector(".funding-payment-amount")?.textContent?.replace(/[^\d,]/g, "").replace(",", ".");
      return payment && Number(payment) === Number(lineState.schedule[0].total_payment);
    }, "completed payment is not shown as the next payment");
    const calendar = await nativeFetch(base + "/api/calendar").then(response => response.json());
    expect(calendar.events.some((item: {application_id:string;kind:string}) => item.application_id === loan.application_id && item.kind === "line_final_payment")).toBe(true);
  }, 25_000);

  it("finances equipment, explains the first debt during a second application and restores both calendars", async () => {
    await act(async () => { root.unmount(); });
    localStorage.clear();
    root = createRoot(host);
    await act(async () => { root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={["/cabinet?mode=manual"]}><CabinetPage /></MemoryRouter></QueryClientProvider>); });
    await click("Начать подбор");
    await click("Купить оборудование");
    expect(document.querySelector("#need-amount")).toBeNull();
    await input("#need-project-cost", "200000");
    await input("#need-own", "100000");
    await click("3 месяца");
    await click("Посмотреть подходящие предложения");
    await until(() => [...document.querySelectorAll(".exploration-option")].some(item => item.textContent?.includes("36 мес.")), "investment offers");
    const option = [...document.querySelectorAll(".exploration-option")].find(item => item.textContent?.includes("36 мес."))!;
    expect(option.textContent).toContain("Первые 3 мес.");
    expect(option.textContent).toContain("только проценты");
    const id = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    await chooseOption(option);
    await click("Перейти к заявке");
    await click("Проверить и отправить");
    await click("Отправить заявку");
    await click("Выбрать предложение");
    await click("Подписать договор");
    await click("Подписать");
    await until(async () => (await nativeFetch(`${base}/api/applications/${id}`).then(response => response.json())).completion?.product_id === "investment_loan", "investment issued");
    const view = await nativeFetch(`${base}/api/applications/${id}`).then(response => response.json());
    expect(view.completion.product_id).toBe("investment_loan");
    expect(view.completion.schedule).toHaveLength(36);
    expect(view.completion.schedule[0].principal_payment).toBe("0.00");
    expect(view.completion.schedule[0].total_payment).toBe("1500.00");
    expect(Number(view.completion.schedule[3].principal_payment)).toBeGreaterThan(0);
    await click("Платёжный календарь");
    await until(() => document.querySelector(".payment-calendar-grid"), "investment in calendar");
    const calendar = await nativeFetch(base + "/api/calendar").then(response => response.json());
    const payments = calendar.events.filter((item: { application_id:string; direction:string }) => item.application_id === id && item.direction === "outflow");
    expect(payments).toHaveLength(36);
    expect(payments[0].amount).toBe("1500.00");
    await click("Получить финансирование");
    await click("Подобрать продукт");
    await click("Новый подбор");
    await until(() => document.querySelector("#need-amount"), "second financing need");
    await click("Закупить товар");
    await input("#need-amount", "100000");
    await input("#need-term", "12");
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector("[aria-label='Учтённые кредиты']"), "previous debts explained");
    const debtDetails = document.querySelector<HTMLElement>("[aria-label='Учтённые кредиты']")!;
    await act(async () => { debtDetails.querySelector("summary")!.click(); });
    const previousInvestment = [...debtDetails.querySelectorAll("li")].find(item => item.textContent?.includes("Инвестиционный кредит"));
    expect(previousInvestment).toBeTruthy();
    expect(previousInvestment?.textContent).toContain("после отсрочки");
    expect(previousInvestment?.textContent).toContain("только проценты");
    const secondId = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    expect(secondId).not.toBe(id);
    const secondOption = [...document.querySelectorAll(".exploration-option")].find(item => item.textContent?.includes("12 мес."))!;
    expect(secondOption).toBeTruthy();
    await chooseOption(secondOption);
    await click("Перейти к заявке");
    await click("Проверить и отправить");
    await click("Отправить заявку");
    await click("Выбрать предложение");
    await click("Подписать договор");
    await click("Подписать");
    await until(async () => (await nativeFetch(`${base}/api/applications/${secondId}`).then(response => response.json())).completion?.product_id === "working_capital_loan", "second loan issued");
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={["/cabinet?mode=calendar"]}><CabinetPage /></MemoryRouter></QueryClientProvider>); });
    await until(() => document.querySelector(".payment-calendar-grid"), "both loans restored after reopening");
    const restored = await nativeFetch(base + "/api/calendar").then(response => response.json());
    const profile = await nativeFetch(base + "/api/profile").then(response => response.json());
    for (const [applicationId, expectedLength] of [[id, 36], [secondId, 12]] as const) {
      expect(restored.events.filter((item: {application_id:string;direction:string}) => item.application_id === applicationId && item.direction === "outflow")).toHaveLength(expectedLength);
      expect(profile.financials.existing_loans.filter((item: {application_id?:string}) => item.application_id === applicationId)).toHaveLength(1);
    }
  }, 40_000);

  it("refinances the equipment loan during grace without promising lower immediate payments or duplicating cash", async () => {
    const before = await nativeFetch(base + "/api/profile").then(response => response.json());
    const investment = before.financials.existing_loans.find((loan: {product_id?:string}) => loan.product_id === "investment_loan");
    expect(investment).toBeTruthy();
    await click("Получить финансирование");
    await click("Подобрать продукт");
    await click("Новый подбор");
    await click("Объединить кредиты");
    await click("Продолжить");
    await until(() => [...document.querySelectorAll("[aria-label='Кредиты для рефинансирования'] label")].some(label => label.textContent?.includes("Инвестиционный кредит")), "investment available for replacement");
    const oldCredit = [...document.querySelectorAll("[aria-label='Кредиты для рефинансирования'] label")].find(label => label.textContent?.includes("Инвестиционный кредит"))!;
    await act(async () => { oldCredit.querySelector<HTMLInputElement>("input[type=checkbox]")!.click(); });
    await click("Посмотреть подходящие предложения");
    await until(() => [...document.querySelectorAll(".exploration-option")].some(item => item.textContent?.includes("36 мес.")), "replacement offers");
    const option = [...document.querySelectorAll(".exploration-option")].find(item => item.textContent?.includes("36 мес."))!;
    expect(option.textContent).toContain("В первом месяце выплаты вырастут");
    expect(option.textContent).toContain("хотя максимальная нагрузка снизится");
    const id = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    await chooseOption(option);
    await click("Перейти к заявке");
    await click("Проверить и отправить");
    await click("Отправить заявку");
    await click("Выбрать предложение");
    let selected: {state:{status:string}};
    await until(async () => { selected = await nativeFetch(`${base}/api/applications/${id}`).then(response => response.json()); return ["ready_to_sign", "conditions_pending"].includes(selected.state.status); }, "replacement selected");
    if (selected!.state.status === "conditions_pending") {
      await click("Подтвердить поручительство");
      await click("Подтвердить");
    }
    await click("Подписать договор");
    await click("Подписать");
    await until(async () => (await nativeFetch(`${base}/api/applications/${id}`).then(response => response.json())).completion?.product_id === "refinancing", "replacement completed");
    const profile = await nativeFetch(base + "/api/profile").then(response => response.json());
    expect(profile.financials.cash_balance).toBe(before.financials.cash_balance);
    expect(profile.financials.existing_loans).toHaveLength(before.financials.existing_loans.length);
    expect(profile.financials.existing_loans.some((loan: {loan_id:string}) => loan.loan_id === investment.loan_id)).toBe(false);
    const calendar = await nativeFetch(base + "/api/calendar").then(response => response.json());
    expect(calendar.events.some((event: {application_id:string;direction:string}) => event.application_id === investment.application_id && event.direction === "outflow")).toBe(false);
    expect(calendar.events.filter((event: {application_id:string;direction:string}) => event.application_id === id && event.direction === "outflow")).toHaveLength(36);
    await click("Моё финансирование");
    await until(() => document.querySelector('.funding-filter'), "portfolio archive filter");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.funding-filter button')].find(item => item.textContent?.startsWith("Закрытые"))!.click());
    await until(() => document.querySelector(`[aria-labelledby="funding-app:${investment.application_id}"] .funding-card-status`)?.textContent?.includes("Рефинансирован"), "replaced equipment loan marked closed");
  }, 30_000);

  it.each(["before", "after"] as const)("recovers a chat creation failure %s the server response without leaving a dead end or duplicate chat", async (failure) => {
    await act(async () => root.unmount());
    localStorage.clear();
    createChatFailure = failure;
    await render();
    await openAssistant();
    await click("Начать подбор");
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes("Не удалось связаться"), "failed chat creation");
    const id = JSON.parse(localStorage.getItem("delo-react-contexts")!).assistant;
    await click("Обновить");
    await until(() => !document.querySelector('[role="alert"]'), "chat error cleared");
    await input('[aria-label="Сообщение ассистенту"]', "Нужны деньги на закупку товара.");
    await until(() => !document.querySelector<HTMLButtonElement>('[aria-label="Отправить сообщение"]')?.disabled, "chat recovered and ready to send");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    const chats = await nativeFetch(`${base}/api/applications/${id}/chats`).then(response => response.json());
    expect(chats).toHaveLength(1);
    const message = document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')!;
    expect(message.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Отправить сообщение"]')!.disabled).toBe(false);
  }, 15_000);
  it("creates and repeats applications as new records while restoring list filters", async () => {
    if (root) await act(async () => root.unmount());
    localStorage.clear();
    await render();
    await click("Начать подбор");
    await until(() => document.querySelector("#need-amount"), "initial task");
    const oldId = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".workspace-nav-body nav button")].find(item => item.textContent?.startsWith("Заявки"))!.click());
    await click("Новая заявка");
    await until(() => JSON.parse(localStorage.getItem("delo-react-contexts")!).manual !== oldId && document.querySelector("#need-amount"), "fresh task");
    const freshId = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    expect((document.querySelector("#need-amount") as HTMLInputElement).value).toBe("");
    expect((await nativeFetch(`${base}/api/applications/${oldId}`).then(response => response.json())).state.status).toBe("draft");
    expect(freshId).not.toBe(oldId);
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".workspace-nav-body nav button")].find(item => item.textContent?.startsWith("Заявки"))!.click());
    await until(() => document.querySelector(".application-record"), "applications loaded");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".applications-filters button")].find(item => item.textContent?.startsWith("Завершённые"))!.click());
    const completedCard = [...document.querySelectorAll<HTMLElement>(".application-record")].find(item => /Кредит выдан|Лимит открыт/.test(item.textContent || ""))!;
    expect(completedCard).toBeTruthy();
    const sourceId = completedCard.querySelector("h3")!.id.replace("application-", "");
    const original = await nativeFetch(`${base}/api/applications/${sourceId}`).then(response => response.json());
    await act(async () => completedCard.querySelector<HTMLButtonElement>("button")!.click());
    await click("Все заявки");
    expect([...document.querySelectorAll(".applications-filters button")].find(item => item.textContent?.startsWith("Завершённые"))?.getAttribute("aria-pressed")).toBe("true");
    const sameCard = document.querySelector<HTMLElement>(`[aria-labelledby="application-${sourceId}"]`)!;
    await act(async () => sameCard.querySelector<HTMLButtonElement>("button")!.click());
    await until(() => document.querySelector('[aria-label="Действия с заявкой"]'), "loaded application actions");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Действия с заявкой"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await until(() => document.querySelector('[role="menuitem"]'), "application actions menu");
    await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    await until(() => JSON.parse(localStorage.getItem("delo-react-contexts")!).manual !== freshId && document.querySelector(".selection-workspace"), "repeated task");
    const repeatedId = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    expect(repeatedId).not.toBe(sourceId);
    const repeated = await nativeFetch(`${base}/api/applications/${repeatedId}`).then(response => response.json());
    expect(repeated.application.need.purpose).toBe(original.application.need.purpose);
    expect(repeated.application.need.preferred_product).toBe(original.application.need.preferred_product);
    expect(repeated.application.need.term_months).toBe(original.application.need.term_months);
    expect(repeated.events.some((item: { type: string }) => item.type === "application_repeated")).toBe(true);
    if (original.application.need.preferred_product === "refinancing") expect(repeated.application.product_details.refinancing.loan_ids).toEqual([]);
    else expect(repeated.application.need.requested_amount).toBe(original.application.need.requested_amount);
    expect(repeated.state.status).toBe("draft");
    expect((await nativeFetch(`${base}/api/applications/${sourceId}`).then(response => response.json())).state.status).toBe(original.state.status);
    await act(async () => root.unmount());
    localStorage.clear();
  }, 15_000);

  it("starts a fresh Luma task from a completed conversation while preserving its history and the manual task", async () => {
    if (root) await act(async () => root.unmount());
    const post = (path: string, body: object) => nativeFetch(base + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(response => { expect(response.ok).toBe(true); return response.json(); });
    const manual = await post("/api/applications", {});
    const original = await post("/api/applications", {});
    const oldId = original.application.application_id;
    const chat = await post("/api/chats", { application_id: oldId });
    const closed = await post(`/api/applications/${oldId}/cancel`, {
      base_application_version: chat.record.application.application_version, confirmed: true,
    });
    const history = await nativeFetch(`${base}/api/chats/${chat.chat.chat_id}`).then(response => response.json());
    localStorage.clear();
    localStorage.setItem("delo-react-contexts", JSON.stringify({ manual: manual.application.application_id, assistant: oldId }));
    await render();
    await openAssistant();
    await until(() => document.querySelector(".saved-selection-entry"), "completed task entry");
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')).toBeNull();
    await click("Начать новый подбор");
    await until(() => JSON.parse(localStorage.getItem("delo-react-contexts")!).assistant !== oldId
      && document.querySelector(".clarification-card")
      && document.querySelector<HTMLTextAreaElement>('[aria-label="Сообщение ассистенту"]')?.disabled === false,
      "new application and editable chat");
    const contexts = JSON.parse(localStorage.getItem("delo-react-contexts")!);
    expect(contexts.manual).toBe(manual.application.application_id);
    expect(button("Новая задача с Лумой")).toBeUndefined();
    const fresh = await nativeFetch(`${base}/api/applications/${contexts.assistant}`).then(response => response.json());
    expect(fresh.state.status).toBe("draft");
    expect(fresh.application.need.requested_amount).toBeNull();
    const chats = await nativeFetch(`${base}/api/applications/${contexts.assistant}/chats`).then(response => response.json());
    expect(chats).toHaveLength(1);
    expect(chats[0].chat_id).not.toBe(chat.chat.chat_id);
    expect(await nativeFetch(`${base}/api/applications/${oldId}`).then(response => response.json())).toEqual(closed);
    expect(await nativeFetch(`${base}/api/chats/${chat.chat.chat_id}`).then(response => response.json())).toEqual(history);
  }, 15_000);

  it("opens timeline dates and calculates server penalties for one selected credit without moving money", async () => {
    if (root) await act(async () => root.unmount());
    const calendar: CalendarData = await nativeFetch(base + "/api/calendar").then(response => response.json());
    const before = await nativeFetch(base + "/api/profile").then(response => response.json());
    const active = new Set(calendar.accounts.filter(account => !["closed", "refinanced"].includes(account.status || "")).map(account => account.application_id));
    const due = calendar.events.find(event => isDebtObligation(event) && active.has(event.application_id) && Number(event.amount) > 0)!;
    expect(due).toBeTruthy();
    const target = new Date(Date.parse(due.date + "T12:00:00Z") + 20 * 86400000).toISOString().slice(0,10);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/cabinet?mode=calendar&view=timeline&date=${target}`]}><CabinetPage /></MemoryRouter></QueryClientProvider>));
    await until(() => document.querySelector(".payment-timeline-contract"), "timeline loaded");
    await act(async () => document.querySelector<HTMLButtonElement>(`[data-timeline-date="${target}"]`)!.click());
    await until(() => document.querySelector(".payment-timeline-detail-actions button"), "date inspector and penalty action");
    expect(document.querySelector(`[data-timeline-date="${target}"][aria-pressed="true"]`)).toBeTruthy();
    await click("Рассчитать пени");
    await until(() => document.querySelector(".penalty-product-option"), "penalty products");
    for (const option of document.querySelectorAll<HTMLLabelElement>(".penalty-product-option")) {
      if (!option.textContent?.includes(due.application_id.slice(0,6))) await act(async () => option.querySelector<HTMLInputElement>("input")!.click());
    }
    expect(document.querySelectorAll('.penalty-product-option input:checked')).toHaveLength(1);
    expect(document.querySelector("#penalty-rate")).toBeNull();
    const calculate = document.querySelector<HTMLButtonElement>('.penalty-form button[type="submit"]')!;
    expect(calculate.disabled).toBe(false);
    await act(async () => calculate.click());
    await until(() => document.querySelector(".penalty-result"), "server penalty result");
    expect(document.querySelectorAll(".penalty-result-products>details")).toHaveLength(1);
    expect(document.querySelector(".penalty-result-total")?.textContent).toMatch(/[1-9]/);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Закрыть расчёт штрафа"]')!.click());
    await click("Календарь");
    expect(document.querySelector(`[data-date="${target}"][aria-pressed="true"]`)).toBeTruthy();
    const after = await nativeFetch(base + "/api/profile").then(response => response.json());
    expect(after.financials).toEqual(before.financials);
    expect(await nativeFetch(base + "/api/calendar").then(response => response.json())).toEqual(calendar);
    await act(async () => root.unmount()); client.clear();
  }, 15_000);

  it("previews and confirms account spending with overdraft, then automatically repays it from revenue", async () => {
    if (root) await act(async () => root.unmount());
    const post = async (path:string, body:object) => {
      const response=await nativeFetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      expect(response.ok,await response.clone().text()).toBe(true);return response.json();
    };
    const profile = await nativeFetch(base+"/api/profile").then(response=>response.json());
    const calendar = await nativeFetch(base+"/api/calendar").then(response=>response.json());
    const today = calendar.today;
    const later = new Date(Date.parse(today+"T12:00:00Z")+7*86400000).toISOString().slice(0,10);
    let view = await post("/api/applications",{need:{purpose:"working_capital",preferred_product:"overdraft",financing_pattern:"cash_gap",requested_amount:"150000.00"},product_details:{overdraft:{start_date:today,end_date:later,opening_cash_balance:profile.financials.cash_balance,cash_reserve:"0.00",transactions:[{transaction_id:"supplier",date:today,direction:"outflow",amount:(Number(profile.financials.cash_balance)+150000).toFixed(2)},{transaction_id:"revenue",date:later,direction:"inflow",amount:"200000.00"}],existing_debt_payments:[]}}});
    const id = view.application.application_id;
    const version = view.application.application_version;
    view = await post(`/api/applications/${id}/submit`,{base_application_version:version,confirmed:true});
    const assessment = view.result.assessment, offer = assessment.offers[0];
    expect(offer).toBeTruthy();
    view = await post(`/api/applications/${id}/select-offer`,{base_application_version:version,assessment_id:assessment.assessment_id,offer_id:offer.offer_id});
    for(const condition of offer.conditions) view = await post(`/api/applications/${id}/conditions/${condition.code}/complete`,{base_application_version:version,offer_id:offer.offer_id,confirmed:true});
    view = await post(`/api/applications/${id}/sign`,{base_application_version:version,offer_id:offer.offer_id,confirmed:true});
    expect(view.state.status).toBe("limit_opened");
    root=createRoot(host);const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/cabinet?mode=portfolio&manage=${id}&action=draw`]}><CabinetPage/></MemoryRouter></QueryClientProvider>));
    await until(()=>document.querySelector("#supplier-name"),"supplier invoice form");
    const cash = (await nativeFetch(base+"/api/profile").then(response=>response.json())).financials.cash_balance;
    await input("#supplier-name", "ООО Поставка");
    await input("#supplier-amount", (Number(cash)+100000).toFixed(2));
    await input("#supplier-number", "148");
    await input("#supplier-purpose", "Оплата товара по счёту № 148. Без НДС.");
    await click("Далее: реквизиты");
    await input("#supplier-inn", "7707083893");
    await input("#supplier-account", "40702810200000000001");
    await input("#supplier-bik", "044525225");
    await click("Проверить платёж");
    await until(()=>document.querySelector(".supplier-review"),"supplier payment preview");
    expect(document.querySelector(".supplier-split")?.textContent?.replace(/\s/g," ")).toContain("100 000,00 ₽");
    expect(document.querySelector("[data-overdraft-terms]")?.textContent).toContain("24% годовых");
    expect((await nativeFetch(`${base}/api/applications/${id}/overdraft`).then(response=>response.json())).principal).toBe("0.00");
    const confirm = [...document.querySelectorAll<HTMLButtonElement>(".supplier-actions button")].find(item=>item.textContent?.startsWith("Оплатить "))!;
    await act(async()=>confirm.click());
    await until(()=>document.querySelector(".operation-result"),"completed supplier payment receipt");
    expect(document.querySelector(".operation-result")?.textContent).toContain("Демо-платёж выполнен");
    expect(document.querySelector(".operation-result")?.textContent).toContain("ООО Поставка");
    expect(document.querySelector("#supplier-amount")).toBeNull();
    let state=await nativeFetch(`${base}/api/applications/${id}/overdraft`).then(response=>response.json());
    expect(state.principal).toBe("100000.00");expect(state.cash_balance).toBe("0.00");
    const paymentHistory=await nativeFetch(base+"/api/account/payments").then(response=>response.json());
    expect(paymentHistory.payments[0].request.recipient_account).toBe("40702810200000000001");
    expect(paymentHistory.payments[0].quote.overdraft_application_id).toBe(id);
    await click("Готово");
    const card = document.getElementById(`funding-app:${id}`)!.closest(".funding-card")!;
    await act(async()=>[...card.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent==="Зачислить поступление")!.click());
    await until(()=>document.querySelector("#overdraft-payment-amount"),"revenue receipt form");
    await input("#overdraft-payment-amount","50000");
    await click("Проверить поступление");
    await click("Подтвердить поступление");
    await until(()=>document.querySelector(".operation-result")?.textContent?.includes("Поступление зачислено"),"receipt and automatic repayment");
    state=await nativeFetch(`${base}/api/applications/${id}/overdraft`).then(response=>response.json());
    expect(state.principal).toBe("50000.00");expect(state.available_limit).toBe("100000.00");expect(state.cash_balance).toBe("0.00");
    expect(state.operations.map((item:{kind:string})=>item.kind)).toEqual(["expense","receipt","auto_repayment"]);
    const updated=await nativeFetch(base+"/api/calendar").then(response=>response.json());
    expect(updated.events.some((item:{application_id:string;kind:string})=>item.application_id===id&&item.kind==="overdraft_payment_due")).toBe(true);
    await click("Готово");
    await click("Оплатить счёт");
    await until(()=>document.querySelector("#supplier-name"), "new supplier invoice");
    const account = await nativeFetch(base+"/api/account/payments").then(response=>response.json());
    const invoiceAmount = (Number(account.cash_balance) + Number(account.overdraft?.available_limit || 0) + 100000).toFixed(2);
    await input("#supplier-name", "ООО Второй поставщик");
    await input("#supplier-amount", invoiceAmount);
    await input("#supplier-purpose", "Оплата следующей поставки. Без НДС.");
    await click("Далее: реквизиты");
    await input("#supplier-inn", "7707083893");
    await input("#supplier-account", "40702810200000000001");
    await input("#supplier-bik", "044525225");
    await click("Проверить платёж");
    await until(()=>button("Подобрать финансирование"), "financing instead of an impossible payment");
    expect([...document.querySelectorAll<HTMLButtonElement>(".supplier-actions button")].some(item=>item.textContent?.startsWith("Оплатить "))).toBe(false);
    await click("Подобрать финансирование");
    await until(()=>document.querySelector(".need-progress") && button("Вернуться к счёту поставщика"), "guided financing and return to saved invoice");
    expect(document.querySelector<HTMLInputElement>("#need-amount")?.value).toBe("100000.00");
    await click("Вернуться к счёту поставщика");
    await until(()=>document.querySelector<HTMLInputElement>("#supplier-name")?.value === "ООО Второй поставщик", "invoice retained after financing handoff");
    expect(document.querySelector<HTMLInputElement>("#supplier-amount")?.value).toBe(invoiceAmount);
    expect((await nativeFetch(base+"/api/profile").then(response=>response.json())).financials.cash_balance).toBe("0.00");
  },20_000);
});
