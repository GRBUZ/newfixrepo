Minimal Influencers Wall — README
----------------------------------
Deploy steps
1) Upload this repo to GitHub (all files at root).
2) Netlify → Add new project from GitHub → (no build) → Deploy.
3) If build fails: verify Node 18+ and that Netlify installs dependencies (package.json present).

Features
- 100x100 grid (10px)
- Drag rectangle selection + single click toggle
- ESC / Cancel clears selection immediately
- Minimal modal: Link + Image upload (required)
- No payment
- Anti-double purchase on finalize (server rejects already-sold blocks)
- One image across the whole selection (mosaic via CSS background-position/size)
- Price increases $0.01 every 1000 pixels sold (shown in header)
