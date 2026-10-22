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
    if (condition()) return;
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
    const manualId = JSON.parse(
      localStorage.getItem("delo-react-contexts")!,
    ).manual;
    await click("Закупить товар");
    await input("#need-amount", "500000");
    await input("#need-term", "12");
    await click("Продолжить к вариантам");
    await until(() => button("Показать варианты"), "saved manual need");
    await click("Показать варианты");
    await until(() => button("Выбрать условия"), "real loan options");
    await click("Выбрать условия");
    await until(() => button("Перейти к заявке"), "apply confirmation");
    await click("Перейти к заявке");
    await until(() => button("Проверить и отправить"), "application review");
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

    await click("С ИИ-ассистентом");
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
    await input('[aria-label="Своя сумма, ₽"]', "450 000");
    await click("Ответить");
    await until(() => button("Завтра"), "expense date card");
    await click("Завтра");
    await until(
      () => document.querySelector('[aria-label="Своя сумма, ₽"]'),
      "receipt amount card",
    );
    await input('[aria-label="Своя сумма, ₽"]', "500000");
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
    await click("Подтвердить данные и подобрать");
    await until(() => button("Выбрать условия"), "confirmed overdraft option");
    const after = await nativeFetch(
      `${base}/api/applications/${assistantId}`,
    ).then((response) => response.json());
    expect(after.application.application_version).toBe(2);
    expect(after.application.financials.cash_balance).toBe("300000.00");

    await click("Подобрать продукт");
    await until(() => button("Новый подбор"), "manual mode");
    await click("Новый подбор");
    await until(
      () =>
        document.querySelector("#need-amount") &&
        !(document.querySelector("#need-amount") as HTMLInputElement).disabled,
      "fresh independent manual draft",
    );
    await input("#need-amount", "600000");
    await click("С ИИ-ассистентом");
    await click("Подобрать продукт");
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
    await click("С ИИ-ассистентом");
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
    await click("Подобрать продукт");
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
    await click("С ИИ-ассистентом");
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
    await click("С ИИ-ассистентом");
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
    await click("Дождаться выручки");
    await click("Продолжить к денежному плану");
    await until(() => document.querySelector("#plan-start"), "cash gap plan step");
    expect(button("2. Денежный план")?.getAttribute("aria-current")).toBe("step");
    const start = document.querySelector<HTMLInputElement>("#plan-start")!.value;
    const date = (offset: number) => {
      const value = new Date(start + "T12:00:00Z");
      value.setUTCDate(value.getUTCDate() + offset);
      return value.toISOString().slice(0, 10);
    };
    await input("#plan-end", date(7));
    await click("Расход");
    const expenseDate = document.querySelector<HTMLInputElement>('[id^="operation-date-"]')!;
    const expenseAmount = document.querySelector<HTMLInputElement>('[id^="operation-amount-"]')!;
    await input(`#${expenseDate.id}`, date(1));
    await input(`#${expenseAmount.id}`, "450000");
    await click("Поступление");
    const amounts = document.querySelectorAll<HTMLInputElement>('[id^="operation-amount-"]');
    await input(`#${amounts[1].id}`, "500000");
    const debtConfirmation = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((item) => item.parentElement?.textContent?.includes("Я учёл в расходах"));
    if (debtConfirmation) await act(async () => debtConfirmation.click());
    await click("Продолжить к вариантам");
    await until(() => button("Показать варианты"), "cash gap options step");
    expect(button("3. Варианты")?.getAttribute("aria-current")).toBe("step");
    expect(document.body.textContent).toContain("Рассчитаем: Овердрафт");
    expect(document.querySelector("#compare-amount")).toBeNull();
    const settings = document.querySelector("#compare-product")!.closest("details")!;
    expect(settings.open).toBe(false);
    expect(visible(button("Показать варианты")!)).toBe(true);
    await click("Показать варианты");
    await until(() => button("Выбрать условия"), "real overdraft options");
    const id = JSON.parse(localStorage.getItem("delo-react-contexts")!).manual;
    const read = () => nativeFetch(`${base}/api/applications/${id}`)
      .then((response) => response.json());
    const view = await read();
    expect(view.application.need.preferred_product).toBeNull();
    expect(view.explorations.at(-1).product_id).toBe("overdraft");
    expect(view.explorations.at(-1).result.options[0].amount).toBe("150000.00");
    expect(requests.slice(initialRequests).some((url) => url.includes("/chats"))).toBe(false);

    await click("Изменить потребность");
    await until(() => button("Закупить товар"), "edit saved need");
    await click("Закупить товар");
    await input("#need-amount", "500000");
    await input("#need-term", "12");
    await click("Продолжить к вариантам");
    await until(() => button("Показать варианты"), "updated loan selection");
    expect(document.body.textContent).toContain("Рассчитаем: Кредит на оборотные цели");
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
    await click("С ИИ-ассистентом");
    await until(
      () => document.querySelector(".clarification-card"),
      "legacy assistant conversation",
    );
    expect(
      JSON.parse(localStorage.getItem(`delo-chat:${contexts.assistant}`)!),
    ).toBe(assistantChat.chat.chat_id);
  });

  it("reviews a real PDF, explicitly resolves a conflicting credit amount and shows its source", async () => {
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
    await click("Продолжить к вариантам");
    await until(() => button("Показать варианты"), "saved manual form");
    await click("1. Потребность");
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
    await act(async () => {
      useAs.value = "loan_amount";
      useAs.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button("Использовать проверенные данные")!.disabled).toBe(true);
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
    await click("Использовать проверенные данные");
    await until(
      () =>
        (document.querySelector("#need-amount") as HTMLInputElement).value ===
        "450000.00",
      "invoice applied to need",
    );
    expect(document.body.textContent).toContain("Из счёта, стр. 1");
    expect(
      (document.querySelector("#need-term") as HTMLInputElement).value,
    ).toBe("24");
    const contexts = JSON.parse(localStorage.getItem("delo-react-contexts")!);
    const record = await nativeFetch(
      `${base}/api/applications/${contexts.manual}`,
    ).then((response) => response.json());
    expect(record.application.financials.cash_balance).toBe("300000.00");
    expect(record.field_sources["need.requested_amount"].original.value).toBe(
      "450000.00",
    );
    await click("Продолжить к вариантам");
    await until(() => button("Показать варианты"), "updated loan need");
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
        amount: "600000.00",
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
});
