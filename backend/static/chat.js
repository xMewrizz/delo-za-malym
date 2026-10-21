"use strict";
const $ = id => document.getElementById(id);
const names = {purpose:"Цель",preferred_product:"Продукт",requested_amount:"Сумма",term_months:"Срок",financing_pattern:"Возврат",own_funds:"Свои средства",minimum_acceptable_amount:"Минимальная сумма",needed_by:"Дата",recurring:"Регулярность",priority:"Приоритет"};
const values = {working_capital:"Оборотные расходы",investment:"Развитие",refinancing:"Рефинансирование",contract_execution:"Контракт",other:"Другая цель",working_capital_loan:"Разовый кредит",overdraft:"Овердрафт",cash_gap:"После конкретного поступления",gradual_repayment:"Постепенно из выручки",lowest_payment:"Меньший платёж",lowest_total_cost:"Меньшая переплата",preserve_amount:"Сохранить сумму"};
const states = {draft:"Черновик",offers_ready:"Предложения готовы",waiting_for_data:"Нужны сведения",check_retry_pending:"Повтор проверки",disbursed:"Кредит выдан",limit_opened:"Лимит открыт",declined:"Отказ",out_of_policy:"Вне правил",conditions_pending:"Нужны условия",ready_to_sign:"К подписанию"};
const outcomes = {approved:"Исходный запрос проходит",alternative_offers:"Предлагаются другие условия",conditional_approval:"Нужны дополнительные условия",needs_information:"Нужно уточнение",declined:"Отказ",out_of_policy:"Нужен отдельный разбор"};
const editable = new Set(["draft","waiting_for_data","check_retry_pending","offers_ready","conditions_pending","ready_to_sign","offer_expired","declined","out_of_policy"]);
let data = null, busy = false, thinking = false, retry = null;
function el(tag, text, cls) { const node = document.createElement(tag); if(text !== undefined) node.textContent = text; if(cls) node.className = cls; return node; }
function money(value) { return value == null ? "Неизвестно" : Number(value).toLocaleString("ru-RU", {maximumFractionDigits:2}) + " ₽"; }
function display(key, value) { if(value == null) return "Не указано"; if(["requested_amount","own_funds","minimum_acceptable_amount"].includes(key)) return money(value); if(key === "term_months") return value + " мес."; if(typeof value === "boolean") return value ? "Да" : "Нет"; return values[value] || String(value); }
function show(id, message) { $(id).textContent = message; $(id).hidden = !message; }
function stored(id) { try { if(id) localStorage.setItem("delo-chat-id",id); else return localStorage.getItem("delo-chat-id"); } catch {} }
function controls() {
  document.querySelectorAll("[data-lock]").forEach(node => { node.disabled = busy || !data; });
  document.querySelectorAll('[data-stale="true"]').forEach(button=>{button.disabled=true;});
  $("waiting").hidden = !(busy && thinking);
  if(data) {
    $("need-fields").disabled = busy || !editable.has(data.record.state.status);
    $("recommend").disabled = busy || !editable.has(data.record.state.status);
    $("preview").disabled = busy || data.record.state.status !== "draft";
  }
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
  if(busy) return;
  busy = true; thinking = generating; show("error",""); show("notice",""); controls();
  try { await action(); }
  catch(error) {
    show("error", error.name === "TimeoutError" ? "Ответ задержался. Повторите сообщение: оно не задублируется в истории." : error.message || "Нет соединения с сервером.");
    if(data) { try { accept(await api("/api/chats/" + data.chat.chat_id,undefined,"GET")); } catch {} }
  }
  finally { busy = false; thinking = false; controls(); }
}
function accept(next) { data = next; stored(data.chat.chat_id); render(); }
function render() {
  const {chat,record,assistant} = data, need = record.application.need;
  $("mode").textContent = assistant.mode === "demo" ? "Демонстрационный режим" : assistant.model;
  $("mode").className = "badge " + assistant.mode;
  $("demo-note").hidden = assistant.mode !== "demo"; $("examples").hidden = assistant.mode !== "demo";
  $("chat-info").textContent = "Диалог " + chat.chat_id.slice(0,8) + " · " + chat.messages.filter(m=>m.role === "user").length + "/40 сообщений";
  $("application-info").textContent = "Заявка " + chat.application_id.slice(0,8) + " · версия " + record.application.application_version;
  $("state").textContent = states[record.state.status] || record.state.status;
  for(const [id,key] of [["purpose","purpose"],["amount","requested_amount"],["term","term_months"],["product","preferred_product"],["pattern","financing_pattern"]]) $(id).value = need[key] ?? "";
  $("context").textContent = JSON.stringify({application:record.application,state:record.state,result:record.result,recommendation:record.recommendation},null,2);
  const last = [...chat.messages].reverse().find(m=>m.role === "assistant");
  $("reply-json").textContent = last ? JSON.stringify({intent:last.intent,text:last.text,question:last.question,proposal:last.proposal},null,2) : "Пока нет ответа";
  $("messages").replaceChildren();
  if(!chat.messages.length) {
    const empty = el("div",undefined,"empty"); empty.append(el("div","✳","empty-icon"), el("p","Расскажите, для какой задачи вам нужно финансирование. Или начните с примера ниже.")); $("messages").append(empty);
  }
  for(const message of chat.messages) {
    const item = el("article",undefined,"message " + message.role);
    item.append(el("div",message.role === "user" ? "Вы" : "Ассистент" + (message.mode === "demo" ? " · демо" : ""),"message-label"),el("div",message.text,"bubble"));
    if(message.question && !message.text.includes(message.question)) item.append(el("p",message.question,"muted"));
    if(message.proposal) item.append(proposalCard(message.proposal));
    $("messages").append(item);
  }
  $("messages").scrollTop = $("messages").scrollHeight;
  renderResult(); controls();
}
function proposalCard(proposal) {
  const card = el("div",undefined,"proposal"); card.append(el("div","Предлагаемые изменения","proposal-title"));
  for(const [path,value] of Object.entries(proposal.changes)) {
    const key = path.split(".")[1], row = el("div",undefined,"change");
    row.append(el("span",(names[key] || path) + ": "),el("strong",display(key,value))); card.append(row);
  }
  const stale = proposal.base_application_version !== data.record.application.application_version;
  if(proposal.status === "pending") {
    const buttons = el("div",undefined,"proposal-buttons");
    const confirm = el("button","Подтвердить","primary"); confirm.dataset.lock = ""; confirm.disabled = busy || stale;
    const reject = el("button","Не применять","quiet"); reject.dataset.lock = "";
    // Устаревшее предложение можно отклонить, но нельзя подтвердить для новой версии.
    confirm.dataset.stale = String(stale);
    confirm.addEventListener("click",()=>resolve(proposal,"confirm")); reject.addEventListener("click",()=>resolve(proposal,"reject"));
    buttons.append(confirm,reject);card.append(buttons);
    if(stale) card.append(el("p","Заявка уже изменилась. Обсудите изменения заново.","muted"));
  } else card.append(el("div",{applied:"✓ Данные сохранены",rejected:"Изменения отклонены",superseded:"Заменено следующим ответом"}[proposal.status] || proposal.status,"proposal-status"));
  return card;
}
function resolve(proposal, action) { run(async()=>{
  accept(await api(`/api/chats/${data.chat.chat_id}/proposals/${proposal.proposal_id}/${action}`,{base_chat_version:data.chat.chat_version,...(action === "confirm" ? {confirmed:true} : {})}));
  show("notice",action === "confirm" ? "Изменения подтверждены и сохранены в заявке." : "Изменения отклонены.");
}); }
function renderOffer(parent, offer) {
  const card = el("div",undefined,"offer");
  card.append(el("strong",(values[offer.product_id] || "Предложение") + " · " + money(offer.amount)));
  if(offer.term_months) card.append(el("p",offer.term_months + " мес. · платёж " + money(offer.monthly_payment)));
  if(offer.annual_rate_percent) card.append(el("p","Ставка " + offer.annual_rate_percent + "% годовых"));
  if(offer.total_repayment) card.append(el("p","Всего выплат: " + money(offer.total_repayment)));
  if(offer.scenario_cost) card.append(el("p","Проценты по плану: " + money(offer.scenario_cost.total_interest)));
  for(const condition of offer.conditions || []) card.append(el("p",condition.message));
  parent.append(card);
}
function questions(parent, list) { for(const item of list || []) parent.append(el("p",item.question || item.message || String(item))); }
function renderResult() {
  const box = $("result"), record = data.record; box.replaceChildren();
  const recommendation = record.recommendation;
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
  if(result) {
    const assessment = result.assessment;
    box.append(el("h3",assessment ? outcomes[assessment.outcome] || assessment.outcome : "Оценка: " + result.status));
    questions(box,result.issues);
    if(assessment) { questions(box,assessment.reasons);questions(box,assessment.required_information);for(const offer of assessment.offers || []) renderOffer(box,offer); }
  }
  if(!result && !recommendation) box.append(el("p","Здесь появятся предложения и вопросы после расчёта.","muted"));
}
$("message-form").addEventListener("submit",event=>{event.preventDefault();send();});
$("message").addEventListener("keydown",event=>{if(event.key === "Enter" && !event.shiftKey && !event.isComposing){event.preventDefault();if(!busy)send();}});
function send() {
  const text = $("message").value.trim(); if(!text || !data) return;
  if(!retry || retry.text !== text || retry.chat_id !== data.chat.chat_id) retry = {text,chat_id:data.chat.chat_id,request_id:crypto.randomUUID()};
  run(async()=>{
    const pending = el("article",undefined,"message user");
    pending.append(el("div","Вы · отправляется","message-label"),el("div",text,"bubble"));
    $("messages").append(pending);$("messages").scrollTop=$("messages").scrollHeight;
    accept(await api(`/api/chats/${data.chat.chat_id}/messages`,{base_chat_version:data.chat.chat_version,text,request_id:retry.request_id}));
    $("message").value = "";retry=null;
  },true);
}
document.querySelectorAll("[data-example]").forEach(button=>button.addEventListener("click",()=>{$("message").value=button.dataset.example;send();}));
$("new-chat").addEventListener("click",()=>run(async()=>{accept(await api("/api/chats",{application_id:data.chat.application_id}));$("message").value="";retry=null;show("notice","Создан новый диалог. Данные заявки сохранены.");}));
$("load-scenario").addEventListener("click",()=>run(async()=>{
  const scenario = $("scenario").value;
  const record = await api(scenario ? "/api/demo/scenarios/" + scenario : "/api/applications",{});
  accept(await api("/api/chats",{application_id:record.application.application_id}));$("message").value="";retry=null;
}));
$("need-form").addEventListener("submit",event=>{event.preventDefault();run(async()=>{
  const changes = {"need.purpose":$("purpose").value || null,"need.preferred_product":$("product").value || null,"need.financing_pattern":$("pattern").value || null,
    "need.requested_amount":$("amount").value ? Number($("amount").value).toFixed(2) : null,"need.term_months":$("term").value ? Number($("term").value) : null};
  await api("/api/applications/" + data.chat.application_id,{base_application_version:data.record.application.application_version,changes},"PATCH");
  accept(await api("/api/chats/" + data.chat.chat_id,undefined,"GET"));show("notice","Данные сохранены. Ассистент увидит их в следующем сообщении.");
});});
for(const [id,action] of [["recommend","recommendations"],["preview","preview"]]) $(id).addEventListener("click",()=>run(async()=>{
  await api(`/api/applications/${data.chat.application_id}/${action}`,{base_application_version:data.record.application.application_version});
  accept(await api("/api/chats/" + data.chat.chat_id,undefined,"GET"));show("notice","Расчёт обновлён. Он доступен ассистенту в следующем сообщении.");
}));
run(async()=>{
  const chatId = stored();
  if(chatId) { try {accept(await api("/api/chats/" + encodeURIComponent(chatId),undefined,"GET"));return;} catch {} }
  accept(await api("/api/chats",{}));
});
