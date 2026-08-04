"""HTTP entrypoint for the pythonapi service."""

from fastapi import FastAPI

from pythonapi.hello import hello

app = FastAPI(title="pythonapi")


@app.get("/health")
def health() -> dict[str, str]:
    """Return a simple health status."""
    return {"status": "ok"}


@app.get("/hello")
def hello_route() -> dict[str, str]:
    """Expose the sample greeting via HTTP."""
    return {"message": hello()}