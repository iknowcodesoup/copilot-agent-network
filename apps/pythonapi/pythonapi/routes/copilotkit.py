from copilotkit import CopilotKitRemoteEndpoint
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from fastapi import FastAPI


def register_copilotkit_endpoint(app: FastAPI) -> None:
    """Mount the CopilotKit remote endpoint at /copilotkit.

    Not an APIRouter: the CopilotKit SDK wires itself directly onto the
    FastAPI app instance rather than exposing a router to include.
    """
    endpoint = CopilotKitRemoteEndpoint(agents=[])
    add_fastapi_endpoint(app, endpoint, "/copilotkit")
