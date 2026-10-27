# WebSockets Study Plan

Learning WebSockets from scratch, client side first, then the server side. Each stage ends with a small hands-on task.

**Status legend:** ⬜ not started · 🟡 in progress · ✅ done

## Setup

- **Client:** this project (`websockets/websockets-test`), my React + TS + Vite template.
- **Server:** a separate sibling folder, `websockets/websockets-server/` (plain Node + TypeScript + the [`ws`](https://github.com/websockets/ws) library).
  - Stages 1–4: Claude provides a small, ready-made server so the focus stays on the client. Reading it is encouraged, but writing it is not required.
  - Stage 5 and later: I write or rewrite the server myself.
- **Main tool:** Chrome DevTools → Network → filter **Socket** → click the connection → **Messages** tab.

---

## Stage 0: How it works ✅

Goal: know what happens on the wire before writing any code.

- [x] Why WebSockets exist: limits of HTTP request/response, short polling, long polling
- [x] The handshake: an HTTP `GET` with `Upgrade: websocket` + `Sec-WebSocket-Key` → `101 Switching Protocols`
- [x] After the upgrade: one persistent TCP connection, **full-duplex** (either side sends at any time)
- [x] Frames: text vs binary, fragmentation, masking (client → server only), control frames (ping, pong, close)
- [x] `ws://` vs `wss://` (TLS); why `wss://` matters with proxies
- [x] Close handshake and close codes (`1000` normal, `1001` going away, `1006` abnormal / no close frame, `1008` policy, `4000–4999` app-defined)
- [x] Alternatives and when to choose them: SSE (`EventSource`), polling, plain fetch, WebTransport (just to know it exists)

**Task:** Open any site that uses WebSockets (or the Stage 1 echo server), find the handshake in DevTools, and explain each request/response header in your own words.

## Stage 1: The browser `WebSocket` API ✅

Goal: use the native API comfortably, with no libraries.

- [x] `new WebSocket(url, protocols?)`
- [x] Events: `open`, `message`, `error`, `close` (and what `CloseEvent.code / reason / wasClean` mean)
- [x] `readyState`: `CONNECTING`, `OPEN`, `CLOSING`, `CLOSED`, and why `send()` before `OPEN` throws
- [x] `send()` with strings, `Blob`, `ArrayBuffer`; `binaryType`
- [x] `bufferedAmount` and backpressure (basic idea)
- [x] Why the `error` event tells you almost nothing (on purpose, for security)

**Task 1:** A plain page (no React yet, or a single bare component) that connects to the echo server, sends text from an input, and logs everything it receives plus every state change.
**Task 2:** Stop the server while connected and see what `close` gives you. Try a wrong URL and compare.

## Stage 2: Using it in React ✅

Goal: a socket that behaves correctly with React's lifecycle.

- [x] Where the socket lives: inside a component, a custom hook, a module singleton, or context
- [x] `useEffect` setup and cleanup; the **StrictMode double-mount** trap (two connections, or a closed-too-early socket)
- [x] Stale closures in `onmessage` handlers; refs vs state
- [x] Turning "socket status" into UI state (connecting, online, offline)
- [x] `useSyncExternalStore` as a clean way to subscribe to an external source

**Task:** `useWebSocket(url)` hook → `{ status, lastMessage, send }`. Build a simple chat UI on top of it against the broadcast server (open two tabs).

## Stage 3: Message design 🟡

> **Paused (2026-10-27).** The original task below bundled too many ideas at once. A finished reference version is in `/rooms` (`src/socket/roomChatStore.ts`, `src/protocol/messages.ts`, server: `pnpm rooms`), with the lesson in `lessons/stage-3-message-design.md`. When resuming, redo Stage 3 in small steps on `/shared-chat`, one idea each: **3a** JSON envelope → **3b** typed `send` → **3c** Zod validation → **3d** acks (no timeouts at first). Rooms and the typing indicator are optional extras.

Goal: stop sending random strings and adopt a real protocol.

- [ ] A single envelope: `{ type, payload }` (plus `id` / `ts` when needed)
- [ ] TypeScript discriminated unions for client → server and server → client messages
- [ ] Runtime validation of incoming messages with Zod (never trust the wire)
- [ ] Request/response over a socket: correlation IDs, acknowledgements, timeouts
- [ ] Rooms/channels from the client's perspective: `subscribe` / `unsubscribe` messages

**Task:** Chat with rooms, a "user is typing…" indicator, and acked messages (show ✓ when the server confirms). All messages are typed and validated.

## Stage 4: Reliability ⬜

Goal: survive real networks. Most production bugs live here.

- [ ] Detecting dead connections: why TCP can look "open" while dead; app-level heartbeat
- [ ] Reconnecting with **exponential backoff + jitter**; stopping on purpose vs retrying
- [ ] Reacting to `online` / `offline` and `visibilitychange`
- [ ] Outgoing queue while disconnected; what should and shouldn't be replayed
- [ ] Catching up after reconnect: last-seen event ID, refetching state over HTTP
- [ ] Duplicate and out-of-order messages: idempotency

**Task:** Make the chat survive a server restart, a laptop sleep, and DevTools "Offline" mode without losing or duplicating messages.

## Stage 5: The server side ⬜

Goal: write the server myself.

- [ ] Node + `ws`: `WebSocketServer`, the `connection` event, per-client state
- [ ] Broadcasting, rooms, tracking connected clients
- [ ] Server-side ping/pong and terminating dead clients
- [ ] Attaching to an existing HTTP server (Express) and handling `upgrade` manually
- [ ] Graceful shutdown (close code `1001`)

**Task:** Rewrite the Stage 1–4 server from scratch so the existing client works unchanged.

## Stage 6: Auth and security ⬜

- [ ] Authenticating the handshake: cookies (sent automatically, same-site rules), a token in the query string (and why it leaks into logs), a first-message auth
- [ ] Checking the `Origin` header (Cross-Site WebSocket Hijacking)
- [ ] Validating message size and shape on the server; rate limiting per connection
- [ ] Authorization per message/room, not only at connect time

**Task:** Add login (fake/session cookie is fine) and allow only authenticated users to join rooms.

## Stage 7: State management integration ⬜

- [ ] Redux middleware that owns the socket and dispatches actions for incoming messages
- [ ] RTK Query streaming updates via `onCacheEntryAdded` (relevant to dual-cookbook's `rtk_query_test_branch`)
- [ ] Optimistic updates confirmed or reverted by server events

**Task:** Move the chat's socket handling into Redux (middleware or RTK Query), and compare it with the hook version.

## Stage 8: Scaling and libraries (optional) ⬜

- [ ] Why broadcasting breaks with more than one server instance; Redis pub/sub as the fix
- [ ] Sticky sessions and load balancers
- [ ] Socket.IO: what it adds (rooms, acks, reconnection, fallbacks), what it costs, and why it is **not** a WebSocket at the protocol level
- [ ] Hosting notes: idle timeouts on proxies/PaaS (e.g. Render), free-tier sleeping

## Stage 9: Final project, dual-cookbook ⬜

Live updates between the two cookbook users: when one person creates, edits, or deletes a recipe/category, the other person's screen updates without a refresh.

- [ ] Design the events (`recipe.created`, `recipe.updated`, …)
- [ ] Server: broadcast after successful DB writes, authenticated with the existing session cookie
- [ ] Client: update the `recipes` / `categories` slices from events; show a toast
- [ ] Check that it works with Render hosting

---

## Notes and takeaways

_(Add your own notes per stage here as you go.)_
