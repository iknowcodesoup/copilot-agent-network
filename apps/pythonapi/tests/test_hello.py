"""Hello unit test module."""

from fastapi.testclient import TestClient

from pythonapi.hello import hello
from pythonapi.main import app


client = TestClient(app)


def test_hello():
    """Test the hello function."""
    assert hello() == "Hello pythonapi"


def test_health_route():
    """Test the health endpoint."""
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_hello_route():
    """Test the hello endpoint."""
    response = client.get("/hello")

    assert response.status_code == 200
    assert response.json() == {"message": "Hello pythonapi"}