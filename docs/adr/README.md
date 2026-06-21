# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for significant technical choices in the project.

## What is an ADR?

An ADR documents an important architectural decision, including the context that led to it and the consequences of the choice. ADRs help future developers (including future you) understand the "why" behind decisions, not just the "what."

Format based on [Michael Nygard's ADR template](https://github.com/joelparkerhenderson/architecture_decision_record).

## ADR Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [001](./001-jwt-auth.md) | Use JWT for stateless authentication | Accepted | 2026-06-13 |
| [002](./002-google-oauth.md) | Support Google OAuth 2.0 for social login | Accepted | 2026-06-13 |
| [003](./003-jwt-decode-client.md) | Decodificar JWT en cliente sin librería + patrón híbrido JWT/store | Accepted | 2026-06-20 |

## Creating a New ADR

### Steps

1. **Increment the number**: Use the next available number (e.g., `003-feature-name.md`)
2. **Use this template**:

```markdown
# ADR-XXX: [Title]

**Status**: Proposed / Accepted / Deprecated / Superseded by ADR-YYY

**Date**: YYYY-MM-DD

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive

- Benefit 1
- Benefit 2

### Negative

- Trade-off 1
- Trade-off 2

### Neutral

- Side effect 1
```

3. **Add to index**: Update this file's index table
4. **Link from relevant docs**: Reference the ADR from feature docs or architecture guides

### When to Create an ADR

- Choosing between libraries or frameworks
- Database design decisions
- Authentication/authorization approach
- Architectural patterns (modules, layers, etc.)
- Performance optimizations with trade-offs
- Infrastructure choices (Docker, cloud provider, etc.)

### When NOT to Create an ADR

- Implementation details (local variable naming, function signature tweaks)
- Bug fixes
- Refactoring that doesn't change external behavior
- Small UI tweaks

## Reading an ADR

The **Status** field tells you:
- **Proposed**: Under discussion, not yet committed
- **Accepted**: Decision is made and implemented
- **Deprecated**: Was decided, but we're moving away from it
- **Superseded by ADR-XXX**: Replaced by a newer decision

The **Consequences** section is the most important — it explains both benefits and trade-offs, so you can judge whether the decision still fits your context.
