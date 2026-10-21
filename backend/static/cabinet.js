"use strict";

let renderedApplication=null, compareIds=new Set(), showAllOptions=false, savedListSignature="", confirmCallback=null, activeExploration=null, lastExploration=null, renderedState=null;
let scenariosLoaded=false;
if(location.pathname === "/cabinet") {
  document.body.classList.add("cabinet");document.title="Дело за малым · Кредитный кабинет";
  document.querySelector(".tag").textContent="кредитный кабинет";document.querySelector(".brand").href="/cabinet";
  for(const id of ["context","reply-json"])$(id).closest("details").classList.add("debug-only");
} else if(location.pathname === "/chat") {
  $("scenario-label").hidden=false;$("scenario").hidden=false;
}
function button(text, action, cls="secondary") {const node=el("button",text,cls);node.type="button";node.dataset.lock="";node.addEventListener("click",action);return node;}
function numberInput(value, min="0", step="0.01") {const node=el("input");node.type="number";node.min=min;node.step=step;node.value=value??"";return node;}
function dateInput(value) {const node=el("input");node.type="date";node.value=value??"";return node;}
function selectInput(choices,value) {const node=el("select");for(const [key,label] of choices)node.append(new Option(label,key));node.value=value??"";return node;}
function asMoney(input) {return input.value === "" ? null : Number(input.value).toFixed(2);}
function appPath(suffix="") {return "/api/applications/"+data.chat.application_id+suffix;}
function versionBody(extra={}) {return {base_application_version:data.record.application.application_version,...extra};}
function requireSaved() {if(["need","finance","plan"].some(section=>dirty.has(section)))throw new Error("Есть несохранённые изменения в форме. Сначала подтвердите или отмените их.");}
function focusField(field) {
  if(typeof focusWorkspaceField === "function")focusWorkspaceField(field);
  let id=({"need.requested_amount":"amount","need.term_months":"term","need.purpose":"purpose","need.minimum_acceptable_amount":"minimum-amount","need.preferred_product":"product","need.financing_pattern":"pattern","product_details.overdraft.end_date":"plan-end"})[field];
  if(field.startsWith("financials")){$("finance-section").open=true;id=field.includes("cash_balance")?"cash-balance":field.includes("largest_buyer_share")?"buyer-share":"financial-months";}
  if(field.startsWith("need."))$("need-section").open=true;
  if(field.startsWith("product_details")){$("plan-section").open=true;id=id || "transactions";if(field.endsWith("end_date")){$("plan-settings").open=true;$("plan-auto-period").checked=false;syncPlanDetails();}if(field.includes("existing_debt_payments"))id="debt-plan-confirmed";}
  if(id && $(id)){$(id).scrollIntoView({block:"center"});($(id).querySelector("input,select") || $(id)).focus();}
}
async function refreshRecord(clear=[]) {for(const section of clear)dirty.delete(section);accept(await api("/api/chats/"+data.chat.chat_id,undefined,"GET"));}
function confirmAction(title,text,action) {$("confirmation-title").textContent=title;$("confirmation-text").textContent=text;confirmCallback=action;$("confirmation-dialog").showModal();}
$("confirmation-no").addEventListener("click",()=>{$("confirmation-dialog").close();confirmCallback=null;});
$("confirmation-yes").addEventListener("click",()=>{const action=confirmCallback;confirmCallback=null;$("confirmation-dialog").close();if(action)run(action);});
$("close-schedule").addEventListener("click",()=>$("schedule-dialog").close());

