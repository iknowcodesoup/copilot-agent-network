"""Task lifecycle helpers shared by both specialist executors.

The SDK requires an executor to enqueue the `Task` itself before any status
update, and rejects the run otherwise. That is one easily-forgotten step in
front of every skill, so both agents get it from here rather than each
remembering it - and the spec's task model (unique ID, correlation ID,
terminal state) is satisfied in one place.
"""

from __future__ import annotations

from a2a.server.agent_execution import RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Task, TaskState, TaskStatus


async def start_task(context: RequestContext, event_queue: EventQueue) -> TaskUpdater:
    """Open the task and return the updater that drives it to a terminal state.

    A follow-up message on an existing task arrives with `current_task`
    already set. Enqueuing a second Task for that id would be a replacement
    the SDK logs and drops, so only a genuinely new task is created here.
    """
    if context.current_task is None:
        await event_queue.enqueue_event(
            Task(
                id=context.task_id,
                context_id=context.context_id,
                status=TaskStatus(state=TaskState.TASK_STATE_SUBMITTED),
            )
        )

    updater = TaskUpdater(event_queue, context.task_id, context.context_id)
    await updater.start_work()
    return updater
