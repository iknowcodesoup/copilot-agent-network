# Research Agent

The Research Agent answers questions from the project's documentation.

## What it does

It exposes one skill, `research`. Given a question, it runs the existing
`RagPipeline` and returns an answer with the documents that answer came
from.

The result carries two halves. The answer text is the readable reply. The
sources ride along as message metadata, so the Orchestrator can use them
without parsing prose apart.

## What it must not do

- It must not start or modify voice runs.
- It must not call the voice factory.
- It must not become a general-purpose agent.

The research and voice pipelines stay separate. RAG is not part of normal
voice processing, and adding it without a real need would create a
dependency the system does not have.

## No results is an answer

When the corpus holds nothing relevant, the agent still answers. It returns
a clear no-results message and an empty source list. It does not fail the
task. A caller checks the empty list, not an error.

There are two ways the corpus comes up empty: retrieval found no chunks, or
it found some and the generator judged them not to answer the question. Both
give the same no-results reply.

## Where its knowledge comes from

The corpus is the `docs/` tree, ingested through the documents API. Qdrant
holds the chunk vectors. Postgres holds the document and chunk metadata.
