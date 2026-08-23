"""Header filtering shared by openai_proxy.py and voice_factory_proxy.py.

Both routes forward a request untouched to an upstream service, and both
have to drop hop-by-hop headers that would otherwise be copied twice or
describe a connection this proxy hop invalidates.
"""

from collections.abc import Iterable


def copy_headers(
    headers: Iterable[tuple[str, str]], blocked: set[str]
) -> dict[str, str]:
    return {key: value for key, value in headers if key.lower() not in blocked}
