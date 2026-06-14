# Session Persistence — Access Token + Refresh Token

**Date:** 2026-06-14  
**Status:** Approved

## Problem

The current auth system stores the JWT in `localStorage` and reads it with `import.meta.client` guard. When Nuxt runs route middleware on the server (SSR), `localStorage` is unavailable, the token is always `null`, and the middleware redirects every authenticated page to `/login` on refresh or navigation.

Additionally, JWTs have no expiry configured, so a stolen token is valid forever.

## Goals

- Session persists across page reloads and browser close/reopen (within 1 hour of inactivity)
- Session extends automatically while the user is active
- Session expires after exactly 1 hour of inactivity
- Stolen access tokens have a short damage window (15 minutes)

## Architecture

### Token Strategy

| Token | Expiry | Storage | Transport |
|-------|--------|---------|-----------|
| Access token (JWT) | 15 minutes | Cookie (`access_token`, non-httpOnly, SSR-safe) | `Authorization: Bearer` header |
| Refresh token (JWT) | 1 hour sliding | Cookie (`refresh_token`, httpOnly, JS-inaccessible) | Sent automatically by browser |

Sliding means every successful `/auth/refresh` call issues a new refresh token that resets the 1-hour clock.

### Flow

```
Login → access_token cookie (15min) + refresh_token httpOnly cookie (1h)
                                          ↓
Every API call → Authorization: Bearer <access_token>
                                          ↓
Access token expires (401) → POST /auth/refresh (browser sends httpOnly cookie)
                                          ↓
            Valid refresh → new access_token + new refresh_token (rotation)
            Invalid refresh → clearAuth() + redirect /login
```

---

## Backend Changes (NestJS)

### New Entity: `RefreshToken`

File: `src/modules/auth/entities/refresh-token.entity.ts`

Fields:
- `id` — UUID primary key
- `token` — unique string (UUID v4)
- `userId` — FK to users
- `expiresAt` — timestamp
- `createdAt` — timestamp

### New Endpoints

**`POST /auth/refresh`** — no auth guard required
- Reads `refresh_token` from httpOnly cookie
- Validates against DB (exists, not expired)
- Deletes old refresh token (rotation prevents reuse)
- Issues new access token (15min JWT) + new refresh token (1h)
- Sets new httpOnly cookie, returns `{ access_token }`

**`POST /auth/logout`** — no guard (access token may already be expired)
- Reads `refresh_token` from httpOnly cookie
- Deletes from DB
- Clears both cookies
- Returns 200

### Changes to `auth.service.ts`

- `login()` and `register()`: generate refresh token UUID, save to DB, set httpOnly cookie, return access token in response body
- Extract `generateTokens(user)` helper that handles both tokens
- Add `refresh(refreshToken: string, res: Response)` method
- Add `logout(refreshToken: string, res: Response)` method

### Changes to `auth.controller.ts`

- Add `@Res({ passthrough: true })` to login/register to set cookies
- Add `POST /refresh` and `POST /logout` routes
- Use `@Req()` to read the refresh token cookie

### Changes to `main.ts`

- Add `cookie-parser` middleware (`npm install cookie-parser @types/cookie-parser`)
- Update CORS: `credentials: true`, explicit `origin` (no wildcard with credentials)

### New Environment Variables

```env
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<different_secret_from_JWT_SECRET>
JWT_REFRESH_EXPIRES_IN=1h
```

---

## Frontend Changes (Nuxt 3)

### Fix SSR Bug — `stores/auth.ts`

- Convert to **setup store syntax** (`defineStore('auth', () => { ... })`)
- Replace `localStorage` token handling with `useCookie<string | null>('access_token')`
- `useCookie` is reactive and available on both server and client — fixes the SSR redirect bug
- `user` state stays as `ref<User | null>(null)`, recovered via `fetchMe()` in middleware (same as now)

### New Composable — `composables/useApiFetch.ts`

Wraps `$fetch` with automatic token refresh on 401:

1. Attempt the original request with `Authorization: Bearer <token>`
2. On 401 response:
   a. Call `POST /auth/refresh` (browser sends httpOnly cookie automatically)
   b. If refresh succeeds → update `access_token` cookie → retry original request
   c. If refresh fails → `store.clearAuth()` → `navigateTo('/login')`
3. All API calls in the store and pages use `useApiFetch` instead of raw `$fetch`

### Middleware `middleware/auth.ts`

No logic changes needed. Token now comes from cookie (SSR-safe), so the existing flow works:
1. Check `store.token` (from cookie — available in SSR)
2. If no user, `fetchMe()`
3. Check `isAuthenticated`

### Google OAuth Callback — `pages/auth/callback.vue`

Backend already sets httpOnly refresh token cookie during OAuth callback. Frontend reads the access token from the redirect query param and stores it in the `access_token` cookie.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Access token expired | Auto-refresh via `useApiFetch`, user doesn't notice |
| Refresh token expired (1h inactivity) | Redirect to `/login` |
| Refresh token not in DB (logout from another tab) | Redirect to `/login` |
| Network error during refresh | Show error toast, stay on page |
| Concurrent requests on 401 | Queue retries; only one refresh call fires |

---

## Testing

**Backend:**
- Unit: `auth.service` — token generation, refresh rotation, expired token rejection
- E2E: login → use token → wait for expiry → refresh → use new token → logout

**Frontend:**
- Unit: `useApiFetch` — mock 401 response, assert refresh called and request retried
- E2E (Playwright): login → reload page → assert still authenticated; idle 1h → assert redirected to login
