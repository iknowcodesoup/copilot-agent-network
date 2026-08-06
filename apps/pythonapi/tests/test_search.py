"""Search endpoint tests."""

import io
import time

from pythonapi.main import app


def _wait_for_processing(client, document_id: str, attempts: int = 50) -> dict:
    for _ in range(attempts):
        detail = client.get(f"/documents/{document_id}").json()
        if detail["status"] in {"ready", "failed"}:
            return detail
        time.sleep(0.05)
    return detail


def test_search_returns_ranked_results(client):
    # Deterministic: the embedding provider is simulated as flaky by default.
    app.state.embedding_client.failure_rate = 0.0

    text = b"The quick brown fox jumps over the lazy dog. Foxes are cunning."
    content = io.BytesIO(text)
    upload = client.post(
        "/documents/upload",
        files={"file": ("note.txt", content, "text/plain")},
    )
    document_id = upload.json()["id"]
    detail = _wait_for_processing(client, document_id)
    assert detail["status"] == "ready"

    response = client.post("/search", json={"query": "fox", "top_k": 3})

    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "fox"
    assert len(body["results"]) >= 1
    assert body["results"][0]["document_id"] == document_id


def test_search_rejects_empty_query(client):
    response = client.post("/search", json={"query": "", "top_k": 3})
    assert response.status_code == 422
