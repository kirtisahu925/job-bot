"""Provider-neutral interface: one JSON-schema call in, a validated pydantic object plus token counts out."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


@dataclass
class RawUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0
    cached_tokens: int = 0


class LLMError(Exception):
    """Non-retryable failure for this model (bad output, refusal, 4xx)."""


class RateLimited(LLMError):
    """Quota or rate limit hit; the ledger moves on to the next model in the chain."""


class Unavailable(LLMError):
    """The model stayed overloaded (503) through every retry; the ledger skips it for the rest of the run."""


class QuotaExhausted(LLMError):
    """Every model in the chain is capped or rate limited for now."""


class BudgetExceeded(LLMError):
    """The configured money budget / balance for a paid provider is used up."""


class LLMProvider(Protocol):
    name: str

    def generate(
        self, *, model: str, system: str, user: str, schema: type[T], max_output_tokens: int
    ) -> tuple[T, RawUsage]: ...
