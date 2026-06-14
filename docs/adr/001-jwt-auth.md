# ADR-001: Use JWT for Stateless Authentication

**Status**: Accepted

**Date**: 2026-06-13

## Context

We needed to authenticate requests to a REST API that serves a frontend SPA. The API needed to support:
- Email + password login
- Token-based (not session-based) auth to remain stateless
- Protection of routes that require authentication

Traditional session cookies require server-side state (session store), which complicates scaling and doesn't fit well with REST APIs consumed by JavaScript frontends.

## Decision

We use **JSON Web Tokens (JWT)** with `passport-jwt` strategy for stateless authentication.

### How It Works

1. **Registration**: User creates account with email + password
2. **Login**: User submits email + password → `LocalAuthGuard` validates via bcrypt → `AuthService` signs a JWT token
3. **Token format**: `{ sub: user.id, email: user.email }` signed with `JWT_SECRET`
4. **Token lifetime**: Configurable via `JWT_EXPIRATION` env var (default `7d`)
5. **API requests**: Frontend includes token in `Authorization: Bearer <token>` header
6. **Route protection**: `JwtAuthGuard` validates the token; invalid/expired tokens return 401

### Configuration

- `JWT_SECRET` env var — signing key (must be set, should be strong and random)
- `JWT_EXPIRATION` env var — token lifetime (e.g., `7d`, `24h`, `30m`)
- Backend: `src/modules/auth/strategies/jwt.strategy.ts`
- Frontend: `stores/auth.ts` auto-includes token in fetch headers

## Consequences

### Positive

- **Stateless**: No server-side session store needed; API can scale horizontally
- **RESTful**: Fits REST principles; token travels with each request
- **SPA-friendly**: Frontend can store token in localStorage/sessionStorage and include it in AJAX calls
- **Mobile-friendly**: Works well with mobile apps (iOS, Android)
- **CORS**: Works across domains (as long as CORS is configured)
- **Simple revocation pattern**: Short-lived tokens (7d) mean tokens expire naturally

### Negative

- **Token revocation is hard**: Once issued, a token is valid until expiration — no way to "logout" on the server side (unless you maintain a blacklist, which defeats statelesness)
- **Larger payloads**: Token travels with every request (vs. small session ID in cookies)
- **Clock skew**: Token validation depends on server/client clock accuracy; skew can cause premature rejection

### Neutral

- Token stored in localStorage is vulnerable to XSS attacks — mitigate via CSP headers and careful escaping
- Requires HTTPS in production to prevent token interception

## Related Decisions

- [ADR-002: Google OAuth 2.0](./002-google-oauth.md) — Extends this auth system to support social login

## References

- Passport.js JWT strategy: https://github.com/mikenicholson/passport-jwt
- JWT best practices: https://tools.ietf.org/html/rfc7519
