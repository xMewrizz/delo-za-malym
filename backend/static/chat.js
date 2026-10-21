"use strict";
const $ = id => document.getElementById(id);
const names = {purpose:"Цель",preferred_product:"Продукт",requested_amount:"Сумма",term_months:"Срок",financing_pattern:"Возврат",own_funds:"Свои средства",minimum_acceptable_amount:"Минимальная сумма",needed_by:"Дата",recurring:"Регулярность",priority:"Приоритет"};
const values = {working_capital:"Оборотные расходы",investment:"Развитие",refinancing:"Рефинансирование",contract_execution:"Контракт",other:"Другая цель",working_capital_loan:"Разовый кредит",overdraft:"Овердрафт",cash_gap:"После конкретного поступления",gradual_repayment:"Постепенно из выручки",lowest_payment:"Меньший платёж",lowest_total_cost:"Меньшая переплата",preserve_amount:"Сохранить сумму"};
const states = {draft:"Черновик",offers_ready:"Предложения готовы",waiting_for_data:"Нужны сведения",check_retry_pending:"Повтор проверки",disbursed:"Кредит выдан",limit_opened:"Лимит открыт",declined:"Отказ",out_of_policy:"Вне правил",conditions_pending:"Нужны условия",ready_to_sign:"К подписанию"};
const outcomes = {approved:"Исходный запрос проходит",alternative_offers:"Предлагаются другие условия",conditional_approval:"Нужны дополнительные условия",needs_information:"Нужно уточнение",declined:"Отказ",out_of_policy:"Нужен отдельный разбор"};
const editable = new Set(["draft","waiting_for_data","check_retry_pending","offers_ready","conditions_pending","ready_to_sign","offer_expired","declined","out_of_policy"]);
let data = null, busy = false, thinking = false, retry = null;
const dirty = new Set();
function el(tag, text, cls) { const node = document.createElement(tag); if(text !== undefined) node.textContent = text; if(cls) node.className = cls; return node; }
function money(value) { return value == null ? "Неизвестно" : Number(value).toLocaleString("ru-RU", {maximumFractionDigits:2}) + " ₽"; }
function display(key, value) { if(value == null) return "Не указано"; if(["requested_amount","own_funds","minimum_acceptable_amount"].includes(key)) return money(value); if(key === "term_months") return value + " мес."; if(typeof value === "boolean") return value ? "Да" : "Нет"; return values[value] || String(value); }
function show(id, message) { $(id).textContent = message; $(id).hidden = !message; }
function stored(id) { try { if(id) localStorage.setItem("delo-chat-id",id); else return localStorage.getItem("delo-chat-id"); } catch {} }
function controls() {
  document.querySelectorAll("[data-lock]").forEach(node => { const chatControl=node.closest(".conversation");node.disabled = busy || !data || (thinking && (chatControl || ["saved-applications","open-application","scenario","load-scenario"].includes(node.id))); });
  document.querySelectorAll('[data-stale="true"]').forEach(button=>{button.disabled=true;});
  $("waiting").hidden = !thinking;
  if(data) {
    $("need-fields").disabled = busy || !editable.has(data.record.state.status);
    $("recommend").disabled = busy || !editable.has(data.record.state.status);
    $("preview").disabled = busy || data.record.state.status !== "draft";
    for(const id of ["finance-fields","plan-fields","option-fields"]) if($(id)) $(id).disabled = busy || !editable.has(data.record.state.status);
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
  if(busy || (generating && thinking)) return;
  if(generating)thinking=true;else busy=true;
  show("error",""); show("notice",""); controls();
  try { await action(); }
  catch(error) {
    show("error", error.name === "TimeoutError" ? "Ответ задержался. Повторите сообщение: оно не задублируется в истории." : error.message || "Нет соединения с сервером.");
    if(data) { try { accept(await api("/api/chats/" + data.chat.chat_id,undefined,"GET")); } catch {} }
  }
  finally { if(generating)thinking=false;else busy=false;controls(); }
}
function accept(next) {
  if(data && data.chat.application_id !== next.chat.application_id)dirty.clear();
  else if(data){if(next.record.application.application_version < data.record.application.application_version || (next.record.application.application_version === data.record.application.application_version && next.record.events.length < data.record.events.length))next.record=data.record;if(next.chat.chat_id === data.chat.chat_id && next.chat.chat_version < data.chat.chat_version)next.chat=data.chat;}
  data=next;stored(data.chat.chat_id);render();
}
function render() {
  const {chat,record,assistant} = data, need = record.application.need;
  $("mode").textContent = assistant.mode === "demo" ? "Демонстрационный режим" : assistant.model;
  $("mode").className = "badge " + assistant.mode;
  $("demo-note").hidden = assistant.mode !== "demo"; $("examples").hidden = assistant.mode !== "demo";
  $("chat-info").textContent = "Диалог " + chat.chat_id.slice(0,8) + " · " + chat.messages.filter(m=>m.role === "user").length + "/40 сообщений";
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
    if(question && question.toLowerCase() !== "null" && !message.text.includes(question)) item.append(el("p",question,"muted"));
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
    if(message.proposal && message.proposal.status !== "pending") item.append(proposalCard(message.proposal));

    $("messages").append(item);
  }
  $("messages").scrollTop = $("messages").scrollHeight;
  const pending = [...chat.messages].reverse().find(message=>message.proposal?.status === "pending");
  $("pending-draft").replaceChildren();
  if(pending) $("pending-draft").append(proposalCard(pending.proposal));
  renderResult();
  if(typeof renderCabinet === "function") renderCabinet();
  controls();
}
function proposalCard(proposal) {
  const card = el("div",undefined,"proposal"); card.append(el("div",proposal.status === "pending" ? "Собранные данные — проверьте и подтвердите" : "Предлагаемые изменения","proposal-title"));
  if(proposal.status !== "pending") for(const [path,value] of Object.entries(proposal.changes)) {
    const key = path.split(".")[1], row = el("div",undefined,"change");
    row.append(el("span",(names[key] || path) + ": "),el("strong",display(key,value))); card.append(row);
  }
  const stale = Boolean(proposal.conflicts?.length);
  if(proposal.status === "pending") {
    const edits = {};
    for(const [path,value] of Object.entries(proposal.changes)) {
      const field = path.split(".")[1], wrapper = el("label",names[field] || field);
      let input;
      if(["purpose","preferred_product","financing_pattern","priority","recurring"].includes(field)) {
        input = el("select");input.append(new Option("Не указано",""));
        const choices = {purpose:["working_capital","investment","refinancing","contract_execution","other"],preferred_product:["working_capital_loan","overdraft"],financing_pattern:["cash_gap","gradual_repayment"],priority:["lowest_payment","lowest_total_cost","preserve_amount"],recurring:["true","false"]}[field];
        for(const choice of choices) input.append(new Option(values[choice] || (choice === "true" ? "Да" : choice === "false" ? "Нет" : choice),choice));
      } else {input=el("input");input.type=field === "needed_by" ? "date" : "number";input.step=field === "term_months" ? "1" : "0.01";input.min=field === "own_funds" ? "0" : "0.01";}
      input.value=value == null ? "" : String(value);input.dataset.lock="";edits[path]=input;
      const remove=el("button","Убрать поле","quiet");remove.type="button";remove.dataset.lock="";remove.addEventListener("click",()=>{delete edits[path];wrapper.remove();});
      wrapper.append(input,remove);if(proposal.conflicts?.includes(path)) wrapper.append(el("p","Это поле изменено в форме. Проверьте новое значение перед сохранением правок.","conflict"));card.append(wrapper);
    }
    const save=el("button","Сохранить правки черновика","secondary");save.dataset.lock="";save.addEventListener("click",()=>run(async()=>{
      const changes={};for(const [path,input] of Object.entries(edits)){const key=path.split(".")[1];changes[path]=input.value === "" ? null : key === "term_months" ? Number(input.value) : key === "recurring" ? input.value === "true" : input.type === "number" ? Number(input.value).toFixed(2) : input.value;}
      accept(await api(`/api/chats/${data.chat.chat_id}/proposals/${proposal.proposal_id}/edit`,{base_chat_version:data.chat.chat_version,base_application_version:data.record.application.application_version,changes}));
    }));card.append(save);
    const buttons = el("div",undefined,"proposal-buttons");
    const confirm = el("button","Подтвердить","primary"); confirm.dataset.lock = ""; confirm.disabled = busy || stale;
    const reject = el("button","Не применять","quiet"); reject.dataset.lock = "";
    // Устаревшее предложение можно отклонить, но нельзя подтвердить для новой версии.
    confirm.dataset.stale = String(stale);
    confirm.addEventListener("click",()=>resolve(proposal,"confirm")); reject.addEventListener("click",()=>resolve(proposal,"reject"));
    buttons.append(confirm,reject);card.append(buttons);
    if(stale) card.append(el("p","Сохраните проверенные правки черновика, чтобы разрешить конфликт.","muted"));
  } else card.append(el("div",{applied:"✓ Данные сохранены",rejected:"Изменения отклонены",superseded:"Заменено следующим ответом"}[proposal.status] || proposal.status,"proposal-status"));
  return card;
}
function resolve(proposal, action) { run(async()=>{
  if(action === "confirm" && dirty.has("need")) throw new Error("В форме потребности есть несохранённые правки. Сохраните или отмените их перед подтверждением черновика чата.");
  accept(await api(`/api/chats/${data.chat.chat_id}/proposals/${proposal.proposal_id}/${action}`,{base_chat_version:data.chat.chat_version,...(action === "confirm" ? {confirmed:true} : {})}));
  show("notice",action === "confirm" ? "Изменения подтверждены и сохранены в заявке." : "Изменения отклонены.");
}); }
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
$("message-form").addEventListener("submit",event=>{event.preventDefault();send();});
$("message").addEventListener("keydown",event=>{if(event.key === "Enter" && !event.shiftKey && !event.isComposing){event.preventDefault();if(!busy)send();}});
function send() {
  const text = $("message").value.trim(); if(!text || !data || busy || thinking) return;
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
  const changes=needFormChanges();
  await api("/api/applications/" + data.chat.application_id,{base_application_version:data.record.application.application_version,changes},"PATCH");
  dirty.delete("need");
  accept(await api("/api/chats/" + data.chat.chat_id,undefined,"GET"));show("notice","Данные сохранены. Ассистент увидит их в следующем сообщении.");
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
run(async()=>{
  const requested = new URLSearchParams(location.search).get("chat");
  const chatId = requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : stored();
  if(chatId) { try {accept(await api("/api/chats/" + encodeURIComponent(chatId),undefined,"GET"));return;} catch {} }
  accept(await api("/api/chats",{}));
});
