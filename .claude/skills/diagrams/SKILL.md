---
name: diagrams-mermaid-syntax
description: This skill provides guidance for creating architecture diagrams, flowcharts, sequence diagrams, or any visual documentation in specs or markdown files. Always use Mermaid syntax - never use ASCII box art.
---

## Steps

### 1. Choose Diagram Type

Select the appropriate Mermaid diagram type:

| Diagram Type      | Use Case                                              |
| ----------------- | ----------------------------------------------------- |
| `flowchart`       | Architecture, data flow, component relationships      |
| `sequenceDiagram` | API calls, message passing, time-ordered interactions |
| `classDiagram`    | Object relationships, inheritance, interfaces         |
| `stateDiagram`    | State machines, workflow states                       |
| `erDiagram`       | Database schemas, entity relationships                |

### 2. Architecture/Flow Diagram

```mermaid
flowchart TD
    A[ViewModel] --> B[IDeviceRepository]
    B --> C[PreferencesAdapter]
    C --> D[MAUI Preferences]
```

### 3. Sequence Diagram

```mermaid
sequenceDiagram
    participant App
    participant Repository
    participant Preferences

    App->>Repository: GetLastDevice()
    Repository->>Preferences: Get(key)
    Preferences-->>Repository: value
    Repository-->>App: SavedDevice
```

### 4. Component Diagram

```mermaid
flowchart LR
    subgraph Presentation
        VM[ViewModel]
    end
    subgraph Application
        SVC[ConnectionFacade]
    end
    subgraph Infrastructure
        REPO[Repository]
        ADAPTER[Adapter]
    end

    VM --> SVC
    SVC --> REPO
    REPO --> ADAPTER
```

## Why Mermaid?

- Renders properly in GitHub, VS Code, and most markdown viewers
- Maintainable and editable (text-based)
- Consistent styling across specs
- Supports flowcharts, sequence diagrams, class diagrams, and more

## Never Use ASCII Art

```
BAD - Do not use:
+------------------+     +------------------+
|   ViewModel      | --> |   Repository     |
+------------------+     +------------------+
```

ASCII box art (`+-+`, `|`, `+--+`) does not render well and is harder to maintain. Always use Mermaid instead.
