# Production backend and reliability design

Use a managed backend so the alert system does not depend on a school laptop or one phone.

Recommended production stack:
- Expo / React Native for iOS and Android.
- Firebase Authentication with Google sign-in, Apple sign-in on iOS, and email/password fallback.
- MFA required for privileged district accounts.
- Cloud Firestore as the system of record.
- Cloud Storage for only district-approved public alert images.
- Cloud Functions or Cloud Run for server-side alert approval/publishing.
- FCM + APNs for push delivery.
- Firebase Crashlytics for mobile crash monitoring.
- Cloud Logging, Error Reporting, uptime checks, backups, and recovery procedures.
- App Check, rate limiting, custom claims, and server-side role enforcement.

Reliability rules:
- A phone never sends an alert directly; it requests a server-side publish action.
- Publish actions are idempotent to prevent duplicate alerts.
- Push jobs are queued, delivery receipts are tracked, invalid tokens are pruned, and transient failures retry.
- One device crash cannot affect other users or the database.
- The all-clear references the original alert and is sent to the same audience.

Roles:
- Community: read/receive only.
- Creator: draft and submit only.
- Approver: activate/resolve.
- Admin: manage roles and configuration; cannot bypass audit logging.

Required audit record:
- creator and timestamp
- approver and timestamp
- investigating agency and public contact number
- legal/policy authorization selected by the human decision-maker
- exact public payload sent
- push job IDs/delivery statistics
- every update and correction
- all-clear actor and timestamp