function renderCabinet() {
  const {application,state}=data.record;
  if(renderedApplication !== application.application_id) {renderedApplication=application.application_id;compareIds.clear();showAllOptions=false;savedListSignature="";activeExploration=null;lastExploration=null;renderedState=null;
    $("explore-amount").value="";$("maximum-payment").value="";$("minimum-term").value="6";$("maximum-term").value="36";$("preserve-amount").checked=true;$("option-priority").value=application.need.priority || "preserve_amount";
    $("plan-section").open=application.need.financing_pattern === "cash_gap" || application.need.preferred_product === "overdraft";$("plan-settings").open=false;
  }
  $("next-action").textContent=state.next_action.label;renderBankProfile();
  document.querySelector(".application").classList.toggle("review",state.status !== "draft");
  if(renderedState !== state.status){$("need-section").open=state.status === "draft";renderedState=state.status;}
  $("options-form").hidden=!editable.has(state.status);
  if(!dirty.has("finance"))renderFinancials();
  if(!dirty.has("plan"))renderPlan();
  renderExplorations();renderProcess();
  for(const [section,form]of [["need","need-form"],["finance","finance-form"],["plan","plan-form"]])if(!$(form).querySelector(".reset-form")){
    const reset=button("Отменить несохранённые правки",()=>{dirty.delete(section);render();},"quiet reset-form");$(form).append(reset);
    reset.hidden=!dirty.has(section);
  }
  $("finance-form").querySelector(".reset-form").hidden=$("save-finance").hidden;
  loadApplications().catch(()=>{});
  if(location.pathname === "/chat" && !scenariosLoaded){scenariosLoaded=true;api("/api/demo/scenarios",undefined,"GET").then(items=>{const select=$("scenario"),selected=select.value;select.replaceChildren(new Option("Новая потребность",""));for(const item of items)select.append(new Option(`${values[item.product_id]} · ${item.title}`,`${item.product_id}/${item.scenario_id}`));select.value=selected;}).catch(()=>{scenariosLoaded=false;});}
}
for(const [id,pattern,product]of [["task-purchase","gradual_repayment","working_capital_loan"],["task-gap","cash_gap","overdraft"]])$(id).addEventListener("click",()=>{
  $("purpose").value="working_capital";$("pattern").value=pattern;$("product").value="";$("explore-product").value=product;toggleProduct();dirty.add("need");dirty.add("preferences");
  if(pattern === "cash_gap"){$("plan-section").open=true;$("transactions").querySelector('[data-field="amount"]')?.focus();show("notice","Остаток уже известен. Укажите, когда и сколько нужно заплатить и когда придут деньги. Если нужный лимит неизвестен, подберём его по плану.");}
  else {$("amount").focus();show("notice","Задача выбрана. Уточните сумму, если она известна, и сохраните потребность. Продукт можно подобрать после проверки данных.");}
});
$("known-product").addEventListener("click",()=>$("product").focus());
async function loadApplications() {
  const items=await api("/api/applications",undefined,"GET");
  const signature=JSON.stringify(items.map(item=>[item.application_id,item.state.status,item.state.application_version]));
  if(signature === savedListSignature)return;savedListSignature=signature;
  const select=$("saved-applications");select.replaceChildren(new Option("Выберите заявку",""));
  for(const item of items)select.append(new Option(`${(values[item.need.preferred_product] || "Потребность")} · ${item.need.requested_amount ? money(item.need.requested_amount) : "Сумма не указана"} · ${states[item.state.status] || item.state.status} · ${item.application_id.slice(0,6)}`,item.application_id));
  select.value=data.chat.application_id;
}
$("open-application").addEventListener("click",()=>run(async()=>{
  const id=$("saved-applications").value;if(!id)return;
  const chats=await api(`/api/applications/${id}/chats`,undefined,"GET");
  accept(chats.length ? await api("/api/chats/"+chats[0].chat_id,undefined,"GET") : await api("/api/chats",{application_id:id}));
}));
$("refresh-application").addEventListener("click",()=>run(()=>refreshRecord()));

