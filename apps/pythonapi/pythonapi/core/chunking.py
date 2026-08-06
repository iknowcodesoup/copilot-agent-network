import re


def chunk_text(text: str, max_chars: int = 800, overlap_chars: int = 100) -> list[str]:
    """Sentence-aware splitting with overlap, so search results retain context."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if current and len(current) + len(sentence) + 1 > max_chars:
            chunks.append(current)
            current = current[-overlap_chars:] + " " + sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks
