---
name: reactiveui-viewmodel-best-practices
description: This skill provides guidance for working with ViewModels, ReactiveUI, MVVM patterns, reactive commands, observable properties, or any UI/presentation layer code.
---

## Steps

### 1. The Philosophy: Functional Reactive Programming

ReactiveUI ViewModels follow **Functional Reactive Programming (FRP)** principles. Instead of imperative code ("Do A, then B, then C"), write **declarative relationships** between properties and commands.

**Core Principle:** Almost all interesting code should be in the **constructor**, describing how properties relate to each other using `WhenAnyValue` and `ToProperty`.

### 2. Use ReactiveUI.SourceGenerators (Recommended)

**ALWAYS use `[Reactive]` attribute for read-write properties:**

**Bad: Manual Boilerplate**

```csharp
private string name;
public string Name
{
    get => name;
    set => this.RaiseAndSetIfChanged(ref name, value);
}
```

**Good: Source Generator**

```csharp
using ReactiveUI.SourceGenerators;

public partial class MyViewModel : ReactiveObject
{
    [Reactive]
    private string name;
}
```

### 3. ObservableAsPropertyHelper (Output Properties)

**Use `[ObservableAsProperty]` for derived/computed properties:**

```csharp
public partial class MyViewModel : ReactiveObject
{
    [Reactive]
    private string name;

    [ObservableAsProperty]
    IObservable<string> FirstName => this.WhenAnyValue(x => x.Name)
        .Where(x => !string.IsNullOrEmpty(x))
        .Select(x => x.Split(' ')[0]);

    public MyViewModel()
    {
        InitializeOAPH(); // Initialize all OAPH properties
    }
}
```

### 4. ReactiveCommand Pattern

**Use `[ReactiveCommand]` attribute for command generation:**

```csharp
public partial class MyViewModel : ReactiveObject
{
    [Reactive]
    private string searchTerm;

    private IObservable<bool> canExecuteSearch;

    public MyViewModel()
    {
        canExecuteSearch = this.WhenAnyValue(
            x => x.SearchTerm,
            x => !string.IsNullOrEmpty(x));
    }

    [ReactiveCommand(CanExecute = nameof(canExecuteSearch))]
    private async Task Search(CancellationToken cancellationToken)
    {
        // Command logic
    }
}
```

### 5. When to Use Each Pattern

| Pattern                  | Use Case                             | Example                                |
| ------------------------ | ------------------------------------ | -------------------------------------- |
| `[Reactive]`             | User-editable properties             | `Username`, `SearchTerm`, `IsSelected` |
| `[ObservableAsProperty]` | Computed/derived properties          | `FullName` from `FirstName + LastName` |
| `[ReactiveCommand]`      | User actions                         | `SaveCommand`, `DeleteCommand`         |
| `WhenAnyValue`           | Reacting to property changes         | Enable button when fields valid        |
| `ToProperty`             | Converting observables to properties | Command results, async data loading    |

### 6. View-ViewModel Relationship

**Views are tightly coupled to ViewModels; ViewModels are decoupled from Views:**

```csharp
public partial class LoginView : ContentPage
{
    public LoginView()
    {
        InitializeComponent();

        this.WhenActivated(disposables =>
        {
            this.Bind(ViewModel,
                vm => vm.Username,
                v => v.UsernameEntry.Text)
                .DisposeWith(disposables);

            this.BindCommand(ViewModel,
                vm => vm.LoginCommand,
                v => v.LoginButton)
                .DisposeWith(disposables);
        });
    }
}
```

### 7. Common Anti-Patterns to Avoid

| Bad Practice                    | Correct Approach                  |
| ------------------------------- | --------------------------------- |
| Setters with logic              | Use `WhenAnyValue` + `ToProperty` |
| Code-behind in Views            | ViewModel + WhenActivated         |
| ViewModel references View       | Never (breaks testability)        |
| Manual property change handlers | Observable composition            |

### 8. MessageBus Anti-Pattern

**CRITICAL: MessageBus should be a LAST RESORT ONLY.** The ReactiveUI IMessageBus is effectively a global variable that creates invisible dependencies.

**Hierarchy of Communication Patterns (Best to Worst):**

| Rank | Pattern                      | When to Use                                  |
| ---- | ---------------------------- | -------------------------------------------- |
| 1    | **Explicit Dependencies**    | Standard case: pass dependencies via DI      |
| 2    | **Observable Composition**   | Reacting to state changes in reactive chains |
| 3    | **IObservable Chains**       | Connecting multiple observables              |
| 4    | **Events (Traditional)**     | Legacy code or platform-specific UI events   |
| 5    | **Commands (ReactiveUI)**    | Encapsulating user actions                   |
| 6    | **Mediator Pattern**         | Coordinating complex interactions            |
| X    | **MessageBus (LAST RESORT)** | NO other pattern works                       |

**Before using MessageBus, ask in order:**

1. Are the objects directly related? -> Pass dependency explicitly
2. Are they reacting to state changes? -> Use `WhenAny`
3. Do you need to merge multiple streams? -> Use observable operators
4. Are they in a parent-child relationship? -> Use reactive collections
5. Are you coordinating multiple objects? -> Use Mediator pattern with explicit DI
6. Is there truly no other way? -> ONLY then consider MessageBus

### 9. Requirements

- **Minimum C# Version:** 12.0
- **Recommended C# Version:** 13.0 (for partial properties)
- **ReactiveUI Version:** 19.5.31+
- **Class must be `partial`** to allow source generation
