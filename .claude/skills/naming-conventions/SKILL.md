---
name: naming-conventions
description: This skill provides guidance for naming classes, methods, variables, interfaces, and other identifiers in code. Use this skill when writing new code, reviewing code, or any task involving identifier names.
---

## Steps

### 1. NO UNDERSCORES (Except Tests)

**NEVER use underscores ANYWHERE in production code identifiers.**

Use PascalCase for types/classes/methods/properties and camelCase for variables/parameters/private fields.

**ONLY Exceptions:**

1. Test method names may use `snake_case` for readability (e.g., `Should_Connect_When_DeviceAvailable`)
2. Unused/discarded parameters may use single underscore `_` ONLY (e.g., `void Method(int _, string value)`)

| Bad (BANNED)         | Good               | Context         |
| -------------------- | ------------------ | --------------- |
| `_deviceName`        | `deviceName`       | Private field   |
| `_field`             | `field`            | Private field   |
| `device_name`        | `deviceName`       | Production code |
| `connect_to_device`  | `connectToDevice`  | Production code |
| `audio_data_handler` | `audioDataHandler` | Production code |
| `ble_gateway`        | `BleGateway`       | Production code |

### 2. NO ABBREVIATIONS

**Always use full, descriptive names.** Never abbreviate identifiers.

| Bad (Abbreviated) | Good (Full Name)             |
| ----------------- | ---------------------------- |
| `ct`              | `cancellationToken`          |
| `devName`         | `deviceName`                 |
| `cfg`             | `configuration`              |
| `ctx`             | `context`                    |
| `req` / `res`     | `request` / `response`       |
| `svc`             | Use pattern name (Gateway)   |
| `mgr`             | Use pattern name (Mediator)  |
| `util`            | Use pattern name (Factory)   |
| `msg`             | `message`                    |
| `conn`            | `connection`                 |
| `temp`            | `temporary` or `temperature` |
| `init`            | `initialize`                 |
| `repo`            | `repository`                 |

### 3. Enums for Types, NOT String Constants

**Use enum types with descriptive names.** Use `[Flags]` attribute for multi-selection scenarios.

| Bad (String Constants)                           | Good (Enums)                                                    |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `class DeviceType { const string Ble = "ble"; }` | `enum DeviceType { Bluetooth, Wifi, Usb }`                      |
| `if (status == "connected")`                     | `if (status == ConnectionStatus.Connected)`                     |
| `string[] permissions = { "read", "write" }`     | `[Flags] enum Permissions { Read = 1, Write = 2, Execute = 4 }` |

**Enum Guidelines:**

- Use singular names: `DeviceType` NOT `DeviceTypes`
- Use PascalCase for enum members: `ConnectionStatus.Connected`
- Access string name via `.ToString()` or `nameof` when needed
- Use `[Flags]` for bitwise combinations
- **Every member MUST have an explicit numeric value. Never rely on implicit declaration-order values.**

  ```csharp
  // BAD — implicit values. Inserting a member anywhere but the end silently
  // renumbers every member after it.
  public enum LanguageModelType { Onnx, Gguf, Piper, SherpaOnnx, LiteRt }

  // GOOD — explicit values. New members always get the next unused number,
  // appended at the end. Order in the source no longer matters for numbering.
  public enum LanguageModelType
  {
    Onnx = 0,
    Gguf = 1,
    Piper = 2,
    SherpaOnnx = 3,
    LiteRt = 4
  }
  ```

  **Why this is non-negotiable:** this codebase persists enums as raw ints in several
  places — `ImportedModelRegistry`, `PersistCustomTtsModel`, `PreferencesGateway` —
  via default `System.Text.Json`/`Preferences` int serialization, with no
  `JsonStringEnumConverter`. An implicit enum reads back correctly ONLY as long as no
  member is ever inserted, removed, or reordered. Inserting `Kokoro` in the middle of
  `LanguageModelType` once shifted `LiteRt` from ordinal 8 to 9, so every
  already-persisted `LiteRt` model record silently deserialized as `Yolo` on the next
  load — a full chat-model outage from a one-line enum edit. Explicit values make this
  class of bug structurally impossible: a new member is just a new number, never a
  renumber.
  - `[Flags]` enums must additionally keep values as powers of two (`1, 2, 4, 8, ...`).

### 4. NO MAGIC STRINGS

**Never hardcode strings directly in code.** All strings must be externalized:

| String Type                            | Location                                 |
| -------------------------------------- | ---------------------------------------- |
| UI text (labels, messages, tooltips)   | `.resx` resource files                   |
| Error messages shown to users          | `.resx` resource files                   |
| Code-behind strings (feature-specific) | Feature-local `Constants.cs`             |
| Shared/global strings                  | Global `Constants.cs` or `AppStrings.cs` |
| Single-use in one class only           | `static` property at top of class        |

### 5. Static and Extension Methods

**Prefer static methods and extension methods for cross-cutting behavior WITHOUT violating SOLID.**

| Scenario                        | Good Use of Static/Extension                    | Bad (Violates SOLID)                 |
| ------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Pure utility functions          | `public static int Max(int a, int b)`           | Instance method in God Object        |
| Cross-cutting string operations | `public static string ToSnakeCase(this string)` | Utility class with state             |
| Validation extensions           | `public static bool IsValidEmail(this string)`  | Validator with mutable state         |
| Domain logic                    | Instance methods in domain entities             | Static methods (loses encapsulation) |
| Stateful operations             | Instance methods with injected dependencies     | Static methods (untestable)          |

**Guidelines:**

- Static methods: Pure functions, no side effects, deterministic
- Extension methods: Enhance existing types WITHOUT modifying them (Open/Closed Principle)
- Avoid static methods for: Domain logic with state, operations requiring dependencies