function renderBankProfile() {
  const record=data.record,profile=record.client_data || {},financials=record.application.financials,business=record.application.business;
  $("company").textContent=profile.company_name || "Моя компания";
  $("bank-source").textContent="Банковский профиль"+(profile.loaded_at ? " · получено "+new Date(profile.loaded_at).toLocaleString("ru-RU") : "");
  $("company-details").textContent="ИНН "+business.inn+(business.registered_at ? " · регистрация "+business.registered_at : "");
  const box=$("bank-facts");box.replaceChildren();
  const history=profile.credit_history || {},labels={good:"Без просрочек",no_history:"Нет кредитной истории",minor_delinquency:"Есть небольшие просрочки",serious_delinquency:"Есть серьёзные просрочки"};
  const historyText=history.status === "completed" ? labels[history.category] || "Нужна проверка" : history.status === "error" ? "Повтор проверки" : "Проверка ожидается";
  const loans=financials.existing_loans;
  for(const [title,value]of [["Остаток на счёте",money(financials.cash_balance)],["История операций",financials.monthly?.length ? financials.monthly.length+" мес." : "Нужны сведения"],["Действующие кредиты",loans == null ? "Нужны сведения" : loans.length ? loans.length+" · платежи "+money(loans.reduce((sum,item)=>sum+Number(item.monthly_payment || 0),0))+"/мес." : "Нет"],["Кредитная история",historyText]]) {
    const item=el("div",undefined,"bank-fact");item.append(el("span",title,"muted"),el("strong",value));box.append(item);
  }
}
function renderFinancials() {
  const financials=data.record.application.financials,known=data.record.client_data?.bank_financials || financials;
  $("cash-balance").value=financials.cash_balance??"";$("buyer-share").value=financials.largest_buyer_share == null ? "" : Number(financials.largest_buyer_share)*100;
  $("cash-balance").readOnly=known.cash_balance != null;$("buyer-share").readOnly=known.largest_buyer_share != null;
  $("financial-months").replaceChildren();
  let months=financials.monthly;
  if(months == null){months=[];const today=new Date();for(let offset=6;offset>=1;offset--){const date=new Date(today.getFullYear(),today.getMonth()-offset,1);months.push({month:date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")});}}
  for(const source of months) {
    const row=el("tr");
    const bankRow=(known.monthly || []).find(item=>item.month === source.month);
    for(const field of ["month","operating_inflow","operating_outflow","taxes"]) {const cell=el("td");const input=field === "month" ? el("input") : numberInput(source[field]);if(field === "month"){input.type="month";input.value=source[field];}input.readOnly=bankRow?.[field] != null;input.dataset.field=field;input.setAttribute("aria-label",field === "month" ? "Месяц" : ({operating_inflow:"Поступления",operating_outflow:"Расходы",taxes:"Налоги"}[field])+" "+source.month);cell.append(input);row.append(cell);}
    $("financial-months").append(row);
  }
  $("existing-loans").replaceChildren();
  for(const loan of financials.existing_loans || [])addLoan(loan,false,(known.existing_loans || []).find(item=>item.loan_id === loan.loan_id));
  if(financials.existing_loans?.length === 0)$("existing-loans").append(el("p","Действующих кредитов нет.","muted"));
  if(financials.existing_loans === null)$("existing-loans").append(el("p","Сведения о текущих кредитах неизвестны. Добавьте их либо подтвердите отсутствие кредитов пустым списком.","muted"));
  $("add-loan").hidden=known.existing_loans != null;
  const hasMissing=known.existing_loans == null || [...$("finance-form").querySelectorAll("input")].some(input=>!input.readOnly);
  $("save-finance").hidden=!hasMissing;
  $("finance-note").textContent=hasMissing ? "Известные банку показатели уже заполнены. Дополните только отсутствующие сведения — они будут сохранены отдельно от исходных банковских данных." : "Показатели получены из банковского профиля. Повторно заполнять их не нужно.";
}
function addLoan(source={},mark=true,known=null) {
  const row=el("div",undefined,"loan-row");row.dataset.loanId=source.loan_id || crypto.randomUUID();
  const fields=[["outstanding_principal","Остаток долга, ₽",numberInput(source.outstanding_principal)],["monthly_payment","Платёж, ₽",numberInput(source.monthly_payment)],["maturity_date","Дата погашения",dateInput(source.maturity_date)]];
  for(const [key,title,input]of fields){input.dataset.field=key;input.readOnly=known?.[key] != null;const label=el("label",title);label.append(input);row.append(label);}
  if(!known)row.append(button("Удалить",()=>{row.remove();dirty.add("finance");},"quiet"));$("existing-loans").append(row);if(mark)dirty.add("finance");
}
$("add-loan").addEventListener("click",()=>addLoan());
$("finance-form").addEventListener("input",()=>dirty.add("finance"));
$("finance-form").addEventListener("submit",event=>{event.preventDefault();confirmAction("Сохранить недостающие сведения?","Дополнения будут использованы при рассмотрении. Показатели, полученные из банка, останутся неизменными.",async()=>{
  const monthly=[...$("financial-months").children].map(row=>Object.fromEntries([...row.querySelectorAll("input")].map(input=>[input.dataset.field,input.dataset.field === "month" ? input.value : asMoney(input)])));
  const loans=[...$("existing-loans").querySelectorAll(".loan-row")].map(row=>({loan_id:row.dataset.loanId,...Object.fromEntries([...row.querySelectorAll("input")].map(input=>[input.dataset.field,input.type === "date" ? input.value || null : asMoney(input)]))}));
  await api(appPath(),versionBody({changes:{financials:{monthly,cash_balance:asMoney($("cash-balance")),largest_buyer_share:$("buyer-share").value === "" ? null : Number($("buyer-share").value)/100,existing_loans:loans}}}),"PATCH");
  await refreshRecord(["finance"]);show("notice","Дополнения сохранены. Можно продолжить рассмотрение.");
});});

function localToday() {const now=new Date();return now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");}
function activeLoans() {return (data.record.application.financials.existing_loans || []).filter(loan=>Number(loan.outstanding_principal)>0);}
function syncPlanDetails() {
  const automatic=$("plan-auto-period").checked;
  if(automatic){$("plan-start").value=localToday();$("plan-end").value=[...$("transactions").querySelectorAll('[data-field="date"]')].reduce((latest,input)=>input.value > latest ? input.value : latest,localToday());}
  $("plan-start").readOnly=automatic;$("plan-end").readOnly=automatic;
  const period=$("plan-start").value+" — "+$("plan-end").value;
  $("plan-context").textContent="Собственные деньги к началу: "+money(asMoney($("plan-cash")))+" · период "+period;
}
function renderPlan() {
  const application=data.record.application,plan=application.product_details?.overdraft;
  $("plan-auto-period").checked=!plan;
  $("plan-start").value=plan?.start_date || localToday();$("plan-end").value=plan?.end_date || localToday();
  $("plan-cash").value=plan?.opening_cash_balance??application.financials.cash_balance??"";$("plan-reserve").value=plan?.cash_reserve??"0.00";
  $("transactions").replaceChildren();
  if(plan)for(const transaction of plan.transactions || []) {const ref=(plan.existing_debt_payments || []).find(item=>item.transaction_id === transaction.transaction_id);addTransaction(transaction,ref?.loan_id,false);}
  else {addTransaction({direction:"outflow",date:localToday()},"",false);addTransaction({direction:"inflow"},"",false);}
  const loans=activeLoans();$("debt-plan-section").hidden=!loans.length;$("debt-plan-confirmed").required=Boolean(loans.length);
  $("debt-plan-confirmed").checked=Boolean(plan && Array.isArray(plan.existing_debt_payments));
  $("known-debt-payments").replaceChildren();
  loans.forEach((loan,index)=>$("known-debt-payments").append(button("Добавить платёж по кредиту "+(index+1)+" · "+money(loan.monthly_payment),()=>{addTransaction({direction:"outflow",amount:loan.monthly_payment},loan.loan_id);controls();},"quiet")));
  syncPlanDetails();
  const delay=$("delay-transaction"),previous=delay.value;delay.replaceChildren(new Option("Без задержки",""));
  for(const transaction of plan?.transactions || [])if(transaction.direction === "inflow")delay.append(new Option(transaction.date+" · "+money(transaction.amount),transaction.transaction_id));
  if([...delay.options].some(option=>option.value === previous))delay.value=previous;
  if(!dirty.has("preferences"))$("explore-product").value=application.need.preferred_product || (application.need.financing_pattern === "cash_gap" ? "overdraft" : "working_capital_loan");
  toggleProduct();
}
function markPlanChanged() {dirty.add("plan");$("debt-plan-confirmed").checked=false;syncPlanDetails();}
function addTransaction(source={},loanId="",mark=true) {
  const row=el("div",undefined,"transaction-row plan-operation "+(source.direction === "inflow" ? "inflow" : "outflow"));
  row.dataset.transactionId=source.transaction_id || crypto.randomUUID();row.dataset.direction=source.direction === null ? "" : source.direction || "outflow";row.dataset.loanId=loanId || "";
  const loanIndex=activeLoans().findIndex(loan=>loan.loan_id === loanId);
  row.append(el("strong",loanId ? "Платёж по кредиту"+(loanIndex >= 0 ? " "+(loanIndex+1) : "") : row.dataset.direction === "inflow" ? "Деньги поступят" : row.dataset.direction === "outflow" ? "Нужно оплатить" : "Уточните назначение","operation-title"));
  if(!row.dataset.direction){const direction=selectInput([["","Не указано"],["outflow","Нужно оплатить"],["inflow","Деньги поступят"]],"");direction.required=true;direction.setAttribute("aria-label","Назначение платежа");direction.addEventListener("change",()=>{row.dataset.direction=direction.value;markPlanChanged();});row.append(direction);}
  for(const [key,title,input]of [["amount","Сумма, ₽",numberInput(source.amount,"0.01")],["date",row.dataset.direction === "inflow" ? "Когда поступят" : "Когда заплатить",dateInput(source.date)]]) {
    input.dataset.field=key;input.required=true;input.max=key === "amount" ? "999999999999.99" : "9999-12-31";
    const label=el("label",title);label.append(input);row.append(label);
  }
  if(loanId)row.append(el("small","Регулярный платёж подставлен из банковского профиля. Дату укажите по графику.","muted operation-note"));
  row.append(button("Убрать",()=>{row.remove();markPlanChanged();},"quiet"));$("transactions").append(row);
  if(mark){markPlanChanged();row.querySelector('[data-field="'+(loanId ? "date" : "amount")+'"]').focus();}
}
$("add-transaction").addEventListener("click",()=>{addTransaction({direction:"outflow"});controls();});
$("add-inflow").addEventListener("click",()=>{addTransaction({direction:"inflow"});controls();});
$("plan-form").addEventListener("input",event=>{dirty.add("plan");if(event.target.id !== "debt-plan-confirmed")markPlanChanged();});
$("plan-form").addEventListener("invalid",event=>{const section=event.target.closest("details");if(section)section.open=true;},true);
$("plan-form").addEventListener("submit",event=>{event.preventDefault();run(async()=>{
  if(typeof workspacePending === "function" && workspacePending()){await saveWorkspaceScenario();return;}
  if(dirty.has("finance"))throw new Error("Сначала сохраните дополнения к финансовым данным — они нужны для расчёта.");
  if(dirty.has("need") && !$("need-form").reportValidity())throw new Error("Проверьте поля потребности перед сохранением.");
  const operations=[...$("transactions").children].map(row=>({transaction_id:row.dataset.transactionId,direction:row.dataset.direction,loan_id:row.dataset.loanId,
    date:row.querySelector('[data-field="date"]').value,amount:asMoney(row.querySelector('[data-field="amount"]'))}));
  const plan=OverdraftPlan.build({today:localToday(),automaticPeriod:$("plan-auto-period").checked,start:$("plan-start").value,end:$("plan-end").value,
    openingCash:asMoney($("plan-cash")),reserve:asMoney($("plan-reserve")),operations,loans:data.record.application.financials.existing_loans,debtPaymentsConfirmed:$("debt-plan-confirmed").checked});
  const changes=dirty.has("need") ? needFormChanges() : {},need=data.record.application.need;
  if((changes["need.purpose"] ?? need.purpose) == null)changes["need.purpose"]="working_capital";
  if((changes["need.financing_pattern"] ?? need.financing_pattern) == null)changes["need.financing_pattern"]="cash_gap";
  changes.product_details={overdraft:plan};
  const saved=await api(appPath(),versionBody({changes}),"PATCH");
  dirty.delete("need");dirty.delete("plan");
  try{await api(appPath("/explorations"),{base_application_version:saved.application.application_version,product_id:"overdraft"});dirty.delete("preferences");compareIds.clear();showAllOptions=false;}
  finally{await refreshRecord();}
  show("notice","План сохранён. Ниже — расчёт лимита, процентов и погашения либо конкретные уточнения, необходимые для продолжения.");
  if(typeof workspaceCalculated === "function")workspaceCalculated();
});});

function toggleProduct() {const loan=$("explore-product").value === "working_capital_loan";$("loan-preferences").hidden=!loan;$("delay-preferences").hidden=loan;}
$("explore-product").addEventListener("change",toggleProduct);
$("options-form").addEventListener("input",()=>dirty.add("preferences"));
$("options-form").addEventListener("submit",event=>{event.preventDefault();run(async()=>{
  requireSaved();
  const product_id=$("explore-product").value,extra={product_id};
  if(product_id === "working_capital_loan")extra.preferences={...(asMoney($("explore-amount")) ? {requested_amount:asMoney($("explore-amount"))} : {}),...(asMoney($("maximum-payment")) ? {maximum_monthly_payment:asMoney($("maximum-payment"))} : {}),minimum_term:Number($("minimum-term").value),maximum_term:Number($("maximum-term").value),preserve_amount:$("preserve-amount").checked,priority:$("option-priority").value};
  else if($("delay-transaction").value)extra.delay={transaction_id:$("delay-transaction").value,days:Number($("delay-days").value)};
  await api(appPath("/explorations"),versionBody(extra));compareIds.clear();showAllOptions=false;dirty.delete("preferences");await refreshRecord();
  if(typeof workspaceCalculated === "function")workspaceCalculated();
});});

function scheduleTable(schedule) {
  const table=el("table"),head=el("tr");for(const title of ["Месяц","Платёж, ₽","Проценты, ₽","Основной долг, ₽","Остаток, ₽"])head.append(el("th",title));table.append(head);
  for(const row of schedule){const line=el("tr");for(const value of [row.month_number,row.total_payment,row.interest_payment,row.principal_payment,row.closing_balance])line.append(el("td",value));table.append(line);}return table;
}
function showSchedule(schedule) {$("schedule-table").replaceChildren(scheduleTable(schedule));$("schedule-dialog").showModal();}
function renderExplorations() {
  const box=$("explorations");box.replaceChildren();const all=data.record.explorations;if(!all.length)return;
  if(lastExploration !== all.at(-1).exploration_id){lastExploration=all.at(-1).exploration_id;activeExploration=lastExploration;compareIds.clear();
    if(!dirty.has("preferences")){const latest=all.at(-1).result,prefs=latest.preferences || {};$("explore-product").value=latest.product_id;toggleProduct();if(latest.product_id === "working_capital_loan"){$("explore-amount").value=prefs.requested_amount || "";$("maximum-payment").value=prefs.maximum_monthly_payment || "";$("minimum-term").value=prefs.minimum_term || 6;$("maximum-term").value=prefs.maximum_term || 36;$("preserve-amount").checked=prefs.preserve_amount !== false;$("option-priority").value=prefs.priority || "preserve_amount";}}
  }
  const exploration=all.find(item=>item.exploration_id === activeExploration) || all.at(-1);
  if(all.length>1){const label=el("label","Сохранённые расчёты"),select=selectInput(all.map((item,index)=>[item.exploration_id,`${index+1}. ${values[item.product_id]} · ${new Date(item.created_at).toLocaleTimeString("ru-RU")} · версия ${item.application_version}`]),exploration.exploration_id);select.addEventListener("change",()=>{activeExploration=select.value;compareIds.clear();renderExplorations();controls();});label.append(select);box.append(label);}
  const result=exploration.result,stale=exploration.application_version !== data.record.application.application_version || Date.parse(exploration.valid_until) <= Date.now();
  if(result.preferences){const prefs=result.preferences;box.append(el("p",`Условия расчёта: ${prefs.requested_amount ? money(prefs.requested_amount) : "сумма заявки"}, срок ${prefs.minimum_term || 6}–${prefs.maximum_term || 36} мес.${prefs.maximum_monthly_payment ? ", платёж до "+money(prefs.maximum_monthly_payment) : ""}.`,"muted"));}
  box.append(el("p",stale ? "Заявка изменилась или срок расчёта истёк. Варианты доступны для просмотра; перед выбором пересчитайте." : "Предварительные варианты. Выбор сохранит условия в черновик для последующего рассмотрения.","muted"));
  questions(box,result.reasons);questions(box,result.required_information);questions(box,result.issues);
  if(result.status === "no_matching_options")box.append(button("Снять ограничение платежа",()=>{$("maximum-payment").value="";$("options-form").requestSubmit();},"quiet"));
  if(result.product_id === "overdraft")renderCashPlan(box,result);
  const options=result.options || [];
  const highlighted=options.filter(option=>option.labels.some(label=>label === "Исходный запрос"));
  for(const option of options)if(highlighted.length<3 && option.labels.length && !highlighted.includes(option))highlighted.push(option);
  for(const option of options)if(highlighted.length<3 && !highlighted.includes(option))highlighted.push(option);
  const shown=showAllOptions ? options : highlighted;
  for(const option of shown) {
    const card=el("article",undefined,"option-card");card.append(el("h3",money(option.amount)+(option.term_months ? " · "+option.term_months+" мес." : " · лимит овердрафта")));
    card.append(el("p",`Ставка ${option.annual_rate_percent}% годовых · комиссии ${money(option.fees_total)}`,"muted"));
    for(const label of option.labels)card.append(el("span",label,"badge option-label"));
    if(option.monthly_payment)card.append(el("p","Платёж: "+money(option.monthly_payment)),el("p","Проценты за весь срок: "+money(option.total_interest)),el("p","Общие выплаты: "+money(option.total_repayment)));
    if(option.payment_headroom)card.append(el("p","До допустимого платежа остаётся: "+money(option.payment_headroom),"muted"));
    if(option.scenario_cost)card.append(el("p","Проценты по плану: "+money(option.scenario_cost.total_interest)),el("p","Срок погашения каждой выборки: до "+option.max_debt_days+" дней"));
    for(const condition of option.conditions)card.append(el("p",condition.message));
    if(result.baseline?.monthly_payment && option.monthly_payment && (option.amount !== result.baseline.amount || option.term_months !== result.baseline.term_months)){const delta=Number(option.monthly_payment)-Number(result.baseline.monthly_payment),interest=Number(option.total_interest)-Number(result.baseline.total_interest);card.append(el("p","К исходному запросу: платёж "+(delta>0?"+":"")+money(delta)+", проценты "+(interest>0?"+":"")+money(interest)+", изменение срока "+(option.term_months>result.baseline.term_months?"+":"")+(option.term_months-result.baseline.term_months)+" мес.","muted"));}
    if(option.available_monthly_payment){const details=el("details"),summary=el("summary","Почему этот вариант проходит");details.append(summary,el("p",`Максимальный платёж по графику ${money(option.maximum_payment)} не превышает доступные ${money(option.available_monthly_payment)} в месяц. Проверены данные бизнеса, обязательства и правила продукта.`));card.append(details);}
    if(option.schedule)card.append(button("График платежей",()=>showSchedule(option.schedule),"quiet"));
    const compare=el("label",undefined,"inline-check"),check=el("input");check.type="checkbox";check.checked=compareIds.has(option.option_id);check.addEventListener("change",()=>{if(check.checked)compareIds.add(option.option_id);else compareIds.delete(option.option_id);renderComparison(box,options);});compare.append(check,document.createTextNode("Добавить в сравнение"));card.append(compare);
    const apply=button("Выбрать эти условия",()=>confirmAction("Сохранить выбранные условия?",`${money(option.amount)}${option.term_months ? ", "+option.term_months+" месяцев" : ", овердрафт"}. Выбранный вариант станет новой версией черновика; после этого отправьте заявку на рассмотрение.`,async()=>{
      await api(appPath(`/explorations/${exploration.exploration_id}/apply`),versionBody({confirmed:true,option_id:option.option_id}));await refreshRecord(["need","plan"]);show("notice","Условия сохранены. Проверьте заявку и подтвердите отправку.");
      if(typeof workspaceOptionSelected === "function")workspaceOptionSelected();
    }),"primary");if(stale || !editable.has(data.record.state.status))apply.dataset.stale="true";card.append(apply);box.append(card);
  }
  if(options.length>highlighted.length)box.append(button(showAllOptions ? "Показать основные" : `Все варианты (${options.length})`,()=>{showAllOptions=!showAllOptions;renderExplorations();controls();},"quiet"));
  renderComparison(box,options);
  if(all.length>1){const previous=all[all.length-2];box.append(el("p",`Предыдущий расчёт сохранён: ${new Date(previous.created_at).toLocaleString("ru-RU")}, вариантов ${previous.result.options.length}.`,"muted"));}
}
function renderComparison(box,options) {
  box.querySelector(".comparison-table")?.remove();const selected=options.filter(option=>compareIds.has(option.option_id));if(selected.length<2)return;
  const wrapper=el("div",undefined,"table-scroll comparison-table"),table=el("table"),head=el("tr");for(const title of ["Сумма / срок","Платёж","Проценты","Всего","Условия"])head.append(el("th",title));table.append(head);
  for(const option of selected){const row=el("tr");for(const text of [money(option.amount)+" / "+(option.term_months || "лимит"),option.monthly_payment?money(option.monthly_payment):"По операциям",money(option.total_interest || option.scenario_cost?.total_interest),option.total_repayment?money(option.total_repayment):"По плану",option.conditions.length?"Поручительство":"Без дополнительных условий"])row.append(el("td",text));table.append(row);}wrapper.append(table);box.append(wrapper);
}

function lineChart(rows,series) {
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 600 220");svg.setAttribute("role","img");svg.setAttribute("aria-label","Денежный план по дням");
  const all=rows.flatMap(row=>series.map(item=>Number(row[item.key]))),low=Math.min(0,...all),high=Math.max(1,...all),y=value=>180-(value-low)/(high-low)*145,x=index=>60+index/Math.max(1,rows.length-1)*510;
  const axis=document.createElementNS(ns,"line");for(const [key,value]of Object.entries({x1:60,x2:570,y1:y(0),y2:y(0),stroke:"#ccd3cf"}))axis.setAttribute(key,String(value));svg.append(axis);
  for(const item of series){const path=document.createElementNS(ns,"polyline");path.setAttribute("points",rows.map((row,index)=>`${x(index)},${y(Number(row[item.key]))}`).join(" "));path.setAttribute("fill","none");path.setAttribute("stroke",item.color);path.setAttribute("stroke-width","2.5");svg.append(path);}
  for(const [text,tx,ty]of [[money(high),2,25],[money(low),2,185],[rows[0].date,60,208],[rows.at(-1).date,490,208]]){const label=document.createElementNS(ns,"text");label.setAttribute("x",tx);label.setAttribute("y",ty);label.setAttribute("font-size","10");label.setAttribute("fill","#777");label.textContent=text;svg.append(label);}return svg;
}
function renderCashPlan(box,result) {
  if(!result.daily?.length)return;
  const calculation=result.calculation;
  if(result.horizon_extension_required)box.append(el("p","Ниже показан исходный план. Для расчёта задержки продлите период и подтвердите операции.","conflict"));
  box.append(el("h3","Когда нужны деньги"),el("p","Пик задолженности по плану: "+money(calculation.required_limit)+". Проценты: "+money(calculation.total_interest)));
  if(result.limit_calculation)box.append(el("p","Допустимый лимит по данным бизнеса: "+money(result.limit_calculation.maximum_eligible_limit),"muted"));
  if(result.limit_calculation){const limits=result.limit_calculation,details=el("details");details.append(el("summary","Из чего складывается ограничение лимита"),el("p",`Ограничение по обороту: ${money(limits.turnover_limit)}. По нагрузке: ${money(limits.interest_capacity_limit)}. Максимум продукта: ${money(limits.product_maximum_limit)}. Используется наименьшее ограничение с округлением по шагу лимита.`));box.append(details);}
  if(result.suggested_amount)box.append(el("p","Для операций плана достаточно лимита с округлением: "+money(result.suggested_amount),"muted"));
  box.append(lineChart(result.daily,[{key:"cash_without_financing",color:"#dc514b"},{key:"closing_cash",color:"#39896b"}]));
  box.append(el("p","Красная линия — деньги без финансирования. Зелёная — собственный остаток при использовании расчётного овердрафта.","muted"));
  if(result.delay && !result.horizon_extension_required && result.baseline)box.append(el("p","При задержке поступления на "+result.delay.days+" дн.: изменение процентов "+money(Number(calculation.total_interest)-Number(result.baseline.total_interest))+", изменение потребности в лимите "+money(Number(calculation.required_limit)-Number(result.baseline.required_limit))));
  if(!calculation.feasible)box.append(el("p","План требует уточнений: "+calculation.violations.map(item=>item.message).join(" "),"conflict"));
  const details=el("details"),summary=el("summary","Операции, задолженность и погашение по дням");details.append(summary);
  const table=el("table"),head=el("tr");for(const title of ["Дата","Поступления","Расходы","Долг","Проценты за день"])head.append(el("th",title));table.append(head);
  for(const row of result.daily){const tr=el("tr");for(const value of [row.date,row.inflow,row.outflow,row.closing_principal,row.interest_accrued])tr.append(el("td",value));table.append(tr);}const scroll=el("div",undefined,"table-scroll");scroll.append(table);details.append(scroll);box.append(details);
}

function renderProcess() {
  const record=data.record,box=$("process-actions"),completion=$("completion");box.replaceChildren();completion.replaceChildren();
  const state=record.state,assessment=record.result?.assessment;
  if(state.status === "draft")box.append(button("Проверить и отправить заявку",()=>confirmAction("Отправить заявку на рассмотрение?",`Сохранено: ${values[record.application.need.preferred_product] || "продукт не выбран"}, ${money(record.application.need.requested_amount)}${record.application.need.term_months ? ", "+record.application.need.term_months+" мес." : ""}. Подтверждаю сведения о бизнесе, финансах и условиях.`,async()=>{requireSaved();await api(appPath("/submit"),versionBody({confirmed:true}));await refreshRecord();}),"primary"));
  if(["check_retry_pending","offer_expired"].includes(state.status))box.append(button("Повторить рассмотрение",()=>run(async()=>{await api(appPath("/retry"),versionBody());await refreshRecord();}),"primary"));
  if(assessment?.stage === "final") {
    const conditionsCompleted=["ready_to_sign","signed","disbursed","limit_opened"].includes(state.status);
    box.append(el("h3",conditionsCompleted ? "Выбранные условия" : outcomes[assessment.outcome] || assessment.outcome));if(!conditionsCompleted)questions(box,assessment.reasons);questions(box,assessment.required_information);questions(box,record.result.issues);
    for(const offer of assessment.offers) {
      if(record.completion && offer.offer_id !== state.selected_offer_id)continue;
      const card=el("div",undefined,"offer");renderOffer(card,offer,conditionsCompleted && state.selected_offer_id === offer.offer_id);
      if(["offers_ready","conditions_pending","ready_to_sign"].includes(state.status) && state.selected_offer_id !== offer.offer_id)card.append(button("Выбрать итоговое предложение",()=>run(async()=>{await api(appPath("/select-offer"),versionBody({assessment_id:assessment.assessment_id,offer_id:offer.offer_id}));await refreshRecord();}),"primary"));box.append(card);
    }
  }
  if(state.status === "conditions_pending")for(const condition of record.readiness?.pending_conditions || [])box.append(button("Оформить поручительство в прототипе",()=>confirmAction("Смоделировать оформление поручительства?",condition.message,async()=>{await api(appPath(`/conditions/${condition.code}/complete`),versionBody({confirmed:true,offer_id:state.selected_offer_id}));await refreshRecord();}),"primary"));
  if(state.status === "ready_to_sign")box.append(button("Подписать и завершить оформление",()=>confirmAction("Подписать договор в прототипе?","Будет смоделировано подписание и выдача кредита либо открытие лимита по выбранному предложению.",async()=>{await api(appPath("/sign"),versionBody({confirmed:true,offer_id:state.selected_offer_id}));await refreshRecord();}),"primary"));
  if(record.completion) {
    completion.append(el("h3",record.completion.type === "limit_opening" ? "Лимит открыт" : "Кредит выдан"),el("p",money(record.completion.amount)),el("p","Операция выполнена в демонстрационном режиме.","muted"));
    if(record.completion.schedule)completion.append(button("Посмотреть график выплат",()=>showSchedule(record.completion.schedule),"secondary"));
  }
  const labels={application_created:"Создана заявка",application_updated:"Подтверждены новые данные",application_submitted:"Заявка отправлена",review_started:"Начато рассмотрение",assessment_completed:"Рассмотрение завершено",offer_selected:"Выбрано предложение",condition_completed:"Выполнено дополнительное условие",contract_signed:"Договор подписан",credit_disbursed:"Кредит выдан",limit_opened:"Лимит открыт",document_imported:"Проверен файл",import_corrected:"Проверены исправления файла",import_confirmed:"Подтверждены данные из файла",options_explored:"Рассчитаны варианты",explored_option_applied:"Сохранены выбранные условия",recommendations_calculated:"Выполнен подбор продуктов"};
  $("timeline").replaceChildren();for(const event of record.events)$("timeline").append(el("li",`${new Date(event.created_at).toLocaleTimeString("ru-RU")} · ${labels[event.type] || event.type} · версия ${event.application_version}`));
}
