"""HTTP API кабинета: uvicorn backend.main:app."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from credit_engine import OverdraftCreditPolicy, WorkingCapitalPolicy

from . import demo
from .assistant import configured_assistant
from .chat import ChatService
from .models import (ApplicationView, ChatMessage, ChatVersion, ConfirmChatProposal, CreateChat,
                     ConfirmedAction, CreateApplication, OfferAction, SelectOffer, UpdateApplication, VersionAction)
from .service import CreditProcess, ProcessError
from .store import Store


def create_app(database_path: str | Path | None = None, *, clock=None, assistant=None) -> FastAPI:
    store = Store(database_path or os.getenv("DATABASE_PATH", "data/cabinet.sqlite3"))
    clock = clock or (lambda: datetime.now(timezone.utc))
    process = CreditProcess(store, clock)

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        yield

    app = FastAPI(title="Дело за малым", version="0.1.0", lifespan=lifespan,
                  description="Кредитный процесс существующего демонстрационного клиента: разовый кредит и овердрафт.")
    app.state.process = process
    assets = Path(__file__).with_name("static")
    app.mount("/chat-assets", StaticFiles(directory=assets), name="chat-assets")

    @app.get("/chat", include_in_schema=False)
    def chat_page():
        return FileResponse(assets / "chat.html", headers={"Cache-Control": "no-store"})
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
        return RedirectResponse("/docs")

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
             "annual_rate_percent": loan.annual_rate_percent, "terms": list(loan.terms)},
            {"product_id": "overdraft", "name": "Овердрафт", "policy_version": overdraft.version,
             "minimum_amount": str(overdraft.minimum_limit), "maximum_amount": str(overdraft.maximum_limit),
             "annual_rate_percent": overdraft.annual_rate_percent, "agreement_months": overdraft.agreement_months,
             "max_debt_days": overdraft.max_debt_days},
        ]

    chats = ChatService(process, assistant if assistant is not None else configured_assistant(), products)
    app.state.chats = chats

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

    @app.post("/api/chats/{chat_id}/proposals/{proposal_id}/reject", tags=["Диалог"])
    def reject_proposal(chat_id: str, proposal_id: str, body: ChatVersion) -> dict:
        return chats.resolve(chat_id, proposal_id, body.base_chat_version, apply=False)

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
