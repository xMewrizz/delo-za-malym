"""Read-only workflow help grounded in the current application, not bank promises."""
import re
from decimal import Decimal


def effective_need(context):
    result = dict(context.get("application", {}).get("need", {}))
    for proposal in context.get("previous_proposals", []):
        if proposal.get("status") == "pending":
            result.update({key[5:]: value for key, value in proposal.get("changes", {}).items() if key.startswith("need.")})
    return result


def is_workflow_question(text):
    question = re.sub(r"[.!?]+$", "", re.sub(r"\s+", " ", text.casefold().replace("ё", "е").strip()))
    patterns = (
        r"(?:а )?что(?: (?:я|мы))? (?:еще )?(?:можно|можем|могу|нужно|надо) (?:еще )?(?:уточнить|изменить|добавить)(?: (?:по|в) заявке)?",
        r"(?:а )?что(?: мне)?(?: делать)? дальше",
        r"(?:а )?(?:каких данных|чего)(?: еще)? не хватает(?: по заявке)?",
        r"(?:больше )?ничего (?:больше )?не (?:хочу|нужно) менять[, ]+(?:что|как) дальше",
        r"сумму и срок не меняй[.! ]+какие еще параметры можно выбрать",
    )
    return any(re.fullmatch(pattern, question) for pattern in patterns)


def workflow_help(text, context):
    if not is_workflow_question(text):
        return None
    need = effective_need(context)
    pending = any(item.get("status") == "pending" for item in context.get("previous_proposals", []))
    clarification = context.get("clarification") or {}
    summary = []
    if need.get("requested_amount"):
        amount = f"{Decimal(need['requested_amount']):,.2f}".replace(",", " ").replace(".", ",").removesuffix(",00")
        summary.append(f"сумма {amount} ₽")
    if need.get("term_months"):
        summary.append(f"срок {need['term_months']} мес")
    intro = "Уже указаны " + ", ".join(summary) + ". " if summary else ""
    if clarification.get("title"):
        return intro + "Ещё нужно уточнить: " + clarification["title"] + " Ответьте в карточке под разговором или напишите сообщение."
    if context.get("state", {}).get("status") not in {"draft", "waiting_for_data", "check_retry_pending", "offers_ready", "conditions_pending", "ready_to_sign", "offer_expired"}:
        return "Этот подбор уже завершён. Условия и ход рассмотрения доступны в разделе «Заявки», операции по выданному продукту — в «Моём финансировании». Для другой задачи начните новый подбор."
    choices = "Можно изменить сумму, срок или приоритет: меньший платёж либо меньшая переплата."
    if need.get("preferred_product") == "investment_loan":
        choices = "Можно уточнить стоимость проекта, собственный взнос, срок и отсрочку основного долга."
    elif need.get("preferred_product") == "overdraft" or need.get("financing_pattern") == "cash_gap":
        choices = "Можно уточнить суммы и даты будущих расходов и поступлений, а также запас денег на счёте."
    elif need.get("preferred_product") == "revolving_credit_line":
        choices = "Можно изменить лимит и срок доступности линии. Проценты будут зависеть от фактически использованной суммы."
    next_step = ("Если всё верно, проверьте данные справа и нажмите «Подтвердить данные и подобрать». Заявка в банк этим не отправляется."
                 if pending else "Если параметры подходят, откройте «Предложения» справа и сравните доступные условия. Отправку заявки вы подтвердите отдельно.")
    return intro + choices + "\n\n" + next_step
