"""Unit tests for PiiMasker's mask/reconstitute round trip, independent of
the FastAPI app (no client fixture needed)."""

import pytest

from pythonapi.core.pii import PiiMasker
from pythonapi.repositories.pii_vault import InMemoryPiiVaultRepository


@pytest.mark.asyncio
async def test_mask_replaces_pii_with_surrogate_tokens():
    masker = PiiMasker(InMemoryPiiVaultRepository(), salt="test-salt")
    text = "Contact John Smith at john.smith@example.com."

    masked = await masker.mask(text)

    assert "John Smith" not in masked
    assert "john.smith@example.com" not in masked


@pytest.mark.asyncio
async def test_reconstitute_restores_the_original_text():
    masker = PiiMasker(InMemoryPiiVaultRepository(), salt="test-salt")
    text = "Contact John Smith at john.smith@example.com."

    masked = await masker.mask(text)
    restored = await masker.reconstitute(masked)

    assert restored == text


@pytest.mark.asyncio
async def test_mask_is_a_no_op_when_no_pii_is_present():
    masker = PiiMasker(InMemoryPiiVaultRepository(), salt="test-salt")
    text = "The quick brown fox jumps over the lazy dog."

    assert await masker.mask(text) == text
