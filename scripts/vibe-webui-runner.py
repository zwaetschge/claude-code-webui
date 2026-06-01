#!/usr/bin/env python3
"""Run Mistral Vibe in WebUI programmatic mode.

The stock `vibe -p` path is headless and has no approval callback, so tools that
resolve to ASK are either auto-approved by the auto-approve agent or skipped by
the core loop. This runner mirrors Vibe's programmatic entrypoint but wires ASK
decisions into Plum Code WebUI's permission endpoints.
"""

from __future__ import annotations

import argparse
import asyncio
from contextlib import aclosing
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
import uuid
from typing import Any

from pydantic import BaseModel

from vibe import __version__
from vibe.cli.cli import (
    _build_cli_entrypoint_metadata,
    bootstrap_config_files,
    get_initial_agent_name,
    load_config_or_exit,
    load_dotenv_values,
    load_session,
    warn_if_workdir_trust_is_unset,
)
from vibe.core.agent_loop import AgentLoop, TeleportError
from vibe.core.config.harness_files import init_harness_files_manager
from vibe.core.hooks.config import load_hooks_from_fs
from vibe.core.logger import logger
from vibe.core.output_formatters import create_formatter
from vibe.core.session.session_loader import SessionLoader
from vibe.core.telemetry.build_metadata import build_entrypoint_metadata
from vibe.core.tools.permissions import RequiredPermission
from vibe.core.tracing import setup_tracing
from vibe.core.trusted_folders import trusted_folders_manager
from vibe.core.types import (
    ApprovalResponse,
    AssistantEvent,
    LLMMessage,
    OutputFormat,
    Role,
)
from vibe.core.utils import ConversationLimitException

PLAN_ALLOWED_TOOLS = {"TodoWrite", "ExitPlanMode"}
BASH_CHAIN_RE = re.compile(r"\s*(?:;|&&|\|\||\|)\s*")
BASH_SUBSTITUTION_RE = re.compile(r"`|\$\(")

