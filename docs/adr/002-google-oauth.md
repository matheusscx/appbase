# ADR-002: Support Google OAuth 2.0 for Social Login

**Status**: Accepted

**Date**: 2026-06-13

## Context

We wanted to support social login to reduce friction for users who don't want to create yet another username/password account. Google is the most commonly used OAuth provider and simplifies user onboarding.

We already use JWT for auth ([ADR-001](./001-jwt-auth.md)), so the question was how to integrate OAuth into that system.

## Decision

We use **Google OAuth 2.0** with `passport-google-oauth20` strategy. The flow:

1. **Frontend**: User clicks "Sign in with Google"
2. **Redirect**: Browser goes to `GET /api/auth/google`
3. **Google consent screen**: User is prompted to grant permission
4. **Callback**: Google redirects back to `GET /api/auth/google/callback?code=...`
5. **Token exchange**: Backend exchanges the `code` for a Google profile (email, name, Google ID)
6. **User upsert**:
   - If user with matching `google_id` exists → use that user
   - Else if user with matching email exists → link Google ID to existing user
   - Else → create new user
7. **JWT issued**: Backend signs a JWT for the user and redirects frontend to `/auth/callback?token=<jwt>`
8. **Frontend stores token**: `useAuthStore.setToken()` saves token to localStorage and state

### Configuration

**Required environment variables:**
- `GOOGLE_CLIENT_ID` — from Google Cloud Console
- `GOOGLE_CLIENT_SECRET` — from Google Cloud Console
- `GOOGLE_CALLBACK_URL` — redirect URI registered in Google Cloud Console (e.g., `http://localhost:3000/api/auth/google/callback`)

**Implementation:**
- Backend: `src/modules/auth/strategies/google.strategy.ts`
- Frontend: Login page has "Sign in with Google" button that calls `useAuthStore.loginWithGoogle()`

## Consequences

### Positive

- **User convenience**: One less password to remember; leverages existing Google account
- **Reduced support burden**: No password reset flows for OAuth users (Google handles password management)
- **Faster signup**: Pre-fills name and email from Google profile
- **Higher conversion**: Removes friction from the login/signup flow
- **Integrates with existing JWT system**: OAuth is just another way to issue a JWT

### Negative

- **External dependency**: Relies on Google OAuth availability and network connectivity
- **Requires setup**: Must register app in Google Cloud Console and manage secrets
- **Account linking complexity**: Email-based matching can cause issues if user signs up via password first, then tries OAuth with same email
- **Privacy**: User must grant permission to share email with our app (though most users expect this)
- **Fallback needed**: If user doesn't have Google account, they need email+password option (which we have)

### Neutral

- Users can link OAuth to existing accounts by using the same email
- Google ID is stored separately, so no dependency on Google's stability for password verification

## Known Issues & Mitigations

### Issue: Account Linking Confusion
If user signs up with email `user@gmail.com` + password, then later tries to "Sign in with Google" (same email), our system will link the Google account to the existing user. This is convenient but could be surprising.

**Mitigation**: Document this behavior in sign-up flow; consider adding an "account already exists" warning.

### Issue: GOOGLE_CLIENT_SECRET Exposure
Secrets must be stored securely and never committed to version control.

**Mitigation**: Keep `GOOGLE_CLIENT_ID/SECRET` in `.env.example` as placeholders; actual values in `.env` (which is .gitignored).

## Related Decisions

- [ADR-001: JWT Authentication](./001-jwt-auth.md) — OAuth extends this system, not replaces it

## References

- Passport.js Google OAuth strategy: https://github.com/jaredhanson/passport-google-oauth2
- Google OAuth 2.0 documentation: https://developers.google.com/identity/protocols/oauth2
