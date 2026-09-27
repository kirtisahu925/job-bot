"""Claude via the official anthropic SDK (paid upgrade path).

- Structured output with a pydantic schema (`messages.parse`).
- The system prompt (framework + instructions) is a stable prefix marked for prompt caching.
- Opus models opt into server-side refusal fallbacks, so a rare policy decline is retried on another
  model inside the same call instead of failing the resume.
"""

from __future__ import annotations

import anthropic

from jobbot.llm.base import LLMError, RateLimited, RawUsage, T

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, effort: str = "medium"):
        self.client = anthropic.Anthropic(api_key=api_key, max_retries=3)
        self.effort = effort

    def generate(
        self, *, model: str, system: str, user: str, schema: type[T], max_output_tokens: int
    ) -> tuple[T, RawUsage]:
        kwargs = dict(
            model=model,
            max_tokens=max(max_output_tokens, 16000),
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_format=schema,
        )
        if not model.startswith("claude-haiku"):
            kwargs["thinking"] = {"type": "adaptive"}
            kwargs["output_config"] = {"effort": self.effort}
        try:
            if model.startswith("claude-opus"):
                resp = self.client.beta.messages.parse(**kwargs, betas=[FALLBACK_BETA], fallbacks="default")
            else:
                resp = self.client.messages.parse(**kwargs)
        except anthropic.RateLimitError as exc:
            raise RateLimited(f"{model}: rate limited") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"{model}: HTTP {exc.status_code} {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError(f"{model}: connection error {exc}") from exc

        u = resp.usage
        usage = RawUsage(
            input_tokens=(u.input_tokens or 0)
            + (u.cache_read_input_tokens or 0)
            + (u.cache_creation_input_tokens or 0),
            output_tokens=u.output_tokens or 0,
            cached_tokens=u.cache_read_input_tokens or 0,
        )
        if resp.stop_reason == "refusal":
            raise LLMError(f"{model}: refused ({getattr(resp.stop_details, 'category', None)})")
        if resp.stop_reason == "max_tokens" or resp.parsed_output is None:
            raise LLMError(f"{model}: incomplete structured output (stop_reason={resp.stop_reason})")
        return resp.parsed_output, usage
