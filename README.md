# v0.8 fixes

- Fixed scrolling text animation and forces animation restart on each update.
- Showing text now clears image/video; showing an image/video clears text and the other media type.
- Reworked image/video placement with explicit inline coordinates, including bottom-center sizing.

# Prism Cloud Overlay v0.8

An isolated mobile/Prism overlay system. It does not modify or depend on OBS.

## v0.8 adds

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

Replace the repository contents with the contents of this v0.8 folder (do not upload the outer folder itself). Commit to the same branch Cloudflare is already watching.

Cloudflare should automatically redeploy with:

`npx wrangler deploy`

## URLs after deployment

Overlay for Prism:

`https://prism-cloud-overlay.benny1600.workers.dev/overlay.html?room=mobiletest`

Controller:

`https://prism-cloud-overlay.benny1600.workers.dev/control.html?room=mobiletest`

The controller asks for your CONTROL_KEY and keeps it in `sessionStorage`, so closing the tab locks the controller again.

## First v0.8 test

1. Create the R2 bucket.
2. Push v0.8 to GitHub and let Cloudflare deploy.
3. Open the controller and enter your existing CONTROL_KEY.
4. Upload one small PNG/WebP.
5. Tap SHOW and verify it appears in the already-working Prism overlay.
6. Tap DELETE and confirm it disappears from the library.
7. Upload one short MP4/WebM and test PLAY.

## Mobile media guidance

- Images: WebP or optimized PNG.
- Video: H.264 MP4 is the safest compatibility choice for mobile; WebM can also work depending on the embedded browser.
- Keep clips short and reasonably compressed.
- v0.8 intentionally caps panel uploads at 75 MB per file.
- Only one overlay video is designed to play at a time.

## Security model

- R2 bucket stays private.
- `/api/media/*` upload/list/delete/rename requires `X-Control-Key`.
- Control WebSocket requires the same key.
- `/media/*` is read-only through the Worker so Prism can render media without holding credentials.
- The overlay remains receive-only except for the harmless `videoEnded` event used to clear finished video state.

## Future additions

Possible later upgrades include folders/categories, drag-and-drop button ordering, saved named presets, soft-delete/trash, thumbnails generated in the cloud, multiple overlay layers, and Streamer.bot API integration.


## v0.8 changes
- Fixed mobile image positioning with explicit top/bottom/left/right placement.
- Added top-center, bottom-center, left-center and right-center media positions.
- Added scrolling ticker text.
- Added text color selector.
- Added Small/Medium/Large/Extra-large text sizes.
- Added Slow/Normal/Fast ticker speed.


## v0.8 additions

- Per-image display size: 20%, 30%, 40%, 50%, 60%, 75%, or 100%.
- `Stay on + layer` allows multiple images/GIFs to remain visible together.
- Timed images replace the image layer, keeping temporary popups predictable.
- HIDE/STOP on an image removes only that selected image.
- Dropdown text is smaller and more compact for phone use.
- Up to 12 stay-on graphics can be active at once to protect mobile performance.


## v0.8 additions

- Per-image entrance transitions:
  - None
  - Fade
  - Slide up/down/left/right
  - Zoom
  - Pop
- Per-image exit transitions with the same options.
- Transition speed choices:
  - 250 ms
  - 500 ms
  - 750 ms
  - 1 second
- Timed images begin their exit transition before removal.
- HIDE/STOP uses the selected exit transition.
- CSS transform + opacity animations only, to remain lightweight for Prism/mobile.


## v0.8 fixes and additions

- Fixed image state so pressing SHOW on one card only adds that selected image.
- Stay-on images persist when a temporary/timed image is shown.
- Temporary images no longer replace stay-on images.
- Removed the stale `removeAt` state that could revive old images.
- Timed images clean themselves out of Durable Object state when they expire.
- Exit transitions now run from the image's own stored transition settings.
- Entrance transitions use explicit opacity/transform animation and work at every image position.
- Added built-in text font choices with no external font downloads:
  - System
  - Arial
  - Georgia
  - Impact
  - Comic Sans


## v0.8 changes

- Removed all image transition controls and animation code.
- Kept independent per-image SHOW/HIDE behavior.
- Kept Stay on + layer behavior.
- Kept per-image size and positioning.
- Kept timed image cleanup.
- Kept text scrolling, color, size, position, speed, and font choices.
- Simpler overlay code for better Prism/mobile reliability.


## v0.9 fix
- Text is now independent from the image layer.
- Showing or updating text no longer clears stay-on or timed images.
- Hiding text affects only the text layer.


## v0.10 — Disney Ride Waits

Added a new **Ride Waits** tab to the mobile controller.

- Four park cards: Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom.
- Each park card has its own position, size, and cycle-speed controls.
- The ride-wait layer is independent from image and text layers.
- Waits refresh from Queue-Times every 5 minutes.
- Rides cycle automatically.
- Green: 0–30 minutes, Yellow: 31–60, Red: 61+.
- Existing omitted rides and shortened attraction names are preserved.
- `HIDE RIDE WAITS` hides only the ride-wait layer.
- `CLEAR SCREEN` still clears all overlay layers.


## v0.11 — Parks + Weather

