"""Агент локальной модели с разрешёнными инструментами."""

__all__ = ["Agent", "AgentReply"]


def __getattr__(name):
    if name in __all__:
        from .agent import Agent, AgentReply
        return {"Agent": Agent, "AgentReply": AgentReply}[name]
    raise AttributeError(name)
