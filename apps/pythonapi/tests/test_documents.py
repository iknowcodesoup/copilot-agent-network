"""Document upload/list/get/delete tests. No Redis involved."""

import io


def test_document_upload_list_get_delete(client):
    content = io.BytesIO(b"Hello world. This is a test document.")
    upload = client.post(
        "/documents/upload",
        files={"file": ("note.txt", content, "text/plain")},
    )
    assert upload.status_code == 202
    document_id = upload.json()["id"]

    listing = client.get("/documents")
    assert listing.status_code == 200
    assert any(doc["id"] == document_id for doc in listing.json())

    detail = client.get(f"/documents/{document_id}")
    assert detail.status_code == 200
    assert detail.json()["id"] == document_id

    delete = client.delete(f"/documents/{document_id}")
    assert delete.status_code == 204

    missing = client.get(f"/documents/{document_id}")
    assert missing.status_code == 404


def test_upload_rejects_empty_file(client):
    response = client.post(
        "/documents/upload",
        files={"file": ("empty.txt", io.BytesIO(b"   "), "text/plain")},
    )
    assert response.status_code == 400


def test_upload_rejects_non_utf8_file(client):
    content = io.BytesIO(b"\xff\xfe\x00\x01")
    response = client.post(
        "/documents/upload",
        files={"file": ("binary.dat", content, "application/octet-stream")},
    )
    assert response.status_code == 400


def test_get_missing_document_returns_404(client):
    response = client.get("/documents/does-not-exist")
    assert response.status_code == 404
