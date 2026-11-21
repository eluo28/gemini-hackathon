# ClipThat

**ClipThat** is a modern multi-user live streaming studio built with React, TypeScript, Express, WebSockets, and WebRTC. Multiple hosts and co-hosts can stream audio, video, and screens together while viewers watch and interact in real-time chat.

## Key Features

- **Pre-Join Name & Animal Avatar Gate**: Participants enter their own display name before entering a room and receive a randomly assigned illustrated animal avatar (with one-click shuffle) shown cleanly whenever their camera is off.
- **Multi-User Live Stage**: Full-mesh WebRTC (`RTCPeerConnection` with Perfect Negotiation) plus an automatic WebSocket frame relay fallback for strict NATs or headless environments.
- **Always-On Rolling Buffer & Hands-Free Clip Markers**: Going live automatically maintains a rolling 60-second in-memory `ClipRingBuffer` and listens for `"clip that"` while unmuted, alongside a manual **Clip That** button.
- **Pluggable Downstream Clipping Interface**: Downstream pipelines (e.g., Deepgram transcription + DaVinci Resolve MCP) can register a `ClipSinkAdapter` via `src/services/clipSink.ts` to receive `DownstreamClipPayload` events (`{ marker, mimeType, chunks, bufferedSeconds }`).
- **Real-Time Stream Chat**: Live messages, stream timestamps, quick reactions, pinned messages, host moderation, and viewer slow mode.

## Local Multi-User Demo (No Deployment Needed)

1. Install dependencies and start the local server:
   ```bash
   npm install
   npm run dev
   ```
2. Open `http://localhost:3000` in one browser tab and enter your name to join `main-stage` as Host.
3. Click **Copy Link** and open it in a second tab, incognito window, or another device on the same Wi-Fi (using your machine's LAN IP, e.g., `http://<your-ip>:3000/?room=main-stage`).
4. Optional quick-join URL parameters for scripted demos:
   - `http://localhost:3000/?room=main-stage&name=Maya&role=host`
   - `http://localhost:3000/?room=main-stage&name=Jordan&role=cohost`
   - `http://localhost:3000/?room=main-stage&name=Sam&role=viewer`

## Architecture & Contracts

- `server.ts`: Express + `ws` signaling server with typed protocol frames, `/api/health`, `/api/rooms`, per-socket sliding-window rate limits, payload caps, avatar URL validation, empty-room garbage collection, and graceful shutdown.
- `src/shared/protocol.ts`: Shared discriminated unions (`ClientWsMessage`, `ServerWsMessage`), REST DTOs, and `ClipSinkAdapter` / `DownstreamClipPayload` interfaces.
- `src/services/clipSink.ts`: Bounded `ClipRingBuffer<T>` and pluggable `registerClipSink()` hook (defaults to `NoopClipSink` so video stays strictly in-memory until a downstream clipper connects).

## Scripts

- `npm run dev` — Start Express + Vite dev server on port `3000`
- `npm test` — Run unit tests (`tsx --test src/utils/streamUtils.test.ts`)
- `npm run lint` — TypeScript strict type-check (`tsc --noEmit`)
- `npm run build` — Production client bundle (`vite build`)
- `npm start` — Run production server (`NODE_ENV=production node server.ts`)


## Creator profile setup

Join as a host and select **Set up creator profile** above the stage. Add your
name, handle, bio, and optional gift delivery address, then save. No profiles or
addresses are preloaded. Use **Edit profile** in the same browser to change it.

Profiles persist across server restarts in ignored `.data/streamers.json`
(override the directory with `PROFILE_DATA_DIR`). Addresses stay on the server;
public profile responses and room broadcasts never include them. The private
settings endpoint requires the creator ownership cookie. This prototype uses
first-claim, browser-cookie ownership, not verified creator accounts; add actual
creator authentication before a public launch or real gifting.

Gifting remains disabled until Shop MCP recipient checkout is implemented and
verified. Saving an address does not activate purchases.

## Shop MCP catalog infrastructure

The Express backend calls `https://mcp.shop.com/` directly using Shop's MCP
protocol. No Shop API key, merchant store, or buyer sign-in is needed for these
anonymous catalog routes:

- `POST /api/shop/search`: `{ "catalog": { "query": "ceramic mug", "context": { "address_country": "US", "currency": "USD" }, "pagination": { "limit": 3 } } }`
- `POST /api/shop/lookup`: `{ "catalog": { "ids": ["<public product URL or identifier>"] } }`
- `POST /api/shop/product`: `{ "catalog": { "id": "<returned product ID>", "selected": [{ "name": "Color", "label": "Blue" }] } }`

Search accepts price, attribute, shop, and shipping-destination filters. Price
bounds use integer minor units and require `context.currency`. Copy returned IDs,
URLs, option names, and labels unchanged. Public product URLs only: never send
private cart, checkout, account, or signed URLs to lookup. This initial API
supports text search; image matching will be added with the clip-analysis flow.

Responses preserve Shop's structured product data, warnings, and pagination.
Catalog responses use `Cache-Control: no-store`; do not persist returned listings
or rehost merchant images. Fetch current data when needed and display source
images directly. The transport has a 12-second timeout, never automatically
retries, and does not follow redirects or accept a caller-selected endpoint.

This is catalog infrastructure only. Buyer OAuth, session-owned carts, purchase
confirmation and completion, and verified creator-recipient shipping remain to
be implemented. There is no payment endpoint in this change.
