"use strict";

// Общие компоненты расчётов, независимые черновики двух способов подбора.
const customerWorkspace=location.pathname === "/cabinet";
const needInputs={purpose:"purpose",requested_amount:"amount",term_months:"term",preferred_product:"product",financing_pattern:"pattern",minimum_acceptable_amount:"minimum-amount",own_funds:"own-funds",needed_by:"needed-by",recurring:"recurring"};
let workspaceView="manual",manualStep="need",workspaceApplication=null,workspacePreview=null,previewKey="",previewLoading=false,previewError="",previewRequest=0;
let shownProposal="",shownValues={},showAllNeed=false,saveTimer=null,workspaceApplications=[];
let activeWorkspaceContext=null,workspaceSwitching=false,restoredFormChat=null;
let clarificationRetry=null,clarificationDraft=null,clarificationError="";
let workspaceContexts={};
try{workspaceContexts=JSON.parse(localStorage.getItem("delo-workspace-contexts") || "{}");if(!workspaceContexts || Array.isArray(workspaceContexts) || typeof workspaceContexts !== "object")workspaceContexts={};}catch{}

function saveWorkspaceContexts(){try{localStorage.setItem("delo-workspace-contexts",JSON.stringify(workspaceContexts));}catch{}}
function rememberWorkspaceContext(next) {
  if(!customerWorkspace || !activeWorkspaceContext || workspaceView === "applications")return;
  workspaceContexts[activeWorkspaceContext]={...workspaceContexts[activeWorkspaceContext],chat_id:next.chat.chat_id};saveWorkspaceContexts();
}
async function initializeWorkspaceSession() {
  // Старый единый диалог переносится только в один подходящий раздел.
  if(!workspaceContexts.manual?.chat_id && !workspaceContexts.assistant?.chat_id && stored()){
    try{const previous=await api("/api/chats/"+encodeURIComponent(stored()),undefined,"GET");const owner=previous.chat.messages.length ? "assistant" : "manual";workspaceContexts[owner]={chat_id:previous.chat.chat_id};saveWorkspaceContexts();}catch{}
  }
  await openWorkspaceContext(workspaceView === "applications" ? "manual" : workspaceView);
}
async function openWorkspaceContext(view) {
  workspaceSwitching=true;clearTimeout(saveTimer);restoredFormChat=null;updateWorkspaceStatus();
  try{
    let next=null;const id=workspaceContexts[view]?.chat_id;
    if(id && /^[0-9a-f-]{36}$/i.test(id)){try{next=await api("/api/chats/"+id,undefined,"GET");}catch(error){if(!error.message.includes("404") && !error.message.includes("не найден"))throw error;}}
    if(!next)next=await api("/api/chats",{});
    activeWorkspaceContext=view;
    workspaceContexts[view]={...workspaceContexts[view],chat_id:next.chat.chat_id};saveWorkspaceContexts();
    dirty.clear();accept(next);
    manualStep=workspaceContexts.manual?.step || "need";
  }finally{workspaceSwitching=false;renderProductWorkspace();controls();}
}
function persistWorkspaceForm() {
  if(!customerWorkspace || !data || !activeWorkspaceContext || workspaceView === "applications")return;
  const key="delo-form-"+data.chat.chat_id;
  try{
    const draft={};
    if(dirty.has("need"))draft.need=Object.fromEntries(Object.entries(needInputs).map(([field,id])=>[id,$(id).value]));
    if(dirty.has("plan"))draft.plan={settings:Object.fromEntries(["plan-start","plan-end","plan-cash","plan-reserve"].map(id=>[id,$(id).value])),automatic:$("plan-auto-period").checked,confirmed:$("debt-plan-confirmed").checked,rows:[...$("transactions").children].map(row=>({transaction_id:row.dataset.transactionId,direction:row.dataset.direction || null,loan_id:row.dataset.loanId,amount:row.querySelector('[data-field="amount"]').value,date:row.querySelector('[data-field="date"]').value}))};
    if(Object.keys(draft).length)localStorage.setItem(key,JSON.stringify(draft));else localStorage.removeItem(key);
  }catch{}
}
function restoreWorkspaceForm() {
  if(restoredFormChat === data.chat.chat_id || workspaceView === "applications")return;
  restoredFormChat=data.chat.chat_id;
  try{const draft=JSON.parse(localStorage.getItem("delo-form-"+data.chat.chat_id) || "null");if(!draft)return;
    if(draft.need){for(const [id,value]of Object.entries(draft.need))if(Object.values(needInputs).includes(id))$(id).value=value;dirty.add("need");}
    if(draft.plan){$("transactions").replaceChildren();for(const row of draft.plan.rows)addTransaction(row,row.loan_id,false);for(const [id,value]of Object.entries(draft.plan.settings))if(["plan-start","plan-end","plan-cash","plan-reserve"].includes(id))$(id).value=value;$("plan-auto-period").checked=draft.plan.automatic;$("debt-plan-confirmed").checked=draft.plan.confirmed;dirty.add("plan");syncPlanDetails();}
  }catch{}
}

