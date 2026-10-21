"use strict";

const OverdraftPlan = (() => {
  function build({today, automaticPeriod, start, end, openingCash, reserve, operations, loans, debtPaymentsConfirmed}) {
    if(!operations.length) throw new Error("Добавьте предстоящий расход и ожидаемое поступление.");
    for(const operation of operations) {
      if(!operation.date || !operation.amount || !Number.isFinite(Number(operation.amount)) || Number(operation.amount) <= 0) throw new Error("У каждой операции укажите дату и положительную сумму.");
      if(!["inflow","outflow"].includes(operation.direction)) throw new Error("Выберите поступление или расход.");
    }
    if(automaticPeriod) {start=today;end=operations.reduce((latest,item)=>item.date > latest ? item.date : latest,today);}
    if(!start || !end || start > end) throw new Error("Проверьте начало и конец периода расчёта.");
    if(start < today) throw new Error("План начинается в прошлом. Укажите актуальные даты будущих операций.");
    if(operations.some(item=>item.date < start || item.date > end)) throw new Error("Одна из операций выходит за период. Исправьте дату или расширьте период в настройках.");
    if(openingCash == null || reserve == null) throw new Error("Нужны остаток к началу плана и запас денег.");
    const active=(loans || []).filter(loan=>Number(loan.outstanding_principal)>0);
    if(active.length && !debtPaymentsConfirmed) throw new Error("Проверьте платежи по текущим кредитам и подтвердите, что все они учтены за выбранный период.");
    const ids=new Set(),references=[];
    for(const operation of operations) {
      if(!operation.transaction_id || ids.has(operation.transaction_id)) throw new Error("Операции должны иметь разные идентификаторы. Обновите план.");
      ids.add(operation.transaction_id);
      if(operation.loan_id) {
        if(operation.direction !== "outflow" || !active.some(loan=>loan.loan_id === operation.loan_id)) throw new Error("Кредитный платёж должен относиться к действующему кредиту и быть расходом.");
        references.push({loan_id:operation.loan_id,transaction_id:operation.transaction_id});
      }
    }
    return {start_date:start,end_date:end,opening_cash_balance:openingCash,cash_reserve:reserve,
      transactions:operations.map(({transaction_id,date,direction,amount})=>({transaction_id,date,direction,amount})),
      existing_debt_payments:references};
  }
  return {build};
})();
if(typeof module !== "undefined") module.exports=OverdraftPlan;
