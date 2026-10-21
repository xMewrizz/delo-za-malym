"""Сборка общего промпта и инструкций выбранного продукта/сценария."""

import re
from pathlib import Path


class PromptBuilder:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def build(
        self, *, product: str | None = None, scenario: str | None = None,
        tools: tuple[str, ...] = (),
    ) -> str:
        """Читает только явно выбранные файлы, заново при каждом ходе."""
        if scenario is not None and product is None:
            raise ValueError("Для сценария нужно выбрать product.")
        paths = [Path("main.md")]
        for name in dict.fromkeys(tools):
            self._validate_name(name)
            paths.append(Path("tools") / f"{name}.md")
        if product is not None:
            self._validate_name(product)
            base = Path("products") / product
            paths.append(base / "common.md")
            if scenario is not None:
                self._validate_name(scenario)
                paths.append(base / "scenarios" / f"{scenario}.md")
        parts = [self._read(path).strip() for path in paths]
        return "\n\n".join(part for part in parts if part)

    @staticmethod
    def _validate_name(name: str) -> None:
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", name):
            raise ValueError("Имя продукта, сценария или инструмента: латиница, цифры и подчёркивание.")

    def _read(self, relative: Path) -> str:
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Промпт должен находиться внутри AGENT_PROMPTS_DIR.")
        try:
            return path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            raise RuntimeError(f"Не удалось прочитать промпт: {relative.as_posix()}") from None
