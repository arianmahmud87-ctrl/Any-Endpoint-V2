# Any Endpoint frontend

How the website works today. This is the control-panel site, not the gateway server.

## What “Gateway” means in Playground

Gateway is not a separate product screen. It is the name on the phone-style chat in Playground.

Playground is an API tester. You type an endpoint URL and an API key, then send a message. The site posts that message straight to the URL you typed. The chat header says “Gateway” because that URL is meant to be your gateway, for example `https://your-gateway.example/v1/responses`.

What the tester sends:

- Method: `POST`
- Header: `Content-Type: application/json`
- Header: `Authorization: Bearer <the key in the field>`, if a key is filled in
- Body: `{ "model": "gpt-5-codex", "input": "<your message>" }`

The reply is shown as plain text in a left bubble and types in. The status code and time appear under the bubble. Stop cancels the request. Clear wipes the thread. Messages stay in the open tab only. They are not saved.

The key field starts with the account key from sign-in. You can replace it to test another key. If the endpoint blocks browser calls, the bubble says the site could not reach it.

## Sign-in

- Public pages: `/login` and `/auth/callback`.
- The Google button goes to `/api/auth/google/start`.
- On open, the site checks `GET /api/me`. A valid session enters the app. An expired session returns to login.
- Everything else redirects to `/app/playground`.

## After sign-in

Sidebar, in order:

1. Playground — `/app/playground` (home)
2. Overview — `/app/overview`
3. Profiles — `/app/profiles`
4. Keys — `/app/keys`
5. Usage — `/app/usage`
6. Settings — `/app/settings`

The top-right button shows the signed-in name, email, and picture, or initials. Log out ends the session. Workers, Claude profiles, Universal keys, and the audit log are not in the product right now.

## Overview

Shows Codex profile totals (all, active, disabled), whether Intelligent Switcher is on, and request counts for the last day. Quick links open Playground, add a Codex profile, or open the API key page.

## Profiles

Codex accounts only.

- Add a profile with a name you type. The site never invents a name.
- Upload `auth.json` or paste it. You must confirm: “I understand this file contains sensitive login credentials.”
- The file is checked for `tokens.refresh_token` and an access token before it is sent.
- Import calls `POST /api/codex/credentials/import` with `{ label, content }`.
- The file is cleared from the form whether import succeeds or fails. It is never shown again, and it is not stored in the browser.
- The list shows status, expiry, last used, last refreshed, and created. You can enable, disable, or revoke. Revoke asks you to type the profile name.

## Intelligent Switcher

A sliding button on Playground, Overview, Profiles, and Settings.

- On: failover is enabled. A safe retry can try the next active Codex profile.
- Off: the request stays on the selected profile.
- Saved with `PATCH /api/user/settings/intelligent-switcher` and `{ enabled }`.
- Loaded on startup from `GET /api/user/settings`.

## API key

One key is created when you sign in. It covers every Codex profile. There is no create-key form and no per-profile key.

- The key stays blurred.
- Click it twice to show it.
- Copy copies it while it is still blurred.
- Regenerate replaces it. The old key stops working. The new one starts blurred again.
- A sample curl is shown with a placeholder, not your real key.

## Usage

A table of request metadata: time, route, model, status, latency, profile, and key prefix. Prompts and response bodies are not shown. You can filter to errors.

## Settings

Account name and email, Google sign-in, the switcher, organization, active sessions, log out everywhere, and environment. Session is an HttpOnly cookie, not a value kept in the browser.

## How data is loaded

Dashboard calls use relative `/api/...` paths, send cookies, and attach `X-CSRF-Token` on changes. The token lives in memory only.

Until `VITE_PREVIEW_MODE=false`, those dashboard calls use in-memory demo data so the site can be clicked through without a backend. The Playground tester is different: it always calls the endpoint URL you typed, even in preview.

Errors:

- 400: fix the highlighted field
- 401: sign in again
- 403: not allowed, or no active Codex profile
- 404: not found
- 409: conflict; the list refreshes
- 429: wait and retry later
- 503: dependency unavailable
- 500 or 502: retry, without showing server internals
