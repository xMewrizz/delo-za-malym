/** Illustrative ledger. Never writes operations to the cabinet. Amounts are whole rubles. */
export type PromoOperation = {id:string;day:number;title:string;shortTitle:string;amount:number;track:"account"|"loan"|"line";principal?:number;interest?:number};
export const openingCash=120_000;
export const promoOperations:readonly PromoOperation[]=[
 {id:"revenue-4",day:4,title:"Выручка от клиентов",shortTitle:"Выручка",amount:180_000,track:"account"},
 {id:"line-6",day:6,title:"Кредитная линия",shortTitle:"Кредитная линия",amount:-21_600,track:"line",principal:18_000,interest:3_600},
 {id:"supplier-10",day:10,title:"Поставка товара",shortTitle:"Поставщик",amount:-95_000,track:"account"},
 {id:"loan-13",day:13,title:"Оборотный кредит",shortTitle:"Оборотный кредит",amount:-32_800,track:"loan",principal:26_800,interest:6_000},
 {id:"contract-17",day:17,title:"Оплата по контракту",shortTitle:"Контракт",amount:120_000,track:"account"},
 {id:"loan-18",day:18,title:"Оборотный кредит",shortTitle:"Оборотный кредит",amount:-38_240,track:"loan",principal:30_240,interest:8_000},
 {id:"rent-18",day:18,title:"Аренда и коммунальные",shortTitle:"Аренда",amount:-64_000,track:"account"},
 {id:"revenue-23",day:23,title:"Выручка от клиентов",shortTitle:"Выручка",amount:86_000,track:"account"},
 {id:"line-27",day:27,title:"Кредитная линия",shortTitle:"Кредитная линия",amount:-21_600,track:"line",principal:18_000,interest:3_600},
 {id:"salary-30",day:30,title:"Зарплата команде",shortTitle:"Зарплата",amount:-48_000,track:"account"},
];
export function promoDay(day:number){
 const operations=promoOperations.filter(operation=>operation.day===day);
 return {operations,income:operations.reduce((sum,operation)=>sum+Math.max(operation.amount,0),0),expense:operations.reduce((sum,operation)=>sum-Math.min(operation.amount,0),0),balance:openingCash+promoOperations.filter(operation=>operation.day<=day).reduce((sum,operation)=>sum+operation.amount,0)};
}
export const promoMonth={income:promoOperations.reduce((sum,operation)=>sum+Math.max(operation.amount,0),0),expense:promoOperations.reduce((sum,operation)=>sum-Math.min(operation.amount,0),0),closingCash:promoDay(30).balance};
