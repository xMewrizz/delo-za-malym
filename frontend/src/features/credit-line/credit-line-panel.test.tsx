// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { CreditLinePanel } from "./credit-line-panel";
import { getLine, postLineOperation } from "./api";
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getLine: vi.fn(), postLineOperation: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const state: Awaited<ReturnType<typeof getLine>> = { application_id: "line-one", limit: "500000.00", principal: "70000.00", accrued_interest: "0.00", amount_to_close: "70000.00", available_limit: "430000.00", capacity_reserve: "50000.00", annual_rate_percent: "24.00", maturity_date: "2027-10-23", version: 2, status: "active", matured: false, overdue_interest: false, interest_due: "0.00", interest_due_date: null, schedule: [], operations: [] };
async function until(test: () => unknown) { for (let i=0;i<80;i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve,10)); }); if(test()) return; } throw new Error("Recovery did not settle"); }
describe("line operation recovery", () => {
  it.each([true,false])("restores a confirmed draw or retries the same unknown request: confirmed=%s", async confirmed => {
    const request_id = crypto.randomUUID();
    const payload = { kind: "draw", amount: "70000.00", base_line_version: 1, request_id };
    const completed = { ...state, operations: [{ operation_id: "draw-one", request_id, kind: "draw", date: "2026-10-23", amount: "70000.00", principal_paid: "0.00", interest_paid: "0.00" }] };
    localStorage.setItem("delo-pending-operation:line:line-one", JSON.stringify(payload));
    vi.mocked(postLineOperation).mockReset();
    vi.mocked(getLine).mockResolvedValue(confirmed ? completed : state);
    vi.mocked(postLineOperation).mockResolvedValue(completed);
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    try {
      await act(async()=>root.render(<MemoryRouter><QueryClientProvider client={client}><CreditLinePanel applicationId="line-one"/></QueryClientProvider></MemoryRouter>));
      if(!confirmed) {
        await until(()=>[...host.querySelectorAll<HTMLButtonElement>("button")].some(item=>item.textContent==="Повторить тот же запрос" && !item.disabled));
        expect(host.querySelector("input")).toBeNull();
        await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent==="Повторить тот же запрос")!.click());
      }
      await until(()=>host.querySelector(".operation-result"));
      expect(host.textContent).toContain("Деньги зачислены на счёт");
      if(confirmed) expect(postLineOperation).not.toHaveBeenCalled();
      else expect(postLineOperation).toHaveBeenCalledExactlyOnceWith("line-one",payload);
      expect(localStorage.getItem("delo-pending-operation:line:line-one")).toBeNull();
    } finally {await act(async()=>root.unmount());client.clear();host.remove();localStorage.removeItem("delo-pending-operation:line:line-one");}
  });
});