function workspacePending() {
  if(!customerWorkspace || !data)return null;
  return [...data.chat.messages].reverse().find(message=>message.proposal?.status === "pending")?.proposal || null;
}
function workspaceButton(text,action,cls="quiet") {return button(text,action,cls);}
function initializeProductWorkspace() {
  if(!customerWorkspace)return;
  $("product-navigation").hidden=false;
  document.querySelector(".application-body").insertAdjacentHTML("afterbegin",`
    <div id="workspace-state" class="workspace-state" role="status"><span class="phase-dot"></span><span id="workspace-status">Опишите задачу бизнеса</span><span id="workspace-origin">Данные уже известны банку</span></div>
    <nav id="manual-steps" class="manual-steps" aria-label="Шаги подбора"><button type="button" data-step="need">1. Потребность</button><button type="button" data-step="plan">2. Денежный план</button><button type="button" data-step="options">3. Варианты</button></nav>
    <div id="workspace-empty" class="workspace-empty"><div class="workspace-spark">✳</div><h3>Соберём решение под вашу задачу</h3><p>Расскажите, на что нужны деньги. Здесь появятся суммы, даты, денежный план и подходящие варианты.</p><div class="workspace-empty-steps"><span>Потребность</span><span>Денежный план</span><span>Варианты</span></div></div>
    <div id="workspace-proposal" class="workspace-proposal" hidden><div class="workspace-proposal-heading"><strong>Данные из разговора</strong><span class="badge">Предложено</span></div><p class="muted">Проверьте значения прямо здесь. Можно исправить поля или продолжить разговор.</p><div id="workspace-conflicts"></div><div id="workspace-questions"></div><div class="proposal-buttons"><button data-lock type="button" id="workspace-confirm" class="primary">Подтвердить данные и рассчитать</button><button data-lock type="button" id="workspace-reject" class="quiet">Отклонить изменения</button></div></div>
    <section id="workspace-need"></section><section id="workspace-plan"></section>
    <section id="workspace-live" class="workspace-live" aria-live="polite" hidden><div class="live-heading"><h3>Деньги по датам</h3><span class="badge">Предварительный сценарий</span></div><div id="workspace-live-content"></div></section>
    <section id="workspace-options"></section>
    <section id="workspace-review" class="workspace-review" hidden><h3>Проверьте заявку</h3><div id="workspace-review-content"></div><button type="button" id="workspace-edit" class="quiet">Изменить параметры</button></section>
  `);
  $("workspace-need").append($("need-section"));$("workspace-plan").append($("plan-section"));
  $("workspace-plan").after($("workspace-proposal"));
  $("workspace-options").append(document.querySelector(".calculation-actions"),document.querySelector(".options-section"),$("result"));
  const bank=document.querySelector(".bank-summary"),details=el("details",undefined,"workspace-bank");details.append(el("summary","Данные бизнеса · уже известны банку"),bank,$("finance-section"));$("workspace-state").after(details);
  document.querySelector(".applications-bar").hidden=true;
  document.querySelector(".intro").after(Object.assign(el("section",undefined,"applications-list"),{id:"workspace-applications",hidden:true}));
  $("need-section").querySelector("summary").textContent="Ваша потребность";
  $("need-form").querySelector('[type="submit"]').textContent="Продолжить подбор →";
  $("load-scenario").textContent="Новая потребность";
  const more=workspaceButton("Дополнить сведения",()=>{showAllNeed=!showAllNeed;renderProductWorkspace();});more.id="workspace-more-fields";$("need-section").append(more);
  const catalog=el("div",undefined,"product-catalog");catalog.id="workspace-catalog";catalog.hidden=true;
  for(const [product,title,description,pattern]of [["working_capital_loan","Разовый кредит","Деньги на закупку · возврат по графику","gradual_repayment"],["overdraft","Овердрафт","Заплатить до поступления денег · лимит на счёте","cash_gap"]]){const choice=workspaceButton("",()=>{$("purpose").value="working_capital";$("product").value=product;$("pattern").value=pattern;dirty.add("need");catalog.hidden=true;persistWorkspaceForm();showAllNeed=true;renderProductWorkspace();});choice.append(el("strong",title),el("span",description));catalog.append(choice);}
  $("need-fields").querySelector(".task-start").after(catalog);
  $("known-product").addEventListener("click",()=>{catalog.hidden=!catalog.hidden;});
  const quick=el("div",undefined,"quick-answers");quick.id="workspace-quick-answers";$("message-form").before(quick);
  for(const nav of document.querySelectorAll("[data-view]"))nav.addEventListener("click",()=>setWorkspaceView(nav.dataset.view));
  for(const step of document.querySelectorAll("[data-step]"))step.addEventListener("click",()=>{manualStep=step.dataset.step;renderProductWorkspace();});
  $("workspace-confirm").addEventListener("click",()=>run(saveWorkspaceScenario));
  $("workspace-reject").addEventListener("click",()=>{const pending=workspacePending();if(pending){dirty.delete("need");dirty.delete("plan");resolve(pending,"reject");}});
  $("workspace-edit").addEventListener("click",()=>{manualStep="need";setWorkspaceView("manual");});
  for(const form of [$("need-form"),$("plan-form")])form.addEventListener("change",()=>{
    persistWorkspaceForm();
    clearTimeout(saveTimer);
    if(workspacePending())saveTimer=setTimeout(()=>{if(!busy && !thinking && !workspacePending()?.conflicts?.length)run(()=>saveWorkspaceDraft());},250);
    updateWorkspaceStatus();
  });
  for(const form of [$("need-form"),$("plan-form")])form.addEventListener("input",persistWorkspaceForm);
  $("plan-form").addEventListener("click",event=>{const action=event.target.closest("button");if(action && (action.closest(".plan-operation") || ["add-transaction","add-inflow"].includes(action.id))){persistWorkspaceForm();clearTimeout(saveTimer);if(workspacePending())saveTimer=setTimeout(()=>{if(!busy && !thinking && !workspacePending()?.conflicts?.length)run(()=>saveWorkspaceDraft());},250);}});
  $("load-scenario").addEventListener("click",()=>{manualStep="need";showAllNeed=false;if(workspaceView === "applications")setWorkspaceView("manual");});
  window.addEventListener("hashchange",()=>setWorkspaceView(location.hash.slice(1),false));
  setWorkspaceView(location.hash.slice(1) || "manual",false);
}
function setWorkspaceView(view,changeHash=true,force=false) {
  if(!customerWorkspace)return;
  if(busy && data && !workspaceSwitching && !force)return;
  persistWorkspaceForm();clearTimeout(saveTimer);
  if(workspaceView === "manual"){workspaceContexts.manual={...workspaceContexts.manual,step:manualStep};saveWorkspaceContexts();}
  workspaceView=["manual","assistant","applications"].includes(view) ? view : "manual";
  if(changeHash)history.replaceState(null,"","#"+workspaceView);
  document.body.dataset.workspaceView=workspaceView;
  for(const nav of document.querySelectorAll("[data-view]")){const active=nav.dataset.view === workspaceView;nav.setAttribute("aria-current",active ? "page" : "false");}
  const copy={manual:["Финансирование под вашу задачу","Выберите цель — подберём продукт и проверим условия по данным бизнеса."],assistant:["Расскажите о своём деле","Обсуждайте задачу — суммы, даты и варианты будут появляться рядом."],applications:["Ваши заявки","Выбранные условия, отправка и ход рассмотрения."]}[workspaceView];
  document.querySelector("h1").textContent=copy[0];document.querySelector(".intro p:not(.eyebrow)").textContent=copy[1];
  document.querySelector(".conversation").hidden=workspaceView !== "assistant";
  if(workspaceView !== "applications")document.querySelector(".application").hidden=false;
  $("mode").hidden=true;
  if(data && workspaceView !== "applications" && activeWorkspaceContext !== workspaceView)run(()=>openWorkspaceContext(workspaceView));
  else renderProductWorkspace();
  if(workspaceView === "applications")loadWorkspaceApplications();
}
function projectionNeed() {
  const need={...data.record.application.need};
  for(const [path,value]of Object.entries(workspacePending()?.changes || {}))if(path.startsWith("need."))need[path.slice(5)]=value;
  return need;
}
function renderProductWorkspace() {
  if(!customerWorkspace || !data || !$("workspace-state"))return;
  if(workspaceView !== "applications" && activeWorkspaceContext !== workspaceView){document.querySelector(".application").hidden=true;document.querySelector(".conversation").hidden=true;return;}
  if(workspaceView !== "applications"){document.querySelector(".application").hidden=false;document.querySelector(".conversation").hidden=workspaceView !== "assistant";}
  const record=data.record,pending=workspacePending(),need=projectionNeed(),plan=pending?.changes["product_details.overdraft"] || record.application.product_details?.overdraft;
  if(workspaceApplication !== data.chat.application_id){workspaceApplication=data.chat.application_id;manualStep="need";showAllNeed=false;shownProposal="";shownValues={};workspacePreview=null;previewKey="";previewError="";previewRequest++;previewLoading=false;loadWorkspaceApplications();}
  restoreWorkspaceForm();
  const assistant=workspaceView === "assistant",applications=workspaceView === "applications";
  document.querySelector(".application .panel-heading h2").textContent=applications ? "Заявка и рассмотрение" : assistant ? "Ваша ситуация" : "Подбор финансирования";
  $("application-info").textContent=applications ? "№ "+data.chat.application_id.slice(0,8)+" · "+(states[record.state.status] || record.state.status) : assistant ? "Отдельный подбор в разговоре с ассистентом" : "Самостоятельный подбор без ИИ";
  $("workspace-applications").hidden=!applications;
  $("manual-steps").hidden=workspaceView !== "manual";
  for(const step of document.querySelectorAll("[data-step]"))step.setAttribute("aria-current",step.dataset.step === manualStep ? "step" : "false");
  const hasNeed=Boolean(need.purpose || need.requested_amount || need.preferred_product || plan || pending);
  $("workspace-empty").hidden=!assistant || hasNeed;
  $("workspace-need").hidden=applications || (assistant ? !hasNeed : manualStep !== "need");
  $("workspace-plan").hidden=applications || (assistant ? !plan : manualStep !== "plan");
  $("workspace-options").hidden=applications || (assistant ? !record.explorations.length : manualStep !== "options");
  document.querySelector(".process-section").hidden=!applications;
  $("workspace-review").hidden=!applications;
  document.querySelector(".scenario-row").hidden=applications;
  $("workspace-state").hidden=applications;
  document.querySelector(".workspace-bank").hidden=applications;
  $("workspace-more-fields").hidden=applications || (!assistant && manualStep !== "need");
  $("workspace-more-fields").textContent=showAllNeed ? "Скрыть дополнительные поля" : "Дополнить сведения";
  if(pending || !assistant || !record.explorations.length)$("need-section").open=true;
  if(assistant && plan)$("plan-section").open=true;
  for(const [key,id]of Object.entries(needInputs)) {
    const input=$(id),value=need[key],label=input.closest("label"),proposed=pending && Object.hasOwn(pending.changes,"need."+key);
    if(!dirty.has("need"))input.value=value == null ? "" : String(value);
    label.hidden=!showAllNeed && (assistant ? value == null : (["minimum_acceptable_amount","own_funds","recurring","preferred_product"].includes(key) && value == null));
    if(!assistant && (need.financing_pattern === "cash_gap" || need.preferred_product === "overdraft") && ["requested_amount","term_months","needed_by"].includes(key))label.hidden=true;
    label.classList.toggle("proposed-value",Boolean(proposed));
    label.title=proposed ? "Предложено из разговора; можно исправить" : "";
    const signature="need."+key;
    if(proposed && shownValues[signature] !== JSON.stringify(value)){label.classList.remove("value-arrived");void label.offsetWidth;label.classList.add("value-arrived");}
    shownValues[signature]=JSON.stringify(value);
  }
  for(const row of $("need-fields").querySelectorAll(".field-row"))row.hidden=[...row.children].every(child=>child.hidden);
  $("need-fields").querySelector(".task-start").hidden=assistant;
  $("need-form").querySelector('[type="submit"]').hidden=assistant;
  // В единственной форме плана показываем предложенные операции до подтверждения.
  if(pending?.changes["product_details.overdraft"] && !dirty.has("plan")) {
    const proposed=pending.changes["product_details.overdraft"];
    $("transactions").replaceChildren();
    for(const row of proposed.transactions){const loan=(proposed.existing_debt_payments || []).find(ref=>ref.transaction_id === row.transaction_id);addTransaction(row,loan?.loan_id,false);}
    $("plan-auto-period").checked=false;$("plan-start").value=proposed.start_date;$("plan-end").value=proposed.end_date;$("plan-cash").value=proposed.opening_cash_balance??"";$("plan-reserve").value=proposed.cash_reserve || "0.00";$("debt-plan-confirmed").checked=Boolean(proposed.debt_payments_confirmed);syncPlanDetails();
    $("transactions").classList.add("proposed-value");
    if(shownProposal !== pending.proposal_id){$("transactions").classList.remove("value-arrived");void $("transactions").offsetWidth;$("transactions").classList.add("value-arrived");}
  } else if(!pending)$("transactions").classList.remove("proposed-value");
  shownProposal=pending?.proposal_id || "";
  $("plan-form").querySelector('[type="submit"]').hidden=assistant && Boolean(pending);
  $("plan-settings").hidden=assistant && Boolean(pending);
  $("workspace-proposal").hidden=!pending || applications;
  renderWorkspaceQuestions(pending);
  if(applications)renderWorkspaceReview();
  for(const [section,id]of [["need","need-form"],["plan","plan-form"],["finance","finance-form"]]){const reset=$(id).querySelector(".reset-form");if(reset)reset.hidden=!dirty.has(section);}
  if(pending && !applications)loadWorkspacePreview(pending);else{$("workspace-live").hidden=true;if(!pending){previewRequest++;previewLoading=false;previewKey="";}}
  persistWorkspaceForm();
  updateWorkspaceStatus();
}
function renderWorkspaceQuestions(pending) {
  const questions=$("workspace-questions"),conflicts=$("workspace-conflicts"),quick=$("workspace-quick-answers");questions.replaceChildren();conflicts.replaceChildren();quick.replaceChildren();
  if(pending?.conflicts?.length){
    conflicts.append(el("strong","Есть расхождения — проверьте значения"));
    for(const path of pending.conflicts){const key=path.split(".")[1];if(path.startsWith("need."))conflicts.append(el("p",(names[key] || key)+": в заявке «"+display(key,data.record.application.need[key])+"», предложено «"+display(key,pending.changes[path])+"»."));else conflicts.append(el("p","Сохранённый денежный план или банковские сведения изменились. Проверьте текущие значения."));}
    const label=el("label",undefined,"inline-check"),check=el("input");check.type="checkbox";check.id="workspace-conflicts-reviewed";label.append(check,document.createTextNode("Проверил различия и предлагаемые значения"));conflicts.append(label);
  }
  const issues=pending?.plan_issues || [];
  for(const text of new Set(issues.map(issue=>issue.message)))questions.append(el("p",text,"workspace-question"));
  const card=data.clarification;$("message").placeholder=card ? "Можно ответить своими словами…" : "Расскажите, на что нужны деньги…";if(!card)return;
  if(clarificationDraft?.question_id !== card.question_id){clarificationDraft={question_id:card.question_id,value:""};clarificationError="";}
  const container=el("section",undefined,"clarification-card");container.setAttribute("aria-labelledby","clarification-title");
  const title=el("h3",card.title);title.id="clarification-title";container.append(title);
  const choices=el("div",undefined,"clarification-choices");
  for(const choice of card.choices)choices.append(workspaceButton(choice.label,()=>answerWorkspaceClarification(card,{choice_id:choice.choice_id})));
  if(card.choices.length)container.append(choices);
  if(card.input_type){
    const form=el("form",undefined,"clarification-input-form"),input=el("input");input.id="clarification-value";input.type=card.input_type === "date" ? "date" : "text";input.inputMode=card.input_type === "money" ? "decimal" : "text";input.required=true;input.dataset.lock="";input.value=clarificationDraft.value;
    if(card.input_type === "money"){input.placeholder="Сумма, ₽";input.maxLength=24;}
    input.setAttribute("aria-label",card.input_type === "date" ? "Указать свою дату" : "Указать сумму в рублях");
    input.addEventListener("input",()=>{clarificationDraft.value=input.value;});
    const submit=el("button",card.input_type === "date" ? "Указать дату" : "Указать сумму","secondary");submit.type="submit";submit.dataset.lock="";
    form.append(input,submit);form.addEventListener("submit",event=>{event.preventDefault();if(form.reportValidity())answerWorkspaceClarification(card,{value:input.value});});container.append(form);
  }
  if(clarificationError)container.append(el("p",clarificationError,"conflict"));
  const own=workspaceButton("Отвечу своими словами",()=>{$("message").focus();$("message").placeholder="Ваш ответ на вопрос: "+card.title;},"clarification-own quiet");container.append(own);quick.append(container);
}
function answerWorkspaceClarification(card,answer){run(async()=>{
  if(data.clarification?.question_id !== card.question_id)throw new Error("Вопрос уже изменился. Используйте новую карточку.");
  if(dirty.has("need") || dirty.has("plan")){
    if(!workspacePending())throw new Error("Сначала сохраните правки в рабочей области.");
    await saveWorkspaceDraft();
    show("notice","Правки сохранены. Ответьте на обновлённый вопрос.");return;
  }
  const identity=JSON.stringify([data.chat.chat_id,card.question_id,answer]);
  if(clarificationRetry?.identity !== identity)clarificationRetry={identity,request_id:crypto.randomUUID()};
  clarificationError="";
  try{accept(await api(`/api/chats/${data.chat.chat_id}/clarifications/${card.question_id}/answer`,{base_chat_version:data.chat.chat_version,base_application_version:data.record.application.application_version,request_id:clarificationRetry.request_id,...answer}));clarificationRetry=null;}
  catch(error){clarificationError=error.message;throw error;}
});}
function workspaceDraftBody() {
  const pending=workspacePending();if(!pending)return null;
  const changes={...Object.fromEntries(Object.entries(pending.changes).filter(([path])=>path !== "product_details.overdraft")),...needFormChanges()};
  const body={base_chat_version:data.chat.chat_version,base_application_version:data.record.application.application_version,changes};
  if(pending.changes["product_details.overdraft"]) {
    body.overdraft_plan={mode:"replace",cash_reserve:asMoney($("plan-reserve")) || "0.00",debt_payments_confirmed:!activeLoans().length || $("debt-plan-confirmed").checked,transactions:[...$("transactions").children].map(row=>({transaction_id:row.dataset.transactionId,direction:row.dataset.direction || null,loan_id:row.dataset.loanId || null,date:row.querySelector('[data-field="date"]').value || null,amount:asMoney(row.querySelector('[data-field="amount"]'))}))};
  }
  return body;
}
async function saveWorkspaceDraft(explicit=false) {
  clearTimeout(saveTimer);const pending=workspacePending();if(!pending)return;
  if(pending.conflicts?.length && (!explicit || !$("workspace-conflicts-reviewed")?.checked))throw new Error("Проверьте расхождения и отметьте подтверждение под ними.");
  for(const form of [$("need-form"),$("plan-form")])for(const input of form.querySelectorAll('input[type="number"]'))if(input.value && !input.checkValidity())throw new Error("Проверьте сумму и срок.");
  const next=await api(`/api/chats/${data.chat.chat_id}/proposals/${pending.proposal_id}/edit`,workspaceDraftBody());
  dirty.delete("need");dirty.delete("plan");accept(next);
}
async function saveWorkspaceScenario() {
  if(!workspacePending())return;
  await saveWorkspaceDraft(true);
  const pending=workspacePending();if(!pending)return;
  await applyProposal(pending);
  workspaceCalculated();
}
function workspacePreviewIdentity() {const pending=workspacePending();return pending ? [data.chat.chat_id,pending.proposal_id,data.chat.chat_version,data.record.application.application_version].join(":") : "";}
async function loadWorkspacePreview(pending) {
  const key=workspacePreviewIdentity();
  if(previewKey === key){renderWorkspacePreview();return;}
  previewKey=key;workspacePreview=null;previewError="";
  if(pending.conflicts?.length){previewLoading=false;renderWorkspacePreview();return;}
  const request=++previewRequest;previewLoading=true;renderWorkspacePreview();updateWorkspaceStatus();
  try {
    const result=await api(`/api/chats/${data.chat.chat_id}/proposals/${pending.proposal_id}/preview`,{base_chat_version:data.chat.chat_version});
    if(request !== previewRequest || key !== workspacePreviewIdentity())return;
    workspacePreview=result;
  } catch(error){if(request === previewRequest && key === workspacePreviewIdentity())previewError=error.message;}
  finally{if(request === previewRequest && key === workspacePreviewIdentity()){previewLoading=false;renderWorkspacePreview();updateWorkspaceStatus();}}
}
function renderWorkspacePreview() {
  const box=$("workspace-live-content");box.replaceChildren();
  $("workspace-live").hidden=workspaceView === "applications" || !workspacePending();
  $("workspace-live").querySelector("h3").textContent=workspacePending()?.changes["product_details.overdraft"] ? "Деньги по датам" : "Предварительные варианты";
  if(previewLoading){box.append(el("p","Рассчитываем по предложенным данным…","muted"));return;}
  if(previewError){box.append(el("p",previewError,"conflict"),workspaceButton("Повторить расчёт",()=>{previewKey="";loadWorkspacePreview(workspacePending());}));return;}
  if(!workspacePreview)return;
  const result=workspacePreview.result,plan=workspacePending()?.changes["product_details.overdraft"];
  if(plan){const timeline=el("div",undefined,"cash-timeline");for(const row of [...plan.transactions].sort((a,b)=>(a.date || "").localeCompare(b.date || ""))){const point=el("div",undefined,"cash-event "+row.direction);point.append(el("time",planDate(row.date)),el("strong",money(row.amount)),el("span",row.direction === "inflow" ? "Поступление" : "Расход"));timeline.append(point);}box.append(timeline);}
  if(result.daily?.length){box.append(lineChart(result.daily,[{key:"cash_without_financing",color:"#cf6556"},{key:"closing_cash",color:"#39896b"}]));box.append(el("p","Красная линия — без финансирования. Зелёная — с расчётным лимитом, процентами и погашением.","muted"));
    const facts=el("div",undefined,"preview-facts");for(const [title,value]of [["Нужно покрыть",money(result.suggested_amount || result.calculation?.required_limit)],["Проценты по плану",money(result.calculation?.total_interest)]]){const fact=el("div");fact.append(el("span",title),el("strong",value));facts.append(fact);}box.append(facts);
    if(workspacePreview.issues.length)box.append(el("p","График построен по названным операциям. Перед подбором условий ответьте на уточнения выше.","muted"));
  }
  if(!result.daily?.length && !result.options?.length){const info=[...(result.required_information || []),...(result.issues || [])];for(const issue of info)box.append(el("p",issue.question || issue.message,"workspace-question"));if(!info.length)box.append(el("p","Добавьте недостающие суммы и даты для расчёта.","muted"));}
  if(result.options?.length){const options=el("div",undefined,"preview-options");for(const option of result.options.slice(0,3)){const card=el("article",undefined,"preview-option");card.append(el("strong",money(option.amount)),el("p",option.term_months ? option.term_months+" мес. · платёж "+money(option.monthly_payment) : "Лимит овердрафта"),el("small",option.total_interest ? "Проценты: "+money(option.total_interest) : "Проценты по плану: "+money(option.scenario_cost?.total_interest)));options.append(card);}box.append(options,el("p","Подтвердите данные, чтобы выбрать условия и перейти к оформлению.","muted"));}
}
function updateWorkspaceStatus() {
  if(!customerWorkspace || !data || !$("workspace-status"))return;
  const pending=workspacePending(),hasOptions=data.record.explorations.at(-1)?.application_version === data.record.application.application_version && data.record.explorations.at(-1)?.result.options?.length;
  const currentThinking=thinking && data.chat.chat_id === thinkingChatId;
  const text=workspaceSwitching ? "Открываем сохранённый подбор…" : currentThinking ? "Ассистент разбирает ваш запрос…" : busy ? "Сохраняем данные…" : previewLoading ? "Рассчитываем предложенный сценарий…" : pending?.conflicts?.length ? "Проверьте расхождения" : pending?.plan_issues?.length ? "Уточняем денежный план" : pending ? "Проверьте собранные данные" : hasOptions ? "Варианты готовы к выбору" : "Уточняем потребность";
  $("workspace-status").textContent=text;$("workspace-state").classList.toggle("is-loading",currentThinking || busy || previewLoading || workspaceSwitching);
  document.body.classList.toggle("workspace-switching",workspaceSwitching);
  for(const nav of document.querySelectorAll("[data-view]"))nav.disabled=busy || workspaceSwitching;
  $("workspace-origin").textContent=pending ? "Из разговора · можно исправить" : "Прогресс сохраняется";
  $("workspace-confirm").disabled=busy || currentThinking || !pending || Boolean(data.clarification);
}
async function continueWorkspaceManual() {
  if(!customerWorkspace)return;
  const need=data.record.application.need;
  if(need.financing_pattern === "cash_gap" || need.preferred_product === "overdraft") {manualStep="plan";$("plan-section").open=true;renderProductWorkspace();show("notice","Укажите предстоящий расход и ожидаемое поступление. Остаток уже подставлен из банка.");return;}
  await api(appPath("/recommendations"),versionBody());
  if(need.purpose === "working_capital")await api(appPath("/explorations"),versionBody({product_id:"working_capital_loan"}));
  await refreshRecord();workspaceCalculated();
}
function workspaceCalculated(){if(!customerWorkspace)return;manualStep="options";if(workspaceView === "manual"){workspaceContexts.manual={...workspaceContexts.manual,step:manualStep};saveWorkspaceContexts();}renderProductWorkspace();if(workspaceView === "assistant"){$("need-section").open=false;$("plan-section").open=false;}}
function workspaceOptionSelected(){if(customerWorkspace)setWorkspaceView("applications",true,true);}
function focusWorkspaceField(field){if(!customerWorkspace)return;if(workspaceView === "applications")setWorkspaceView("manual");manualStep=field.startsWith("product_details") ? "plan" : "need";showAllNeed=true;renderProductWorkspace();}
function renderWorkspaceReview() {
  const box=$("workspace-review-content"),need=data.record.application.need;box.replaceChildren();
  for(const [title,value]of [["Продукт",values[need.preferred_product] || "Ещё не выбран"],["Сумма / лимит",money(need.requested_amount)],["Срок",need.term_months ? need.term_months+" мес." : need.preferred_product === "overdraft" ? "По условиям овердрафта" : "Не указан"],["Компания",data.record.client_data?.company_name || "Моя компания"]]){const row=el("div",undefined,"review-row");row.append(el("span",title),el("strong",value));box.append(row);}
  if(workspacePending())box.append(el("p","В подборе есть неподтверждённые изменения. Текущая заявка использует сохранённые значения.","muted"));
}
async function loadWorkspaceApplications() {
  try{workspaceApplications=await api("/api/applications",undefined,"GET");renderWorkspaceApplications();}catch(error){const box=$("workspace-applications");box.replaceChildren(el("p",error.message,"conflict"),workspaceButton("Повторить",loadWorkspaceApplications));}
}
function renderWorkspaceApplications() {
  const box=$("workspace-applications");box.replaceChildren();const items=workspaceApplications.filter(item=>item.ready_for_application);
  $("applications-count").textContent=String(items.length);
  if(!items.length){box.append(el("h2","Сначала выберите условия"),el("p","Собранная заявка появится здесь, когда вы выберете вариант финансирования.","muted"),workspaceButton("Подобрать продукт",()=>setWorkspaceView("manual"),"primary"));}
  for(const item of items){const card=el("article",undefined,"saved-application");card.classList.toggle("is-current",item.application_id === data.chat.application_id);card.append(el("strong",values[item.need.preferred_product] || "Финансирование"),el("p",money(item.need.requested_amount)+" · "+(states[item.state.status] || item.state.status)));const open=workspaceButton("Открыть заявку",()=>run(async()=>{const chats=await api(`/api/applications/${item.application_id}/chats`,undefined,"GET");activeWorkspaceContext="applications";accept(chats.length ? await api("/api/chats/"+chats[0].chat_id,undefined,"GET") : await api("/api/chats",{application_id:item.application_id}));setWorkspaceView("applications");}));if(item.application_id === data.chat.application_id){open.textContent="Открыта";open.disabled=true;}card.append(open);box.append(card);}
  const currentReady=items.some(item=>item.application_id === data.chat.application_id);
  document.querySelector(".application").hidden=workspaceView === "applications" && !currentReady;
}
initializeProductWorkspace();
