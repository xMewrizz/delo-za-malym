// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ExplorationPanel } from "./exploration-panel";
import type { ApplicationView } from "../api/applications";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const options = [12,18,24,36].map(term=>({option_id:`option-${term}`,offer_id:`offer-${term}`,product_id:"working_capital_loan",term_months:term,amount:"500000.00",monthly_payment:String(500000/term),total_repayment:"600000.00",total_interest:"100000.00"}));
const fixture = {application:{application_id:"one",application_version:1,need:{purpose:"working_capital",preferred_product:"working_capital_loan",requested_amount:"500000.00"},financials:{existing_loans:[]}},explorations:[{exploration_id:"explore-one",application_version:1,product_id:"working_capital_loan",result:{status:"options_ready",options}}]} as unknown as ApplicationView;
describe("offer comparison",()=>{
  it("offers one actionable recovery when the bank needs a smaller-amount decision", async () => {
    const host = document.createElement("div"), root = createRoot(host), client = new QueryClient();
    const edit = vi.fn();
    const view = {...fixture, explorations:[{...fixture.explorations[0], result:{status:"needs_information",options:[],reasons:[{code:"reduced_amount_requires_confirmation",message:"Нужно подтвердить достаточность меньшей суммы."}],required_information:[{code:"minimum_acceptable_amount_required",field:"need.minimum_acceptable_amount",message:"Какая минимальная сумма кредита решит вашу задачу с учётом собственных средств?"}]}}]};
    try {
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><ExplorationPanel view={view} busy={false} onExplore={vi.fn()} onApply={vi.fn()} onEditNeed={edit} compact /></QueryClientProvider></MemoryRouter>));
      expect(host.querySelectorAll(".exploration-empty-state")).toHaveLength(1);
      expect(host.textContent).toContain("Подойдёт ли сумма меньше?");
      expect(host.textContent).not.toContain("Статус расчёта");
      expect(host.textContent).not.toContain("Нужно подтвердить достаточность");
      expect(host.querySelector(".exploration-context,.exploration-settings")).toBeNull();
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Уточнить сумму")!.click());
      expect(edit).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); client.clear(); }
  });
  it("preserves permission for a lower amount when recalculating a stale request", async () => {
    const host = document.createElement("div"), root = createRoot(host), client = new QueryClient();
    const explore = vi.fn();
    const view = {...fixture,application:{...fixture.application,application_version:2,need:{...fixture.application.need,minimum_acceptable_amount:"300000.00"}}};
    try {
      // The comparison panel stays mounted while the saved need changes.
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><ExplorationPanel view={fixture} busy={false} onExplore={explore} onApply={vi.fn()} compact /></QueryClientProvider></MemoryRouter>));
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><ExplorationPanel view={view} busy={false} onExplore={explore} onApply={vi.fn()} compact /></QueryClientProvider></MemoryRouter>));
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Пересчитать условия")!.click());
      expect(explore).toHaveBeenCalledWith("working_capital_loan", {preserve_amount:false});
    } finally { await act(async () => root.unmount()); client.clear(); }
  });
  it("limits side-by-side comparison to three, resets selectable choices on new conditions, and collapses stale options",async()=>{
    const host=document.createElement("div"); document.body.append(host); const root=createRoot(host);const client=new QueryClient();const refresh=vi.fn();
    const render=(view:ApplicationView)=>act(async()=>root.render(<MemoryRouter><QueryClientProvider client={client}><ExplorationPanel view={view} busy={false} onExplore={refresh} onApply={vi.fn()} compact/></QueryClientProvider></MemoryRouter>));
    try {
      await render(fixture);
      const checks=[...host.querySelectorAll<HTMLInputElement>(".offer-compare-choice input")];
      for(const check of checks.slice(0,3)) await act(async()=>check.click());
      expect(checks[3].disabled).toBe(true);
      expect(host.querySelectorAll(".offer-compare-tray thead th")).toHaveLength(4);
      const updated={...fixture,explorations:[{...fixture.explorations[0],result:{status:"options_ready",options:options.map(option=>({...option,option_id:option.option_id+"-new"}))}}]};
      await render(updated);
      expect([...host.querySelectorAll<HTMLInputElement>(".offer-compare-choice input")].every(item=>!item.disabled)).toBe(true);
      expect(host.querySelector(".offer-compare-tray")).toBeNull();
      await render({...fixture,application:{...fixture.application,application_version:2}});
      const old=host.querySelector<HTMLDetailsElement>(".exploration-context")!;
      expect(old.open).toBe(false);
      expect(host.querySelector(".offer-select-action")).toBeNull();
      const recalc=[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent==="Пересчитать условия")!;
      await act(async()=>recalc.click());expect(refresh).toHaveBeenCalledExactlyOnceWith("working_capital_loan",{});
    } finally {await act(async()=>root.unmount());client.clear();host.remove();}
  });
});
