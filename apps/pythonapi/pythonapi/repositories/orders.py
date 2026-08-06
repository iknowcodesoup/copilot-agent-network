from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from pythonapi.models.orders import OrderRequest
from pythonapi.models.orm import OrderRow


class OrderRepository(Protocol):
    """Storage contract for orders - the REST API's relational data."""

    async def create_order(
        self, order_id: str, order: OrderRequest, status: str
    ) -> None: ...


class InMemoryOrderRepository:
    """Dict-backed OrderRepository. Test double only - the same role
    fake_redis played before orders moved off Redis onto Postgres."""

    def __init__(self) -> None:
        self._orders: dict[str, dict] = {}

    async def create_order(
        self, order_id: str, order: OrderRequest, status: str
    ) -> None:
        self._orders[order_id] = {
            **order.model_dump(),
            "id": order_id,
            "status": status,
        }


class PostgresOrderRepository:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def create_order(
        self, order_id: str, order: OrderRequest, status: str
    ) -> None:
        async with AsyncSession(self._engine) as session:
            session.add(
                OrderRow(
                    id=order_id,
                    name=order.name,
                    item_id=order.itemId,
                    status=status,
                )
            )
            await session.commit()
