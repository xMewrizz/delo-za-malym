import { describe, expect, it } from "vitest";
import { applicationViewSchema } from "@/features/applications";
import { pendingProposal, projectApplication } from "./projection";
import { chatViewSchema } from "../api/chat";

const record = () =>
  applicationViewSchema.parse({
    application: {
      application_id: "manual",
      application_version: 1,
      need: { requested_amount: null },
      financials: { cash_balance: "300000.00" },
      product_details: {},
    },
    client_data: {},
    state: {
      status: "draft",
      application_version: 1,
      next_action: { type: "complete_profile", label: "Дополнить" },
    },
    result: null,
    recommendation: null,
    readiness: null,
    completion: null,
    explorations: [],
    events: [],
  });
describe("conversation projection", () => {
  it("shows full project financing when no own funds were promised",()=>{
    const source=record();
    const projected=projectApplication(source,{proposal_id:"project",status:"pending",changes:{"need.preferred_product":"investment_loan","need.purpose":"investment","need.project_cost":"2000000.00"}});
    expect(projected.application.need.requested_amount).toBe("2000000.00");
    expect(projected.application.need.own_funds).toBeUndefined();
    expect(source.application.need.requested_amount).toBeNull();
  });
  it("updates the live view without mutating the stored application or bank facts", () => {
    const source = record();
    const proposal = {
      proposal_id: "p",
      status: "pending",
      changes: {
        "need.requested_amount": "450000.00",
        "product_details.overdraft": {
          transactions: [
            { transaction_id: "expense", amount: "450000.00", date: null },
          ],
        },
      },
    };
    const projected = projectApplication(source, proposal);
    expect(projected.application.need.requested_amount).toBe("450000.00");
    expect(source.application.need.requested_amount).toBeNull();
    expect(projected.application.financials.cash_balance).toBe("300000.00");
    expect(source.application.product_details).toEqual({});
    (
      projected.application.product_details!.overdraft as {
        transactions: unknown[];
      }
    ).transactions.length = 0;
    expect(
      proposal.changes["product_details.overdraft"].transactions,
    ).toHaveLength(1);
  });
  it("uses only the current pending proposal and ignores applied or superseded answers", () => {
    const source = record();
    const chat = chatViewSchema.parse({
      chat: {
        chat_id: "chat",
        application_id: "manual",
        chat_version: 3,
        messages: [
          {
            message_id: "1",
            role: "assistant",
            text: "old",
            created_at: "now",
            proposal: { proposal_id: "old", status: "superseded", changes: {} },
          },
          {
            message_id: "2",
            role: "assistant",
            text: "new",
            created_at: "now",
            proposal: {
              proposal_id: "new",
              status: "pending",
              changes: { "need.requested_amount": "500000.00" },
            },
          },
        ],
      },
      record: source,
      assistant: { mode: "demo" },
      clarification: null,
    });
    expect(pendingProposal(chat)?.proposal_id).toBe("new");
  });
});
