"""Поиск публичных источников через Tavily; без дополнительного SDK."""

import json
from datetime import datetime, timezone
from http.client import HTTPException
from typing import TYPE_CHECKING
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    from scr.delo_za_malyn.settings.settings import Settings


class SearchError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class TavilyClient:
    def __init__(self, config: "Settings | None" = None):
        if config is None:
            from scr.delo_za_malyn.settings.settings import settings
            config = settings
        self.config = config

    @property
    def available(self) -> bool:
        return bool(self.config.tavily_api_key)

    def search(self, query: str) -> dict:
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 400:
            raise SearchError("invalid_arguments", "Нужен поисковый запрос длиной 1–400 символов.")
        if not self.available:
            raise SearchError("not_configured", "Веб-поиск не настроен.")
        request = Request(
            "https://api.tavily.com/search",
            data=json.dumps({
                "query": query.strip(), "topic": "general", "search_depth": "basic",
                "max_results": self.config.tavily_max_results,
                "include_answer": False, "include_raw_content": False,
                "include_images": False, "auto_parameters": False,
            }, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.config.tavily_api_key}"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.config.tavily_timeout_seconds) as response:
                body = response.read(1_000_001)
            if len(body) > 1_000_000:
                raise SearchError("invalid_response", "Слишком большой ответ веб-поиска.")
            data = json.loads(body)
        except HTTPError as exc:
            code, message = {
                401: ("authentication", "Tavily отклонил API-ключ."),
                403: ("forbidden", "Tavily запретил доступ."),
                429: ("rate_limit", "Превышена частота запросов Tavily."),
                432: ("quota_exceeded", "Исчерпан лимит Tavily."),
                433: ("quota_exceeded", "Превышен лимит оплаты Tavily."),
            }.get(exc.code, ("http_error", f"Веб-поиск вернул HTTP {exc.code}."))
            exc.close()
            raise SearchError(code, message) from None
        except TimeoutError:
            raise SearchError("timeout", "Истекло время ожидания веб-поиска.") from None
        except (URLError, ConnectionError, HTTPException):
            raise SearchError("unavailable", "Веб-поиск временно недоступен.") from None
        except (ValueError, UnicodeError):
            raise SearchError("invalid_response", "Веб-поиск вернул некорректный JSON.") from None
        if not isinstance(data, dict) or not isinstance(data.get("results"), list):
            raise SearchError("invalid_response", "Веб-поиск вернул некорректные результаты.")
        sources = []
        for item in data["results"][:self.config.tavily_max_results]:
            if not isinstance(item, dict):
                raise SearchError("invalid_response", "Некорректный источник веб-поиска.")
            title, url, content = (item.get(key) for key in ("title", "url", "content"))
            if not all(isinstance(value, str) for value in (title, url, content)):
                raise SearchError("invalid_response", "Некорректные поля источника веб-поиска.")
            try:
                parsed = urlsplit(url)
                valid = parsed.scheme in {"http", "https"} and bool(parsed.hostname)
            except ValueError:
                valid = False
            if not valid:
                continue
            sources.append({"title": title[:200], "url": url[:2000],
                            "content": content[:self.config.tavily_snippet_chars]})
        return {
            "ok": True,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "untrusted_external_data": True,
            "sources": sources,
        }