- Renamed Ride Waits tab to Parks.
- Added weather for Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom, and Disney Springs.
- Weather uses Open-Meteo and refreshes every 10 minutes.
- Weather includes temperature, feels-like temperature, conditions, rain chance, rain bar, precipitation, updated time, park name, and channel footer.
- Weather has position, size, and Fahrenheit/Celsius controls.
- Ride Waits minimum size is now 2%, with presets 2%, 3%, 5%, 7%, 10%, 15%, 20% and larger.
- Weather and Ride Waits are independent layers and can coexist with images/text.


## v0.12 — Rain Chance Fix

- Weather now requests hourly `precipitation_probability` from Open-Meteo.
- The main rain indicator now shows **Rain next hour** instead of using the day's maximum probability.
- The weather card also shows **High today** separately using `precipitation_probability_max`.
- Existing temperature, feels-like, condition, precipitation, update time, park name, position, size, and unit controls remain unchanged.


## v0.13 — On-Demand Live Radar

- Added a separate **Live Radar** card inside the Parks tab.
- Locations:
  - Walt Disney World
  - Magic Kingdom
  - EPCOT
  - Hollywood Studios
  - Animal Kingdom
  - Disney Springs
- Radar controls:
  - position
  - size
  - zoom: Close / Medium / Wide
- Radar uses the RainViewer Weather Maps API and loops the six most recent past radar frames.
- Basemap uses OpenStreetMap tiles with attribution.
- Radar metadata refreshes every 10 minutes only while radar is active.
- **HIDE RADAR** stops the animation, stops refresh polling, clears radar/base-map images, and hides the card.
- Radar is an independent layer and can coexist with weather, ride waits, images, and text.


## v0.15 — Ride Setup + Timer Ride Comparison

### Ride Setup tab
- New phone-friendly **Ride Setup** tab.
- Choose Magic Kingdom, EPCOT, Hollywood Studios, or Animal Kingdom.
- Loads the current Queue-Times attraction list for that park.
- Each attraction can be:
  - renamed for display
  - omitted from the rotating Ride Waits overlay
  - reset back to the built-in/default behavior
- Settings are stored in the Durable Object room state and broadcast to every overlay/controller using that room.
- Existing built-in omissions and aliases remain as defaults, but can now be overridden from the controller.
- Ride configuration survives **Clear Screen**.

### Line Timer integration
- The timer now has a ride/attraction dropdown populated from the current park's live Queue-Times data.
- Renamed rides use the custom display name.
- Omitted rides are excluded from the timer ride picker.
- A **Custom / Other line** option remains available for queues that are not in Queue-Times.
- When START is pressed, the controller refreshes that attraction's live Queue-Times value and stores it as a snapshot.
- The timer overlay shows:
  - attraction name
  - **Reported Wait** at the moment START was pressed
  - **Our Wait** live stopwatch underneath
- STOP freezes the actual wait and labels it **Final Actual Wait**.
- Timing remains persistent through controller reloads/phone screen changes because the start timestamp is stored in the Durable Object.


## v0.16 — Dedicated Line Timer Park Selector

- Added a **Park selector directly on the Line Timer card**.
- Timer park selection is now independent from the global **Current Park** selector.
- Changing the timer park immediately refreshes the attraction list.
- Supported timer park choices:
  - Magic Kingdom
  - EPCOT
  - Hollywood Studios
  - Animal Kingdom
  - Disney Springs
- Disney Springs falls back to **Custom / Other line**, since Queue-Times ride data is not used there.
- Starting/configuring a timer stores the selected timer park with the timer state.


## v0.17 — Ride Wait Times Card / Ticker Mode

- Added a **Display Mode** selector for Ride Wait Times:
  - **Card** — existing rotating ride card behavior.
  - **Ticker** — continuous horizontal scrolling list of ride names and wait times.
- Ticker uses the same selected Current Park and Queue-Times data.
- Existing wait-time colors remain:
  - 30 minutes or less: green
  - 31–60 minutes: yellow
  - over 60 minutes: red
- Existing Wait Size and Cycle controls are reused:
  - Size adjusts ticker text scale.
  - Cycle controls ticker scrolling speed.
- Hide Ride Waits hides either display style.


## v0.18 — Wait Ticker Rendering Fix

- Fixed a v0.17 bug where Ticker mode briefly rendered but the legacy card renderer immediately turned the card back on.
- Card and Ticker modes are now mutually exclusive.
- Added `displayMode` to the ride-wait configuration key so switching Card ↔ Ticker is always detected, even when all other settings stay unchanged.
- Ticker mode no longer runs the rotating-card interval.
- Ticker uses the same ride filtering, omitted rides, and display-name aliases as Card mode.
- Five-minute Queue-Times refresh remains active in both modes.


## v0.19 — Visible / Seamless Wait Ticker Fix

- Fixed ticker text color so ride names are white on the dark ticker bar.
- Wait-time colors remain green/yellow/red.
- Ticker now begins with content visible immediately instead of starting fully off-screen.
- Rebuilt ticker as two duplicated groups for a seamless continuous marquee loop.
- Animation restarts cleanly when park, size, speed, or ride data changes.
- Card mode remains unchanged.
