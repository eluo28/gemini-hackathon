# Clip Gen

## 3D View

Open `/3d` for the isolated spatial viewer: bundled flower depth/stereo demos,
local files (never uploaded), URL loading (`?src=` stereo or `?rgbd=` RGB+depth),
look-around relief, 2D, wiggle, red/cyan glasses and frame signal checks.
The original vanilla Three.js modules run in an iframe to isolate styles and
release their document/listeners on unmount. WebGL and media resources are
also released on page exit. Chrome matches the studio's white/slate palette.
Enter VR / Open in AR enable only for a supported WebXR immersive session and
stereo media; use HTTPS or localhost and a compatible headset browser.
RGB+depth is 2.5D reprojection, not volumetric or 360° video. Headset perception,
comfort and physical phone tilt require real-device testing. Cross-origin
videos must permit CORS; stereo is full-width left-eye/right-eye SBS.

Open `/clip-gen` for isolated Gemini Omni character replacement.
Clip Gen uses packaged `ffmpeg-static`/`ffprobe-static` binaries (system fallback),
with optional `FFMPEG_PATH`/`FFPROBE_PATH` overrides and server-side `GEMINI_API_KEY`.
Production installs must include these dependencies and allow their binary installation scripts.
Upload a video, use the sample, or choose a saved video from **My clips** (the same
browser-owned `/api/clips/library` used by the studio). Then click a person, refine the description, add 1–3
reference photos or camera selfies, then swap. Compare synchronized results or download MP4.
The edit requests whole-person replacement: identity, body/build, chest, all visible
skin tone and clothing follow the references. Target outfit descriptions locate the
person only. Motion, pose and scene remain; generative results may need a retry.
Videos: at least 3 seconds, up to 200 MiB; first 10 seconds normalized to silent H.264.
Photos: JPEG/PNG/WebP, up to 15 MiB and 30 megapixels each. Public figures may be blocked.
Use photos you have permission to use; generation usually takes about a minute.
Camera requires localhost or HTTPS. Description failures fall back to click position.
`CLIP_GEN_WORK_DIR` defaults to gitignored `.data/clip-gen`; `CLIP_GEN_DESCRIBE_MODEL`
defaults to `gemini-4-hydrogen`. Jobs/IDs are in memory; restart loses them, files remain.
Remove work files manually when finished. Uploads go to Gemini Files API and its retention applies.
This trusted-environment prototype has no authentication, quotas or durable queue.
Sample: [Anna Shvets, Pexels](https://www.pexels.com/video/two-women-dancing-and-hugging-4800574/),
under the [Pexels license](https://www.pexels.com/license/).

# ClipThat

**ClipThat** is a modern multi-user live streaming studio built with React, TypeScript, Express, WebSockets, and WebRTC. Multiple hosts and co-hosts can stream audio, video, and screens together while viewers watch and interact in real-time chat.

## Key Features

- **Pre-Join Name & Animal Avatar Gate**: Participants enter their own display name before entering a room and receive a randomly assigned illustrated animal avatar (with one-click shuffle) shown cleanly whenever their camera is off.
- **Multi-User Live Stage**: Full-mesh WebRTC (`RTCPeerConnection` with Perfect Negotiation) plus an automatic WebSocket frame relay fallback for strict NATs or headless environments.
- **Always-On Rolling Buffer & Hands-Free Clips**: Going live starts header-preserving staggered WebM recordings of the local stage and WebRTC guests. Manual **Clip That** and the `"clip that"` voice trigger feed the Gemini judge after post-roll.
- **Gemini Decisions Auto-Clipper**: Low-resolution probes, a full-context judge, automatic saving to My Clips, trimmed WebM downloads, and JSON/CSV cut lists. The registered `ClipSinkAdapter` receives `{ marker }`; the clipping controller owns recording and post-roll.
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

## Stream soundboard

Hosts and co-hosts can open **Soundboard** in the stream control dock in development
and production. Go live with clip detection enabled to play air horn, applause,
victory, or drum sting into the stream and clip buffer. Volume and Stop controls
are included; microphone mute does not mute the soundboard. Completed sounds
create an explicit 100% soundboard event and start clip editing, bypassing
automatic thresholds. This event is labeled separately from AI probabilities.
Stopping a sound cancels its trigger.

## Local clip telemetry

Run `npm run dev:telemetry` (or `PORT=3001 VITE_HMR_PORT=24679 npm run dev:telemetry` if 3000 is busy).
Follow the trace file in another terminal:

```bash
tail -f .data/telemetry/clips.jsonl
# Filter one browser request or capture:
rg 'YOUR_TRACE_ID' .data/telemetry/clips.jsonl
```

Traces cover request admission, normalization, Gemini Decisions, briefing, editor
turns/reviews, trim/render, and library saves. Every stage reports
start, elapsed time, success/failure, and a heartbeat every 10 seconds while waiting.
Decision scores, thresholds, model names, token usage, tool names/cut bounds, provider
errors, and FFmpeg stderr explain slow calls, rejected cuts, and failed generation.
`traceId` correlates a request; `spanId` / `parentSpanId` link nested work. The response's `X-Request-ID` matches the trace. Development
browser consoles show `[clipping]` events (enable **Verbose**), including skipped
captures, post-roll, and request IDs. Browser-only events stay in the browser console.

For an offline scan, use
`CLIP_TELEMETRY=1 npx tsx scripts/clip-video.ts "path/to/video.webm"`.
Each analysis window includes its run ID and source timestamps. Override the file
with `CLIP_TELEMETRY_FILE`; logs append across runs, with timestamps and process IDs.
Telemetry is opt-in and local; there is no external collector. It omits media,
prompts, chat, and credentials, and redacts the API key from captured error text.
Delete the gitignored log when finished; it does not rotate automatically.

## Architecture & Contracts

- `server.ts`: Express + `ws` signaling server with typed protocol frames, `/api/health`, `/api/rooms`, per-socket sliding-window rate limits, payload caps, avatar URL validation, empty-room garbage collection, and graceful shutdown.
- `src/shared/protocol.ts`: Shared discriminated unions (`ClientWsMessage`, `ServerWsMessage`), REST DTOs, and `ClipSinkAdapter` / `DownstreamClipPayload` interfaces.
- `src/services/clipSink.ts`: Pluggable `registerClipSink()` marker hook. `useAutoClipper` registers the Decisions pipeline; `rollingRecorder.ts` owns the live media buffer. The generic `ClipRingBuffer<T>` remains available for other bounded data.

## Scripts

- `npm run dev` — Start Express + Vite dev server on port `3000`
- `npm test` — Run unit tests for utilities, server routes, Decisions contracts, media trimming, and recording rollover
- `npm run lint` — TypeScript strict type-check (`tsc --noEmit`)
- `npm run build` — Production client bundle (`vite build`)
- `npm start` — Run production server (`NODE_ENV=production npm start` after building)


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

Creators can opt into product gifting in the profile form after entering a
delivery address. Delivery details may be visible in merchant checkout and order
records; the form asks for this consent before enabling gifts.

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

The catalog endpoints are anonymous. The viewer gifting flow described below
adds separate buyer sessions, OAuth, carts, checkout review and payment completion.

## Gemini item detection

`POST /api/shop/detect-items` analyzes one to three compressed frames from a live
stream or clip. Configure `GEMINI_API_KEY` in server secrets; optionally override
`GEMINI_ITEM_MODEL` (default `gemini-4-hydrogen`; Gemini 4 overrides only). Missing credentials return a clear
503 without preventing the rest of the app from starting.

Request shape: `{ "frames": [{ "mimeType": "image/jpeg", "data": "<base64 image bytes, without data-URL prefix>", "timestampSec": 12.5 }] }`.
JPEG, PNG, and WebP are supported, up to 500,000 base64 characters per frame and
three frames per request. Timestamp is optional and supplied by the caller.
Compress/resize frames before sending them. The request body limit is 2 MB.

The result has `{ items, model }`. Each item includes its source frame index,
caller-supplied timestamp when present, visible description/evidence, nullable
brand/model, a Shop search phrase, and a bounding box `[top,left,bottom,right]`
normalized to 0..1000. Results are discovery candidates (`matchType: "similar"`),
not verified product matches. Gemini is instructed to report brands/models only
when readable, ignore instructions inside images, and return no items for unclear
scenes. Output is validated again on the server. No prices or catalog IDs are
accepted from Gemini.

Pass an item's `searchQuery` to `/api/shop/search` as `catalog.query`, with the
buyer's country/currency context. Verify returned products and exact options before
presenting a match or adding to cart. Detection does not create carts or purchases.

Frames and model responses are not saved or logged by this app. The SDK sends the
frames to Google for inference. Calls have a 20-second timeout with automatic SDK
retries disabled. The endpoint allows five valid requests per IP per minute and
two concurrent analyses per server process. These are prototype, process-local
limits. Live-frame capture, clip-trigger wiring, automatic scheduling, and product
cards are not connected yet; this endpoint is ready for those consumers.


### Profile saves behind hosting proxies

Profile writes accept browser-confirmed same-origin requests using the
browser-controlled `Sec-Fetch-Site` header, even when a hosting proxy rewrites the
internal scheme or Host. Direct same-origin requests and the configured `APP_URL`
origin are also accepted. Set `APP_URL` to the public app URL for clients that do
not send Fetch Metadata. Paths/trailing slashes in that setting are normalized.
Missing/opaque origins and cross-origin browser requests without an explicit
configured origin remain rejected. Creator ownership cookies are still required
when editing an existing profile. No global `trust proxy` setting is enabled.

## Local Gemini auto-clipping

1. Use Node 22+, install dependencies with `npm install`, and install **ffmpeg + ffprobe**
   (`brew install ffmpeg` on macOS). Optional binary overrides: `FFMPEG_PATH` / `FFPROBE_PATH`.
2. Create **`.env.local`** at the repository root with `GEMINI_API_KEY="your-key"`.
   This file is ignored by Git. `.env.local` takes precedence over `.env`; existing
   shell environment variables take precedence over both. The key is used only by Express.
3. Run `npm run dev`, open `http://localhost:3000`, join as a host, and **Go Live**.
4. **Auto-clip is on by default**: the first check runs after 15 seconds of live
   recording, then repeats every 15 seconds. The **My Clips** tab beside the stage
   shows the current analysis status, latest highlight signal, and playable cuts
   as they arrive. Use **Share Screen** to clip a live application or playing video
   (include tab/system audio in the browser picker if needed).
5. Press **Clip That** or say “clip that” to request a cut manually. Finished cuts save directly to **My Clips**; play or download them beside the stream. Open
   **Clipping studio** for thresholds, questions, exports, and API details.
   Toggle **Auto-clip** off to pause scheduled analysis; manual capture still works.
   You can turn it off before going live. Checks send recorded video/audio to Gemini.
   Setup errors appear in the Clips panel; missing credentials or FFmpeg prevent
   analysis. Restart the server and reload after changing the key.

### Recording and decisions

The browser composites up to six local/WebRTC participants at 1280×720, 20 fps,
with mixed audio. Changes to camera, screen sharing, or connected guests update
that composite without replacing its output tracks. Relay-only guest audio/video
is not included; recording requires the guest's WebRTC MediaStream. My Clips is persistent per browser, across rooms and reloads. Multiple broadcasters can run their
own clipper and incur separate API calls.

A new recorder starts every 15 seconds. Whole recordings expire after 60 seconds;
individual header chunks are never removed. A snapshot requests all chunks from
one recording's start, preserving WebM initialization. A warmed-up full snapshot
covers approximately 45–60 seconds; early captures use the available history.
Each recording is limited to 16 MB. Background-tab throttling can reduce capture
cadence; keep the recording tab active for reliable live capture.

- **Two-stage (default):** every 10 / 15 / 20 seconds, a low-resolution probe checks
  the latest 15 seconds (shorter during warm-up). Crossing the trigger threshold
  schedules a full-buffer judge after 10 seconds of post-roll measured from the
  probed window's end (API latency counts toward that wait). Triggers are coalesced
  while busy, with a 30-second cooldown. Manual and voice markers bypass the trigger
  threshold and schedule the same judge.
- **Single-stage:** disabling deep judge evaluates all highlight questions in each
  immediate 15-second probe. Manual flush judges the available full buffer immediately.
- **Chat:** off by default. When enabled, only messages inside the chosen recording
  window are included, with timestamps adjusted to the normalized video.
- **Cancellation:** stopping the stream, switching rooms, or leaving cancels pending
  post-roll and browser requests; late results are not shown as the current session’s analysis.
  An accepted server request can still finish and save to My Clips; the library
  refreshes every 15 seconds and on window focus. There is no durable job queue yet;
  restarting the server interrupts in-flight work.

Express normalizes the snapshot to a seekable WebM using FFmpeg (remuxing whole
recordings without re-encoding, and re-encoding partial cuts), trims probe inputs
to their last 15 seconds, and calls `ai.decisions.create` from `@google/genai` with
`apiVersion: 'v1beta'` and `model: 'gemini-decision-1'`. Resolution belongs to the
video input block. Noul returns `noul` (P(true)); choice returns a probability map;
score returns an expected 0–4 rubric score and its distribution. There is no
text-generation fallback or simulated scoring. Missing, blocked, malformed, or
non-zero-output-token responses are rejected. Requests time out and are not retried
automatically. An auto-probe failure pauses auto-probing until you re-enable it.

The API inspector shows the actual submitted payload (video bytes explicitly
omitted), the raw response, timing, and token counts. Successful results require
`usage.total_output_tokens === 0`. Questions are editable for future requests.
Thresholds apply to future automatic captures. Existing saved clips remain saved.
Automatic selection uses four checks:
clip-worthiness, complete arc, sharing potential, and hook strength.

The clipping pipeline separates annotation, understanding, and editing:

- **Decisions** supplies structured categories and quality scores. It does not select
  peaks, durations, or edit boundaries. Probes stop after annotation, and automatic
  candidates below the configured thresholds skip all editing agents.
- **Hydrogen** (`gemini-4-hydrogen`) watches the normalized source video and audio,
  interprets an optional `query`, and returns a validated editing brief: summary,
  intent, query relevance, and timestamped story beats.
- **Neon** (`gemini-4-neon`) receives the source footage, aligned chat, annotations,
  and brief. It chooses exact numeric start/end seconds using `trim_clip`.
  It can delegate `review_cut` to a Hydrogen specialist to check narrative and
  boundary quality, then refine its edit from the feedback. The server permits
  at most two reviews and three Neon turns, preserves tool-call thought signatures,
  validates every proposed cut, and renders the final contiguous cut with FFmpeg.

In Clipping studio → Controls, **What should this clip be about?** supplies the
query for manual and voice captures. API clients can send a `query` string of
1–2,000 characters to `/api/clips/analyze`. Manual captures and explicit queries
bypass generic quality thresholds; a requested event absent from the footage
returns 422 instead of saving an unrelated clip. Automatic probes do not use the
manual-query field. Query, brief, edit rationale, and delegated reviews persist
with saved clips. Invalid or failed agent responses never fall back to heuristic
cuts. The renderer currently supports one contiguous cut, not generative video
changes, captions, or montages.

All analysis/editing agents use **`GEMINI_API_KEY`**. Model defaults can be changed
through `GEMINI_CLIP_BRIEF_MODEL`, `GEMINI_CLIP_EDITOR_MODEL`, and
`GEMINI_CLIP_REVIEW_MODEL`; these and `GEMINI_ITEM_MODEL` accept only Gemini 4 model
IDs, with no Flash fallback. The separate Clip Gen character-swap feature keeps
its existing Omni video generator and configuration.
Model IDs and capabilities are documented in the
[Google model catalog](https://aistudio.google.com/docs/models) and
[Neon model reference](https://aistudio.google.com/docs/models/gemini-4-neon).

Each inference call has a 45-second timeout and no automatic retries. A selected
capture normally makes one Hydrogen and one Neon call after Decisions, with up to
four additional calls when Neon requests both reviews. Browser requests allow
seven minutes for the bounded workflow plus media processing. There is no durable
agent job queue; restarting the server interrupts in-flight work.
The inspector includes every agent exchange with video bytes omitted. Brief usage
is tracked in `brief.usage`, total Neon usage in `edit.usage`, and specialist usage
in `edit.reviews[].usage`; offline reports include all three. The zero-output-token
requirement applies only to Decisions scoring.

Finished files and metadata live in `.data/clips` (override with `CLIP_DATA_DIR`).
An opaque HttpOnly SameSite cookie identifies this browser's library; clearing
cookies or using a different browser loses access to that library. This is not
account authentication. Files survive reloads and server restarts, with a 2 GB
quota per browser and no automatic eviction. Playback supports range requests;
downloads serve the finished WebM without another encode. JSON/CSV exports include
all saved cuts. Open `/?view=clips` or **My Clips** on the join screen to browse
without going live. **Previous video clips** can import already-rendered local
`.data/clip-runs` results, without another Gemini call.

Endpoints: `GET /api/clips/status`, `POST /api/clips/analyze`,
`GET /api/clips/library`, `GET /api/clips/library/:id/media`,
`DELETE /api/clips/library/:id`, `GET /api/clips/imports`, and
`POST /api/clips/library/import`. The legacy `POST /api/clips/trim` remains for
the recorder test and independent clients. Requests without capture metadata
retain the analysis-only contract. Uploads are bounded, validated for WebM
headers, restricted to same-origin browser requests, and limited to two concurrent
processing jobs / 15 requests per IP per minute. Intermediate files are removed
in `finally`. Selected media and optional chat go to Google for inference.

This is local disk storage. Hosting requires durable storage, account ownership,
and persistent worker jobs; moving this development server onto an ephemeral
host would not preserve clips across instance replacement.

### Verification

`npm test` covers the Decisions payload/response contract, failure handling,
automatic selection, direct manual saving, owner isolation, persistence, quotas,
range playback, trim bounds, route limits, and staggered recorder
rollovers. FFmpeg integration tests decode generated video with audio, normalize
it, and trim a playable cut (skipped only when FFmpeg is absent). Test-only response
fixtures never enter the runtime pipeline. `npm run lint` checks TypeScript and
`npm run build` bundles the studio.

For a real browser recording check, open `/tests/recorder.html` on the dev server
and click **Start 65-second recording check**. It records generated shapes and a
quiet tone, crosses the buffer rollover, then normalizes and plays a three-second
cut using the local server. It uses neither camera/microphone nor Gemini and is
not included in the production build.

`/tests/auto-clipper.html` exercises the actual React controller and drawer with a
generated video-only feed. Its probe/flush controls **do call Gemini with your
configured key**. It is useful for checking post-roll, automatic saving, thresholds,
and downloads without sharing camera or microphone data. Stop the test recording
and turn off auto-probe when finished. Neither test page is shipped by Vite's
production entry point.

## Automated clip-quality eval set

The five local sample videos are registered in `evals/dataset.json` with source
fingerprints. Run `npm run eval:review` to label desired start/peak/end timestamps,
`npm run eval:run -- --video wimbledon` for a real pipeline run, and
`npm run eval:score -- --run <run.json>` to re-score cached predictions locally.
Use `npm run eval:run -- --all` for the full dataset. See [evals/README.md](evals/README.md)
for metrics, held-out splits, reference review, and run comparison. The imported
Wimbledon suggestion starts as a draft; quality metrics require reviewed references.

## Stream shopping and product gifts

Connect Shop from **Show Shop** in the right-hand **Chat** tab, then send a
message such as `@shop find that mug`. The command appears in room chat; product
results and checkout are private to the viewer. Disconnected requests show a
connection prompt and do not run Gemini. The Shop panel and its top **Cart**
dropdown collapse independently; cart controls never contain the conversation.

Each submitted question freezes a visible live frame (up to 960×540). Gemini
Hydrogen identifies at most two requested objects with bounding boxes. The
browser crops those objects from the same frame, and Shop MCP searches by image
similarity and description. Up to three product cards are shown. There are no
background Gemini scans or polling timers. The assistant ignores avatars and the
local synthetic standby feed. Frames/crops are not stored; catalog results are
not cached or rehosted. Each question uses a fresh frame, without sending prior
chat as model conversation history.

Product actions add an exact, freshly revalidated variant to a real Shop cart:

- **Gift to streamer** uses the creator's private saved delivery address. The
  creator opts into gifts through **Edit profile** below the video and controls.
- **Buy for myself** uses the connected buyer's preferred Shop delivery address
  at checkout. Missing saved delivery details require merchant checkout.

One cart belongs to one store, room, and purchase mode. Switching between gifts
and personal purchases requires finishing or explicitly clearing the current
cart. The badge reflects the authoritative cart read back after a mutation.
Errors and merchant notices remain visible; an empty cart is not reported as a
successful addition.

### Checkout behavior and limits

Discovery and basket operations use anonymous Shop MCP requests from the server;
account and checkout requests use the connected buyer. Checkout uses
`allenlu378@gmail.com` as the prototype's configured contact email, including a
follow-up full-document update when the merchant ignores contact during creation.
There is no contact-email input in the UI.

The viewer reviews returned items, quantities, delivery choices, total and
recipient, selects an offered payment method, and explicitly confirms before
payment. In-app completion requires `ready_for_complete` and a verified delivery
destination covering all line items. Only a completed checkout with an order and
verified streamer destination generates a room-wide gift alert. Personal orders
never generate gift alerts. Live in-app payment completion has not been verified.

Shop can require a merchant-hosted step or reject a delivery destination. The UI
preserves notices and links to the returned merchant checkout. Stores confirmed
to require merchant checkout are hidden from subsequent discovery in that
browser. This is a learned exclusion, not a guarantee that new stores support
in-app completion: search does not expose a reliable checkout-eligibility filter.

Cart quantities can change before payment or merchant handoff, invalidating the
old checkout review. Opening merchant checkout locks parallel in-app payment and
cart edits. After declining and closing the merchant page, the explicit
**I declined—clear local cart** action checks status and clears the local cart;
it refuses known processing/completed orders. If Shop's read fails, it records an
unverified retired checkout and explains that clearing locally does not cancel or
refund a merchant order. No payment is automatically resubmitted.

### Setup and local testing

Run `npm run dev` with `GEMINI_API_KEY` in the ignored server environment file;
`GEMINI_ITEM_MODEL` defaults to `gemini-4-hydrogen`. Join as host, enable a camera
or screen share and go live. A separate viewer can connect Shop, submit an
`@shop` message, and test gifts or personal cart additions. Gemini is called only
when a question is submitted. No wishlist or seeded creator is required.

Shop sign-in uses the public prototype OAuth device client by default. Distributed
apps should configure a registered `SHOP_OAUTH_CLIENT_ID` (and secret when needed)
with `personal_agent` and the `https://mcp.shop.com` resource. The optional
`npm run dev:gifting-demo` fixture mode simulates carts and payment, rejects
production use, and does not establish real merchant/payment compatibility.

This is a single-process hackathon prototype. Creator ownership uses the existing
first-claim browser cookie. Buyer tokens, addresses, cart/checkout resources and
payment instruments stay server-side. Buyer sessions expire after 24 hours and
are lost on server restart. A durable file of hashed checkout identities prevents
repeating in-app completion; uncertain outcomes are reconciled with reads.
Production use needs real creator authentication and a shared secure session and
transaction store. Do not log credentials, private checkout URLs or addresses.

### Shop a saved clip

While in a room, open **My Clips** and choose **Shop this clip**. This inserts
`@shop look in {clip:CLIP_ID}, ` into the existing Chat composer. Add your question
and send it. `{this clip}` also resolves the selected clip (or the only saved
clip). Unknown or deleted references are rejected rather than falling back to
live video.

Clip shopping takes three frames at 10%, 50%, and 90% of the saved clip, sends
those three images in one Gemini request, and reuses the live Shop matching and
cart flow. Each object is cropped from its returned source-frame index. The
stream can be offline. Sampling may miss an object visible only between those
frames; this does not analyze the entire video. Only clips in the viewer's
private My Clips library are supported; arbitrary video URLs are not fetched.
Gifts require a clip from the current room so the destination cannot silently
switch to another streamer; personal purchases work for any saved clip.
