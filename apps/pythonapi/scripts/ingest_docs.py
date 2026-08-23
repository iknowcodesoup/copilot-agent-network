"""Load the `docs/` tree into the Research Agent's corpus.

The Research Agent answers from whatever the documents API has ingested, so
the seed corpus is not useful until it is uploaded. This walks the tree and
posts each Markdown file to a running service.

    python scripts/ingest_docs.py --api-url http://localhost:8000

Re-running it uploads the files again rather than replacing them. Delete the
old documents first if you have edited the tree and want one copy of each.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

import httpx

DEFAULT_API_URL = "http://localhost:8000"
# The repo root's docs/, reached from apps/pythonapi/scripts/.
DEFAULT_DOCS_ROOT = pathlib.Path(__file__).resolve().parents[3] / "docs"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--docs-root", type=pathlib.Path, default=DEFAULT_DOCS_ROOT)
    arguments = parser.parse_args()

    if not arguments.docs_root.is_dir():
        print(f"No docs tree at {arguments.docs_root}", file=sys.stderr)
        return 1

    markdown_files = sorted(arguments.docs_root.rglob("*.md"))
    if not markdown_files:
        print(f"No Markdown files under {arguments.docs_root}", file=sys.stderr)
        return 1

    failures = 0
    with httpx.Client(base_url=arguments.api_url, timeout=120.0) as client:
        for path in markdown_files:
            # The title a citation shows is the file name the API records, so
            # send the path relative to the tree - "voice-training/x.md" reads
            # better in a source list than a bare "x.md".
            name = path.relative_to(arguments.docs_root).as_posix()
            response = client.post(
                "/api/documents",
                files={"file": (name, path.read_bytes(), "text/markdown")},
            )
            if response.is_success:
                print(f"ingested {name}")
            else:
                failures += 1
                print(
                    f"FAILED {name}: {response.status_code} {response.text[:200]}",
                    file=sys.stderr,
                )

    print(f"\n{len(markdown_files) - failures}/{len(markdown_files)} ingested")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
