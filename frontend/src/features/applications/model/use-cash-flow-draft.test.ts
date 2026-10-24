import { describe,it,expect } from "vitest";
import { mergeCashFlowDraft } from "./use-cash-flow-draft";
import type { PlanDraft } from "./overdraft-plan";
const base:PlanDraft={start:"2026-10-23",end:"2026-10-30",openingCash:"300000.00",reserve:"0",debtConfirmed:false,automaticPeriod:true,rows:[]};
describe("cash flow edits across invoice updates",()=>{
  it("retains unsaved payments when an uploaded file changes only the application version",()=>{
    const edited={...base,reserve:"10000",rows:[{id:"manual",direction:"outflow" as const,date:"2026-10-25",amount:"450000",loanId:""}]};
    expect(mergeCashFlowDraft({...base,openingCash:"400000.00"},{base,draft:edited})).toEqual({...edited,openingCash:"400000.00"});
  });
  it("accepts the confirmed invoice amount but preserves a separately edited payment date",()=>{
    const before={...base,rows:[{id:"invoice",direction:"outflow" as const,date:"2026-10-25",amount:"450000",loanId:""}]};
    const edited={...before,rows:[{...before.rows[0],date:"2026-10-28"}]};
    expect(mergeCashFlowDraft({...before,rows:[{...before.rows[0],amount:"460000"}]},{base:before,draft:edited}).rows).toEqual([{...edited.rows[0],amount:"460000"}]);
  });
});
