# Сценарии: согласованные тексты

Общий `main.md` уже согласован и подключён. Все 14 сценариев и общие инструкции
двух продуктов согласованы и перенесены в рабочие промпты 21 октября 2026 года.
Здесь сохранены копии согласованных текстов; сборщик читает рабочие файлы
в `Models/Agent/prompts`, а не эту папку. Инструменты кредитного процесса
и RAG на этом этапе не добавлялись. Модель не запускалась.

## Общие инструкции продуктов

- [Разовый кредит](working-capital-common.md) → `products/working_capital_loan/common.md`.
- [Овердрафт](overdraft-common.md) → `products/overdraft/common.md`.

Общие инструкции читаются вместе с основным промптом и одним выбранным сценарием.
Условия продукта и цифры в них не зафиксированы: они должны поступать из каталога
и актуального результата расчёта.

## Все 14 текущих ситуаций

Пути назначения указаны относительно `Models/Agent/prompts`.

| Продукт | Ситуация и согласованный текст | Рабочий файл |
|---|---|---|
| Разовый кредит | [Запрошенные условия подходят](working-capital-approved.md) | `products/working_capital_loan/scenarios/approved.md` |
| Разовый кредит | [Предложен более длительный срок](working-capital-longer-term.md) | `products/working_capital_loan/scenarios/longer_term.md` |
| Разовый кредит | [Предложена меньшая сумма](working-capital-lower-amount.md) | `products/working_capital_loan/scenarios/lower_amount.md` |
| Разовый кредит | [Нужны сведения](working-capital-needs-information.md) | `products/working_capital_loan/scenarios/needs_information.md` |
| Разовый кредит | [Нужно поручительство](working-capital-guarantor-required.md) | `products/working_capital_loan/scenarios/guarantor_required.md` |
| Разовый кредит | [Отказ](working-capital-declined.md) | `products/working_capital_loan/scenarios/declined.md` |
| Разовый кредит | [Проверка недоступна](working-capital-check-unavailable.md) | `products/working_capital_loan/scenarios/check_unavailable.md` |
| Овердрафт | [Запрошенный лимит подходит](overdraft-approved.md) | `products/overdraft/scenarios/approved.md` |
| Овердрафт | [Предложен меньший лимит](overdraft-lower-limit.md) | `products/overdraft/scenarios/lower_limit.md` |
| Овердрафт | [Нужен план операций](overdraft-missing-plan.md) | `products/overdraft/scenarios/missing_plan.md` |
| Овердрафт | [Погашение пока не показано](overdraft-repayment-unclear.md) | `products/overdraft/scenarios/repayment_unclear.md` |
| Овердрафт | [Нужно поручительство](overdraft-guarantor-required.md) | `products/overdraft/scenarios/guarantor_required.md` |
| Овердрафт | [План не проходит](overdraft-declined.md) | `products/overdraft/scenarios/declined.md` |
| Овердрафт | [Проверка недоступна](overdraft-check-unavailable.md) | `products/overdraft/scenarios/check_unavailable.md` |

Черновики сверены с форматом и смыслом 7 примеров из
[contracts/scenarios](../../../contracts/scenarios) и 7 примеров из
[contracts/overdraft/scenarios](../../../contracts/overdraft/scenarios).
Фиксированные суммы, ставки, сроки и ожидаемые ответы из примеров в инструкции
не перенесены. Ответы модели по этим инструкциям ещё не проверялись.

## Что проверять при следующих изменениях

1. Когда инструкция применима и какие фактические поля подтверждают ситуацию.
2. Какие условия и причины можно объяснять клиенту.
3. Какие вопросы нужно задать, когда данных не хватает.
4. Какой следующий шаг доступен, а какие действия требуют подтверждения.

Следующие редакции сначала показываются автору проекта. После подтверждения
конкретный текст переносится в соответствующий рабочий файл.

## Границы этого набора

Это 14 ситуаций из текущих JSON-примеров, а не все возможные состояния процесса.
Для `invalid_data`, `needs_checks` и `out_of_policy` действуют общие инструкции;
отдельных сценарных файлов для них пока нет. Автоматический выбор сценария
по результату рассмотрения также ещё не подключён.

## Следующие этапы

1. Подключить инструменты получения заявки, каталога, отдельной симуляции
   и подготовки правок с подтверждением в интерфейсе.
2. Подключить JSON-примеры к RAG как справочные случаи. Сохранить отдельный набор
   проверочных случаев, который не включается в поиск примеров для этих проверок.

JSON сейчас остаются на своих местах в `contracts`. При подключении RAG нужно
сохранить различие между входным примером, его ожидаемым результатом и реальными
данными текущего клиента. Найденный пример не устанавливает лимит, ставку,
подтверждение или кредитное решение для новой заявки. Их возвращает движок.
