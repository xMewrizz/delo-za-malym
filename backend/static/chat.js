"use strict";
const $ = id => document.getElementById(id);
const names = {purpose:"Цель",preferred_product:"Продукт",requested_amount:"Сумма",term_months:"Срок",financing_pattern:"Возврат",own_funds:"Свои средства",minimum_acceptable_amount:"Минимальная сумма",needed_by:"Дата",recurring:"Регулярность",priority:"Приоритет"};
const values = {working_capital:"Оборотные расходы",investment:"Развитие",refinancing:"Рефинансирование",contract_execution:"Контракт",other:"Другая цель",working_capital_loan:"Разовый кредит",overdraft:"Овердрафт",cash_gap:"После конкретного поступления",gradual_repayment:"Постепенно из выручки",lowest_payment:"Меньший платёж",lowest_total_cost:"Меньшая переплата",preserve_amount:"Сохранить сумму"};
const states = {draft:"Черновик",offers_ready:"Предложения готовы",waiting_for_data:"Нужны сведения",check_retry_pending:"Повтор проверки",disbursed:"Кредит выдан",limit_opened:"Лимит открыт",declined:"Отказ",out_of_policy:"Вне правил",conditions_pending:"Нужны условия",ready_to_sign:"К подписанию"};
const outcomes = {approved:"Исходный запрос проходит",alternative_offers:"Предлагаются другие условия",conditional_approval:"Нужны дополнительные условия",needs_information:"Нужно уточнение",declined:"Отказ",out_of_policy:"Нужен отдельный разбор"};
const editable = new Set(["draft","waiting_for_data","check_retry_pending","offers_ready","conditions_pending","ready_to_sign","offer_expired","declined","out_of_policy"]);
let data = null, busy = false, thinking = false, thinkingChatId = null, retry = null;
const dirty = new Set();
function el(tag, text, cls) { const node = document.createElement(tag); if(text !== undefined) node.textContent = text; if(cls) node.className = cls; return node; }
function money(value) { return value == null ? "Неизвестно" : Number(value).toLocaleString("ru-RU", {maximumFractionDigits:2}) + " ₽"; }
function display(key, value) { if(value == null) return "Не указано"; if(["requested_amount","own_funds","minimum_acceptable_amount"].includes(key)) return money(value); if(key === "term_months") return value + " мес."; if(typeof value === "boolean") return value ? "Да" : "Нет"; return values[value] || String(value); }
function show(id, message) { $(id).textContent = message; $(id).hidden = !message; }
function stored(id) { try { if(id) localStorage.setItem("delo-chat-id",id); else return localStorage.getItem("delo-chat-id"); } catch {} }
function controls() {
  const currentThinking=thinking && data?.chat.chat_id === thinkingChatId;
  document.querySelectorAll("[data-lock]").forEach(node => { const chatControl=node.closest(".conversation");node.disabled = busy || !data || (currentThinking && (chatControl || ["saved-applications","open-application","scenario","load-scenario"].includes(node.id))); });
  document.querySelectorAll('[data-stale="true"],[data-requires-save="true"]').forEach(button=>{button.disabled=true;});
  $("waiting").hidden = !currentThinking;
  if(data) {
    $("need-fields").disabled = busy || (currentThinking && document.body.classList.contains("cabinet")) || !editable.has(data.record.state.status);
    $("recommend").disabled = busy || !editable.has(data.record.state.status);
    $("preview").disabled = busy || data.record.state.status !== "draft";
    for(const id of ["finance-fields","plan-fields","option-fields"]) if($(id)) $(id).disabled = busy || (currentThinking && document.body.classList.contains("cabinet")) || !editable.has(data.record.state.status);
  }
  if(typeof updateWorkspaceStatus === "function")updateWorkspaceStatus();
}
async function api(path, body, method = "POST") {
  const response = await fetch(path, {method, headers:{"Content-Type":"application/json"}, ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(190000)});
  const result = await response.json();
  if(!response.ok) {
    const detail = result.detail;
    const message = typeof detail === "object" && !Array.isArray(detail) ? detail.message : null;
    throw new Error(message || (response.status === 422 ? "Проверьте заполненные поля." : "Ошибка сервера: " + response.status));
  }
  return result;
}
async function run(action, generating = false) {
  if(busy || (generating && thinking)) return;
  if(generating){thinking=true;thinkingChatId=data?.chat.chat_id;}else busy=true;
  show("error",""); show("notice",""); controls();
  try { await action(); }
  catch(error) {
    if(!generating || data?.chat.chat_id === thinkingChatId)show("error", error.name === "TimeoutError" ? "Ответ задержался. Повторите сообщение: оно не задублируется в истории." : error.message || "Нет соединения с сервером.");
    if(data) { try { accept(await api("/api/chats/" + data.chat.chat_id,undefined,"GET")); } catch {} }
  }
  finally { if(generating){thinking=false;thinkingChatId=null;}else busy=false;controls(); }
}
function accept(next) {
  if(typeof rememberWorkspaceContext === "function")rememberWorkspaceContext(next);
  if(data && data.chat.application_id !== next.chat.application_id)dirty.clear();
  else if(data){if(next.record.application.application_version < data.record.application.application_version || (next.record.application.application_version === data.record.application.application_version && next.record.events.length < data.record.events.length))next.record=data.record;if(next.chat.chat_id === data.chat.chat_id && next.chat.chat_version < data.chat.chat_version)next.chat=data.chat;}
  data=next;stored(data.chat.chat_id);render();
}
function render() {
  const {chat,record,assistant} = data, need = record.application.need;
  $("mode").textContent = assistant.mode === "demo" ? "Демонстрационный режим" : assistant.model;
  $("mode").className = "badge " + assistant.mode;
  $("demo-note").hidden = assistant.mode !== "demo"; $("examples").hidden = assistant.mode !== "demo";
  const turnCount=chat.messages.filter(m=>m.role === "user").length;
  $("chat-info").textContent = document.body.classList.contains("cabinet") ? "История разговора сохраняется"+(turnCount>=35 ? " · осталось сообщений: "+(40-turnCount) : "") : "Диалог " + chat.chat_id.slice(0,8) + " · " + turnCount + "/40 сообщений";
  $("application-info").textContent = "Заявка " + chat.application_id.slice(0,8) + " · версия " + record.application.application_version;
  $("state").textContent = states[record.state.status] || record.state.status;
  if(!dirty.has("need")) for(const [id,key] of [["purpose","purpose"],["amount","requested_amount"],["term","term_months"],["product","preferred_product"],["pattern","financing_pattern"],["minimum-amount","minimum_acceptable_amount"],["own-funds","own_funds"],["needed-by","needed_by"],["recurring","recurring"]]) $(id).value = need[key] == null ? "" : String(need[key]);
  $("context").textContent = JSON.stringify({application:record.application,state:record.state,result:record.result,recommendation:record.recommendation},null,2);
  const last = [...chat.messages].reverse().find(m=>m.role === "assistant");
  $("reply-json").textContent = last ? JSON.stringify({intent:last.intent,text:last.text,question:last.question,proposal:last.proposal,tools:last.tools || []},null,2) : "Пока нет ответа";
  $("messages").replaceChildren();
  if(!chat.messages.length) {
    const empty = el("div",undefined,"empty"); empty.append(el("div","✳","empty-icon"), el("p","Расскажите, для какой задачи вам нужно финансирование. Или начните с примера ниже.")); $("messages").append(empty);
  }
  for(const message of chat.messages) {
    const item = el("article",undefined,"message " + message.role);
    item.append(el("div",message.role === "user" ? "Вы" : "Ассистент" + (message.mode === "demo" ? " · демо" : ""),"message-label"),el("div",message.text,"bubble"));
    const question = typeof message.question === "string" ? message.question.trim() : "";
    if(question && question.toLowerCase() !== "null" && !message.text.includes(question) && (!message.proposal || message.proposal.status === "pending")) item.append(el("p",question,"muted"));
    if(message.tools?.length) {
      const labels = {calculate_loan:"Расчёт платежа",assess_credit:"Предварительный расчёт",recommend_financing:"Подбор продукта",simulate_alternative:"Отдельный вариант",compare_options:"Сравнение условий",web_search:"Веб-поиск"};
      for(const tool of message.tools) {
        const status = tool.ok ? "выполнено" : tool.error?.message || "не выполнено";
        item.append(el("p",(labels[tool.name] || "Инструмент") + " · " + status,"muted"));
      }
      for(const tool of message.tools) for(const source of tool.sources || []) {
        if(!/^https?:\/\//i.test(source.url)) continue;
        const link = el("a",source.title || source.url); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer";
        const paragraph = el("p"); paragraph.append(link); item.append(paragraph);
      }
      for(const tool of message.tools.filter(tool=>tool.name === "calculate_loan" && tool.ok)) {
        const calculation = tool.result.calculation, preview = el("div",undefined,"proposal");
        preview.append(el("strong","Расчёт платежа"),el("p","По заданным параметрам · одобрение не оценивалось","muted"));
        preview.append(el("p","Сумма: " + money(calculation.amount) + " · срок: " + calculation.term_months + " мес."));
        preview.append(el("p","Ставка: " + calculation.annual_rate_percent + "% годовых"));
        preview.append(el("p","Ежемесячный платёж: " + money(calculation.monthly_payment)));
        preview.append(el("p","Максимальный платёж с учётом округления: " + money(calculation.maximum_payment)));
        preview.append(el("p","Проценты за весь срок: " + money(calculation.total_interest)));
        preview.append(el("p","Всего выплат: " + money(calculation.total_repayment)));
        preview.append(el("p","Без комиссий и страхования. Заявка не изменена.","muted"));
        item.append(preview);
      }
      const calculation = message.tools.find(tool=>tool.ok && ["assess_credit","simulate_alternative"].includes(tool.name));
      if(calculation) {
        const preview = el("div",undefined,"proposal"), result = calculation.result;
        preview.append(el("strong",calculation.name === "simulate_alternative" ? "Отдельный вариант" : "Предварительный расчёт"));
        preview.append(el("p","Демонстрационные правила · заявка не изменена","muted"));
        questions(preview,result.issues);
        if(result.assessment) {
          preview.append(el("p",outcomes[result.assessment.outcome] || result.assessment.outcome));
          questions(preview,result.assessment.reasons);questions(preview,result.assessment.required_information);
          for(const offer of (result.assessment.offers || []).slice(0,3)) renderOffer(preview,offer);
        }
        item.append(preview);
      }
    }
    if(message.proposal && message.proposal.status !== "pending") {
      const history=el("details",undefined,"proposal-history");
      history.append(el("summary",{applied:"✓ Данные сохранены",rejected:"Изменения отклонены",superseded:"Черновик обновлён"}[message.proposal.status] || "Данные сообщения"),proposalCard(message.proposal));item.append(history);
    }

    $("messages").append(item);
  }
  const pending = [...chat.messages].reverse().find(message=>message.proposal?.status === "pending");
  $("pending-draft").replaceChildren();
  if(pending && !document.body.classList.contains("cabinet")) $("messages").append(proposalCard(pending.proposal));
  $("messages").scrollTop = $("messages").scrollHeight;
  renderResult();
  if(typeof renderCabinet === "function") renderCabinet();
  if(typeof renderProductWorkspace === "function")renderProductWorkspace();
  controls();
}
function planDate(value) {
  return value ? new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short"}).format(new Date(value+"T12:00:00")) : "Дата не указана";
}
function proposalCard(proposal) {
  const card=el("div",undefined,"proposal"),pending=proposal.status === "pending",plan=proposal.changes["product_details.overdraft"];
  card.append(el("div",pending ? "Проверьте, всё верно?" : "Данные из сообщения","proposal-title"));
  for(const [path,value] of Object.entries(proposal.changes)) {
    if(path === "product_details.overdraft")continue;
    // Способ возврата уже понятен из пары «расход — поступление».
    if(plan && path === "need.financing_pattern" && value === "cash_gap")continue;
    const key=path.split(".")[1],row=el("div",undefined,"change");
    row.append(el("span",(key === "requested_amount" ? "Запрашиваемый кредит" : names[key] || path)+": "),el("strong",display(key,value)));card.append(row);
  }
  if(plan) {
    const list=el("div",undefined,"plan-summary");
    const operation=row=>{
      const line=el("div",undefined,"plan-summary-row "+(row.direction || "unknown"));
      const isDebt=(plan.existing_debt_payments || []).some(ref=>ref.transaction_id === row.transaction_id);
      line.append(el("span",isDebt ? "Платёж по кредиту" : row.direction === "inflow" ? "Поступит" : row.direction === "outflow" ? "Нужно заплатить" : "Уточнить назначение"),el("strong",money(row.amount)),el("time",planDate(row.date)));return line;
    };
    for(const row of plan.transactions.slice(0,4))list.append(operation(row));
    if(plan.transactions.length>4){const more=el("details");more.append(el("summary","Ещё платежей: "+(plan.transactions.length-4)));for(const row of plan.transactions.slice(4))more.append(operation(row));list.append(more);}
    card.append(list,el("p","На счёте сейчас: "+money(data.record.application.financials.cash_balance)+" · данные банка","muted"));
    if(plan.cash_reserve && Number(plan.cash_reserve)>0)card.append(el("p","Оставить в запасе: "+money(plan.cash_reserve),"muted"));
    const saved=data.record.application.product_details?.overdraft;
    if(pending && saved && JSON.stringify(saved.transactions)!==JSON.stringify(plan.transactions))card.append(el("p","После подтверждения этот список заменит сохранённый план.","muted"));
  }
  if(!pending)return card;
  const stale=Boolean(proposal.conflicts?.length);
  let debtReview=null;
  if(plan && (data.record.application.financials.existing_loans || []).some(loan=>Number(loan.outstanding_principal)>0)) {
    debtReview=el("input");debtReview.type="checkbox";debtReview.checked=Boolean(plan.debt_payments_confirmed);debtReview.dataset.lock="";
    const label=el("label",undefined,"inline-check");label.append(debtReview,document.createTextNode(plan.existing_debt_payments?.length ? "Все платежи по действующим кредитам за эти даты учтены" : "В эти даты платежей по действующим кредитам нет"));card.append(label);
  }
  const issues=(proposal.plan_issues || []).filter(issue=>!issue.message.startsWith("Уточните даты платежей по действующим кредитам"));
  for(const message of new Set(issues.map(issue=>issue.message)))card.append(el("p",message,"conflict"));
  if(stale)card.append(el("p","Данные заявки изменились. Откройте правки и проверьте их перед подтверждением.","conflict"));
  const actions=el("div",undefined,"proposal-buttons");
  const confirm=el("button",plan ? "Подтвердить и рассчитать" : "Подтвердить","primary");confirm.dataset.lock="";confirm.dataset.stale=String(stale || Boolean(issues.length));
  confirm.addEventListener("click",()=>resolve(proposal,"confirm",debtReview ? {debt_payments_confirmed:debtReview.checked} : null));
  const edit=el("button","Изменить","quiet");edit.dataset.lock="";edit.addEventListener("click",()=>openProposalEditor(proposal));
  const reject=el("button","Отклонить","quiet");reject.dataset.lock="";reject.addEventListener("click",()=>resolve(proposal,"reject"));
  actions.append(confirm,edit,reject);card.append(actions);
  return card;
}
function checkUnsaved(proposal) {
  if(dirty.has("need"))throw new Error("В форме потребности есть несохранённые правки. Сохраните или отмените их.");
  if(proposal.changes["product_details.overdraft"] && dirty.has("plan"))throw new Error("В форме плана есть несохранённые правки. Сохраните или отмените их.");
}
async function applyProposal(proposal,edit=null) {
  checkUnsaved(proposal);
  if(edit)accept(await api(`/api/chats/${data.chat.chat_id}/proposals/${proposal.proposal_id}/edit`,{base_chat_version:data.chat.chat_version,base_application_version:data.record.application.application_version,...edit}));
  accept(await api(`/api/chats/${data.chat.chat_id}/proposals/${proposal.proposal_id}/confirm`,{base_chat_version:data.chat.chat_version,confirmed:true}));
  show("notice",proposal.changes["product_details.overdraft"] ? "План сохранён. Расчёт появился в вариантах финансирования." : "Данные заявки сохранены.");
}
function resolve(proposal,action,debtReview=null) {run(async()=>{
  if(action === "confirm") {
    const plan=proposal.changes["product_details.overdraft"];
    const review=plan && debtReview && debtReview.debt_payments_confirmed !== plan.debt_payments_confirmed;
    await applyProposal(proposal,review ? {changes:Object.fromEntries(Object.entries(proposal.changes).filter(([path])=>path !== "product_details.overdraft")),overdraft_plan:debtReview} : null);
  } else {accept(await api(`/api/chats/${data.chat.chat_id}/proposals/${proposal.proposal_id}/reject`,{base_chat_version:data.chat.chat_version}));show("notice","Изменения отклонены.");}
});}
function openProposalEditor(proposal) {
  const dialog=$("proposal-editor"),fields=$("proposal-editor-fields"),plan=proposal.changes["product_details.overdraft"],edits={};
  fields.replaceChildren();show("proposal-editor-error","");
  for(const [path,value] of Object.entries(proposal.changes)) {
    if(path === "product_details.overdraft")continue;
    const field=path.split(".")[1],label=el("label",names[field] || field);let input;
    const choices={purpose:["working_capital","investment","refinancing","contract_execution","other"],preferred_product:["working_capital_loan","overdraft"],financing_pattern:["cash_gap","gradual_repayment"],priority:["lowest_payment","lowest_total_cost","preserve_amount"],recurring:["true","false"]}[field];
    if(choices){input=el("select");input.append(new Option("Не указано",""));for(const choice of choices)input.append(new Option(values[choice] || (choice === "true" ? "Да" : choice === "false" ? "Нет" : choice),choice));}
    else{input=el("input");input.type=field === "needed_by" ? "date" : "number";input.step=field === "term_months" ? "1" : "0.01";input.min=field === "own_funds" ? "0" : "0.01";}
    input.value=value??"";input.dataset.lock="";edits[path]=input;label.append(input);
    const remove=el("button","Убрать поле","quiet");remove.type="button";remove.dataset.lock="";remove.onclick=()=>{delete edits[path];label.remove();};label.append(remove);fields.append(label);
    if(proposal.conflicts?.includes(path))label.append(el("p","Поле изменилось в заявке. Проверьте значение.","conflict"));
  }
  const collect=plan ? proposalPlanEditor(fields,plan) : null;
  $("proposal-editor-submit").textContent=plan ? "Подтвердить и рассчитать" : "Подтвердить изменения";
  $("proposal-editor-form").onsubmit=event=>{event.preventDefault();run(async()=>{
    show("proposal-editor-error","");
    try {
      const changes={};for(const [path,input] of Object.entries(edits)){const key=path.split(".")[1];changes[path]=input.value === "" ? null : key === "term_months" ? Number(input.value) : key === "recurring" ? input.value === "true" : input.type === "number" ? Number(input.value).toFixed(2) : input.value;}
      await applyProposal(proposal,{changes,...(collect ? collect() : {})});dialog.close();
    } catch(error){show("proposal-editor-error",error.message);}
  });};
  dialog.showModal();controls();
}
function proposalPlanEditor(parent,plan) {
  const section=el("section",undefined,"proposal-plan-editor"),rows=el("div");
  const loans=(data.record.application.financials.existing_loans || []).filter(loan=>Number(loan.outstanding_principal)>0);
  const references=new Map((plan.existing_debt_payments || []).map(ref=>[ref.transaction_id,ref.loan_id]));
  section.append(el("h3","Предстоящие платежи"),el("p","На счёте сейчас: "+money(data.record.application.financials.cash_balance)+". Лимит рассчитаем после подтверждения.","muted"),rows);
  const confirmed=el("input");confirmed.type="checkbox";confirmed.checked=Boolean(plan.debt_payments_confirmed);confirmed.dataset.lock="";
  function add(source) {
    const row=el("div",undefined,"proposal-operation "+(source.direction || "unknown"));row.dataset.transactionId=source.transaction_id;row.dataset.direction=source.direction || "";row.dataset.loanId=source.loan_id || references.get(source.transaction_id) || "";
    const heading=el("strong",row.dataset.loanId ? "Платёж по кредиту" : source.direction === "inflow" ? "Деньги поступят" : source.direction === "outflow" ? "Нужно заплатить" : "Выберите назначение");row.append(heading);
    // Селектор нужен только когда назначение действительно ещё неизвестно.
    if(!source.direction){const choice=el("select");choice.required=true;choice.append(new Option("Уточнить",""),new Option("Нужно заплатить","outflow"),new Option("Деньги поступят","inflow"));choice.onchange=()=>{row.dataset.direction=choice.value;};row.append(choice);}
    for(const [key,title,type]of [["amount","Сумма, ₽","number"],["date","Дата","date"]]) {
      const input=el("input");input.type=type;input.value=source[key]??"";input.dataset.field=key;input.dataset.lock="";input.required=true;
      if(type === "number"){input.min="0.01";input.max="999999999999.99";input.step="0.01";}
      const label=el("label",title);label.append(input);row.append(label);
    }
    const remove=el("button","Убрать","quiet");remove.type="button";remove.dataset.lock="";remove.onclick=()=>{row.remove();confirmed.checked=false;};row.append(remove);rows.append(row);return row;
  }
  for(const source of plan.transactions)add(source);
  const actions=el("div",undefined,"plan-add-actions");
  for(const [direction,title]of [["outflow","+ Расход"],["inflow","+ Поступление"]]){const button=el("button",title,"quiet");button.type="button";button.dataset.lock="";button.onclick=()=>{const row=add({transaction_id:crypto.randomUUID(),direction});confirmed.checked=false;row.querySelector("input").focus();};actions.append(button);}section.append(actions);
  if(loans.length){const debts=el("details");debts.append(el("summary","Добавить платёж по действующему кредиту"));loans.forEach((loan,index)=>{const button=el("button","Кредит "+(index+1)+" · "+money(loan.monthly_payment),"quiet");button.type="button";button.dataset.lock="";button.onclick=()=>{const row=add({transaction_id:crypto.randomUUID(),direction:"outflow",amount:loan.monthly_payment,loan_id:loan.loan_id});confirmed.checked=false;row.querySelector('[data-field="date"]').focus();};debts.append(button);});section.append(debts);const label=el("label",undefined,"inline-check");label.append(confirmed,document.createTextNode("Все кредитные платежи за эти даты учтены. Если их нет, подтверждаю отсутствие."));section.append(label);}
  rows.addEventListener("input",()=>{confirmed.checked=false;});parent.append(section);
  return ()=>({overdraft_plan:{mode:"replace",cash_reserve:plan.cash_reserve || "0.00",transactions:[...rows.children].map(row=>({transaction_id:row.dataset.transactionId,direction:row.dataset.direction || null,amount:Number(row.querySelector('[data-field="amount"]').value).toFixed(2),date:row.querySelector('[data-field="date"]').value,loan_id:row.dataset.loanId || null})),debt_payments_confirmed:!loans.length || confirmed.checked}});
}

function renderOffer(parent, offer, conditionsCompleted=false) {
  const card = el("div",undefined,"offer");
  card.append(el("strong",(values[offer.product_id] || "Предложение") + " · " + money(offer.amount)));
  if(offer.term_months) card.append(el("p",offer.term_months + " мес. · платёж " + money(offer.monthly_payment)));
  if(offer.annual_rate_percent) card.append(el("p","Ставка " + offer.annual_rate_percent + "% годовых"));
  if(offer.total_repayment) card.append(el("p","Всего выплат: " + money(offer.total_repayment)));
  if(offer.scenario_cost) card.append(el("p","Проценты по плану: " + money(offer.scenario_cost.total_interest)));
  for(const condition of offer.conditions || []) card.append(el("p",conditionsCompleted ? (condition.code === "guarantee_required" ? "✓ Поручительство оформлено" : "✓ Условие выполнено: "+condition.message) : condition.message));
  parent.append(card);
}
function questions(parent, list) { for(const item of list || []) {const row=el("p",item.question || item.message || String(item));if(item.field && typeof focusField === "function"){const action=el("button","Заполнить","quiet");action.type="button";action.addEventListener("click",()=>focusField(item.field));row.append(document.createTextNode(" "),action);}parent.append(row);} }
function renderResult() {
  const box = $("result"), record = data.record; box.replaceChildren();
  const recommendation = record.recommendation;
  const exploration=record.explorations.at(-1);
  if(exploration?.application_version === record.application.application_version && exploration.result.options?.length && !record.result){box.hidden=true;return;}
  if(recommendation) {
    box.append(el("h3",recommendation.recommended_product_id ? "Подходит: " + values[recommendation.recommended_product_id] : "Подбор финансирования"));
    questions(box,recommendation.required_information); questions(box,recommendation.reasons); questions(box,recommendation.issues);
    for(const candidate of recommendation.candidates || []) {
      if(candidate.offers?.length) box.append(el("p",values[candidate.product_id] || candidate.product_id,"muted"));
      for(const offer of candidate.offers || []) renderOffer(box,offer);
    }
    if(recommendation.recommended_product_id) box.append(el("p","Выберите продукт в форме и сохраните. Предварительный подбор не отправляет заявку.","muted"));
  }
  const result = record.result;
  $("result").hidden = !recommendation && result?.assessment?.stage === "final";
  if(result && result.assessment?.stage !== "final") {
    const assessment = result.assessment;
    box.append(el("h3",assessment ? outcomes[assessment.outcome] || assessment.outcome : "Оценка: " + result.status));
    questions(box,result.issues);
    if(assessment) { questions(box,assessment.reasons);questions(box,assessment.required_information);for(const offer of assessment.offers || []) renderOffer(box,offer); }
  }
  if(!result && !recommendation) box.append(el("p","Здесь появятся предложения и вопросы после расчёта.","muted"));
}
for(const id of ["proposal-editor-close","proposal-editor-cancel"])$(id).addEventListener("click",()=>$("proposal-editor").close());
$("message-form").addEventListener("submit",event=>{event.preventDefault();send();});
$("message").addEventListener("keydown",event=>{if(event.key === "Enter" && !event.shiftKey && !event.isComposing){event.preventDefault();if(!busy)send();}});
function send() {
  const text = $("message").value.trim(); if(!text || !data || busy || thinking) return;
  if(!retry || retry.text !== text || retry.chat_id !== data.chat.chat_id) retry = {text,chat_id:data.chat.chat_id,request_id:crypto.randomUUID()};
  run(async()=>{
    const sendingChat=data.chat.chat_id;
    const pending = el("article",undefined,"message user");
    pending.append(el("div","Вы · отправляется","message-label"),el("div",text,"bubble"));
    $("messages").append(pending);$("messages").scrollTop=$("messages").scrollHeight;
    const response=await api(`/api/chats/${sendingChat}/messages`,{base_chat_version:data.chat.chat_version,text,request_id:retry.request_id});
    if(data.chat.chat_id === sendingChat)accept(response);
    $("message").value = "";retry=null;
  },true);
}
document.querySelectorAll("[data-example]").forEach(button=>button.addEventListener("click",()=>{$("message").value=button.dataset.example;send();}));
$("new-chat").addEventListener("click",()=>run(async()=>{accept(await api("/api/chats",{application_id:data.chat.application_id}));$("message").value="";retry=null;show("notice","Создан новый диалог. Данные заявки сохранены.");}));
$("load-scenario").addEventListener("click",()=>run(async()=>{
  const scenario = location.pathname === "/chat" ? $("scenario").value : "";
  const record = await api(scenario ? "/api/demo/scenarios/" + scenario : "/api/applications",{});
  accept(await api("/api/chats",{application_id:record.application.application_id}));$("message").value="";retry=null;
}));
$("scenario").addEventListener("change",()=>{$("load-scenario").textContent=$("scenario").value ? "Загрузить пример" : "Новая заявка";});
function needFormChanges() {
  return {"need.purpose":$("purpose").value || null,"need.preferred_product":$("product").value || null,"need.financing_pattern":$("pattern").value || null,
    "need.requested_amount":$("amount").value ? Number($("amount").value).toFixed(2) : null,"need.term_months":$("term").value ? Number($("term").value) : null,
    "need.minimum_acceptable_amount":$("minimum-amount").value ? Number($("minimum-amount").value).toFixed(2) : null,
    "need.own_funds":$("own-funds").value ? Number($("own-funds").value).toFixed(2) : null,
    "need.needed_by":$("needed-by").value || null,"need.recurring":$("recurring").value === "" ? null : $("recurring").value === "true"};
}
$("need-form").addEventListener("submit",event=>{event.preventDefault();run(async()=>{
  if(typeof workspacePending === "function" && workspacePending()){await saveWorkspaceScenario();return;}
  const changes=needFormChanges();
  await api("/api/applications/" + data.chat.application_id,{base_application_version:data.record.application.application_version,changes},"PATCH");
  dirty.delete("need");
  accept(await api("/api/chats/" + data.chat.chat_id,undefined,"GET"));
  if(typeof continueWorkspaceManual === "function"){await continueWorkspaceManual();return;}
  show("notice","Данные сохранены. Ассистент увидит их в следующем сообщении.");
});});
$("need-form").addEventListener("input",()=>dirty.add("need"));
for(const [id,action] of [["recommend","recommendations"],["preview","preview"]]) $(id).addEventListener("click",()=>run(async()=>{
  if(typeof requireSaved === "function") requireSaved();
  const record=await api(`/api/applications/${data.chat.application_id}/${action}`,{base_application_version:data.record.application.application_version});
  if(id === "recommend" && !["check_retry_pending","needs_checks","invalid_data"].includes(record.recommendation.status)){
    const need=record.application.need,product=record.recommendation.recommended_product_id || (need.financing_pattern === "gradual_repayment" ? "working_capital_loan" : need.financing_pattern === "cash_gap" ? "overdraft" : need.preferred_product);
    if(product && need.purpose === "working_capital")await api(`/api/applications/${data.chat.application_id}/explorations`,{base_application_version:record.application.application_version,product_id:product});
  }
  accept(await api("/api/chats/" + data.chat.chat_id,undefined,"GET"));show("notice","Расчёт обновлён. Он доступен ассистенту в следующем сообщении.");
}));
async function initializeChat() {
  if(typeof initializeWorkspaceSession === "function" && customerWorkspace){await initializeWorkspaceSession();return;}
  const requested = new URLSearchParams(location.search).get("chat");
  const chatId = requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : stored();
  if(chatId) { try {accept(await api("/api/chats/" + encodeURIComponent(chatId),undefined,"GET"));return;} catch {} }
  accept(await api("/api/chats",{}));
}
document.addEventListener("DOMContentLoaded",()=>run(initializeChat),{once:true});
