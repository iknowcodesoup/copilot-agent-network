"""Search endpoint tests."""

import io
import time

from pythonapi.core.pii import PiiMasker
from pythonapi.dependencies import get_pii_masker
from pythonapi.main import app
from pythonapi.repositories.pii_vault import InMemoryPiiVaultRepository


def _wait_for_processing(client, document_id: str, attempts: int = 50) -> dict:
    for _ in range(attempts):
        detail = client.get(f"/api/documents/{document_id}").json()
        if detail["status"] in {"ready", "failed"}:
            return detail
        time.sleep(0.05)
    return detail


def _upload_and_wait(client, filename: str, text: bytes) -> str:
    upload = client.post(
        "/api/documents/upload",
        files={"file": (filename, io.BytesIO(text), "text/plain")},
    )
    document_id = upload.json()["id"]
    detail = _wait_for_processing(client, document_id)
    assert detail["status"] == "ready"
    return document_id


def test_search_returns_ranked_results(client):
    # Deterministic: the embedding provider is simulated as flaky by default.
    app.state.embedding_client.failure_rate = 0.0

    text = b"The quick brown fox jumps over the lazy dog. Foxes are cunning."
    document_id = _upload_and_wait(client, "note.txt", text)

    response = client.post("/api/search", json={"query": "fox", "top_k": 3})

    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "fox"
    assert len(body["results"]) >= 1
    assert body["results"][0]["document_id"] == document_id

    # EMBEDDING_PROVIDER/RERANK_PROVIDER/GENERATION_PROVIDER all default to
    # "mock", so hybrid RRF fusion, reranking, and generation are all
    # genuinely exercised offline, not silently skipped.
    answer = body["answer"]
    assert answer["is_answerable"] is True
    assert answer["answer"]
    assert 0.0 <= answer["confidence"] <= 1.0


def test_search_ranks_correct_document_among_multiple(client):
    app.state.embedding_client.failure_rate = 0.0

    fox_id = _upload_and_wait(
        client,
        "fox.txt",
        b"The quick brown fox jumps over the lazy dog. Foxes are cunning hunters.",
    )
    planet_id = _upload_and_wait(
        client,
        "planet.txt",
        b"Jupiter is the largest planet in the solar system. Gas giants dominate "
        b"the outer planets.",
    )

    fox_response = client.post("/api/search", json={"query": "fox", "top_k": 3})
    assert fox_response.json()["results"][0]["document_id"] == fox_id

    planet_response = client.post("/api/search", json={"query": "planet", "top_k": 3})
    assert planet_response.json()["results"][0]["document_id"] == planet_id


def test_search_masks_for_llm_and_reconstitutes_pii_in_response(client):
    app.state.embedding_client.failure_rate = 0.0

    # PII_VAULT_ENCRYPTION_KEY/SALT stay unset in tests, so app.state.pii_masker
    # is None by default - wire in a real masker for this test the same way
    # app.state.embedding_client.failure_rate is toggled above. pii_masker is
    # a plain constructor arg on EmbeddingWorkerPool (not Depends()), so both
    # the worker and the route's dependency need the same instance/vault.
    test_masker = PiiMasker(InMemoryPiiVaultRepository(), salt="test-salt")
    app.state.worker_pool.pii_masker = test_masker
    app.dependency_overrides[get_pii_masker] = lambda: test_masker

    text = b"Contact John Smith at john.smith@example.com about the quarterly report."
    _upload_and_wait(client, "contact.txt", text)

    response = client.post(
        "/api/search", json={"query": "Who should I contact?", "top_k": 3}
    )

    assert response.status_code == 200
    body = response.json()
    combined_text = " ".join(result["text"] for result in body["results"])
    assert "John Smith" in combined_text
    assert "john.smith@example.com" in combined_text


def test_search_rejects_empty_query(client):
    response = client.post("/api/search", json={"query": "", "top_k": 3})
    assert response.status_code == 422
