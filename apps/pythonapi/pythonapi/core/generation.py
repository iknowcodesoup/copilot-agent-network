"""Structured answer generation. "mock" (default) returns a deterministic
RagAnswer with no LLM call, so tests stay offline; "baml" calls the
generated BAML client (baml_src/), which talks to the same LiteLLM gateway
and model alias as the dense embedding provider.

The gateway is applied here through a ClientRegistry rather than read from
`env.VAR` inside clients.baml. BAML would resolve those against the process
environment while everything else resolves against Settings, and the two can
disagree - an unset variable then fails at the first call, far from the cause.
Settings stays the one source of truth.

The BAML-generated client is imported lazily inside the "baml" branch so the
mock/default path stays fully decoupled from generated code - importing this
module never requires baml_client to exist.
"""

from typing import TYPE_CHECKING, Literal

from langfuse import observe

from pythonapi.config import settings
from pythonapi.models.documents import RagAnswer

if TYPE_CHECKING:
    from baml_py import ClientRegistry

# Must match the client declared in baml_src/clients.baml.
_GATEWAY_CLIENT_NAME = "LiteLLMGateway"


class AnswerGenerator:
    def __init__(self, provider: Literal["mock", "baml"] = "mock") -> None:
        self.provider = provider

    @observe(as_type="generation")
    async def generate(self, context: str, question: str) -> RagAnswer:
        if self.provider == "mock":
            has_context = bool(context.strip())
            return RagAnswer(
                is_answerable=has_context,
                answer=(
                    f"Mock answer for: {question}"
                    if has_context
                    else "No relevant context was found to answer this question."
                ),
                confidence=0.5 if has_context else 0.0,
            )

        from pythonapi.baml_client.async_client import b

        result = await b.GenerateAnswer(
            context=context,
            question=question,
            baml_options={"client_registry": _gateway_registry()},
        )
        return RagAnswer(
            is_answerable=result.is_answerable,
            answer=result.answer,
            confidence=result.confidence,
        )


def _gateway_registry() -> "ClientRegistry":
    """Point the BAML client at the gateway described by Settings.

    Built per call rather than cached: it is a plain value object, and caching
    it would pin the first Settings read for the life of the process.
    """
    from baml_py import ClientRegistry

    options: dict[str, str] = {
        "base_url": settings.LLM_BASE_URL,
        "model": settings.LLM_MODEL,
    }
    # Omitted rather than sent empty. A local gateway with no master key wants
    # no Authorization header at all.
    if settings.LLM_API_KEY:
        options["api_key"] = settings.LLM_API_KEY

    registry = ClientRegistry()
    registry.add_llm_client(
        name=_GATEWAY_CLIENT_NAME, provider="openai-generic", options=options
    )
    registry.set_primary(_GATEWAY_CLIENT_NAME)
    return registry
