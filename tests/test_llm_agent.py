"""Проверки протокола агента без запуска модели и без сетевых запросов."""

import json
import unittest
from copy import deepcopy
from dataclasses import replace
from io import BytesIO
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from scr.delo_za_malyn.Models.Agent import Agent
from scr.delo_za_malyn.Models.Agent.prompt_builder import PromptBuilder
from scr.delo_za_malyn.Models.Agent.tavily import SearchError, TavilyClient
from scr.delo_za_malyn.Models.Agent.tools import AgentTools
from scr.delo_za_malyn.Models.Llm.client import LLMClient, LLMContextLimit, LLMOutputLimit, LLMProtocolError, Reply, ToolCall
from scr.delo_za_malyn.settings.settings import Settings, settings


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.config = replace(settings, tavily_api_key="test-key", agent_max_tool_calls=2,
                              agent_tools_enabled=True)
        self.search = Mock(spec=TavilyClient)
        self.search.available = True
        self.search.search.return_value = {"ok": True, "sources": [
            {"title": "Источник", "url": "https://example.org", "content": "Факт"}
        ]}
        self.client = Mock(spec=LLMClient)
        self.agent = Agent(self.config, client=self.client, tools=AgentTools(self.search))

    def test_search_round_trip_and_next_turn_keep_server_history(self):
        requests = []
        replies = iter([
            Reply("", "tool_calls", (ToolCall("s1", "web_search", '{"query":"МСП"}'),)),
            Reply("Ответ со ссылкой", "stop"), Reply("Уточнение", "stop"),
        ])

        def respond(messages, **kwargs):
            requests.append(deepcopy(messages))
            return next(replies)

        self.client.chat.side_effect = respond
        original = [{"role": "user", "content": "Первый вопрос"},
                    {"role": "assistant", "content": "Первый ответ"}]
        snapshot = deepcopy(original)
        result = self.agent.run("Проверь условия", history=original, system_prompt="Мой промпт")
        self.assertEqual(result.text, "Ответ со ссылкой")
        self.assertEqual(result.tool_calls, 1)
        self.assertEqual(original, snapshot)
        self.assertEqual(requests[0][0], {"role": "system", "content": "Мой промпт"})
        tool = requests[1][-1]
        self.assertEqual(tool["role"], "tool")
        self.assertEqual(tool["tool_call_id"], "s1")
        self.assertEqual(json.loads(tool["content"])["sources"][0]["url"], "https://example.org")
        self.assertNotIn("system", [item["role"] for item in result.history])
        self.search.search.assert_called_once_with("МСП")
        self.agent.run("Объясни", history=result.history, system_prompt="Мой промпт")
        self.assertEqual(requests[2][1:-1], result.history)

    def test_prompt_file_is_read_again_on_each_turn(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "main.md"
            agent = Agent(replace(self.config, agent_prompts_dir=path.parent, tavily_api_key=""), client=self.client)
            self.client.chat.return_value = Reply("Ответ", "stop")
            path.write_text("Первый промпт", encoding="utf-8")
            agent.run("Вопрос")
            self.assertEqual(self.client.chat.call_args.args[0][0]["content"], "Первый промпт")
            path.write_text("Новый промпт", encoding="utf-8")
            agent.run("Вопрос")
            self.assertEqual(self.client.chat.call_args.args[0][0]["content"], "Новый промпт")

    def test_scenario_switch_rebuilds_system_without_keeping_old_in_history(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "main.md").write_text("Общие инструкции", encoding="utf-8")
            product = root / "products" / "working_capital_loan"
            (product / "scenarios").mkdir(parents=True)
            (product / "common.md").write_text("Правила продукта", encoding="utf-8")
            (product / "scenarios" / "needs_information.md").write_text("Уточнение", encoding="utf-8")
            (product / "scenarios" / "approved.md").write_text("Объяснение результата", encoding="utf-8")
            agent = Agent(replace(self.config, agent_prompts_dir=root, tavily_api_key=""), client=self.client)
            self.client.chat.return_value = Reply("Ответ", "stop")
            first = agent.run("Вопрос", product="working_capital_loan", scenario="needs_information")
            self.assertEqual(self.client.chat.call_args.args[0][0]["content"],
                             "Общие инструкции\n\nПравила продукта\n\nУточнение")
            agent.run("Продолжим", history=first.history,
                      product="working_capital_loan", scenario="approved")
            messages = self.client.chat.call_args.args[0]
            self.assertEqual(messages[0]["content"], "Общие инструкции\n\nПравила продукта\n\nОбъяснение результата")
            self.assertNotIn("Уточнение", json.dumps(messages, ensure_ascii=False))

    def test_no_key_means_normal_chat_without_tools(self):
        agent = Agent(replace(self.config, tavily_api_key=""), client=self.client)
        self.client.chat.return_value = Reply("Без поиска", "stop")
        result = agent.run("Привет", system_prompt="")
        self.assertEqual(result.tool_calls, 0)
        self.assertEqual(self.client.chat.call_args.kwargs["tools"], [])

    def test_disabled_tools_keep_prompt_and_history_without_search_even_with_key(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "main.md").write_text("Основной промпт", encoding="utf-8")
            # Файла tools/web_search.md намеренно нет: в этом режиме он не нужен.
            history = [{"role": "user", "content": "ИП 18 месяцев"},
                       {"role": "assistant", "content": "Учёл"}]
            agent = Agent(replace(self.config, agent_prompts_dir=root, agent_tools_enabled=False),
                          client=self.client, tools=AgentTools(self.search))
            self.client.chat.return_value = Reply("Ответ", "stop")
            result = agent.run("Пекарне 8 месяцев", history=history)
            payload_messages = self.client.chat.call_args.args[0]
            self.assertEqual(payload_messages[0]["content"], "Основной промпт")
            self.assertEqual(payload_messages[1:3], history)
            self.assertEqual(self.client.chat.call_args.kwargs["tools"], [])
            self.assertEqual(result.tool_calls, 0)
            self.search.search.assert_not_called()

    def test_disabled_tools_do_not_execute_an_unsolicited_call(self):
        agent = Agent(replace(self.config, agent_tools_enabled=False),
                      client=self.client, tools=AgentTools(self.search))
        self.client.chat.return_value = Reply("", "tool_calls", (
            ToolCall("s1", "web_search", '{"query":"МСП"}'),
        ))
        with self.assertRaisesRegex(RuntimeError, "инструменты недоступны"):
            agent.run("Вопрос", system_prompt="")
        self.search.search.assert_not_called()

    def test_unknown_tool_and_invalid_arguments_never_search(self):
        tools = self.agent.tools
        cases = [("delete_file", '{}'), ("web_search", "oops"),
                 ("web_search", '{"query":5}'), ("web_search", '{"query":" "}'),
                 ("web_search", '{"query":"ok","extra":1}')]
        for name, arguments in cases:
            with self.subTest(name=name, arguments=arguments):
                self.assertFalse(json.loads(tools.execute(name, arguments))["ok"])
        self.search.search.assert_not_called()

    def test_search_failure_is_returned_to_model_without_false_success(self):
        self.search.search.side_effect = SearchError("quota_exceeded", "Лимит исчерпан.")
        requests = []
        replies = iter([
            Reply("", "tool_calls", (ToolCall("s1", "web_search", '{"query":"МСП"}'),)),
            Reply("Проверить не удалось", "stop"),
        ])

        def respond(messages, **kwargs):
            requests.append(deepcopy(messages))
            return next(replies)

        self.client.chat.side_effect = respond
        self.agent.run("Проверь", system_prompt="")
        error = json.loads(requests[1][-1]["content"])
        self.assertFalse(error["ok"])
        self.assertEqual(error["error"]["code"], "quota_exceeded")

    def test_batch_budget_and_final_request_disable_tools(self):
        self.client.chat.side_effect = [
            Reply("", "tool_calls", tuple(
                ToolCall(f"s{i}", "web_search", '{"query":"МСП"}') for i in range(4)
            )), Reply("Итог", "stop"),
        ]
        result = self.agent.run("Проверь", system_prompt="")
        self.assertEqual(self.search.search.call_count, 2)
        self.assertEqual(result.tool_calls, 2)
        messages = result.history
        tool_messages = [m for m in messages if m["role"] == "tool"]
        self.assertEqual(len(tool_messages), 4)
        self.assertFalse(json.loads(tool_messages[-1]["content"])["ok"])
        self.assertEqual(self.client.chat.call_args.kwargs["tool_choice"], "none")

    def test_noncompliant_model_cannot_loop_forever(self):
        self.client.chat.return_value = Reply("", "tool_calls", (
            ToolCall("s1", "web_search", '{"query":"МСП"}'),
        ))
        with self.assertRaisesRegex(RuntimeError, "после исчерпания"):
            self.agent.run("Проверь", system_prompt="")
        self.assertEqual(self.search.search.call_count, 2)
        self.assertEqual(self.client.chat.call_count, 3)

    def test_error_does_not_mutate_history(self):
        history = [{"role": "user", "content": "Вопрос"}, {"role": "assistant", "content": "Ответ"}]
        snapshot = deepcopy(history)
        self.client.chat.side_effect = RuntimeError("Сервер недоступен")
        with self.assertRaises(RuntimeError):
            self.agent.run("Ещё вопрос", history=history, system_prompt="")
        self.assertEqual(history, snapshot)

    def test_complete_http_round_trip_keeps_tavily_key_out_of_llm_payload(self):
        config = replace(self.config, llm_model="test-model", llm_api_key="")
        payloads = []

        def model_http(request, **kwargs):
            payload = json.loads(request.data)
            payloads.append(payload)
            if len(payloads) == 1:
                message = {"content": None, "tool_calls": [{
                    "id": "search-1", "type": "function", "function": {
                        "name": "web_search", "arguments": '{"query":"МСП"}'},
                }]}
                finish = "tool_calls"
            else:
                tool_message = payload["messages"][-1]
                self.assertEqual(tool_message["tool_call_id"], "search-1")
                self.assertEqual(json.loads(tool_message["content"])["sources"][0]["url"], "https://example.org")
                message, finish = {"content": "Проверил источник"}, "stop"
            return BytesIO(json.dumps({"choices": [{"message": message, "finish_reason": finish}]}).encode())

        search_response = {"results": [{"title": "Источник", "url": "https://example.org", "content": "Факт"}]}
        with patch("scr.delo_za_malyn.Models.Llm.client.urlopen", side_effect=model_http):
            with patch("scr.delo_za_malyn.Models.Agent.tavily.urlopen", return_value=BytesIO(json.dumps(search_response).encode())):
                result = Agent(config).run("Проверь", system_prompt="")
        self.assertEqual(result.text, "Проверил источник")
        self.assertEqual(len(payloads), 2)
        self.assertNotIn("test-key", json.dumps(payloads))


class LLMToolProtocolTests(unittest.TestCase):
    def setUp(self):
        self.client = LLMClient(replace(settings, llm_model="test-model", llm_api_key=""))

    def response(self, message, finish="stop"):
        return {"choices": [{"message": message, "finish_reason": finish}]}

    def test_tool_only_response_is_valid_and_can_be_replayed(self):
        message = {"role": "assistant", "content": None, "tool_calls": [
            {"id": "s1", "type": "function", "function": {
                "name": "web_search", "arguments": '{"query":"МСП"}'}}
        ]}
        with patch.object(self.client, "_request", return_value=self.response(message, "tool_calls")) as request:
            reply = self.client.chat([{"role": "user", "content": "Проверь"}], tools=[{"type": "function"}])
        self.assertEqual(reply.tool_calls[0].name, "web_search")
        self.assertEqual(reply.as_message()["tool_calls"], message["tool_calls"])
        self.assertEqual(request.call_args.args[1]["tool_choice"], "auto")

    def test_truncated_and_unparsed_calls_are_not_shown_as_answers(self):
        for text, finish in [("Незаконченный ответ", "length"), ("<|tool_call>call:web_search{}", "stop")]:
            with self.subTest(finish=finish):
                with patch.object(self.client, "_request", return_value=self.response({"content": text}, finish)):
                    with self.assertRaises(RuntimeError):
                        self.client.chat([])

    def test_duplicate_call_ids_are_rejected(self):
        call = {"id": "s1", "type": "function", "function": {"name": "web_search", "arguments": "{}"}}
        with patch.object(self.client, "_request", return_value=self.response({"tool_calls": [call, call]})):
            with self.assertRaises(RuntimeError):
                self.client.chat([])

    def test_context_preflight_includes_tools_and_reserves_answer_without_network(self):
        client = LLMClient(replace(settings, llm_model="test", llm_context_size=4096, llm_max_output_tokens=1024))
        with patch.object(client, "_request") as request:
            with self.assertRaises(LLMContextLimit):
                client.chat([{"role": "user", "content": "данные " * 4000}])
            with self.assertRaises(LLMContextLimit):
                client.chat([{"role": "user", "content": "Привет"}], tools=[{"description": "описание " * 4000}])
            request.assert_not_called()
        with patch.object(client, "_request", return_value=self.response({"content": "Здравствуйте"})) as request:
            self.assertEqual(client.chat([{"role": "user", "content": "Привет"}]).text, "Здравствуйте")
            request.assert_called_once()

    def test_truncation_distinguishes_full_context_from_output_budget(self):
        client = LLMClient(replace(settings, llm_model="test", llm_context_size=4096, llm_max_output_tokens=1024))
        data = self.response({"content": "Неполный ответ"}, "length")
        data["usage"] = {"prompt_tokens": 3994, "completion_tokens": 102}
        with patch.object(client, "_request", return_value=data):
            with self.assertRaises(LLMContextLimit):
                client.chat([])
        data["usage"] = {"prompt_tokens": 1000, "completion_tokens": 1024}
        with patch.object(client, "_request", return_value=data):
            with self.assertRaises(LLMOutputLimit):
                client.chat([])

    def test_protocol_errors_identify_empty_and_unparsed_responses_without_leaking_reasoning(self):
        for message, reason in (({"content": "", "reasoning": "private-reasoning"}, "empty_response"),
                                ({"content": "<|tool_call>call:calculate_loan{}"}, "unparsed_tool_call"),
                                ({"content": 123}, "invalid_response")):
            with self.subTest(reason=reason):
                with patch.object(self.client, "_request", return_value=self.response(message)):
                    with self.assertLogs("scr.delo_za_malyn.Models.Llm.client", level="WARNING") as logs:
                        with self.assertRaises(LLMProtocolError) as caught:
                            self.client.chat([])
                self.assertEqual(caught.exception.reason, reason)
                self.assertNotIn("private-reasoning", str(caught.exception))
                self.assertNotIn("private-reasoning", " ".join(logs.output))


class TavilyTests(unittest.TestCase):
    def setUp(self):
        self.config = replace(settings, tavily_api_key="test-key", tavily_snippet_chars=100,
                              tavily_max_results=1, tavily_timeout_seconds=2)

    def test_request_uses_basic_search_and_bounds_external_content(self):
        body = {"results": [{"title": "Источник", "url": "https://example.org", "content": "x" * 500}] * 3}
        with patch("scr.delo_za_malyn.Models.Agent.tavily.urlopen",
                   return_value=BytesIO(json.dumps(body).encode())) as opening:
            result = TavilyClient(self.config).search("МСП")
        request = opening.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertEqual(payload["search_depth"], "basic")
        self.assertFalse(payload["auto_parameters"])
        self.assertEqual(opening.call_args.kwargs["timeout"], 2)
        self.assertEqual(len(result["sources"]), 1)
        self.assertEqual(len(result["sources"][0]["content"]), 100)
        self.assertTrue(result["untrusted_external_data"])

    def test_error_body_and_key_do_not_leak(self):
        for status in (401, 429, 432, 500):
            with self.subTest(status=status):
                error = HTTPError("https://api.tavily.com/search", status, "test-key", {}, BytesIO(b"test-key"))
                with patch("scr.delo_za_malyn.Models.Agent.tavily.urlopen", side_effect=error):
                    with self.assertRaises(SearchError) as caught:
                        TavilyClient(self.config).search("МСП")
                self.assertNotIn("test-key", str(caught.exception))

    def test_missing_key_and_bad_query_do_not_make_requests(self):
        with patch("scr.delo_za_malyn.Models.Agent.tavily.urlopen") as opening:
            with self.assertRaises(SearchError):
                TavilyClient(replace(self.config, tavily_api_key="")).search("МСП")
            with self.assertRaises(SearchError):
                TavilyClient(self.config).search(" " * 3)
        opening.assert_not_called()

    def test_timeout_and_invalid_responses(self):
        with patch("scr.delo_za_malyn.Models.Agent.tavily.urlopen", side_effect=TimeoutError):
            with self.assertRaises(SearchError) as caught:
                TavilyClient(self.config).search("МСП")
        self.assertEqual(caught.exception.code, "timeout")
        for body in (b"not json", b"[]", b'{"results":{}}', b'{"results":[{}]}'):
            with self.subTest(body=body):
                with patch("scr.delo_za_malyn.Models.Agent.tavily.urlopen", return_value=BytesIO(body)):
                    with self.assertRaises(SearchError):
                        TavilyClient(self.config).search("МСП")

    def test_secret_is_excluded_from_settings_repr(self):
        self.assertNotIn("test-key", repr(self.config))

    def test_new_settings_load_from_template_and_validate_limits(self):
        template = Path("scr/delo_za_malyn/settings/.env.example").read_text(encoding="utf-8")
        with TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(template, encoding="utf-8")
            with patch.dict("os.environ", {}, clear=True):
                config = Settings.load(path)
                self.assertEqual(config.agent_max_tool_calls, 3)
                self.assertEqual(config.tavily_api_key, "")
                self.assertTrue(config.agent_tools_enabled)
                self.assertEqual(config.agent_prompts_dir,
                                 (path.parent.parent / "Models/Agent/prompts").resolve())
                path.write_text(template.replace("AGENT_MAX_TOOL_CALLS=3", "AGENT_MAX_TOOL_CALLS=0"), encoding="utf-8")
                with self.assertRaises(ValueError):
                    Settings.load(path)


class PromptBuilderTests(unittest.TestCase):
    def test_composition_includes_only_selected_scenario_and_available_tools(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            texts = {
                "main.md": "Основной",
                "tools/web_search.md": "Поиск",
                "products/overdraft/common.md": "Овердрафт",
                "products/overdraft/scenarios/approved.md": "Одобрен",
                "products/overdraft/scenarios/declined.md": "Отказ",
            }
            for name, text in texts.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            builder = PromptBuilder(root)
            self.assertEqual(builder.build(product="overdraft", scenario="approved", tools=("web_search",)),
                             "Основной\n\nПоиск\n\nОвердрафт\n\nОдобрен")
            self.assertEqual(builder.build(product="overdraft"), "Основной\n\nОвердрафт")
            self.assertEqual(builder.build(), "Основной")

    def test_invalid_and_missing_selection_is_not_silently_ignored(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "main.md").touch()
            builder = PromptBuilder(root)
            for args in ({"scenario": "approved"}, {"product": "../outside"},
                         {"product": ""}, {"tools": ("/outside",)}):
                with self.subTest(args=args):
                    with self.assertRaises(ValueError):
                        builder.build(**args)
            with self.assertRaisesRegex(RuntimeError, "missing/common.md"):
                builder.build(product="missing")

    def test_symlink_cannot_read_a_prompt_outside_configured_directory(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "prompts"
            root.mkdir()
            outside = base / "outside.md"
            outside.write_text("Внешний файл", encoding="utf-8")
            (root / "main.md").symlink_to(outside)
            with self.assertRaises(ValueError):
                PromptBuilder(root).build()
