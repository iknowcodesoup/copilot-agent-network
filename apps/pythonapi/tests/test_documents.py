"""Document upload/list/get/delete tests. No Redis involved."""

import io
import time


def test_document_upload_list_get_delete(client):
    content = io.BytesIO(b"Hello world. This is a test document.")
    upload = client.post(
        "/api/documents/upload",
        files={"file": ("note.txt", content, "text/plain")},
    )
    assert upload.status_code == 202
    document_id = upload.json()["id"]

    listing = client.get("/api/documents")
    assert listing.status_code == 200
    assert any(doc["id"] == document_id for doc in listing.json())

    detail = client.get(f"/api/documents/{document_id}")
    assert detail.status_code == 200
    assert detail.json()["id"] == document_id

    delete = client.delete(f"/api/documents/{document_id}")
    assert delete.status_code == 204

    missing = client.get(f"/api/documents/{document_id}")
    assert missing.status_code == 404


def test_upload_rejects_empty_file(client):
    response = client.post(
        "/api/documents/upload",
        files={"file": ("empty.txt", io.BytesIO(b"   "), "text/plain")},
    )
    assert response.status_code == 400


def test_upload_accepts_binary_file(client):
    # Layout-aware parsing (Docling) now handles binary formats directly, so
    # uploads are no longer restricted to UTF-8 text - only emptiness is
    # rejected up front (see test_upload_rejects_empty_file).
    content = io.BytesIO(b"\xff\xfe\x00\x01")
    response = client.post(
        "/api/documents/upload",
        files={"file": ("binary.dat", content, "application/octet-stream")},
    )
    assert response.status_code == 202


def test_upload_with_unparseable_content_fails(client):
    # "binary.dat" has no extension Docling recognizes, so parsing fails
    # during background processing rather than at upload time - this
    # exercises the DoclingParseError -> status="failed" path.
    content = io.BytesIO(b"\xff\xfe\x00\x01")
    upload = client.post(
        "/api/documents/upload",
        files={"file": ("binary.dat", content, "application/octet-stream")},
    )
    document_id = upload.json()["id"]

    detail = None
    for _ in range(50):
        detail = client.get(f"/api/documents/{document_id}").json()
        if detail["status"] in {"ready", "failed"}:
            break
        time.sleep(0.05)

    assert detail["status"] == "failed"
    assert detail["error"] is not None


def test_get_missing_document_returns_404(client):
    response = client.get("/api/documents/does-not-exist")
    assert response.status_code == 404
