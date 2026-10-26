import {Landmark,Info} from "lucide-react";
import {formatMoney} from "@/shared/lib/format";
import type {ProductCapacity} from "../api/financing-capacity";
import "./business-capacity.css";

export function BusinessCapacity({capacity,loading,failed,term,compact=false}:{capacity?:ProductCapacity;loading:boolean;failed:boolean;term?:number;compact?:boolean}) {
  if(!loading&&!failed&&!capacity)return null;
  const selected=term ? capacity?.terms.find(item=>item.term_months===term) : undefined;
  const best=capacity?.terms.reduce((a,b)=>Number(a.maximum_amount)>Number(b.maximum_amount)?a:b,capacity.terms[0]);
  const amount=selected?.maximum_amount||capacity?.maximum_amount;
  const selection=capacity?.status==="selection_required";
  const unavailable=capacity?.status==="unavailable";
  const overdraft=capacity?.status==="plan_required";
  return <aside className={`business-capacity ${compact?"business-capacity-compact":""}`} aria-label="Доступно вашему бизнесу" aria-busy={loading}>
    <div className="business-capacity-label"><Landmark size={17} aria-hidden="true"/><span>Предварительная оценка</span></div>
    {loading ? <p role="status">Считаем по данным банка…</p> : failed ? <p>Не удалось получить лимит. Проверим его при расчёте предложения.</p> : selection ? <p>Отметьте кредиты для замены. Сумму и доступный платёж рассчитаем с учётом погашаемых долгов.</p> : unavailable ? <><strong>Пока нет доступного лимита</strong><p>{capacity?.reasons[0]?.message||"Нужно проверить сведения о бизнесе и действующие обязательства."}</p></> : <>
      <div className="business-capacity-amount"><strong>до {formatMoney(String(Math.floor(Number(amount||0))))}</strong><span>{overdraft ? "верхняя граница лимита" : selected ? `на ${selected.term_months} мес.` : best ? `при сроке ${best.term_months} мес.` : ""}</span></div>
      <p>{overdraft ? "Нужную часть лимита определим по расходам, остатку счёта и датам поступлений." : capacity?.product_id==="revolving_credit_line" ? "Учтены доходы, расходы и нагрузка по действующим продуктам. Проценты — на использованную часть." : "Учтены доходы, расходы и действующие кредиты. На меньший срок доступная сумма может быть ниже."}</p>
      <p className="business-capacity-final-note">Итоговая сумма — после проверки заявки.</p>
      {!compact&&capacity?.available_monthly_payment&&<div className="business-capacity-payment"><Info size={14} aria-hidden="true"/><span>{capacity.product_id==="revolving_credit_line"||overdraft ? "Резерв нагрузки" : "Доступно на новый платёж"}: <b>{formatMoney(capacity.available_monthly_payment)}/мес.</b></span></div>}
    </>}
  </aside>;
}
