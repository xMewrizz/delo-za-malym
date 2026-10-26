import {useId,useState,type FormEvent,type ReactNode} from "react";
import {z} from "zod";
import {ArrowDownLeft,ArrowUpRight,Landmark,Pencil} from "lucide-react";
import {CashFlowChart,describeIssue,flowDaysSchema,normalizeMoneyInput,type ApplicationView} from "@/features/applications";
import {productName} from "@/features/applications/model/presentation";
import {formatMoney} from "@/shared/lib/format";
import {Button} from "@/shared/ui/button";
import {Input} from "@/shared/ui/input";
import {Disclosure} from "@/shared/ui/disclosure";
import {useFinancingCapacity} from "@/features/products/model/use-financing-capacity";
import {BusinessCapacity} from "@/features/products/ui/business-capacity";
import type {Proposal,ProposalPreview} from "../api/chat";

const rowsSchema=z.array(z.object({transaction_id:z.string(),amount:z.string().nullable().optional(),date:z.string().nullable().optional(),direction:z.string().nullable().optional()}));

function Correction({label,initial,type="text",disabled,onSave}:{label:string;initial:string;type?:string;disabled:boolean;onSave:(value:string)=>void}) {
  const [open,setOpen]=useState(false),[value,setValue]=useState(initial),[error,setError]=useState("");
  const id=useId();
  function submit(event:FormEvent){event.preventDefault();try{onSave(type==="date"?value:normalizeMoneyInput(value)||"");setError("");setOpen(false);}catch(cause){setError(cause instanceof Error?cause.message:"Проверьте значение.");}}
  return <div className="collected-correction"><Button type="button" variant="ghost" size="sm" aria-label={`Изменить: ${label}`} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><Pencil size={13} aria-hidden="true"/>Изменить</Button>{open&&<form id={id} onSubmit={submit}><label htmlFor={`${id}-input`}>{label}</label><Input id={`${id}-input`} type={type} value={value} onChange={event=>setValue(event.target.value)} disabled={disabled}/><Button type="submit" variant="outline" size="sm" disabled={disabled||!value}>Сохранить</Button>{error&&<p role="alert">{error}</p>}</form>}</div>;
}

function Fact({field,label,value,changed,children,hero=false}:{field:string;label:string;value:string;changed?:boolean;children?:ReactNode;hero?:boolean}) {
  return <div className={`collected-fact ${hero?"collected-fact-hero":""}`} data-live-field={field} data-proposed={changed||undefined}>
    <dt>{label}</dt>
    <dd>{value}</dd>{children}
  </div>;
}

