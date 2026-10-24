import {useId} from "react";
import {ArrowRight,FilePenLine,Plus} from "lucide-react";
import type {ApplicationView} from "@/features/applications";
import {draftFromApplication,mergeNeedDraft} from "@/features/applications/model/need";
import {inferNeedTask,needTasks} from "@/features/applications/model/need-scenario";
import {productName} from "@/features/applications/model/presentation";
import {readSaved} from "@/shared/lib/saved-draft";
import {formatMoney} from "@/shared/lib/format";
import {Button} from "@/shared/ui/button";
import "./selection-entry.css";

export function SavedSelectionEntry({view,busy,onContinue,onNew}:{view:ApplicationView;busy:boolean;onContinue:()=>void;onNew:()=>void}) {
  const heading=useId(),draft=view.state.status==="draft";
  const base=draftFromApplication(view);
  const previous=mergeNeedDraft(base,readSaved(`delo-need-source:${view.application.application_id}`,null));
  const fields=draft ? mergeNeedDraft(previous,{base:previous,draft:readSaved(`delo-need:${view.application.application_id}:${view.application.application_version}`,previous)}) : base;
  const task=needTasks.find(item=>item.id===inferNeedTask(fields));
  const amount=fields.requestedAmount.trim().replaceAll(" ","").replace(",",".");
  const amountKnown=/^\d+(\.\d{1,2})?$/.test(amount)&&Number(amount)>0;
  const finished=Boolean(view.completion)||["cancelled","declined","out_of_policy"].includes(view.state.status);
  return <section className="saved-selection-entry" aria-labelledby={heading}>
    <span className="saved-selection-icon" aria-hidden="true"><FilePenLine size={23}/></span>
    <div className="saved-selection-copy"><p className="saved-selection-kicker">{draft ? "СОХРАНЁННЫЙ ЧЕРНОВИК" : "ПРЕДЫДУЩАЯ ЗАЯВКА"}</p>
      <h2 id={heading}>{draft ? "Продолжить начатый подбор?" : finished ? "Предыдущая заявка завершена" : "У вас есть заявка в работе"}</h2>
      <p>{draft ? "Вы уже начали подбирать финансирование. Продолжите с сохранённого шага или начните с новой задачи." : "Можно открыть её условия и историю или подобрать финансирование для новой задачи."}</p>
    </div>
    <dl className="saved-selection-facts">
      <div><dt>{fields.preferredProduct ? "Продукт" : "Задача"}</dt><dd>{fields.preferredProduct ? productName(fields.preferredProduct) : task?.label || "Ещё не выбрана"}</dd></div>
      <div><dt>Сумма</dt><dd>{amountKnown ? formatMoney(amount) : "Ещё не указана"}</dd></div>
      <div><dt>Срок</dt><dd>{/^[1-9]\d*$/.test(fields.termMonths) ? `${fields.termMonths} мес.` : "Ещё не указан"}</dd></div>
    </dl>
    <div className="saved-selection-actions">
      <Button disabled={busy} onClick={draft ? onContinue : onNew}>{draft ? "Продолжить подбор" : "Начать новый подбор"}<ArrowRight size={17}/></Button>
      <Button disabled={busy} variant="outline" onClick={draft ? onNew : onContinue}>{draft ? <Plus size={16}/> : null}{draft ? "Начать новый подбор" : "Открыть заявку"}</Button>
    </div>
    <p className="saved-selection-note">{draft ? "Черновик останется" : "Предыдущая заявка останется"} в разделе «Заявки».</p>
  </section>;
}
