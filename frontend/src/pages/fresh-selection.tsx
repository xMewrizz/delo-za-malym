import {useRef, useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {FileUp} from "lucide-react";
import {createApplication, exploreApplication, patchApplication, type ApplicationView, type Profile} from "@/features/applications";
import {NeedForm} from "@/features/applications/ui/need-form";
import {getErrorMessage} from "@/shared/api/client";
import {Button} from "@/shared/ui/button";
import {Card, CardContent} from "@/shared/ui/card";

/** Keep an untouched entry local; create a server draft only when the visitor saves it. */
export function FreshSelectionForm({profile, onReady, onImport}:{profile?:Profile;onReady:(view:ApplicationView)=>void;onImport:()=>void}) {
  const [entryId]=useState(()=>`new-selection-${crypto.randomUUID()}`);
  const created=useRef<ApplicationView|null>(null);
  const view:ApplicationView={application:{application_id:entryId,application_version:1,need:{},financials:profile?.financials||{}},client_data:{company_name:profile?.company_name,bank_financials:profile?.financials},state:{status:"draft",application_version:1,next_action:{type:"edit",label:"Заполнить задачу"}},result:null,recommendation:null,readiness:null,completion:null,explorations:[],events:[]};
  const save=useMutation({
    mutationFn:async(changes:Record<string,unknown>)=>{
      const draft=created.current||await createApplication();
      created.current=draft;
      const saved=await patchApplication(draft.application.application_id,draft.application.application_version,changes);
      created.current=saved;
      const need=saved.application.need;
      const product=need.preferred_product;
      const productId=product==="investment_loan"||product==="revolving_credit_line"||product==="refinancing"||product==="overdraft" ? product : need.financing_pattern==="cash_gap" ? "overdraft" : "working_capital_loan";
      const preferences=need.minimum_acceptable_amount&&need.requested_amount&&Number(need.minimum_acceptable_amount)<Number(need.requested_amount)?{preserve_amount:false}:{};
      const result=await exploreApplication(saved.application.application_id,saved.application.application_version,productId,preferences);
      try {localStorage.setItem(`delo-step:${result.application.application_id}`,JSON.stringify("options"));} catch {/* Optional persistence. */}
      return result;
    },
    onSuccess:onReady,
  });
  return <Card data-fresh-selection><CardContent>
    <NeedForm view={view} continueToNextStep busy={save.isPending} onSave={changes=>save.mutate(changes)} expenseImport={<Button type="button" variant="ghost" onClick={onImport}><FileUp size={16}/>Заполнить из счёта PDF</Button>}/>
    {save.error&&<p role="alert" className="mt-4 text-sm text-destructive">{getErrorMessage(save.error)}</p>}
  </CardContent></Card>;
}
