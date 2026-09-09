# v0.5 fixes

- Fixed scrolling text animation and forces animation restart on each update.
- Showing text now clears image/video; showing an image/video clears text and the other media type.
- Reworked image/video placement with explicit inline coordinates, including bottom-center sizing.

# Prism Cloud Overlay v0.5

An isolated mobile/Prism overlay system. It does not modify or depend on OBS.

## v0.5 adds

- Private Cloudflare R2 media library
- Upload images/video from the mobile control panel
- Preview media in the panel
- Rename display names
- Delete media directly from the panel with confirmation
- Show images with duration + position presets
- Play MP4/WebM with automatic end clearing
- Range-aware media delivery for video playback
- Controller login without putting the secret in the everyday URL
- Persistent overlay state via Durable Objects/WebSockets

## IMPORTANT: one Cloudflare setup step before deployment

Create an R2 bucket named exactly:

`prism-cloud-overlay-media`

Cloudflare Dashboard path: **R2 Object Storage → Create bucket**.

Leave the bucket private. You do **not** need to enable an r2.dev public URL.

The included `wrangler.jsonc` binds that bucket as `MEDIA`.

Your existing Worker secret `CONTROL_KEY` stays the same.

## Deploy using your existing GitHub repo

Replace the repository contents with the contents of this v0.5 folder (do not upload the outer folder itself). Commit to the same branch Cloudflare is already watching.

Cloudflare should automatically redeploy with:

`npx wrangler deploy`

## URLs after deployment

Overlay for Prism:

`https://prism-cloud-overlay.benny1600.workers.dev/overlay.html?room=mobiletest`

Controller:

`https://prism-cloud-overlay.benny1600.workers.dev/control.html?room=mobiletest`

The controller asks for your CONTROL_KEY and keeps it in `sessionStorage`, so closing the tab locks the controller again.

## First v0.5 test

1. Create the R2 bucket.
2. Push v0.5 to GitHub and let Cloudflare deploy.
3. Open the controller and enter your existing CONTROL_KEY.
4. Upload one small PNG/WebP.
5. Tap SHOW and verify it appears in the already-working Prism overlay.
6. Tap DELETE and confirm it disappears from the library.
7. Upload one short MP4/WebM and test PLAY.

## Mobile media guidance

- Images: WebP or optimized PNG.
- Video: H.264 MP4 is the safest compatibility choice for mobile; WebM can also work depending on the embedded browser.
- Keep clips short and reasonably compressed.
- v0.5 intentionally caps panel uploads at 75 MB per file.
- Only one overlay video is designed to play at a time.

## Security model

- R2 bucket stays private.
- `/api/media/*` upload/list/delete/rename requires `X-Control-Key`.
- Control WebSocket requires the same key.
- `/media/*` is read-only through the Worker so Prism can render media without holding credentials.
- The overlay remains receive-only except for the harmless `videoEnded` event used to clear finished video state.

## Future additions

Possible later upgrades include folders/categories, drag-and-drop button ordering, saved named presets, soft-delete/trash, thumbnails generated in the cloud, multiple overlay layers, and Streamer.bot API integration.


## v0.5 changes
- Fixed mobile image positioning with explicit top/bottom/left/right placement.
- Added top-center, bottom-center, left-center and right-center media positions.
- Added scrolling ticker text.
- Added text color selector.
- Added Small/Medium/Large/Extra-large text sizes.
- Added Slow/Normal/Fast ticker speed.


## v0.5 additions

- Per-image display size: 20%, 30%, 40%, 50%, 60%, 75%, or 100%.
- `Stay on + layer` allows multiple images/GIFs to remain visible together.
- Timed images replace the image layer, keeping temporary popups predictable.
- HIDE/STOP on an image removes only that selected image.
- Dropdown text is smaller and more compact for phone use.
- Up to 12 stay-on graphics can be active at once to protect mobile performance.
