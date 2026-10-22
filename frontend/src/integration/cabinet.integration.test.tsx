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
    !element.closest("details:not([open]) > :not(summary)")
  );
}
function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => visible(item) && item.textContent?.trim() === label,
  );
}
async function click(label: string) {
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
}
async function input(selector: string, value: string) {
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
  let releaseMessage: (() => void) | undefined;
  function releaseHeldMessage() {
    releaseMessage?.();
    releaseMessage = undefined;
  }
  beforeAll(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", async (url: string | URL, options?: RequestInit) => {
      requests.push(String(url));
      if (String(url).endsWith("/messages"))
        messageRequests.push(JSON.parse(String(options?.body)));
      const response = await nativeFetch(new URL(url, base), options);
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
  function render() {
    root = createRoot(host);
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 30_000 },
        mutations: { retry: false },
      },
    });
    return act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/cabinet?mode=manual"]}>
            <CabinetPage />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
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
    expect(document.activeElement?.textContent).toBe("На что нужны деньги?");
    await click("Посмотреть подходящие предложения");
    await until(() => button("Выбрать условия"), "reopened loan options");
    expect(requests.filter(path => path.endsWith(`/applications/${manualId}/explorations`))).toHaveLength(2);
    await click("Выбрать условия");
    await until(() => button("Перейти к заявке"), "apply confirmation");
    await click("Перейти к заявке");
    await until(() => button("Проверить и отправить"), "application review");
    expect(document.querySelector('.manual-step-label[aria-current="step"]')?.textContent).toBe("3. Проверка и отправка");
    await click("Проверить и отправить");
    await until(() => button("Отправить заявку"), "submission confirmation");
    await click("Отправить заявку");
    await until(() => button("Выбрать предложение"), "bank offers");
    await click("Выбрать предложение");
    await until(() => button("Подписать и завершить"), "signing readiness");
    await click("Подписать и завершить");
    await until(() => button("Подписать"), "signing confirmation");
    await click("Подписать");
    await until(
      () => [...document.querySelectorAll(".cabinet-application-item")].some(
        (item) => item.getAttribute("aria-current") === "page" && item.textContent?.includes("Кредит выдан"),
      ),
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
    expect(document.querySelector(".calendar-day-details")?.textContent).toContain("По плану");

    await click("Моё финансирование");
    await until(() => document.querySelectorAll(".portfolio-product").length === 2, "existing and newly issued products");
    const productCalendar = document.querySelector<HTMLAnchorElement>(`a[href="/cabinet?mode=calendar&product=app:${manualId}"]`)!;
    expect(productCalendar).toBeTruthy();
    await act(async () => productCalendar.click());
    await until(() => document.querySelector<HTMLSelectElement>('[aria-label="Продукт в календаре"]')?.value === `app:${manualId}`, "calendar opened for issued product");
    await click("К ближайшему платежу");
    await until(() => document.querySelector(".payment-calendar-grid")?.textContent?.includes("Платёж по кредиту"), "selected product schedule");
    expect(document.querySelector(".payment-calendar-grid")?.textContent).not.toContain("Платёж по действующему кредиту");
    const productFilter = document.querySelector<HTMLSelectElement>('[aria-label="Продукт в календаре"]')!;
    const existingLoan = [...productFilter.options].find(option => option.value.startsWith("loan:"))!;
    await act(async () => {
      productFilter.focus();
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(productFilter, existingLoan.value);
      productFilter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => document.querySelector(".payment-calendar-grid")?.textContent?.includes("Платёж по действующему кредиту"), "bank loan schedule");
    expect(document.activeElement).toBe(productFilter);
    expect(document.querySelector(".payment-calendar-grid")?.textContent).not.toContain("Последний платёж по кредиту");

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
    await click("Ответить");
    await until(() => button("Завтра"), "expense date card");
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
    await click("Подтвердить данные и подобрать");
    await until(() => button("Выбрать условия"), "confirmed overdraft option");
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
    await until(
      () =>
        document.body.textContent?.includes("Предлагаю изменить только срок"),
      "late assistant response",
    );
    expect(
      (document.querySelector("#need-amount") as HTMLInputElement).value,
    ).toBe("600000");
    expect(button("Подобрать продукт")?.getAttribute("aria-current")).toBe(
      "page",
    );
    await openAssistant();
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
    await input("#need-term", "не срок");
    await click("Дождаться выручки");
    await click("Посмотреть подходящие предложения");
    await until(() => document.activeElement?.id === "need-term", "retained term is editable after switching product");
    expect(document.querySelector("#need-term-error")?.textContent).toContain("Срок должен быть");
    expect(document.querySelector("#need-term")?.closest("details")?.open).toBe(true);
    await click("Закупить товар");
    await input("#need-term", "");
    await click("Дождаться выручки");
    expect(document.querySelector("#need-amount")?.getAttribute("aria-describedby")).toContain("need-amount-hint");
    const manualId = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    const needKey = `delo-need:${manualId}:1`;
    expect(JSON.parse(localStorage.getItem(needKey)!).financingPattern).toBe("cash_gap");
    expect(button("1. На что нужны деньги")?.getAttribute("aria-current")).toBe("step");
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
    await input(`#${dates[1].id}`, date(7));
    await input(`#${amounts[1].id}`, "1000000");
    // Both the need and its payment dates must survive leaving the page before saving.
    await act(async () => root.unmount());
    await render();
    await until(() => document.querySelector(`#${amounts[0].id}`), "restored payment fields");
    expect(document.querySelector<HTMLInputElement>(`#${amounts[0].id}`)?.value).toBe("950000");
    expect(JSON.parse(localStorage.getItem(needKey)!).financingPattern).toBe("cash_gap");
    const debtConfirmation = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((item) => item.parentElement?.textContent?.includes("Я учёл в расходах"));
    if (debtConfirmation) await act(async () => debtConfirmation.click());
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector(".exploration-settings"), "cash gap options step");
    await until(() => button("2. Подходящие предложения")?.getAttribute("aria-current") === "step", "cash gap calculation completed");
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
    await until(() => button("Закупить товар"), "edit saved need");
    const receiptDate = [...document.querySelectorAll<HTMLInputElement>('[id^="operation-date-"]')][1];
    await input(`#${receiptDate.id}`, date(8));
    const confirmation = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find(item => item.parentElement?.textContent?.includes("Я учёл в расходах"));
    if (confirmation) await act(async () => confirmation.click());
    await click("Посмотреть подходящие предложения");
    await until(() => button("Выбрать условия") && (document.body.textContent || "").includes("Последний расчёт"), "recalculated edited dates");
    await until(async () => (await read()).application.application_version === 3, "saved new receipt date");
    expect((await read()).application.product_details.overdraft.end_date).toBe(date(8));
    await click("Изменить задачу");
    await until(() => button("Закупить товар"), "edit after date correction");
    await click("Закупить товар");
    await input("#need-amount", "500000");
    await input("#need-term", "12");
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector(".exploration-settings"), "updated loan selection");
    await until(() => document.body.textContent?.includes("Рассчитаем: Кредит на оборотные цели"), "working capital settings after saved selection");
    await act(async () => (document.querySelector(".exploration-settings summary") as HTMLElement).click());
    await click("Показать варианты");
    await until(() => document.querySelector(".loan-calendar summary"), "updated loan options");
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
    await act(async () => planToggle.click());
    const dates = document.querySelectorAll<HTMLInputElement>('[id^="operation-date-"]');
    const amounts = document.querySelectorAll<HTMLInputElement>('[id^="operation-amount-"]');
    await input(`#${dates[0].id}`, "2026-11-05");
    await input(`#${amounts[0].id}`, "500000");
    await input(`#${dates[1].id}`, "2026-11-10");
    await input(`#${amounts[1].id}`, "600000");
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector(".exploration-settings"), "saved manual form");
    await click("1. На что нужны деньги");
    await input("#need-term", "24");
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
    expect(button("Учесть оплату счёта")!.disabled).toBe(true);
    expect(
      (document.querySelector("#need-amount") as HTMLInputElement).value,
    ).toBe("500000.00");
    await click("Показать источник");
    expect(document.body.textContent).toContain(
      "Итого к оплате: 450 000,00 руб.",
    );
    const acknowledge = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((item) =>
      item.parentElement?.textContent?.includes("Заменить отличающиеся"),
    )!;
    await act(async () => acknowledge.click());
    await click("Учесть оплату счёта");
    await until(
      () => document.querySelector<HTMLInputElement>('[id^="operation-amount-"]')?.value === "450000.00",
      "invoice applied to expense",
    );
    expect(document.body.textContent).toContain("Из счёта, стр. 1");
    expect(
      (document.querySelector("#need-term") as HTMLInputElement).value,
    ).toBe("24");
    const contexts = JSON.parse(localStorage.getItem("delo-react-contexts")!);
    const record = await nativeFetch(
      `${base}/api/applications/${contexts.manual}`,
    ).then((response) => response.json());
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
      () => document.querySelector(".loan-calendar summary"),
      "loan options",
    );
    await act(async () =>
      (document.querySelector(".loan-calendar summary") as HTMLElement).click(),
    );
    await until(
      () =>
        document.querySelector(
          '[aria-label="Календарь платежей по кредиту"] time',
        ),
      "dated calendar",
    );
    expect(document.body.textContent).toContain("Минимальный остаток:");
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
          "Данные изменились. Пересчитайте варианты для нового графика.",
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
    expect(document.querySelector("#need-amount")).toBeNull();
    const checkboxes = document.querySelectorAll<HTMLInputElement>('[aria-label^="Рефинансировать кредит"]');
    expect(checkboxes.length).toBeGreaterThan(0);
    for (const checkbox of checkboxes) await act(async () => checkbox.click());
    await click("Посмотреть подходящие предложения");
    await until(() => document.querySelector('[aria-label="Текущие кредиты для сравнения"]'), "current schedules compared");
    await until(() => document.querySelectorAll('.exploration-option').length > 1, "multiple refinancing terms");
    expect(document.body.textContent).toContain("Платёж меньше, но общая стоимость выше");
    expect(document.querySelector('#compare-amount')).toBeNull();
    const option = [...document.querySelectorAll('.exploration-option')].find(item => item.textContent?.includes("24 мес."))!;
    expect(option).toBeTruthy();
    const id = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    const original = await nativeFetch(`${base}/api/applications/${id}`).then(response => response.json());
    expect(original.application.financials).toEqual(before.financials);
    await act(async () => (option.querySelector('button') as HTMLButtonElement).click());
    await click("Перейти к заявке");
    await until(() => button("Проверить и отправить"), "refinancing review");
    await click("Проверить и отправить");
    await click("Отправить заявку");
    await until(() => button("Выбрать предложение"), "refinancing final offer");
    await click("Выбрать предложение");
    await until(() => button("Подписать и завершить"), "refinancing ready");
    await click("Подписать и завершить");
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
    await until(() => document.body.textContent?.includes("Погашен рефинансированием"), "old product visibly repaid");
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
    await act(async () => { offer.querySelector<HTMLButtonElement>("button")!.click(); });
    await click("Перейти к заявке");
    await click("Проверить и отправить");
    await click("Отправить заявку");
    await click("Выбрать предложение");
    await click("Подписать и завершить");
    await click("Подписать");
    await until(() => document.body.textContent?.includes("Управление кредитной линией"), "opened line");
    const opened = await nativeFetch(base + "/api/profile").then(response => response.json());
    expect(opened.financials.cash_balance).toBe(before.financials.cash_balance);
    const loan = opened.financials.existing_loans.find((item: {product_id?: string}) => item.product_id === "revolving_credit_line");
    expect(loan).toBeTruthy();
    await click("Моё финансирование");
    await until(() => document.querySelector("[aria-label='Управление кредитной линией'] input"), "line controls in portfolio");
    await input("[aria-label='Управление кредитной линией'] input", "50000");
    await click("Получить деньги по линии");
    await click("Подтвердить выборку");
    await until(() => document.querySelector("[aria-label='Управление кредитной линией']")?.textContent?.includes("Операция выполнена"), "draw complete");
    const url = base + "/api/applications/" + loan.application_id + "/credit-line";
    expect((await nativeFetch(url).then(response => response.json())).available_limit).toBe("150000.00");
    await input("[aria-label='Управление кредитной линией'] input", "20000");
    await click("Внести платёж по линии");
    await click("Подтвердить платёж");
    await until(async () => (await nativeFetch(url).then(response => response.json())).available_limit === "170000.00", "limit restored");
    const profile = await nativeFetch(base + "/api/profile").then(response => response.json());
    expect(Number(profile.financials.cash_balance)).toBe(Number(before.financials.cash_balance) + 30000);
    await until(() => {
      const card = [...document.querySelectorAll<HTMLElement>(".portfolio-product")].find(item => item.textContent?.includes("Возобновляемая кредитная линия"));
      const payment = card?.querySelectorAll("dd")[1]?.textContent?.replace(/\s/g, "");
      return payment && !payment.includes("20000₽");
    }, "completed payment is not shown as the next payment");
    const calendar = await nativeFetch(base + "/api/calendar").then(response => response.json());
    expect(calendar.events.some((item: {application_id:string;kind:string}) => item.application_id === loan.application_id && item.kind === "line_final_payment")).toBe(true);
  }, 25_000);

  it("finances equipment with a contribution and interest-only grace, then shows the real payment calendar", async () => {
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
    await act(async () => { option.querySelector<HTMLButtonElement>("button")!.click(); });
    await click("Перейти к заявке");
    await click("Проверить и отправить");
    await click("Отправить заявку");
    await click("Выбрать предложение");
    await click("Подписать и завершить");
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
  }, 25_000);
});
