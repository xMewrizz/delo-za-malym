import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "node:process";
import {
  applicationListSchema,
  createApplication,
  createScenario,
  getApplication,
  getProfile,
  listScenarios,
  selectOffer,
  signOffer,
  completeCondition,
  versionAction,
  exploreApplication,
  applyExploration,
} from "@/features/applications/api/applications";
import { getProducts } from "@/features/products/api/products";
import {
  answerClarification,
  createChat,
  previewProposal,
  resolveProposal,
  sendMessage,
} from "@/features/assistant/api/chat";
import { pendingProposal } from "@/features/assistant/model/projection";

const base = env.CABINET_TEST_URL;
const nativeFetch = globalThis.fetch;
describe.skipIf(!base)("frontend contracts against the running backend", () => {
  beforeAll(() =>
    vi.stubGlobal("fetch", (url: string | URL, options?: RequestInit) =>
      nativeFetch(new URL(url, base), options),
    ),
  );
  afterAll(() => vi.unstubAllGlobals());
  it("accepts the real profile, catalog and all fourteen assessment responses", async () => {
    expect((await getProfile()).company_name).toBeTruthy();
    expect(await getProducts()).toHaveLength(5);
    const scenarios = await listScenarios();
    expect(scenarios).toHaveLength(14);
    for (const scenario of scenarios) {
      let view = await createScenario(
        scenario.product_id,
        scenario.scenario_id,
      );
      view = await versionAction(
        view.application.application_id,
        view.application.application_version,
        "submit",
      );
      expect(view.result).toBeTruthy();
      if (view.state.status === "check_retry_pending") {
        view = await versionAction(
          view.application.application_id,
          view.application.application_version,
          "retry",
        );
        expect(view.state.status).toBe("offers_ready");
      }
      const assessment = view.result?.assessment;
      if (assessment?.offers.length) {
        const id = view.application.application_id,
          offer = assessment.offers[0];
        view = await selectOffer(
          id,
          view.application.application_version,
          assessment.assessment_id,
          offer.offer_id,
        );
        if (view.state.status === "conditions_pending")
          view = await completeCondition(
            id,
            view.application.application_version,
            "guarantee_required",
            offer.offer_id,
          );
        view = await signOffer(
          id,
          view.application.application_version,
          offer.offer_id,
        );
        expect(view.state.status).toBe(
          scenario.product_id === "overdraft" ? "limit_opened" : "disbursed",
        );
      }
    }
    const response = await nativeFetch(base + "/api/applications");
    expect(
      applicationListSchema.parse(await response.json()).length,
    ).toBeGreaterThanOrEqual(14);
  });
  it("collects a cash gap through cards, previews without saving and applies an actual offer", async () => {
    const manual = await createApplication(),
      independent = await createApplication();
    let chat = await createChat(independent.application.application_id);
    const answer = async (value: { choice_id: string } | { value: string }) => {
      expect(chat.clarification).toBeTruthy();
      chat = await answerClarification(
        chat,
        chat.clarification!.question_id,
        crypto.randomUUID(),
        value,
      );
    };
    await answer({ choice_id: "cash_gap" });
    await expect(answer({ value: "0" })).rejects.toMatchObject({ status: 422 });
    await answer({ value: "450 000" });
    await answer({ choice_id: "tomorrow" });
    await answer({ value: "500000" });
    await answer({ choice_id: "week" });
    expect(chat.clarification).toBeNull();
    const pending = pendingProposal(chat)!;
    const preview = await previewProposal(
      chat.chat.chat_id,
      chat.chat.chat_version,
      pending.proposal_id,
    );
    expect(preview.confirmed).toBe(false);
    expect(preview.result.calculation?.required_limit).toBe("150000.00");
    expect(preview.result.options?.length).toBeGreaterThan(0);
    expect(
      (await getApplication(independent.application.application_id)).application
        .application_version,
    ).toBe(1);
    expect(
      (await getApplication(manual.application.application_id)).application.need
        .requested_amount,
    ).toBeNull();
    chat = await resolveProposal(
      chat.chat.chat_id,
      chat.chat.chat_version,
      pending.proposal_id,
      true,
    );
    const exploration = chat.record.explorations.at(-1)!;
    const option = exploration.result.options![0];
    const selected = await applyExploration(
      chat.record.application.application_id,
      chat.record.application.application_version,
      exploration.exploration_id,
      option.option_id!,
    );
    expect(selected.application.need.preferred_product).toBe("overdraft");
    const plan = selected.application.product_details!.overdraft as {
      transactions: { direction: string; transaction_id: string }[];
    };
    const receipt = plan.transactions.find(
      (row) => row.direction === "inflow",
    )!;
    const alternative = await exploreApplication(
      selected.application.application_id,
      selected.application.application_version,
      "overdraft",
      {},
      { transaction_id: receipt.transaction_id, days: 3 },
    );
    expect(alternative.explorations.at(-1)!.result.options).toEqual([]);
    expect(
      alternative.explorations.at(-1)!.result.horizon_extension_required,
    ).toBe(true);
    expect(alternative.application.product_details).toEqual(
      selected.application.product_details,
    );
  });
  it("accepts model message proposals through the same client boundary", async () => {
    const application = await createApplication(),
      chat = await createChat(application.application.application_id);
    const reply = await sendMessage(
      chat.chat.chat_id,
      chat.chat.chat_version,
      crypto.randomUUID(),
      "Нужно 500 000 ₽ на закупку на 12 месяцев",
    );
    expect(pendingProposal(reply)?.changes["need.requested_amount"]).toBe(
      "500000.00",
    );
    expect(reply.record.application.need.requested_amount).toBeNull();
  });
});