export function CollectedData({view,proposal,preview,busy,loading,onEdit,expenseImport,nextQuestion}:{view:ApplicationView;proposal?:Proposal;preview?:ProposalPreview;busy:boolean;loading:boolean;onEdit:(changes:Record<string,unknown>,plan?:Record<string,unknown>)=>void;expenseImport?:ReactNode;nextQuestion?:string}) {
  const need=view.application.need,plan=view.application.product_details?.overdraft;
  const rows=rowsSchema.safeParse(plan&&typeof plan==="object"&&"transactions"in plan?plan.transactions:[]);
  const operations=rows.success?rows.data:[];
  const latest=view.explorations.at(-1);
  const result=preview?.result||(!proposal&&latest?.application_version===view.application.application_version?latest.result:undefined);
  const days=flowDaysSchema.safeParse(result?.daily||result?.calculation?.daily);
  const changed=(...paths:string[])=>Boolean(proposal&&paths.some(path=>Object.hasOwn(proposal.changes,path)));
  const purpose=need.purpose==="investment"?"Оборудование и развитие":need.purpose==="refinancing"?"Объединить кредиты":need.financing_pattern==="cash_gap"?"Заплатить до выручки":need.recurring?"Регулярные закупки":need.purpose==="working_capital"?"Закупка и текущие расходы":"Расскажите, на что нужны деньги";
  const cash=view.client_data.bank_financials?.cash_balance??view.application.financials.cash_balance;
  const capacity=useFinancingCapacity(JSON.stringify(view.application.financials),need.preferred_product==="investment_loan"?Number(need.principal_grace_months||0):0);
  const selectedProduct=need.preferred_product||(need.financing_pattern==="cash_gap"?"overdraft":need.purpose==="working_capital"?"working_capital_loan":undefined);
  const quote=capacity.data?.products.find(item=>item.product_id===selectedProduct);
  const amounts=operations.filter(row=>row.amount);
  const total=(direction:string)=>amounts.filter(row=>row.direction===direction).reduce((sum,row)=>sum+Number(row.amount),0);
  return <div className="assistant-live collected-request" aria-busy={loading}>
    <dl className="collected-facts">
      <Fact field="purpose" label="Задача" value={purpose} changed={changed("need.purpose","need.financing_pattern","need.recurring")}/>
      <Fact field="amount" label={need.preferred_product==="revolving_credit_line"?"Нужный лимит":need.preferred_product==="refinancing"?"На погашение кредитов":"Нужно на задачу"} value={need.requested_amount?formatMoney(need.requested_amount):"Пока не указана"} hero changed={changed("need.requested_amount","need.project_cost","need.own_funds")}/>
      <Fact field="term" label="Срок" value={need.term_months?`${need.term_months} мес.`:"Подберём подходящий"} changed={changed("need.term_months")}/>
      <Fact field="product" label="Продукт" value={need.preferred_product?productName(need.preferred_product):"Определим по задаче"} changed={changed("need.preferred_product")}/>
      {need.preferred_product==="investment_loan"&&<>
        <Fact field="project-cost" label="Стоимость проекта" value={need.project_cost?formatMoney(need.project_cost):"Уточняем"} changed={changed("need.project_cost")}>{proposal&&<Correction label="Стоимость проекта" initial={need.project_cost||""} disabled={busy} onSave={value=>onEdit({"need.project_cost":value})}/>}</Fact>
        <Fact field="own-funds" label="Свои средства" value={formatMoney(need.own_funds||"0")} changed={changed("need.own_funds")}>{proposal&&<Correction label="Свои средства" initial={need.own_funds||"0"} disabled={busy} onSave={value=>onEdit({"need.own_funds":value})}/>}</Fact>
        {Boolean(need.principal_grace_months)&&<Fact field="grace" label="Отсрочка долга" value={`${need.principal_grace_months} мес. · проценты ежемесячно`} changed={changed("need.principal_grace_months")}/>}
      </>}
    </dl>
    <div className="collected-bank-context"><Landmark size={18} aria-hidden="true"/><span>На расчётном счёте<small>Данные банка</small></span><strong>{cash==null?"Нет данных":formatMoney(cash)}</strong></div>
    {selectedProduct&&<BusinessCapacity capacity={quote} loading={capacity.loading} failed={capacity.failed} term={need.term_months||undefined} compact/>}
    {nextQuestion&&<div className="collected-next-question"><span>ЕЩЁ УТОЧНЯЕМ</span><p>{nextQuestion}</p></div>}
    {operations.length>0&&<section className="collected-operations" aria-label="Поступления и расходы"><header><h3>Деньги по датам</h3><span>{operations.length} {operations.length===1?"операция":"операций"}</span></header><div className="collected-operation-totals"><span>Поступит <b>+{formatMoney(String(total("inflow")))}</b></span><span>Нужно заплатить <b>−{formatMoney(String(total("outflow")))}</b></span></div><ol>{operations.map(row=><li key={row.transaction_id} className="collected-operation" data-live-field={`operation:${row.transaction_id}`} data-live-value={`${row.amount}:${row.date}:${row.direction}`}>
      <span className="collected-operation-direction" data-direction={row.direction}>{row.direction==="inflow"?<ArrowDownLeft size={17}/>:<ArrowUpRight size={17}/>}</span><div><strong>{row.direction==="inflow"?"Поступление":"Предстоящий расход"}</strong><time dateTime={row.date||undefined}>{row.date?new Date(row.date+"T12:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"long"}):"Дата пока не указана"}</time></div><b>{row.amount?`${row.direction==="inflow"?"+":"−"}${formatMoney(row.amount)}`:"Уточняем сумму"}</b>
      {proposal&&<div className="collected-operation-edit"><Correction key={`amount-${row.amount}`} label="Сумма платежа" initial={row.amount||""} disabled={busy} onSave={value=>onEdit({},{transactions:[{transaction_id:row.transaction_id,amount:value}]})}/><Correction key={`date-${row.date}`} label="Дата платежа" initial={row.date||""} type="date" disabled={busy} onSave={value=>onEdit({},{transactions:[{transaction_id:row.transaction_id,date:value}]})}/></div>}
    </li>)}</ol></section>}
    {result?.calculation&&<section className="collected-plan-summary" aria-label="Результат прогноза"><h3>По вашему плану</h3>{result.calculation.required_limit==="0.00"?<p>Указанные расходы покрываются своими деньгами. Дополнительное финансирование пока не требуется.</p>:<dl><Fact field="required-limit" label="Нехватка денег" value={formatMoney(result.calculation.required_limit)}/><Fact field="interest" label="Проценты по плану" value={formatMoney(result.calculation.total_interest)}/></dl>}{days.success&&<Disclosure title="Как меняется остаток по дням" className="collected-preview"><CashFlowChart days={days.data}/></Disclosure>}</section>}
    {expenseImport}
    {proposal?.conflicts?.length?<p role="alert" className="collected-conflict">Данные заявки изменились. Обновите диалог и проверьте значения.</p>:null}
    {(preview?.issues||proposal?.plan_issues||[]).map((issue,index)=><p className="collected-plan-issue" key={index}>{describeIssue(issue)}</p>)}
  </div>;
}
