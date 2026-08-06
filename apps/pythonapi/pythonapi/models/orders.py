"""Domain models for the orders example endpoint."""

from pydantic import BaseModel


class OrderRequest(BaseModel):
    name: str
    itemId: int


class OrderStatus(BaseModel):
    id: str
    status: str
