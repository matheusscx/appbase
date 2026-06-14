# Feature: [Feature Name]

**Status**: [In Design / In Development / Complete]  
**Owner**: [Optional: who owns this feature]  
**Last Updated**: [YYYY-MM-DD]

---

## Overview

### What is it?

Describe the feature from the user's perspective. What can they do?

### Why does it exist?

Business motivation. What problem does it solve?

### Scope

- Included in this version: [list items]
- NOT included (future): [list items]

---

## API Endpoints

List all REST endpoints for this feature. Include:
- HTTP method + path
- Required auth
- Request body example
- Response example

### Example Endpoint

```
POST /api/[feature]/create

Authorization: Bearer <token>

Request:
{
  "field1": "value",
  "field2": 123
}

Response (201):
{
  "id": "uuid",
  "field1": "value",
  "field2": 123,
  "created_at": "2026-06-13T..."
}
```

---

## Backend

### Module & Services

- **Module**: `src/modules/[feature]/[feature].module.ts`
- **Controller**: `src/modules/[feature]/[feature].controller.ts`
- **Service**: `src/modules/[feature]/[feature].service.ts`

### Entity & Database

**Table**: `[feature_name]`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | |
| | | | |

### DTOs

- `Create[Feature]Dto` — Request body for POST
- `Update[Feature]Dto` — Request body for PATCH
- `[Feature]Dto` — Response body

### Key Methods

- `service.create(dto)` — Create and persist new entity
- `service.findById(id)` — Lookup by ID
- `service.update(id, dto)` — Update entity
- `service.delete(id)` — Delete entity

---

## Frontend

### Pages

- `pages/[feature]/index.vue` — List or overview
- `pages/[feature]/[id].vue` — Detail view (optional)
- `pages/[feature]/new.vue` — Create form (optional)

### Components

- `components/[Feature]List.vue` — Display multiple items
- `components/[Feature]Card.vue` — Display single item
- `components/[Feature]Form.vue` — Create/edit form (optional)

### Pinia Store

**File**: `stores/[feature].ts`

**State**:
- `items: [Feature][]` — List of items
- `currentItem: [Feature] | null` — Currently selected item
- `loading: boolean`
- `error: string | null`

**Actions**:
- `fetchAll()` — GET list from API
- `fetchOne(id)` — GET single item
- `create(data)` — POST new item
- `update(id, data)` — PATCH item
- `delete(id)` — DELETE item

---

## Data Flow

### Example: Create [Feature]

```
[User opens form]
  ↓
[User fills fields]
  ↓ useStore.create(formData)
[POST /api/[feature]]
  ↓
[Controller validates DTO]
  ↓
[Service creates entity in DB]
  ↓
[Return created entity]
  ↓
[Store updates state]
  ↓
[UI re-renders with new item]
```

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/[feature]/[feature].service.spec.ts
npm test -- modules/[feature]/[feature].controller.spec.ts
```

### E2E Tests

```bash
npm run test:e2e -- [feature].e2e.spec.ts
```

### Manual Testing (Swagger)

1. Open http://localhost:3000/api/docs
2. Authenticate with Bearer token
3. Try endpoints in the UI

### Manual Testing (Frontend)

1. Start app: `docker-compose up`
2. Navigate to feature pages
3. Test create/read/update/delete flows
4. Verify error handling

---

## Acceptance Criteria

- [ ] All endpoints implemented and tested
- [ ] Frontend pages and components built
- [ ] Database table(s) created (if applicable)
- [ ] DTOs with validation decorators
- [ ] Unit tests pass
- [ ] E2E tests pass
- [ ] API docs updated (Swagger decorators)
- [ ] Feature docs updated (this file)
- [ ] Code reviewed

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| | | |

---

## Related Features

- [Link to related feature docs]

---

## Notes

Any additional context, blockers, or decisions.
