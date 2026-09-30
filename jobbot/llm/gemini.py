"""Gemini via the google-genai SDK with JSON-schema constrained output."""

from __future__ import annotations

from google import genai
from google.genai import errors, types
from pydantic import ValidationError
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from jobbot.llm.base import LLMError, RateLimited, RawUsage, T, Unavailable


class _Transient(Exception):
    pass


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)

    # 503 "model is experiencing high demand" spikes usually pass within a minute or two
    @retry(
        retry=retry_if_exception_type(_Transient),
        stop=stop_after_attempt(5),
        wait=wait_exponential(4, max=60),
        reraise=True,
    )
    def _call(self, model: str, system: str, user: str, schema: type[T], max_output_tokens: int):
        try:
            return self.client.models.generate_content(
                model=model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    response_schema=schema,
                    max_output_tokens=max_output_tokens,
                    temperature=0.4,
                ),
            )
        except errors.ClientError as exc:
            if exc.code == 429:
                raise RateLimited(f"{model}: {exc.message or 'rate limited'}") from exc
            raise LLMError(f"{model}: HTTP {exc.code} {exc.message}") from exc
        except errors.ServerError as exc:
            raise _Transient(str(exc)) from exc

    def generate(
        self, *, model: str, system: str, user: str, schema: type[T], max_output_tokens: int
    ) -> tuple[T, RawUsage]:
        try:
            resp = self._call(model, system, user, schema, max_output_tokens)
        except _Transient as exc:
            raise Unavailable(f"{model}: server error after retries: {exc}") from exc
        meta = resp.usage_metadata
        usage = RawUsage(
            input_tokens=(meta.prompt_token_count or 0) if meta else 0,
            output_tokens=(meta.candidates_token_count or 0) if meta else 0,
            thinking_tokens=(meta.thoughts_token_count or 0) if meta else 0,
            cached_tokens=(meta.cached_content_token_count or 0) if meta else 0,
        )
        parsed = resp.parsed
        if not isinstance(parsed, schema):
            try:
                parsed = schema.model_validate_json(resp.text or "")
            except ValidationError as exc:
                err = LLMError(f"{model}: output did not match schema: {exc.errors()[:2]}")
                err.usage = usage  # type: ignore[attr-defined]
                raise err from exc
        return parsed, usage

    def list_models(self) -> list[str]:
        return [m.name for m in self.client.models.list()]
