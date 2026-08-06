# Command Reference

Complete reference for LeanSpec CLI commands. For quick help, run `leanspec --help` or `leanspec <command> --help`.

## Discovery Commands

### List Specs
```bash
leanspec list
```
See all specs in your project.

### Search Specs
```bash
leanspec search "<query>"
```
Find relevant specs by content search.

## Viewing Commands

### View Spec
```bash
leanspec view <spec>              # Formatted view
leanspec view <spec> --raw        # Raw markdown
leanspec view <spec> --json       # Structured JSON
leanspec view <spec>/DESIGN.md    # View sub-spec file
```

### Open in Editor
```bash
leanspec open <spec>
```

### List Spec Files
```bash
leanspec files <spec>             # List all files (including sub-specs)
leanspec files <spec> --type docs # Filter by markdown files
```

## Project Overview Commands

### Kanban Board
```bash
leanspec board
```
Visual kanban view with project health summary.

### Project Statistics
```bash
leanspec stats                    # Quick metrics
leanspec stats --full             # Detailed analytics
```

## Spec Management Commands

### Create Spec
```bash
leanspec create <name>                           # Basic creation
leanspec create <name> --title "Human Title"     # With custom title
leanspec create <name> --priority high           # Set priority
leanspec create <name> --tags api,backend        # Add tags
leanspec create <name> --assignee "Name"         # Set assignee
```

### Update Spec Metadata
**REQUIRED - Never manually edit frontmatter fields**

```bash
# Update status
leanspec update <spec> --status planned
leanspec update <spec> --status in-progress
leanspec update <spec> --status complete
leanspec update <spec> --status archived

# Note: When setting status to 'complete', the CLI will verify all checklist
# items are checked. Use --force to skip this verification.
leanspec update <spec> --status complete --force

# Update priority
leanspec update <spec> --priority low
leanspec update <spec> --priority medium
leanspec update <spec> --priority high
leanspec update <spec> --priority critical

# Update tags
leanspec update <spec> --tags tag1,tag2,tag3

# Update assignee
leanspec update <spec> --assignee "Name"

# Combine multiple updates
leanspec update <spec> --status in-progress --priority high

# Batch update multiple specs
leanspec update 001-feature-a 002-feature-b --status in-progress
```

### Manage Relationships
```bash
# Add dependencies
leanspec link <spec> --depends-on other-spec
leanspec link <spec> --depends-on dep-a dep-b
leanspec link <spec> --related other-spec

# Remove relationships
leanspec unlink <spec> --depends-on other-spec
leanspec unlink <spec> --depends-on dep-a dep-b
leanspec unlink <spec> --related other-spec

# View dependency graph
leanspec deps <spec>                # Complete graph
leanspec deps <spec> --upstream     # Dependencies only
leanspec deps <spec> --downstream   # Dependents only
leanspec deps <spec> --impact       # Impact analysis
leanspec deps <spec> --json         # JSON output
```

### Archive Spec
```bash
leanspec archive <spec>
leanspec archive 001-feature-a 002-feature-b
```
Moves spec to `archived/` directory.

## Token Management Commands

### Count Tokens
```bash
leanspec tokens <spec>              # Count tokens in spec
leanspec tokens <file-path>         # Count tokens in any file (md, code, text)
leanspec tokens <spec> -v           # Show detailed breakdown
```

### Validate Specs
```bash
leanspec validate                   # Validate all specs
leanspec validate <spec>            # Validate specific spec
```

## Spec Splitting Commands

**Use when spec exceeds 3,500 tokens**

### Analyze Structure
```bash
leanspec analyze <spec>             # Human-readable analysis
leanspec analyze <spec> --json      # JSON output for parsing
```

### Split Spec
```bash
# Extract sections to sub-spec files
leanspec split <spec> --output "DESIGN.md:100-250"
leanspec split <spec> --output "TESTING.md:300-400" --output "API.md:500-600"
```

### Compact Main File
```bash
# Remove extracted sections from main README
leanspec compact <spec> --remove "100-250"
leanspec compact <spec> --remove "100-250" --remove "300-400"
```

## Backfill Commands

### Backfill Metadata from Git
```bash
leanspec backfill                              # Dry run preview
leanspec backfill --force                      # Apply changes
leanspec backfill --include-assignee           # Backfill assignee
leanspec backfill --include-transitions        # Full transition history
leanspec backfill --specs 042,043              # Specific specs only
```

## Utility Commands

### Check for Conflicts
```bash
leanspec check
```
Detect sequence number conflicts or naming issues.

### Help
```bash
leanspec --help                     # General help
leanspec <command> --help           # Command-specific help
```

## Common Workflows

### Starting New Work
```bash
leanspec create feature-name
leanspec update feature-name --status in-progress --priority high
# ... implement feature ...
leanspec update feature-name --status complete
```

### Finding Related Work
```bash
leanspec search "authentication"
leanspec deps auth-system
leanspec view auth-system
```

### Managing Complex Specs
```bash
leanspec tokens large-spec          # Check size
leanspec analyze large-spec         # Get split recommendations
leanspec split large-spec --output "DESIGN.md:50-200"
leanspec compact large-spec --remove "50-200"
```