TOOL_DISPLAY_NAMES = {
    "bash": "Bash",
    "shell": "Bash",
    "read": "Read",
    "write": "Write",
    "edit": "Edit",
    "apply_patch": "Edit",
    "glob": "Glob",
    "grep": "Grep",
    "list": "LS",
    "ls": "LS",
    "webfetch": "WebFetch",
    "web_fetch": "WebFetch",
    "websearch": "WebSearch",
    "web_search": "WebSearch",
    "task": "Task",
    "todowrite": "TodoWrite",
    "todo_write": "TodoWrite",
    "exit_plan_mode": "ExitPlanMode",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Vibe with WebUI permission callbacks")
    parser.add_argument("-p", "--prompt", nargs="?", const="", metavar="TEXT")
    parser.add_argument("--output", choices=["text", "json", "streaming"], default="streaming")
    parser.add_argument("--agent", default=None)
    parser.add_argument("--max-turns", type=int, default=None)
    parser.add_argument("--max-price", type=float, default=None)
    parser.add_argument("--enabled-tools", action="append", default=None)
    parser.add_argument("--workdir", type=Path, default=None)
    parser.add_argument("--add-dir", action="append", default=[])
    parser.add_argument("--trust", action="store_true")
    parser.add_argument("-c", "--continue", action="store_true", dest="continue_session")
    parser.add_argument("--resume", nargs="?", const=True, default=None)
    parser.add_argument("initial_prompt", nargs="?")
    return parser.parse_args()


def http_json(method: str, url: str, payload: dict[str, Any] | None, timeout: float) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "content-type": "application/json",
            "x-webui-hook-secret": os.environ.get("WEBUI_HOOK_SECRET", ""),
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    if not raw:
        return {}
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {}


def model_to_json(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [model_to_json(item) for item in value]
    if isinstance(value, dict):
        return {str(k): model_to_json(v) for k, v in value.items()}
    return value


def display_tool_name(tool: str) -> str:
    normalized = tool.replace("-", "_").lower()
    return TOOL_DISPLAY_NAMES.get(normalized, tool)


def resolve_config_home() -> Path:
    override = os.environ.get("WEBUI_CONFIG_HOME") or os.environ.get("CLAUDE_CONFIG_HOME")
    if override and override.strip():
        return Path(override.strip()).expanduser()
    return Path.home() / ".claude"


def load_json(path: Path) -> dict[str, Any]:
    try:
        if path.exists():
            parsed = json.loads(path.read_text(encoding="utf-8"))
            return parsed if isinstance(parsed, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}
    return {}


def allowed_patterns() -> list[str]:
    patterns: list[str] = []
    config_home = resolve_config_home()

    global_settings = load_json(config_home / "settings.json")
    global_permissions = global_settings.get("permissions")
    global_allow = global_permissions.get("allow", []) if isinstance(global_permissions, dict) else []
    if isinstance(global_allow, list):
        patterns.extend(str(item) for item in global_allow if isinstance(item, str))

    project_path = os.environ.get("WEBUI_PROJECT_PATH")
    if project_path:
        project_settings = load_json(Path(project_path) / ".claude" / "settings.local.json")
        project_permissions = project_settings.get("permissions")
        project_allow = (
            project_permissions.get("allow", []) if isinstance(project_permissions, dict) else []
        )
        if isinstance(project_allow, list):
            patterns.extend(str(item) for item in project_allow if isinstance(item, str))

    return patterns


def match_value(tool_name: str, tool_input: Any) -> str:
    if not isinstance(tool_input, dict):
        return ""
    lowered = tool_name.lower()
    if lowered in {"bash", "shell"}:
        return str(tool_input.get("command") or tool_input.get("cmd") or "")
    if lowered in {"read", "write", "edit", "apply_patch", "ls", "list"}:
        return str(
            tool_input.get("file_path")
            or tool_input.get("filePath")
            or tool_input.get("path")
            or tool_input.get("pattern")
            or ""
        )
    if lowered == "grep":
        return str(tool_input.get("pattern") or tool_input.get("path") or "")
    if lowered == "glob":
        return str(tool_input.get("pattern") or "")
    if lowered == "webfetch":
        return str(tool_input.get("url") or "")
    if lowered == "websearch":
        return str(tool_input.get("query") or "")
    return ""


def bash_prefix_matches(command: str, prefix: str) -> bool:
    if BASH_SUBSTITUTION_RE.search(command):
        return False
    segments = [segment.strip() for segment in BASH_CHAIN_RE.split(command) if segment.strip()]
    return bool(segments) and all(segment.startswith(prefix) for segment in segments)


def pattern_matches(pattern: str, tool_aliases: set[str], tool_input: Any) -> bool:
    match = re.match(r"^([A-Za-z0-9_:-]+)\((.*):\*\)$", pattern)
    if not match:
        return pattern in tool_aliases

    pattern_tool, prefix = match.groups()
    if pattern_tool not in tool_aliases:
        return False
    if not prefix:
        return True

    value = match_value(pattern_tool, tool_input)
    if pattern_tool.lower() in {"bash", "shell"}:
        return bash_prefix_matches(value, prefix)
    return value.startswith(prefix)


def is_auto_approved(tool: str, tool_input: Any) -> str | None:
    display = display_tool_name(tool)
    aliases = {tool, tool.lower(), display, display.lower()}
    if ":" not in tool:
        aliases.add(f"vibe:{tool}")
        aliases.add(f"vibe:{display}")
    for pattern in allowed_patterns():
        if pattern_matches(pattern, aliases, tool_input):
            return pattern
    return None


def suggested_pattern(tool: str, tool_input: Any) -> str:
    display = display_tool_name(tool)
    value = match_value(display, tool_input)
    if display == "Bash" and value:
        parts = value.split()
        return f"Bash({' '.join(parts[:2])}:*)" if len(parts) >= 2 else f"Bash({parts[0]}:*)"
    if display in {"Read", "Write", "Edit"} and value:
        path = str(value)
        slash = path.rfind("/")
        if slash > 0:
            return f"{display}({path[: slash + 1]}:*)"
    return f"{display}(:*)"


def required_permission_summary(required_permissions: list[RequiredPermission] | None) -> str:
    if not required_permissions:
        return ""
    labels: list[str] = []
    for perm in required_permissions:
        label = getattr(perm, "label", None) or getattr(perm, "invocation_pattern", None)
        if label:
            labels.append(str(label))
    return "; ".join(labels)


async def request_webui_approval(
    tool: str,
    args: BaseModel,
    _tool_call_id: str,
    required_permissions: list[RequiredPermission] | None,
) -> tuple[ApprovalResponse, str | None]:
    session_mode = os.environ.get("WEBUI_SESSION_MODE", "").lower()
    tool_input = model_to_json(args)
    display_tool = display_tool_name(tool)

    if session_mode in {"auto-accept", "danger"}:
        return (ApprovalResponse.YES, None)
    if session_mode == "planning" and display_tool not in PLAN_ALLOWED_TOOLS:
        return (ApprovalResponse.NO, "Plan mode blocks this tool.")

    matched_pattern = is_auto_approved(tool, tool_input)
    if matched_pattern:
        return (ApprovalResponse.YES, None)

    backend = os.environ.get("WEBUI_BACKEND_URL", "http://localhost:3001").rstrip("/")
    session_id = os.environ.get("WEBUI_SESSION_ID", "")
    request_id = str(uuid.uuid4())
    summary = required_permission_summary(required_permissions)
    payload = {
        "sessionId": session_id,
        "requestId": request_id,
        "toolName": display_tool,
        "toolInput": {
            "args": tool_input,
            "requiredPermissions": model_to_json(required_permissions or []),
        },
        "description": f"Vibe requests {tool}{': ' + summary if summary else ''}",
        "suggestedPattern": suggested_pattern(tool, tool_input),
    }

    try:
        await asyncio.to_thread(
            http_json,
            "POST",
            f"{backend}/api/permissions/request",
            payload,
            15,
        )
        response = await asyncio.to_thread(
            http_json,
            "GET",
            f"{backend}/api/permissions/response/{request_id}",
            None,
            130,
        )
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        print(f"[vibe-webui-runner] approval request failed: {exc}", file=sys.stderr)
        return (ApprovalResponse.NO, "Permission request failed.")

    if response.get("approved") is True:
        return (ApprovalResponse.YES, None)
    return (ApprovalResponse.NO, str(response.get("error") or "Denied by user."))


async def run_agent(
    *,
    config: Any,
    prompt: str,
    output_format: OutputFormat,
    agent_name: str,
    max_turns: int | None,
    max_price: float | None,
    previous_messages: list[LLMMessage] | None,
    previous_session_path: Path | None,
    hook_config_result: Any,
) -> str | None:
    formatter = create_formatter(output_format)
    agent_loop = AgentLoop(
        config,
        agent_name=agent_name,
        message_observer=formatter.on_message_added,
        max_turns=max_turns,
        max_price=max_price,
        enable_streaming=False,
        headless=True,
        entrypoint_metadata=build_entrypoint_metadata(
            agent_entrypoint="webui_programmatic",
            agent_version=__version__,
            client_name="plum_code_webui",
            client_version=__version__,
        ),
        hook_config_result=hook_config_result,
    )
    agent_loop.set_approval_callback(request_webui_approval)
    logger.info("USER: %s", prompt)

    try:
        if previous_messages and previous_session_path is not None:
            non_system = [msg for msg in previous_messages if msg.role != Role.system]
            agent_loop.messages.extend(non_system)
            _, metadata = SessionLoader.load_session(previous_session_path)
            session_id = metadata.get("session_id", agent_loop.session_id)
            agent_loop.session_id = session_id
            agent_loop.parent_session_id = metadata.get("parent_session_id")
            agent_loop.session_logger.resume_existing_session(session_id, previous_session_path)
            logger.info("Resumed session %s with %d messages", session_id, len(non_system))
        else:
            await agent_loop.initialize_experiments()
            agent_loop.emit_new_session_telemetry()

        async with aclosing(agent_loop.act(prompt)) as events:
            async for event in events:
                formatter.on_event(event)
                if isinstance(event, AssistantEvent) and event.stopped_by_middleware:
                    raise ConversationLimitException(event.content)
        return formatter.finalize()
    finally:
        agent_loop.emit_session_closed_telemetry()
        await agent_loop.aclose()
        await agent_loop.telemetry_client.aclose()


def main() -> None:
    args = parse_args()
    if args.workdir:
        workdir = args.workdir.expanduser().resolve()
        if not workdir.is_dir():
            print(f"Error: --workdir does not exist or is not a directory: {workdir}", file=sys.stderr)
            sys.exit(1)
        os.chdir(workdir)

    cwd = Path.cwd()
    if args.trust:
        trusted_folders_manager.trust_for_session(cwd)

    add_dirs: list[Path] = []
    for entry in args.add_dir:
        resolved = Path(entry).expanduser().resolve()
        if not resolved.is_dir():
            print(f"Error: --add-dir path does not exist or is not a directory: {entry}", file=sys.stderr)
            sys.exit(1)
        add_dirs.append(resolved)
        trusted_folders_manager.trust_for_session(resolved)

    init_harness_files_manager("user", "project", additional_dirs=add_dirs)
    load_dotenv_values()
    bootstrap_config_files()

    config = load_config_or_exit(interactive=False)
    if args.enabled_tools:
        config.enabled_tools = args.enabled_tools
    hook_config_result = load_hooks_from_fs(config)
    setup_tracing(config)

    warn_if_workdir_trust_is_unset()
    config.disabled_tools = [*config.disabled_tools, "ask_user_question", "exit_plan_mode"]

    prompt = args.prompt or args.initial_prompt
    if not prompt:
        print("Error: No prompt provided for programmatic mode", file=sys.stderr)
        sys.exit(1)

    loaded = load_session(args, config)
    agent_name = get_initial_agent_name(args, config)
    output_format = OutputFormat(args.output)

    try:
        final = asyncio.run(
            run_agent(
                config=config,
                prompt=prompt,
                output_format=output_format,
                agent_name=agent_name,
                max_turns=args.max_turns,
                max_price=args.max_price,
                previous_messages=loaded[0] if loaded else None,
                previous_session_path=loaded[1] if loaded else None,
                hook_config_result=hook_config_result,
            )
        )
        if final:
            print(final)
    except ConversationLimitException as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except TeleportError as exc:
        print(f"Teleport error: {exc}", file=sys.stderr)
        sys.exit(1)
    except (RuntimeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
