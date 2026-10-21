const {test}=require("node:test");
const assert=require("node:assert/strict");
const {build}=require("../backend/static/overdraft-plan.js");

function input(extra={}) {
  return {today:"2026-10-21",automaticPeriod:true,openingCash:"300000.00",reserve:"0.00",loans:[],
    operations:[{transaction_id:"purchase",date:"2026-10-22",direction:"outflow",amount:"450000.00"},
      {transaction_id:"customer",date:"2026-10-31",direction:"inflow",amount:"200000.00"}],...extra};
}

test("Two operations use bank balance and dates without inventing a horizon or changing inputs",()=>{
  const source=input(),before=structuredClone(source),plan=build(source);
  assert.equal(plan.start_date,"2026-10-21");assert.equal(plan.end_date,"2026-10-31");
  assert.equal(plan.opening_cash_balance,"300000.00");assert.deepEqual(plan.transactions,source.operations);
  assert.deepEqual(plan.existing_debt_payments,[]);assert.deepEqual(source,before);
});

test("Multiple receipts and expenses extend the automatic horizon across a month",()=>{
  const source=input();source.operations.push({transaction_id:"second-receipt",date:"2026-11-05",direction:"inflow",amount:"100000.00"});
  assert.equal(build(source).end_date,"2026-11-05");assert.equal(build(source).transactions.length,3);
});

test("An explicitly extended saved period is preserved and operations outside it require correction",()=>{
  const source=input({automaticPeriod:false,start:"2026-10-21",end:"2026-11-10"});
  assert.equal(build(source).end_date,"2026-11-10");
  assert.throws(()=>build({...source,end:"2026-10-25"}),/выходит за период/);
  assert.throws(()=>build({...source,start:"2026-10-20"}),/прошлом/);
});

test("Known loans require explicit review; no future payment or date is fabricated",()=>{
  const source=input({loans:[{loan_id:"existing-loan",outstanding_principal:"700000.00",monthly_payment:"35000.00"}]});
  assert.throws(()=>build(source),/подтвердите/);
  const confirmed=build({...source,debtPaymentsConfirmed:true});
  assert.equal(confirmed.transactions.length,2);assert.deepEqual(confirmed.existing_debt_payments,[]);
});

test("A credit payment is represented by one expense and a reference, without being added twice",()=>{
  const source=input({loans:[{loan_id:"existing-loan",outstanding_principal:"700000.00",monthly_payment:"35000.00"}],debtPaymentsConfirmed:true});
  source.operations.push({transaction_id:"debt-payment",loan_id:"existing-loan",date:"2026-10-28",direction:"outflow",amount:"35000.00"});
  const plan=build(source);
  assert.equal(plan.transactions.length,3);
  assert.deepEqual(plan.existing_debt_payments,[{loan_id:"existing-loan",transaction_id:"debt-payment"}]);
  assert.equal(plan.transactions.filter(item=>item.transaction_id === "debt-payment").length,1);
  source.operations[2].direction="inflow";assert.throws(()=>build(source),/быть расходом/);
});

test("Incomplete amounts, missing dates and duplicate operations cannot be saved",()=>{
  for(const amount of [null,"", "0.00", "NaN", "-1.00"]) {
    const source=input();source.operations[0].amount=amount;assert.throws(()=>build(source),/положительную сумму/);
  }
  const source=input();source.operations[1].date="";assert.throws(()=>build(source),/дату/);
  source.operations[1]={...source.operations[0]};assert.throws(()=>build(source),/разные идентификаторы/);
});
