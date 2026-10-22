import { z } from "zod";
import { apiRequest } from "@/shared/api/client";

const money = z.string();
export const flowDaysSchema = z.array(
  z.object({
    date: z.string(),
    closing_cash: money,
    cash_without_financing: money.optional(),
  }),
);
const reason = z
  .object({ code: z.string().optional(), message: z.string() })
  .passthrough();
export const offerSchema = z
  .object({
    offer_id: z.string(),
    product_id: z.string(),
    amount: money,
    term_months: z.number().nullable().optional(),
    annual_rate_percent: money.optional(),
    monthly_payment: money.nullable().optional(),
    total_repayment: money.nullable().optional(),
    fees_total: money.nullable().optional(),
    valid_until: z.string().optional(),
    option_id: z.string().optional(),
    conditions: z.array(z.unknown()).optional(),
    schedule: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

const need = z
  .object({
    purpose: z.string().nullable().optional(),
    preferred_product: z.string().nullable().optional(),
    requested_amount: money.nullable().optional(),
    term_months: z.number().nullable().optional(),
    financing_pattern: z.string().nullable().optional(),
    minimum_acceptable_amount: money.nullable().optional(),
    own_funds: money.nullable().optional(),
    project_cost: money.nullable().optional(),
    principal_grace_months: z.number().int().nullable().optional(),
    needed_by: z.string().nullable().optional(),
    recurring: z.boolean().nullable().optional(),
    priority: z.string().nullable().optional(),
  })
  .passthrough();

const financials = z
  .object({
    cash_balance: money.nullable().optional(),
    monthly: z
      .array(
        z
          .object({
            month: z.string(),
            operating_inflow: money.nullable().optional(),
            operating_outflow: money.nullable().optional(),
            taxes: money.nullable().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
    existing_loans: z
      .array(
        z
          .object({
            loan_id: z.string(),
            application_id: z.string().optional(),
            maturity_date: z.string().optional(),
            schedule: z.array(z.object({ date: z.string(), total_payment: money }).passthrough()).optional(),
            monthly_payment: money.nullable().optional(),
            outstanding_principal: money.nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const state = z
  .object({
    status: z.string(),
    application_version: z.number().int(),
    selected_offer_id: z.string().nullable().optional(),
    next_action: z
      .object({ type: z.string(), label: z.string() })
      .passthrough(),
    updated_at: z.string().optional(),
  })
  .passthrough();

const application = z
  .object({
    application_id: z.string(),
    application_version: z.number().int(),
    need,
    financials,
    product_details: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const assessment = z
  .object({
    assessment_id: z.string(),
    stage: z.string(),
    outcome: z.string(),
    offers: z.array(offerSchema),
    reasons: z.array(reason).optional(),
    required_information: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const applicationViewSchema = z
  .object({
    application,
    client_data: z
      .object({
        company_name: z.string().optional(),
        bank_financials: financials.optional(),
        credit_history: z
          .object({
            status: z.string(),
            category: z.string().nullable().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    state,
    result: z
      .object({
        status: z.string(),
        assessment: assessment.nullable().optional(),
        issues: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .nullable(),
    recommendation: z
      .object({
        status: z.string(),
        recommended_product_id: z.string().nullable().optional(),
        reasons: z.array(reason).optional(),
        required_information: z.array(z.unknown()).optional(),
        candidates: z
          .array(
            z
              .object({
                product_id: z.string(),
                eligibility: z.string().optional(),
                reasons: z.array(reason).optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .nullable(),
    readiness: z
      .object({
        status: z.string(),
        pending_conditions: z.array(z.unknown()).optional(),
        issues: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .nullable(),
    completion: z
      .object({
        type: z.string(),
        amount: money.optional(),
        mode: z.string().optional(),
        schedule: z.array(z.record(z.string(), z.unknown())).optional(),
      })
      .passthrough()
      .nullable(),
    explorations: z.array(
      z
        .object({
          exploration_id: z.string(),
          application_version: z.number().int(),
          valid_until: z.string(),
          product_id: z.string(),
          result: z
            .object({
              status: z.string(),
              options: z.array(offerSchema).optional(),
              reasons: z.array(reason).optional(),
              required_information: z.array(z.unknown()).optional(),
              calculation: z
                .object({
                  required_limit: money,
                  total_drawn: money,
                  total_interest: money,
                  fully_repaid: z.boolean(),
                  feasible: z.boolean(),
                  daily: z.array(
                    z
                      .object({
                        date: z.string(),
                        inflow: money,
                        outflow: money,
                        drawn: money,
                        principal_repaid: money,
                        interest_accrued: money,
                        closing_principal: money,
                      })
                      .passthrough(),
                  ),
                })
                .passthrough()
                .nullable()
                .optional(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
    events: z.array(
      z
        .object({
          event_id: z.string(),
          type: z.string(),
          created_at: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const applicationListSchema = z.array(
  z
    .object({
      application_id: z.string(),
      need,
      state,
      completion: z.record(z.string(), z.unknown()).nullable().optional(),
      ready_for_application: z.boolean().optional(),
    })
    .passthrough(),
);

export const profileSchema = z
  .object({
    company_name: z.string(),
    business: z
      .object({
        inn: z.string(),
        activity: z.string(),
        registered_at: z.string(),
      })
      .passthrough(),
    financials,
  })
  .passthrough();

export const scenariosSchema = z.array(
  z.object({
    product_id: z.string(),
    scenario_id: z.string(),
    title: z.string(),
    description: z.string(),
  }),
);

export type ApplicationView = z.infer<typeof applicationViewSchema>;
export type ApplicationSummary = z.infer<typeof applicationListSchema>[number];
export type Offer = z.infer<typeof offerSchema>;
export type Profile = z.infer<typeof profileSchema>;

const path = (id: string, suffix = ""): `/${string}` =>
  `/applications/${encodeURIComponent(id)}${suffix}`;
const post = (url: `/${string}`, body: Record<string, unknown>) =>
  apiRequest(url, applicationViewSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getProfile = (signal?: AbortSignal) =>
  apiRequest("/profile", profileSchema, { signal });
export const listApplications = (signal?: AbortSignal) =>
  apiRequest("/applications", applicationListSchema, { signal });
export const getApplication = (id: string, signal?: AbortSignal) =>
  apiRequest(path(id), applicationViewSchema, { signal });
export const listScenarios = (signal?: AbortSignal) =>
  apiRequest("/demo/scenarios", scenariosSchema, { signal });
export const createApplication = () => post("/applications", {});
export const createScenario = (productId: string, scenarioId: string) =>
  post(
    `/demo/scenarios/${encodeURIComponent(productId)}/${encodeURIComponent(scenarioId)}`,
    {},
  );
export const patchApplication = (
  id: string,
  version: number,
  changes: Record<string, unknown>,
) =>
  apiRequest(path(id), applicationViewSchema, {
    method: "PATCH",
    body: JSON.stringify({ base_application_version: version, changes }),
  });
export const versionAction = (
  id: string,
  version: number,
  action: "preview" | "recommendations" | "retry" | "submit" | "cancel",
) =>
  post(path(id, "/" + action), {
    base_application_version: version,
    ...(action === "submit" || action === "cancel" ? { confirmed: true } : {}),
  });
export const exploreApplication = (
  id: string,
  version: number,
  productId: "working_capital_loan" | "overdraft" | "refinancing" | "revolving_credit_line" | "investment_loan",
  preferences: Record<string, unknown> = {},
  delay?: { transaction_id: string; days: number },
) =>
  post(path(id, "/explorations"), {
    base_application_version: version,
    product_id: productId,
    ...(productId === "working_capital_loan" ? { preferences } : {}),
    ...(delay ? { delay } : {}),
  });
export const applyExploration = (
  id: string,
  version: number,
  explorationId: string,
  optionId: string,
) =>
  post(
    path(id, "/explorations/" + encodeURIComponent(explorationId) + "/apply"),
    { base_application_version: version, option_id: optionId, confirmed: true },
  );
export const selectOffer = (
  id: string,
  version: number,
  assessmentId: string,
  offerId: string,
) =>
  post(path(id, "/select-offer"), {
    base_application_version: version,
    assessment_id: assessmentId,
    offer_id: offerId,
  });
export const completeCondition = (
  id: string,
  version: number,
  code: string,
  offerId: string,
) =>
  post(path(id, "/conditions/" + encodeURIComponent(code) + "/complete"), {
    base_application_version: version,
    offer_id: offerId,
    confirmed: true,
  });
export const signOffer = (id: string, version: number, offerId: string) =>
  post(path(id, "/sign"), {
    base_application_version: version,
    offer_id: offerId,
    confirmed: true,
  });
