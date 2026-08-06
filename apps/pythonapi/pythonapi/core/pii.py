"""PII detection, masking, and reconstitution via Microsoft Presidio.

PiiMasker is the single reusable entry point for any PII-aware code path -
not just /search. Ingestion (workers/embedding_worker.py) masks chunk text
before it's embedded/stored; search (core/rag_pipeline.py) masks the query
before it reaches the LLM and reconstitutes only the final response. Future
tool-calling code should reuse this same service (via Depends(get_pii_masker)
or by holding a PiiVaultRepository directly) rather than reimplementing
masking.
"""

import asyncio
import hashlib
import re

from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

from pythonapi.repositories.pii_vault import PiiVaultRepository

_TOKEN_PATTERN = re.compile(r"<[A-Z_]+_[0-9a-f]{8}>")


class PiiMaskingError(Exception):
    """Raised when Presidio analysis/anonymization fails."""


class PiiMasker:
    def __init__(
        self, vault: PiiVaultRepository, salt: str, language: str = "en"
    ) -> None:
        self._vault = vault
        self._salt = salt
        self._language = language
        # AnalyzerEngine()'s bare constructor defaults to en_core_web_lg,
        # which isn't the model this app pins (en_core_web_sm) - build the
        # NLP engine explicitly so the two stay in sync.
        nlp_engine = NlpEngineProvider(
            nlp_configuration={
                "nlp_engine_name": "spacy",
                "models": [{"lang_code": language, "model_name": "en_core_web_sm"}],
            }
        ).create_engine()
        self._analyzer = AnalyzerEngine(
            nlp_engine=nlp_engine, supported_languages=[language]
        )
        self._anonymizer = AnonymizerEngine()

    def _token_for(self, entity_type: str, value: str) -> str:
        # Salted so tokens can't be brute-forced back to the source value
        # from the hash alone (the notebook's own stated caveat).
        digest = hashlib.sha256(f"{self._salt}:{value}".encode()).hexdigest()[:8]
        return f"<{entity_type}_{digest}>"

    def _analyze_and_mask_sync(self, text: str) -> tuple[str, dict[str, str]]:
        try:
            results = self._analyzer.analyze(text=text, language=self._language)
            if not results:
                return text, {}
            discovered: dict[str, str] = {}
            operators: dict[str, OperatorConfig] = {}
            for result in results:
                original_value = text[result.start : result.end]
                discovered[self._token_for(result.entity_type, original_value)] = (
                    original_value
                )
                operators[result.entity_type] = OperatorConfig(
                    "custom",
                    {
                        "lambda": lambda x, et=result.entity_type: self._token_for(
                            et, x
                        )
                    },
                )
            anonymized = self._anonymizer.anonymize(
                text=text, analyzer_results=results, operators=operators
            )
            return anonymized.text, discovered
        except Exception as exc:
            raise PiiMaskingError(str(exc)) from exc

    async def mask(self, text: str) -> str:
        masked_text, discovered = await asyncio.to_thread(
            self._analyze_and_mask_sync, text
        )
        if discovered:
            await self._vault.put_many(discovered)
        return masked_text

    async def reconstitute(self, text: str) -> str:
        tokens = _TOKEN_PATTERN.findall(text)
        if not tokens:
            return text
        values = await self._vault.get_many(tokens)
        for token, value in values.items():
            text = text.replace(token, value)
        return text
