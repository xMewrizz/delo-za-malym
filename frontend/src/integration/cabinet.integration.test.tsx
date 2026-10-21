// @vitest-environment jsdom
import { act } from "react";
import { env } from "node:process";
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
  let holdMessages = false;
  let releaseMessage: (() => void) | undefined;
  beforeAll(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", async (url: string | URL, options?: RequestInit) => {
      requests.push(String(url));
      const response = await nativeFetch(new URL(url, base), options);
      if (holdMessages && String(url).endsWith("/messages"))
        await new Promise<void>((resolve) => {
          releaseMessage = resolve;
        });
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
    await click("Сохранить черновик");
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
      () => document.body.textContent?.includes("Кредит выдан"),
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
    expect(
      (
        document.querySelector(
          '[aria-label="Сообщение ассистенту"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Следующий вопрос ещё не отправлен");
  }, 30_000);
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
});
