import logging

from scr.delo_za_malyn.Models.Llm.client import LLMClient
from scr.delo_za_malyn.settings.logging_config import configure_logging
from scr.delo_za_malyn.settings.settings import settings

logger = logging.getLogger(__name__)


def main() -> int:
    configure_logging()
    try:
        models = LLMClient().list_models()
        logger.info("API доступен. Модели на сервере: %s", ", ".join(models) or "нет моделей")
        if not settings.llm_model:
            logger.warning("Модель пока не выбрана. Заполните LLM_MODEL перед использованием интерфейса.")
        elif settings.llm_model not in models:
            logger.error("LLM_MODEL отсутствует в списке моделей сервера.")
            return 1
    except RuntimeError as exc:
        logger.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
