"""HTTP API кабинета: uvicorn backend.main:app."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
import csv
import json
from io import StringIO

from fastapi import FastAPI, Query, Request
from starlette.concurrency import run_in_threadpool
from urllib.parse import quote
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from credit_engine import OverdraftCreditPolicy, WorkingCapitalPolicy

from . import demo
from .assistant import configured_assistant
from .chat import ChatService
from .models import (AnswerClarification, ApplicationView, ChatMessage, ChatVersion, ConfirmChatProposal, CreateChat,
                     ConfirmedAction, CreateApplication, OfferAction, SelectOffer, UpdateApplication, VersionAction,
                     EditChatProposal, ExploreOptions, ApplyOption, ImportCSV, ConfirmImport, EditImport, UseInvoice)
from .documents import InvoiceDocuments
from .invoice_pdf import MAX_BYTES
from .service import CreditProcess, ProcessError
from .store import Store
from .workspace import ProductWorkspace


def create_app(database_path: str | Path | None = None, *, clock=None, assistant=None, frontend_directory=None) -> FastAPI:
    store = Store(database_path or os.getenv("DATABASE_PATH", "data/cabinet.sqlite3"))
    clock = clock or (lambda: datetime.now(timezone.utc))
    process = CreditProcess(store, clock)
    workspace = ProductWorkspace(process)

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        yield

    app = FastAPI(title="Дело за малым", version="0.1.0", lifespan=lifespan,
                  description="Кредитный процесс существующего демонстрационного клиента: разовый кредит и овердрафт.")
    app.state.process = process
    assets = Path(__file__).with_name("static")
    frontend = Path(frontend_directory or os.getenv("FRONTEND_DIST", Path(__file__).resolve().parent.parent / "frontend" / "dist"))
    frontend_index = frontend / "index.html"
    app.mount("/chat-assets", StaticFiles(directory=assets), name="chat-assets")
    for folder in ("assets", "fonts", "images"):
        if (frontend / folder).is_dir():
            app.mount("/" + folder, StaticFiles(directory=frontend / folder), name="frontend-" + folder)

    @app.get("/chat", include_in_schema=False)
    def chat_page():
        return FileResponse(assets / "chat.html", headers={"Cache-Control": "no-store"})

    @app.get("/cabinet", include_in_schema=False)
    def cabinet_page():
        return FileResponse(frontend_index if frontend_index.is_file() else assets / "chat.html", headers={"Cache-Control": "no-store"})

    @app.get("/cabinet/{page:path}", include_in_schema=False)
    def cabinet_route(page: str):
        if not frontend_index.is_file():
            raise ProcessError("page_not_found", "Страница не найдена.", 404)
        return FileResponse(frontend_index, headers={"Cache-Control": "no-store"})
    origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if origin.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PATCH"], allow_headers=["Content-Type"])

    @app.exception_handler(ProcessError)
    async def process_error(request, exc):
        return JSONResponse(status_code=exc.status_code, content={"detail": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(sqlite3.OperationalError)
    async def database_error(request, exc):
        return JSONResponse(status_code=503, content={"detail": {"code": "database_unavailable", "message": "Хранилище временно недоступно. Повторите запрос."}})

    @app.get("/", include_in_schema=False)
    def index():
        if frontend_index.is_file():
            return FileResponse(frontend_index, headers={"Cache-Control": "no-store"})
        return RedirectResponse("/cabinet")

    @app.get("/health", tags=["Состояние сервиса"])
    def health():
        with store.connect() as connection:
            connection.execute("SELECT 1 FROM applications LIMIT 1")
        return {"status": "ok"}

    @app.get("/api/profile", tags=["Данные клиента"])
    def get_profile():
        return demo.profile(clock())[0]

    @app.get("/api/products", tags=["Данные клиента"])
    def products():
        loan, overdraft = WorkingCapitalPolicy(), OverdraftCreditPolicy()
        return [
            {"product_id": "working_capital_loan", "name": "Разовый кредит на оборотные цели", "policy_version": loan.version,
             "minimum_amount": str(loan.minimum_amount), "maximum_amount": str(loan.maximum_amount),
             "annual_rate_percent": loan.annual_rate_percent, "terms": list(loan.terms),
             "minimum_business_months": loan.minimum_business_months, "history_months": 6,
             "purpose": "working_capital", "conditions": "При среднем классе риска требуется поручительство; высокая оценка риска не проходит автоматические правила."},
            {"product_id": "overdraft", "name": "Овердрафт", "policy_version": overdraft.version,
             "minimum_amount": str(overdraft.minimum_limit), "maximum_amount": str(overdraft.maximum_limit),
             "annual_rate_percent": overdraft.annual_rate_percent, "agreement_months": overdraft.agreement_months,
             "max_debt_days": overdraft.max_debt_days, "minimum_business_months": overdraft.minimum_business_months,
             "history_months": 6, "purpose": "working_capital", "plan_required": True,
             "conditions": "Проверяются оборот, доступная нагрузка и погашение по плану; при среднем классе риска требуется поручительство."},
        ]

    chats = ChatService(process, assistant if assistant is not None else configured_assistant(), products, workspace=workspace)
    app.state.chats = chats
    documents = InvoiceDocuments(process, chats)
    app.state.documents = documents

    @app.get("/api/applications/{application_id}/explorations/{exploration_id}/options/{option_id}/cash-flow")
    def loan_cash_forecast(application_id: str, exploration_id: str, option_id: str, base_application_version: int = Query(ge=1),
                           transaction_id: str | None = Query(default=None, min_length=1, max_length=100),
                           delay_days: int | None = Query(default=None, ge=1, le=30)):
        if (transaction_id is None) != (delay_days is None):
            raise ProcessError("invalid_delay", "Для переноса укажите поступление и количество дней.", 422)
        return workspace.cashflow(application_id, base_application_version, exploration_id, option_id,
                                  delay={"transaction_id": transaction_id, "days": delay_days} if transaction_id else None)

    @app.post("/api/applications/{application_id}/documents", response_model=ApplicationView, tags=["Документы"],
              openapi_extra={"requestBody": {"required": True, "content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}})
    async def upload_invoice(application_id: str, request: Request, filename: str = Query(min_length=1, max_length=200),
                             base_application_version: int = Query(ge=1)):
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_BYTES:
                raise ProcessError("document_too_large", "PDF должен быть не больше 2 МБ.", 413)
        return await run_in_threadpool(documents.upload, application_id, base_application_version, filename, bytes(content))

    @app.get("/api/applications/{application_id}/documents/{document_id}/file", tags=["Документы"])
    def invoice_original(application_id: str, document_id: str):
        filename, content = documents.content(application_id, document_id)
        return Response(content, media_type="application/pdf", headers={
            "Content-Disposition": "attachment; filename=invoice.pdf; filename*=UTF-8''" + quote(filename, safe=""),
            "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        })

    @app.post("/api/applications/{application_id}/documents/{document_id}/use", response_model=ApplicationView, tags=["Документы"])
    def use_invoice(application_id: str, document_id: str, body: UseInvoice):
        return documents.use(application_id, document_id, body)

    @app.post("/api/chats/{chat_id}/documents/{document_id}/use", tags=["Документы"])
    def propose_invoice(chat_id: str, document_id: str, body: UseInvoice) -> dict:
        view = chats.get(chat_id)
        return documents.use(view["record"]["application"]["application_id"], document_id, body, chat_id=chat_id)

    @app.get("/api/chat/config", tags=["Диалог"])
    def chat_config() -> dict:
        return chats.settings()

    @app.post("/api/chats", status_code=201, tags=["Диалог"])
    def create_chat(body: CreateChat) -> dict:
        return chats.create(body.application_id)

    @app.get("/api/chats/{chat_id}", tags=["Диалог"])
    def get_chat(chat_id: str) -> dict:
        return chats.get(chat_id)

    @app.post("/api/chats/{chat_id}/messages", tags=["Диалог"])
    def chat_message(chat_id: str, body: ChatMessage) -> dict:
        return chats.send(chat_id, body.base_chat_version, body.text, body.request_id)

    @app.post("/api/chats/{chat_id}/proposals/{proposal_id}/confirm", tags=["Диалог"])
    def confirm_proposal(chat_id: str, proposal_id: str, body: ConfirmChatProposal) -> dict:
        return chats.resolve(chat_id, proposal_id, body.base_chat_version, apply=True)

    @app.post("/api/chats/{chat_id}/proposals/{proposal_id}/preview", tags=["Диалог"])
    def preview_proposal(chat_id: str, proposal_id: str, body: ChatVersion) -> dict:
        return chats.preview(chat_id, proposal_id, body.base_chat_version)

    @app.post("/api/chats/{chat_id}/clarifications/{question_id}/answer", tags=["Диалог"])
    def answer_clarification(chat_id: str, question_id: str, body: AnswerClarification) -> dict:
        return chats.answer_clarification(chat_id, question_id, body)

    @app.post("/api/chats/{chat_id}/proposals/{proposal_id}/reject", tags=["Диалог"])
    def reject_proposal(chat_id: str, proposal_id: str, body: ChatVersion) -> dict:
        return chats.resolve(chat_id, proposal_id, body.base_chat_version, apply=False)

    @app.post("/api/chats/{chat_id}/proposals/{proposal_id}/edit", tags=["Диалог"])
    def edit_proposal(chat_id: str, proposal_id: str, body: EditChatProposal) -> dict:
        return chats.edit(chat_id, proposal_id, body.base_chat_version, body.base_application_version, body.changes,
                          plan_update=body.overdraft_plan, remove_plan=body.remove_overdraft_plan)

    @app.get("/api/applications/{application_id}/chats", tags=["Диалог"])
    def application_chats(application_id: str) -> list:
        process.get(application_id)
        with store.connect() as connection:
            rows = [json.loads(row[0]) for row in connection.execute("SELECT payload FROM chats")]
        return [{"chat_id": item["chat_id"], "created_at": item["created_at"]} for item in
                sorted(rows, key=lambda item: item["created_at"], reverse=True) if item["application_id"] == application_id]

    @app.post("/api/applications/{application_id}/explorations", response_model=ApplicationView, tags=["Сравнение и сценарии"])
    def explore(application_id: str, body: ExploreOptions):
        return workspace.explore(application_id, body.base_application_version, body.product_id,
            preferences=body.preferences.model_dump(exclude_none=True), delay=body.delay.model_dump() if body.delay else None)

    @app.post("/api/applications/{application_id}/explorations/{exploration_id}/apply", response_model=ApplicationView, tags=["Сравнение и сценарии"])
    def apply_option(application_id: str, exploration_id: str, body: ApplyOption):
        return workspace.apply(application_id, body.base_application_version, exploration_id, body.option_id)

    @app.post("/api/applications/{application_id}/imports", response_model=ApplicationView, tags=["Документы"])
    def import_csv(application_id: str, body: ImportCSV):
        return workspace.import_csv(application_id, body.base_application_version, body.filename, body.content)

    @app.post("/api/applications/{application_id}/imports/{import_id}/confirm", response_model=ApplicationView, tags=["Документы"])
    def confirm_import(application_id: str, import_id: str, body: ConfirmImport):
        return workspace.confirm_import(application_id, body.base_application_version, import_id, body.base_import_revision)

    @app.post("/api/applications/{application_id}/imports/{import_id}/edit", response_model=ApplicationView, tags=["Документы"])
    def edit_import(application_id: str, import_id: str, body: EditImport):
        return workspace.edit_import(application_id, body.base_application_version, import_id, body.base_import_revision, body.monthly)

    @app.get("/api/applications/{application_id}/financials.csv", tags=["Документы"])
    def export_financials(application_id: str):
        record = process.get(application_id)
        output = StringIO()
        writer = csv.DictWriter(output, fieldnames=["month", "operating_inflow", "operating_outflow", "taxes"])
        writer.writeheader()
        for row in record["application"].get("financials", {}).get("monthly") or []:
            writer.writerow({field: row.get(field, "") for field in writer.fieldnames})
        return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="financials.csv"'})

    @app.get("/api/demo/scenarios", tags=["Демонстрационные сценарии"])
    def list_scenarios():
        return demo.scenarios()

    @app.post("/api/demo/scenarios/{product}/{scenario_id}", response_model=ApplicationView, status_code=201,
              tags=["Демонстрационные сценарии"])
    def create_scenario(product: str, scenario_id: str):
        return process.create(scenario=(product, scenario_id))

    @app.get("/api/applications", tags=["Заявки"])
    def list_applications():
        return process.list()

    @app.post("/api/applications", response_model=ApplicationView, status_code=201, tags=["Заявки"])
    def create_application(body: CreateApplication):
        return process.create(**body.model_dump())

    @app.get("/api/applications/{application_id}", response_model=ApplicationView, tags=["Заявки"])
    def get_application(application_id: str):
        return process.get(application_id)

    @app.patch("/api/applications/{application_id}", response_model=ApplicationView, tags=["Заявки"])
    def update_application(application_id: str, body: UpdateApplication):
        return process.patch(application_id, body.base_application_version, body.changes)

    @app.post("/api/applications/{application_id}/preview", response_model=ApplicationView, tags=["Рассмотрение"])
    def preview(application_id: str, body: VersionAction):
        return process.preview(application_id, body.base_application_version)

    @app.post("/api/applications/{application_id}/recommendations", response_model=ApplicationView, tags=["Подбор финансирования"])
    def recommendations(application_id: str, body: VersionAction):
        return process.recommend(application_id, body.base_application_version)

    @app.post("/api/applications/{application_id}/submit", response_model=ApplicationView, tags=["Рассмотрение"])
    def submit(application_id: str, body: ConfirmedAction):
        return process.submit(application_id, body.base_application_version)

    @app.post("/api/applications/{application_id}/retry", response_model=ApplicationView, tags=["Рассмотрение"])
    def retry(application_id: str, body: VersionAction):
        return process.retry(application_id, body.base_application_version)

    @app.post("/api/applications/{application_id}/select-offer", response_model=ApplicationView, tags=["Оформление"])
    def select_offer(application_id: str, body: SelectOffer):
        return process.select(application_id, body.base_application_version, body.assessment_id, body.offer_id)

    @app.post("/api/applications/{application_id}/conditions/{code}/complete", response_model=ApplicationView, tags=["Оформление"])
    def complete_condition(application_id: str, code: str, body: OfferAction):
        return process.fulfill(application_id, body.base_application_version, body.offer_id, code)

    @app.post("/api/applications/{application_id}/sign", response_model=ApplicationView, tags=["Оформление"])
    def sign(application_id: str, body: OfferAction):
        return process.sign(application_id, body.base_application_version, body.offer_id)

    @app.post("/api/applications/{application_id}/cancel", response_model=ApplicationView, tags=["Оформление"])
    def cancel(application_id: str, body: ConfirmedAction):
        return process.cancel(application_id, body.base_application_version)

    return app


app = create_app()
