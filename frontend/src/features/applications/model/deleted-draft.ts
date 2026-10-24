import {readSaved} from "@/shared/lib/saved-draft";

/** Remove this application's saved fields and legacy chat entry, keeping other tasks intact. */
export function forgetDraftStorage(id:string) {
 try {
  const chatId=readSaved<string|null>(`delo-chat:${id}`,null);
  const legacy=readSaved<Record<string,{chat_id?:string}>>("delo-workspace-contexts",{});
  for(const source of ["manual","assistant"]) if(chatId && legacy[source]?.chat_id===chatId) delete legacy[source];
  localStorage.setItem("delo-workspace-contexts",JSON.stringify(legacy));
  const contexts=readSaved<Record<string,string|null>>("delo-react-contexts",{});
  for(const source of ["manual","assistant"]) if(contexts[source]===id) contexts[source]=null;
  localStorage.setItem("delo-react-contexts",JSON.stringify(contexts));
  const prefixes=["delo-chat:","delo-message:","delo-step:","delo-need:","delo-need-page:","delo-need-source:","delo-refinancing:","delo-financials:","delo-followup:","delo-plan:","delo-plan-source:","delo-plan-period-mode:"];
  for(const key of Object.keys(localStorage)) if(prefixes.some(prefix=>key.startsWith(prefix)) && key.split(":").includes(id)) localStorage.removeItem(key);
 } catch { /* Server deletion is authoritative when browser storage is unavailable. */ }
}
