# Quick Start: How to Document Features

This guide shows how to use the documentation standard when adding a new feature.

## Step 1: Create Feature Documentation

Copy the template and fill it in:

```bash
cp docs/features/TEMPLATE.md docs/features/my-feature.md
```

Open `docs/features/my-feature.md` and fill in:
- Feature name and status
- Overview: what it does, why it exists
- API endpoints (if applicable)
- Backend: modules, entities, services
- Frontend: pages, components, stores
- Data flow diagram
- Testing instructions
- Known issues / TODOs

**Example**: See `docs/features/auth.md` for a complete feature doc.

## Step 2: Create Architecture Decision Records (if applicable)

Create ADRs **only** for significant technical decisions, not for every feature.

```bash
# Check the next available number
ls docs/adr/

# Create new ADR (e.g., ADR-003)
touch docs/adr/003-your-decision.md
```

Fill in:
- **Status**: Proposed / Accepted
- **Date**: YYYY-MM-DD
- **Context**: What problem are we solving?
- **Decision**: What did we choose and how?
- **Consequences**: Benefits, trade-offs, risks

Then update `docs/adr/README.md` to add your ADR to the index.

**Example**: See `docs/adr/001-jwt-auth.md` for a complete ADR.

## Step 3: Update the Index

Add your new feature to:
- `docs/README.md` — Add link under "Features" section
- `docs/adr/README.md` — Add link under "ADR Index" (if applicable)

## Documentation Template Checklist

- [ ] Feature name, status, last updated date
- [ ] Overview section with "What", "Why", "Scope"
- [ ] All API endpoints listed with examples
- [ ] Backend: modules, services, entities, DTOs
- [ ] Frontend: pages, components, stores
- [ ] Data flow (text or ASCII diagram)
- [ ] Testing instructions (unit, E2E, manual)
- [ ] Acceptance criteria and known issues
- [ ] Links to related docs and ADRs

## Common Mistakes to Avoid

❌ **Don't**: Create long prose — use tables and examples instead

✅ **Do**: Break content into sections; include code snippets and curl examples

---

❌ **Don't**: Write DTOs without validation examples

✅ **Do**: Show what fields are required, min/max lengths, formats

---

❌ **Don't**: Skip the "Data Flow" section

✅ **Do**: Include a simple ASCII diagram or step-by-step description

---

❌ **Don't**: Document implementation details (variable names, function signatures)

✅ **Do**: Document the "why" and high-level "how"

---

❌ **Don't**: Update docs months after code is written

✅ **Do**: Update docs as you write code; keep them in sync

## Examples

### Simple Feature
If your feature is simple (e.g., add a new field to an existing entity), you may not need a separate feature doc — update the existing feature doc instead.

### Complex Feature
Complex features (new API endpoint + frontend pages + database changes) should have a dedicated feature doc following the template.

### Architectural Change
If your feature involves choosing between frameworks, databases, or auth methods, create an ADR to explain the decision.

## Questions?

- **What's the difference between an ADR and a feature doc?**
  - **ADR**: "Why did we choose this technology/approach?"
  - **Feature doc**: "How does this feature work end-to-end?"

- **When should I create an ADR?**
  - Creating a new service / module
  - Switching databases or auth methods
  - Major architectural changes
  - Not for: bug fixes, small UI tweaks, implementation details

- **Should I document internal modules without user-facing features?**
  - Yes, if they're complex or shared. Keep them in a "modules/" subdirectory in docs.
  - No, if they're simple utilities — comment in the code instead.

---

See `docs/README.md` for full documentation index.
