# Prism Cloud Overlay — isolated mobile prototype

This project does **not** touch your OBS setup.

## What it contains

- `/overlay.html` — transparent page for Prism/browser-source use
- `/control.html` — phone-friendly remote control
- Cloudflare Worker — routing and security
- Durable Object — room state + realtime WebSocket broadcast
- `/public/assets/images` and `/public/assets/video` — your media

## Deploy

Prerequisites: a Cloudflare account and Node.js.

1. Open a terminal in this folder.
2. Run:
   `npm install`
3. Log in:
   `npx wrangler login`
4. Create a private controller key:
   `npx wrangler secret put CONTROL_KEY`
   Enter a long random password when prompted.
5. Deploy:
   `npm run deploy`

Wrangler will return a `workers.dev` URL.

## Test URLs

Replace `YOUR-WORKER` and `YOUR_KEY`.

Overlay:
`https://YOUR-WORKER.workers.dev/overlay.html?room=mobiletest`

Controller:
`https://YOUR-WORKER.workers.dev/control.html?room=mobiletest&key=YOUR_KEY`

Keep the controller URL private because it contains your control key.

## Prism test

Add the overlay URL as a web/browser overlay if your Prism configuration supports a browser/web layer.
Use the transparent page at `overlay.html`.

Start with the sample graphic button. Do not add your full media library until the basic realtime test is reliable.

## Add media

Images:
`public/assets/images/`

Video:
`public/assets/video/`

For mobile, prefer:
- WebP/PNG/SVG for graphics
- H.264 MP4 for maximum playback compatibility
- short, reasonably compressed clips
- one video playing at a time

## State/reconnect behavior

The Durable Object stores the latest overlay state. If the overlay disconnects and reconnects, it receives the current state again.

## Future integration

Later, Streamer.bot can send POST requests to:

`POST /api/ROOM/command`

with:
- header `X-Control-Key: YOUR_KEY`
- JSON body such as:
  `{"action":"showImage","src":"/assets/images/example.webp","duration":5000}`

This endpoint exists now, but you do not need it for the Prism/mobile test.

## First test sequence

1. Deploy.
2. Open overlay URL in a normal browser.
3. Open control URL on another device/browser.
4. Tap SHOW GRAPHIC.
5. Confirm the overlay changes instantly.
6. Test disconnect/reconnect.
7. Only then test the overlay inside Prism.

That keeps this experiment completely isolated from OBS.
