# BSD #7 Community Assistance

Supabase-backed web/PWA prototype for Belcourt School District #7 Community Assistance.

## Current architecture

- Static browser app (`index.html`, `app.js`)
- Supabase Auth for user identity
- Supabase PostgreSQL for profiles and alerts
- Row Level Security for permissions
- Roles: `community`, `creator`, `approver`, `admin`
- Versioned service worker and `version.txt` update checks

## Authentication

The app is wired for **Sign in with Google** through Supabase Auth. Google must be enabled in the Supabase Dashboard and configured with a Google OAuth Web Client ID/Secret before the button will complete sign-in.

Every new authenticated user receives a `profiles` row and defaults to `community`. Admins can promote users to creator, approver, or admin from the app.

## Permissions

- `community`: read approved/active/resolved alerts
- `creator`: create pending requests; cannot approve them
- `approver`: review, approve/activate, and resolve alerts
- `admin`: administrative access plus role management

Permissions are enforced by PostgreSQL RLS, not only by hidden UI controls.

## Updating

`config.js` contains `APP_VERSION`; `version.txt` contains the deployed version; `sw.js` contains the cache version. Keep these versions synchronized when shipping a release. Running clients check `version.txt` at startup, when returning to the app, and every 10 minutes, then offer to update.

## Supabase

Project URL and the browser-safe publishable key are in `config.js`. Never add a Supabase secret/service-role key to this repository or frontend code.

## Hosting

This is now a static web app. It can be hosted on GitHub Pages or another HTTPS static host. Google OAuth redirect URLs must match the final hosted URL.
