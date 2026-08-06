import uuid

from fastapi import APIRouter, Depends, Header, status

from pythonapi.dependencies import get_required_order_repository
from pythonapi.models.orders import OrderRequest, OrderStatus
from pythonapi.repositories.orders import OrderRepository

router = APIRouter(prefix="/orders", tags=["Orders"])


@router.post("", response_model=OrderStatus, status_code=status.HTTP_201_CREATED)
async def create_order(
    order: OrderRequest,
    repository: OrderRepository = Depends(get_required_order_repository),
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
        description="Unique string to identify this operation request. Retried "
        "requests with the same key return the original response instead of "
        "creating a duplicate order (handled by IdempotencyMiddleware).",
    ),
) -> OrderStatus:
    order_id = uuid.uuid4().hex
    await repository.create_order(order_id, order, status="created")
    return OrderStatus(id=order_id, status="created")
