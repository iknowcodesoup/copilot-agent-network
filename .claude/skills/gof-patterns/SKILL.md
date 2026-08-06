---
name: gang-of-four-patterns-reference
description: This skill provides guidance for designing new classes or components, reviewing architecture, naming services/repositories/handlers, or refactoring existing code structure. Use pattern-based names instead of generic "Service", "Manager", or "Helper" suffixes.
---

## Steps

### 1. Avoid Generic Nomenclature

Generic class names like `Service`, `Utility`, `Manager`, or `Helper` are a code smell indicating lack of clear responsibility. This breeds God Objects, SRP violations, and unmaintainable code.

**Always prefer specific, intent-revealing names based on Gang of Four patterns.**

### 2. Pattern Reference

| Pattern       | Purpose                                            | When to Use                                                  |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| **Adapter**   | Convert interface of class into another            | Integrating external APIs with incompatible interfaces       |
| **Observer**  | Define one-to-many dependency for state changes    | Publishing events to multiple subscribers                    |
| **Facade**    | Provide unified interface to subsystem             | Simplifying complex subsystems with many dependencies        |
| **Proxy**     | Provide surrogate/placeholder for expensive object | Adding caching, lazy loading, or access control              |
| **Mediator**  | Encapsulate how objects interact                   | Coordinating interactions between multiple objects           |
| **Memento**   | Capture/restore object state                       | Implementing undo/redo or state snapshots                    |
| **Provider**  | Supplies instances or state of a particular type   | Supplying configuration, health status, or computed state    |
| **Strategy**  | Define interchangeable algorithms                  | Selecting runtime behavior from multiple algorithms          |
| **Factory**   | Create objects without specifying exact classes    | Creating complex objects with dependencies                   |
| **Gateway**   | Encapsulate access to external system              | Abstracting external system communication (BLE, HTTP, cloud) |
| **Command**   | Encapsulate request as object                      | Making requests queue-able, undoable, or log-able            |
| **Builder**   | Construct complex objects step by step             | Objects with many optional parameters                        |
| **Decorator** | Add responsibilities to objects dynamically        | Adding cross-cutting concerns (logging, retry, validation)   |
| **Chain**     | Pass request along chain of handlers               | Processing requests through multiple handlers                |

### 3. Decision Tree for Naming

Ask these questions in order to identify the right pattern-based name:

1. **Does it adapt/convert interfaces?** -> **Adapter** (`CloudWatchMetricsAdapter`, `BleMessageAdapter`)
2. **Does it publish events/notify others?** -> **Observer** (`JobAlertPublisher`, `NotificationPublisher`)
3. **Does it simplify a complex subsystem?** -> **Facade** (`MetricsFacade`, `AudioStreamFacade`)
4. **Does it cache/proxy expensive access?** -> **Proxy** (`BitmapCacheProxy`, `ConnectionProxy`)
5. **Does it coordinate interactions?** -> **Mediator** (`AlarmMediator`, `DeviceConnectionMediator`)
6. **Does it capture/restore state?** -> **Memento** (`ClipboardMemento`, `DeviceStateMemento`)
7. **Does it manage memento lifecycle?** -> **Caretaker** (`HistoryCaretaker`, `SessionCaretaker`)
8. **Does it supply instances/state?** -> **Provider** (`HealthStatusProvider`, `ConfigProvider`)
9. **Does it access external systems/APIs?** -> **Gateway** (`BleGateway`, `CloudGateway`)
10. **Does it persist/retrieve data?** -> **Repository** (`DeviceRepository`, `ConfigRepository`)
11. **Does it create complex objects?** -> **Factory** (`DeviceFactory`, `CodecFactory`)
12. **Does it encapsulate an action?** -> **Command** (`ConnectDeviceCommand`, `SendAudioCommand`)
13. **Does it add behavior to existing object?** -> **Decorator** (`RetryDecorator`, `LoggingDecorator`)
14. **Does it select an algorithm at runtime?** -> **Strategy** (`CompressionStrategy`, `EncryptionStrategy`)
15. **Does it process through multiple handlers?** -> **Chain of Responsibility** (`AudioProcessorChain`)

If none fit, reconsider class design - it may be mixing concerns.

### 4. Naming Examples

| Bad (Generic)               | Good (Pattern-Based)       | Pattern    |
| --------------------------- | -------------------------- | ---------- |
| `IHealthCheckService`       | `IHealthStatusProvider`    | Provider   |
| `ICloudWatchMetricsService` | `IMetricsFacade`           | Facade     |
| `CloudWatchMetricsService`  | `CloudWatchMetricsAdapter` | Adapter    |
| `BleService`                | `BleGateway`               | Gateway    |
| `ConfigService`             | `AppConfigRepository`      | Repository |
| `audio_processor_service`   | `AudioProcessorChain`      | Chain      |
| `device_connection_manager` | `DeviceConnectionMediator` | Mediator   |
| `codec_util`                | `CodecFactory`             | Factory    |
| `connection_helper`         | `ConnectionRetryDecorator` | Decorator  |

### 5. In Specs: Class Design Template

When proposing new classes in specs, use this template:

```markdown
### Component: [PatternBasedName]

**Pattern**: [Pattern name from Gang of Four]
**Responsibility**: [What it owns]
**Delegates**: [What it doesn't own]
**Rejected alternatives**:

- [bad_name_with_underscores] (underscores)
- [GenericServiceName] (generic, unclear responsibility)
```
