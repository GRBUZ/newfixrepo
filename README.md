Firebase Minimal Backend — Setup (no Netlify Functions)
====================================================

This project uses **Firebase Realtime Database** directly from the browser.
No serverless functions, no Blobs, no CORS headaches.

Steps
-----
1) Go to https://console.firebase.google.com → Create a project.
2) Add a Web app → you'll get your **firebaseConfig**. Paste it into `js/app.firebase.js`.
   - Make sure to also set **databaseURL** (copy it from your Firebase console).
3) Realtime Database → Create database (in test mode for now).
4) Rules (Basic anti-double purchase):
   In Realtime Database → Rules, replace with:
   {
     "rules": {
       ".read": true,
       "artCells": {
         "$idx": {
           ".write": "!data.exists()"  // allow create only if the cell is not already sold
         }
       }
     }
   }
   Publish the rules.

5) Deploy the static site anywhere (Netlify, GitHub Pages, Vercel, Firebase Hosting).

How it works
------------
- Grid is 100x100, selection by drag or individual clicks.
- Price increases by $0.01 for every 1000 pixels (100 blocks) sold.
- When confirming, the client compresses the uploaded image and writes to `artCells/{idx}` with a **transaction**.
  If a cell is already taken, the transaction won't commit, so it's safe against race conditions.
- The image is one single mosaic across the whole selected rectangle.

Notes
-----
- For production, tighten rules (auth, rate limit, per-user quotas).
- We keep payloads small by compressing images (<= ~600px width).
