How to fix "MissingBlobsEnvironmentError"
===========================================

1) In Netlify, open **Site settings → Build & deploy → Environment**.
2) Add these **Environment variables** (case-sensitive):
   - `SITE_ID` = your **Project ID** (Site settings → General → Project information → Project ID)
   - `BLOBS_TOKEN` = a **Personal Access Token** (Netlify user menu → User settings → Applications → Personal access tokens)
     • scopes: "Sites", "Blobs" (full access is okay for a test)

3) Save → **Clear cache and deploy**.

4) Visit:
   - `/.netlify/functions/diag` → must show `{ ok: true, blobsOk: true }`
   - Then retry a purchase.

Notes
-----
- We pass `siteID` + `token` **explicitly** to `getStore`, so it works even if the runtime doesn't auto-inject them.
- You can rename the env vars if you prefer; keep the same names in code or map them.
