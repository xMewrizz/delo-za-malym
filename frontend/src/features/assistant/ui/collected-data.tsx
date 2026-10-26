import {type ReactNode} from "react";
import {z} from "zod";
import {CashFlowChart,describeIssue,flowDaysSchema,type ApplicationView} from "@/features/applications";
import {productName} from "@/features/applications/model/presentation";
import {formatMoney} from "@/shared/lib/format";
import {Disclosure} from "@/shared/ui/disclosure";
import {useFinancingCapacity} from "@/features/products/model/use-financing-capacity";
import {BusinessCapacity} from "@/features/products/ui/business-capacity";
import type {Proposal,ProposalPreview} from "../api/chat";

const rowsSchema=z.array(z.object({transaction_id:z.string(),amount:z.string().nullable().optional(),date:z.string().nullable().optional(),direction:z.string().nullable().optional()}));

function Fact({field,label,value,changed,hero=false,empty=false}:{field:string;label:string;value:string;changed?:boolean;hero?:boolean;empty?:boolean}) {
  return <div className={`collected-fact ${hero?"collected-fact-hero":""}`} data-live-field={field} data-empty={empty||undefined} data-proposed={changed||undefined}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>;
}

export function CollectedData({view,proposal,preview,loading,questionPending=false,expenseImport}:{view:ApplicationView;proposal?:Proposal;preview?:ProposalPreview;loading:boolean;questionPending?:boolean;expenseImport?:ReactNode}) {
  const need=view.application.need,plan=view.application.product_details?.overdraft;
  const rows=rowsSchema.safeParse(plan&&typeof plan==="object"&&"transactions"in plan?plan.transactions:[]);
  const operations=rows.success?rows.data:[];
  const latest=view.explorations.at(-1);
  const result=preview?.result||(!proposal&&latest?.application_version===view.application.application_version?latest.result:undefined);
  const days=flowDaysSchema.safeParse(result?.daily||result?.calculation?.daily);
  const changed=(...paths:string[])=>Boolean(proposal&&paths.some(path=>Object.hasOwn(proposal.changes,path)));
  const purpose=need.purpose==="investment"?"Оборудование и развитие":need.purpose==="refinancing"?"Объединить кредиты":need.financing_pattern==="cash_gap"?"Заплатить до выручки":need.recurring?"Регулярные закупки":need.purpose==="working_capital"?"Закупка и текущие расходы":"Не выбрана";
  const cash=view.client_data.bank_financials?.cash_balance??view.application.financials.cash_balance;
  const capacity=useFinancingCapacity(JSON.stringify(view.application.financials),need.preferred_product==="investment_loan"?Number(need.principal_grace_months||0):0);
  const selectedProduct=need.preferred_product||(need.financing_pattern==="cash_gap"?"overdraft":need.purpose==="working_capital"?"working_capital_loan":undefined);
  const quote=capacity.data?.products.find(item=>item.product_id===selectedProduct);
  const cashGap=need.financing_pattern==="cash_gap"||need.preferred_product==="overdraft";
  const expenses=operations.filter(row=>row.direction==="outflow");
  const receipts=operations.filter(row=>row.direction==="inflow");
  const sum=(items:typeof operations)=>items.length&&items.every(row=>row.amount!=null&&Number.isFinite(Number(row.amount))) ? (items.reduce((total,row)=>total+Math.round(Number(row.amount)*100),0)/100).toFixed(2) : null;
  const dates=(items:typeof operations)=>{
    const known=items.flatMap(row=>row.date?[row.date]:[]).sort();
    if(known.length!==items.length||!known.length)return null;
    const label=(date:string)=>new Date(date+"T12:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"long"});
    return known[0]===known.at(-1)?label(known[0]):`${label(known[0])} — ${label(known.at(-1)!)}`;
  };
  const expenseAmount=sum(expenses),receiptAmount=sum(receipts),paymentDates=dates(expenses),receiptDates=dates(receipts);
  const amount=cashGap&&expenseAmount!=null?expenseAmount:need.requested_amount;
  const amountLabel=cashGap&&expenseAmount!=null?(expenses.length>1?"Сумма платежей":"Сумма платежа"):need.preferred_product==="revolving_credit_line"||need.preferred_product==="overdraft"?"Лимит":need.preferred_product==="refinancing"?"На рефинансирование":"Сумма кредита";
  return <div className="assistant-live collected-request" aria-busy={loading}>
    <dl className="collected-facts">
      <Fact field="purpose" label="Цель" value={purpose} empty={purpose==="Не выбрана"} changed={changed("need.purpose","need.financing_pattern","need.recurring")}/>
      <Fact field="amount" label={amountLabel} value={amount?formatMoney(amount):"Не указана"} hero={Boolean(amount)} empty={!amount} changed={changed("need.requested_amount","need.project_cost","need.own_funds","product_details.overdraft")}/>
      {cashGap ? <Fact field="payment-date" label={expenses.length>1?"Даты платежей":"Дата платежа"} value={paymentDates||"Уточняем"} empty={!paymentDates} changed={changed("product_details.overdraft")}/> : <Fact field="term" label="Срок" value={need.term_months?`${need.term_months} мес.`:"Подберём подходящий"} empty={!need.term_months} changed={changed("need.term_months")}/>}
      {cashGap&&receipts.length>0&&<>
        <Fact field="receipt-amount" label="Ожидаемые поступления" value={receiptAmount?formatMoney(receiptAmount):"Уточняем"} empty={!receiptAmount} changed={changed("product_details.overdraft")}/>
        <Fact field="receipt-date" label="Дата поступления" value={receiptDates||"Уточняем"} empty={!receiptDates} changed={changed("product_details.overdraft")}/>
      </>}
      {cashGap&&expenseAmount&&need.requested_amount&&Number(expenseAmount)!==Number(need.requested_amount)&&<Fact field="requested-limit" label="Запрошенный лимит" value={formatMoney(need.requested_amount)} changed={changed("need.requested_amount")}/>}
      {need.preferred_product&&<Fact field="product" label="Продукт" value={productName(need.preferred_product)} changed={changed("need.preferred_product")}/>}
      {need.preferred_product==="investment_loan"&&<>
        <Fact field="project-cost" label="Стоимость проекта" value={need.project_cost?formatMoney(need.project_cost):"Уточняем"} changed={changed("need.project_cost")}/>
        <Fact field="own-funds" label="Свои средства" value={formatMoney(need.own_funds||"0")} changed={changed("need.own_funds")}/>
        {Boolean(need.principal_grace_months)&&<Fact field="grace" label="Отсрочка долга" value={`${need.principal_grace_months} мес. · проценты ежемесячно`} changed={changed("need.principal_grace_months")}/>}
      </>}
    </dl>
    <section className="collected-bank-summary" aria-label="Деньги и доступный лимит">
      <div className="collected-bank-context"><span>На расчётном счёте</span><strong>{cash==null?"Нет данных":formatMoney(cash)}</strong></div>
      {selectedProduct&&<BusinessCapacity capacity={quote} loading={capacity.loading} failed={capacity.failed} term={need.term_months||undefined} compact/>}
    </section>
    {result?.calculation&&<section className="collected-plan-summary" aria-label="Результат прогноза"><h3>По вашему плану</h3>{result.calculation.required_limit==="0.00"?<p>Указанные расходы покрываются своими деньгами. Дополнительное финансирование пока не требуется.</p>:<dl><Fact field="required-limit" label="Нехватка денег" value={formatMoney(result.calculation.required_limit)}/><Fact field="interest" label="Проценты по плану" value={formatMoney(result.calculation.total_interest)}/></dl>}{days.success&&<Disclosure title="Как меняется остаток по дням" className="collected-preview"><CashFlowChart days={days.data}/></Disclosure>}</section>}
    {expenseImport}
    {proposal?.conflicts?.length?<p role="alert" className="collected-conflict">Данные заявки изменились. Обновите диалог и проверьте значения.</p>:null}
    {!questionPending&&(preview?.issues||proposal?.plan_issues||[]).map((issue,index)=><p className="collected-plan-issue" key={index}>{describeIssue(issue)}</p>)}
  </div>;
}
