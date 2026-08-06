# Spec 035: Secure Vector Memory Store — Implementation Plan

## Overview

6-phase RAG memory system: encrypted vector store, embedding gateway, memory indexer, retriever,
context injection, and initial migration. All on-device, no cloud dependency.

---

## New Files (19)

### `app/Memory/` (new directory, 15 files)

| File | Purpose |
|---|---|
| `MemorySourceType.cs` | enum: `Transcription`, `Chat` |
| `MemoryChunk.cs` | record: Id, SourceId, SourceType, ChunkText, CreatedAt, Embedding |
| `MemorySearchResult.cs` | record: Chunk, Score, IsVector |
| `IndexingProgress.cs` | record: ProcessedCount, TotalCount, CurrentSourceId |
| `IVectorMemoryRepository.cs` | interface per spec §2 |
| `VectorMemoryRepository.cs` | sqlite-net-pcl + SQLCipher, key `"MemoryDatabaseEncryptionKey"`, file `memory.db` |
| `IEmbeddingGateway.cs` | interface: EmbedAsync, EmbedBatchAsync, Dimensions, IsAvailable |
| `LlamaSharpEmbeddingGateway.cs` | `LLamaEmbedder` with `EmbeddingMode=true`; lazy load; `IsAvailable=false` when model not downloaded |
| `IMemoryIndexer.cs` | interface: IndexTranscriptionAsync, IndexChatSessionAsync, ReindexAllAsync, Progress observable |
| `MemoryIndexer.cs` | Chunker (500-char max, sentence-boundary / message-pair) + embed + upsert |
| `IMemoryRetriever.cs` | interface: SearchAsync, SearchBySourceTypeAsync |
| `VectorMemoryRetriever.cs` | Load all vectors into memory; cosine similarity; falls back to BM25 when `IEmbeddingGateway.IsAvailable==false` |
| `Bm25MemoryRetriever.cs` | TF-IDF/BM25 keyword scoring; standalone `IMemoryRetriever` |
| `IContextInjector.cs` | interface: BuildContextPrefixAsync(userMessage) → Task<string?> |
| `ContextInjector.cs` | Retrieves topK=5 chunks, threshold=0.4, formats `[Relevant memory]...[End memory]` prefix |

### `tests/FreeFriend.Tests/Memory/` (new directory, 4 files)

| File | Tests |
|---|---|
| `VectorMemoryRepositoryTests.cs` | CRUD: upsert, retrieve, delete by source, purge, chunk count |
| `MemoryIndexerTests.cs` | Chunking: 1000-char text → ≥2 chunks; 50-char overlap; chat pair cap |
| `MemoryRetrieverTests.cs` | Cosine similarity ranking; BM25 fallback path |
| `ContextInjectorTests.cs` | Prefix format; empty when no results; topK clamp |

---

## Modified Files (7)

### 1. `app/LanguageModel/LanguageModelType.cs`
Add `Embedding` value to enum.

### 2. `app/LanguageModel/LanguageModelCatalog.cs`
- Add static `EmbeddingModels` list with `nomic-embed-text-v1.5.Q4_K_M.gguf` entry
  (`modelType: LanguageModelType.Embedding`, ~80 MB, no `chatTemplateId`, no `systemPrompt`)
- Existing `BuiltInModels` lists only chat models; embedding models in separate property to avoid
  showing them in the chat model picker

### 3. `app/Storage/PreferenceKeys.cs`
Add:
```csharp
public const string MemoryEnabled = "MemoryEnabled";
public const bool MemoryEnabledDefault = true;
public const string LastFullReindexAt = "LastFullReindexAt";
```

### 4. `app/Transcription/TranscriptionFacade.cs`
- Add optional `IMemoryIndexer?` constructor parameter
- After `successResult` + `UpdateConversationStatusAsync` completes (in the success path),
  fire-and-forget: `_ = memoryIndexer?.IndexTranscriptionAsync(conversationId, transcribedText, CancellationToken.None)`

### 5. `app/Storage/ChatSessionRepository.cs`
- Add optional `IMemoryIndexer?` constructor parameter
- After `File.WriteAllTextAsync` in `SaveSessionAsync`, fire-and-forget:
  `_ = memoryIndexer?.IndexChatSessionAsync(session.Id, session.Messages, CancellationToken.None)`

### 6. `app/ViewModels/LanguageModelChatViewModel.cs`
- Add `IContextInjector` constructor parameter
- In `SendMessageAsync` (the inner async method that calls `gateway.SendMessageStreamAsync`):
  - If `Preferences.Get(PreferenceKeys.MemoryEnabled, true)`, call `BuildContextPrefixAsync(messageText)`
  - Prepend context prefix to the user message string before sending to gateway

### 7. `app/MauiProgram.cs`
Register all new services:
```csharp
services.AddSingleton<IVectorMemoryRepository, VectorMemoryRepository>();
services.AddSingleton<IEmbeddingGateway>(sp => new LlamaSharpEmbeddingGateway(
    LanguageModelCatalog.EmbeddingModels[0],
    sp.GetRequiredService<IAssetFacade>(),
    sp.GetService<ILogger<LlamaSharpEmbeddingGateway>>()));
services.AddSingleton<Bm25MemoryRetriever>();
services.AddSingleton<IMemoryRetriever>(sp => new VectorMemoryRetriever(
    sp.GetRequiredService<IVectorMemoryRepository>(),
    sp.GetRequiredService<IEmbeddingGateway>(),
    sp.GetRequiredService<Bm25MemoryRetriever>()));
services.AddSingleton<IMemoryIndexer, MemoryIndexer>();
services.AddSingleton<IContextInjector, ContextInjector>();
```
Phase 6 first-launch (in `CreateMauiApp` after `builder.Build()`):
```csharp
if (Preferences.Get(PreferenceKeys.LastFullReindexAt, string.Empty) == string.Empty)
{
    var indexer = app.Services.GetRequiredService<IMemoryIndexer>();
    _ = Task.Run(() => indexer.ReindexAllAsync(CancellationToken.None));
}
```

---

## Architecture Notes

**Thread safety:** `VectorMemoryRepository` uses `SemaphoreSlim(1,1)` for init, same as `EncryptedAudioRepository`.

**Embedding model path:** `LlamaSharpEmbeddingGateway.IsAvailable` calls `assetFacade.GetAssetPath(descriptor) != null`. Lazy loads model on first `EmbedAsync` call.

**Memory budget:** 768-dim float32 per chunk → 1K chunks = ~3 MB in-process. Acceptable on mobile for v1.

**No UI change required for baseline:** context injection is transparent. `MemoryEnabled` preference can be surfaced in ModelSettingsPage later.

**Embedding model in download UI:** Since `LanguageModelType.Embedding` is new, the DownloadsPage will show it in the model list. The `chatTemplateId`/`systemPrompt` fields are already nullable; no UI suppression needed for now (they're just null).
