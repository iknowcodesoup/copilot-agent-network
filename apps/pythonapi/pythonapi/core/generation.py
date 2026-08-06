"""Structured answer generation. "mock" (default) returns a deterministic
RagAnswer with no LLM call, so tests stay offline; "baml" calls the
generated BAML client (baml_src/), which talks to the same LiteLLM/
OpenAI-compatible gateway and model alias as the dense embedding provider.

The BAML-generated client is imported lazily inside the "baml" branch so the
mock/default path stays fully decoupled from generated code - importing this
module never requires baml_client to exist.
"""

from typing import Literal

from langfuse import observe

from pythonapi.models.documents import RagAnswer


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

        result = await b.GenerateAnswer(context=context, question=question)
        return RagAnswer(
            is_answerable=result.is_answerable,
            answer=result.answer,
            confidence=result.confidence,
        )
