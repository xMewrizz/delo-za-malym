"""Извлечение реквизитов текстового счёта; запуск отдельным процессом."""

from datetime import datetime
from decimal import Decimal
from io import BytesIO
import json
import re
import subprocess
import sys

MAX_BYTES = 2 * 1024 * 1024
MAX_PAGES = 8
MAX_TEXT = 80000
AMOUNT_LABEL = re.compile(r"(?:всего\s+к\s+оплате|итого\s+к\s+оплате|сумма\s+к\s+оплате|итого(?:\s+с\s+ндс)?|всего)\s*[:=]?\s*", re.I)
DATE_LABEL = re.compile(r"(?:оплатить\s+до|срок\s+оплаты|оплатить\s+не\s+позднее|действителен\s+до)\s*[:=]?\s*", re.I)
MONEY = re.compile(r"^(\d(?:[\d \u00a0\u202f]*\d)?(?:[,.]\d{2})?)(?![\d,.])")


class InvoiceError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def fields_from_pages(pages):
    extracted = {"amount": [], "due_date": []}
    for page in pages:
        lines = page["text"].splitlines()
        for index, line in enumerate(lines):
            for field, label in (("amount", AMOUNT_LABEL), ("due_date", DATE_LABEL)):
                match = label.match(line.strip())
                if not match:
                    continue
                tail = line.strip()[match.end():].strip()
                following = not tail and index + 1 < len(lines)
                if following:
                    tail = lines[index + 1].strip()
                value = None
                if field == "amount":
                    amount = MONEY.match(tail)
                    if amount:
                        if re.search(r"(?:USD|EUR|доллар|евро|[$€])", tail[amount.end():], re.I):
                            raise InvoiceError("unsupported_currency", "Поддерживаются счета в рублях. Валюта этого счёта отличается.")
                        clean = re.sub(r"[ \u00a0\u202f]", "", amount[1]).replace(",", ".")
                        number = Decimal(clean)
                        if 0 < number < Decimal("1000000000000"):
                            value = f"{number:.2f}"
                else:
                    stamp = re.match(r"(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})(?!\d)", tail)
                    if stamp:
                        try:
                            value = datetime.strptime(stamp[1], "%d.%m.%Y" if "." in stamp[1] else "%Y-%m-%d").date().isoformat()
                        except ValueError:
                            pass
                if value is not None:
                    candidate = {"value": value, "page": page["page"], "line": index + 1,
                                 "quote": line.strip() + ("\n" + lines[index + 1].strip() if following else "")}
                    extracted[field].append(candidate)
    return extracted


def extract_pdf(content):
    from pypdf import PdfReader
    if len(content) > MAX_BYTES:
        raise InvoiceError("document_too_large", "PDF должен быть не больше 2 МБ.")
    if not content.startswith(b"%PDF-"):
        raise InvoiceError("invalid_pdf", "Файл не является PDF.")
    reader = PdfReader(BytesIO(content))
    if reader.is_encrypted:
        raise InvoiceError("encrypted_pdf", "Снимите пароль с PDF перед загрузкой.")
    if not 1 <= len(reader.pages) <= MAX_PAGES:
        raise InvoiceError("too_many_pages", "Поддерживаются счета до 8 страниц.")
    pages, size = [], 0
    for index, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        size += len(text)
        if size > MAX_TEXT:
            raise InvoiceError("document_too_complex", "В счёте слишком много текста. Загрузите только страницы со счётом.")
        pages.append({"page": index, "text": text})
    if not any(page["text"] for page in pages):
        raise InvoiceError("scan_not_supported", "В PDF нет текстового слоя. Пока поддерживаются текстовые счета; скан можно заполнить вручную.")
    return {"pages": pages, "extracted": fields_from_pages(pages)}


def parse_invoice(content):
    try:
        result = subprocess.run([sys.executable, "-m", "backend.invoice_pdf"], input=content,
                                capture_output=True, timeout=12, check=False)
        payload = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, ValueError):
        raise InvoiceError("document_parse_failed", "Не удалось разобрать PDF. Попробуйте более простой текстовый счёт.") from None
    if "error" in payload:
        raise InvoiceError(payload["error"]["code"], payload["error"]["message"])
    if result.returncode:
        raise InvoiceError("document_parse_failed", "Не удалось разобрать PDF.")
    return payload


def main():
    try:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
        except ImportError:
            pass
        payload = extract_pdf(sys.stdin.buffer.read(MAX_BYTES + 1))
    except InvoiceError as exc:
        payload = {"error": {"code": exc.code, "message": str(exc)}}
    except Exception:
        payload = {"error": {"code": "invalid_pdf", "message": "PDF повреждён или его структуру не удалось прочитать."}}
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
