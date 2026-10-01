# Frontend Plan

## Goal
Build a Google-authenticated dashboard where one user can securely manage multiple named Codex profiles and control intelligent request failover.

## 1. Authentication
- Add `Sign in with Google` as the primary entry point.
- After successful login, load the current user profile and redirect to the dashboard.
- Display the signed-in user's name, email, and avatar.
- Provide logout and session-expiry handling.
- Do not expose access tokens, refresh tokens, or raw `auth.json` content after upload.
- The current backend uses `X-User-Id` for development only; production frontend integration must use a verified session/cookie or JWT.

## 2. Dashboard Layout
- Header: application name, user identity, logout action.
- Summary cards:
  - Total profiles
  - Active profiles
  - Disabled profiles
  - Intelligent Switcher status
- Main sections:
  - Codex Profiles
  - API Access
  - Request routing settings

## 3. Codex Profile Management
Each profile must have a user-provided name during import. Never generate a fallback name.

### Add profile flow
1. User clicks `Add Codex Profile`.
2. Show a required `Profile name` field.
3. Show a required auth.json upload control and an optional secure paste area.
4. Validate before submit:
   - Profile name is non-empty and within the backend limit.
   - File is JSON and within the allowed size.
   - Required auth.json fields are present.
5. Submit:
   ```http
   POST /api/codex/credentials/import
   Content-Type: application/json
   X-User-Id: <development-user-id>

   {
     "label": "Work Account",
     "content": "<auth.json text>"
   }
   ```
6. Clear the file content and textarea from frontend state immediately after the request completes.
7. Refresh the profile list and show only safe metadata.

### Profile list
Use:
```http
GET /api/codex/credentials
```

Each card/table row shows:
- Required profile name
- Status: Active, Disabled, Expired, or Revoked
- Expiry time, when available
- Last used time
- Last refreshed time
- Created time

Never show token values or the complete auth.json.

### Profile actions
- `Enable` / `Disable`: toggle whether the profile participates in routing.
- `Delete` or `Revoke`: require confirmation and call:
  ```http
  DELETE /api/codex/credentials/:credentialId
  ```
- Profile rename can be supported with a future update endpoint; do not use auth.json re-import as a rename shortcut.
- Show loading state and disable duplicate submissions.

## 4. Intelligent Switcher
Add a clearly labeled toggle:

```text
Intelligent Switcher: ON / OFF
```

### ON behavior
- Backend chooses an active profile.
- If a retry-safe failure occurs, backend tries the next eligible active profile.
- Disabled, revoked, expired, or unhealthy profiles are skipped.
- Show a compact status message such as `Failover enabled`.

### OFF behavior
- Backend uses the selected/default active profile only.
- If that profile fails, return the error without switching.

### Frontend settings
- Persist the setting through a user-settings endpoint.
- Load the setting on dashboard startup.
- Confirm changes with a small success toast.
- Never require the user to provide a different API key for each Codex profile.

Suggested endpoint:
```http
PATCH /api/user/settings/intelligent-switcher
Content-Type: application/json

{ "enabled": true }
```

## 5. API Access Section
All profiles use the same MyProxy API key by default:

```http
Authorization: Bearer sk-myproxy-xxxx
```

The frontend should provide:
- Create API key
- Show the plaintext key exactly once after creation
- Copy button with warning that it cannot be viewed again
- Revoke API key
- Usage instructions and sample curl request

The frontend does not need to create separate API keys for each Codex profile. Optional profile-specific API-key routing can be added later as an advanced feature.

## 6. API States and Error Handling
- `401`: session expired; redirect to Google login.
- `400`: show field-level validation errors, especially missing profile name.
- `403`: show that no active Codex profile is available.
- `409`: show duplicate/conflict message if introduced by backend.
- `429`: show rate-limit message; do not blindly resubmit.
- `5xx`: show retry action without exposing server internals.
- During upload/import, never log or display raw request payloads.

## 7. Security and UX Requirements
- Warn users that auth.json contains sensitive credentials.
- Require an explicit confirmation before upload:
  `I understand this file contains sensitive login credentials.`
- Use HTTPS in production.
- Clear raw file data from memory/state after import success or failure where practical.
- Do not place auth.json in URLs, analytics events, browser localStorage, or error reports.
- Use accessible labels, keyboard navigation, focus states, and responsive layouts.
- Confirm destructive actions with the profile name.

## 8. Recommended Screens
1. Google login screen
2. Empty dashboard with `Add Codex Profile` CTA
3. Dashboard with profile cards and switcher control
4. Add profile modal/page
5. API keys management section
6. Profile revoke confirmation modal
7. Error/expired-session states

## 9. Backend Dependencies for Frontend Completion
- Production Google session/JWT middleware instead of `X-User-Id`.
- Credential enable/disable field and update endpoint.
- Persistent per-user intelligent-switcher setting and settings endpoint.
- Retry/failover policy in the proxy, including safe retry conditions.
- Optional profile rename endpoint.
- Audit-safe logging and rate limiting for credential imports.
