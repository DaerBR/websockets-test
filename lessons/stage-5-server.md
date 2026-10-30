# Stage 5: The server side

So far the server was a black box that "just answered". In this stage we rebuild it from scratch, in a new file `../websockets-server/src/server.ts`, until your existing `/chat` and `/shared-chat` pages work against it **unchanged**.

How we work here: each step starts with a section of this lesson that explains the idea. You read it, Claude writes the code, you examine it, and then you test it with a checklist.

| Step | Idea                                                                       | Status |
| ---- | -------------------------------------------------------------------------- | ------ |
| 5a   | Server basics: `WebSocketServer`, the `connection` event, per-client state | ✅     |
| 5b   | Broadcasting and tracking connected clients                                | ✅     |
| 5c   | Our app protocol: pong, ids + history + resume (`/shared-chat` works)      | ✅     |
| 5d   | Server-side ping/pong: finding and terminating dead clients                | ✅     |
| 5e   | Attaching to an HTTP server and handling `upgrade` yourself                | ✅     |
| 5f   | Graceful shutdown (close code `1001`)                                      | ✅     |

The Stage 3 rooms server (`rooms.ts`) isn't part of the rewrite. `/rooms` keeps using it.

---

## §1. Server basics

### What the server is

A plain **Node.js process**: a program that runs on your machine (later on a host like Render), not in a browser. Node has no built-in WebSocket **server**, so we use the [`ws`](https://github.com/websockets/ws) library, the most common one. It's the same one the old servers used.

```ts
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8081 });
```

That one line does a lot:

- It starts an **HTTP server** on port 8081. Remember Stage 0: every WebSocket starts as an HTTP `GET` with `Upgrade: websocket`.
- It answers that request with `101 Switching Protocols`, checks `Sec-WebSocket-Key`, and computes `Sec-WebSocket-Accept`. All of the handshake is done for you.
- From then on, it reads and writes **frames** (Stage 0): unmasking client frames, splitting and joining fragments, answering control frames.

(In 5e you'll create the HTTP server yourself and hand the upgrade over to `ws` by hand, to see that seam.)

### Node events: `.on(...)` instead of `addEventListener`

Node objects that emit events are **EventEmitters**. You subscribe with `.on('name', handler)`. It's the same idea as `addEventListener`, with a different name. Handlers often get **several arguments** instead of one event object.

There are two levels:

**The server (`wss`)**, one per process:

| Event        | When                                               | Handler gets        |
| ------------ | -------------------------------------------------- | ------------------- |
| `connection` | A client finished the handshake: a new open socket | `(socket, request)` |
| `listening`  | The port is open and ready                         | nothing             |
| `error`      | The server itself failed, e.g. the port is in use  | `(error)`           |

**Each connection (`socket`)**, one per client, created for you and passed to `connection`:

| Browser `WebSocket` (your client)       | `ws` server-side socket                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `addEventListener('open', …)`           | (none: you get the socket already open)                         |
| `addEventListener('message', (e) => …)` | `.on('message', (data, isBinary) => …)`                         |
| `event.data` is a `string`              | `data` is a **`Buffer`** (raw bytes): call `data.toString()`    |
| `addEventListener('close', (e) => …)`   | `.on('close', (code, reason) => …)`, `reason` is a `Buffer` too |
| `addEventListener('error', …)`          | `.on('error', (error) => …)`                                    |
| `socket.send(text)`                     | `socket.send(text)`, the same                                   |
| `socket.close(code, reason)`            | `socket.close(code, reason)`, the same                          |
| `socket.readyState`, `WebSocket.OPEN`   | the same                                                        |

- **`Buffer`** is Node's type for raw bytes. Browsers give you text frames as strings; `ws` gives you bytes and leaves decoding to you. `isBinary` tells you whether the client sent a text or a binary frame.
- **`request`** is the original HTTP upgrade request: its URL, headers (`origin`, `cookie`), and the client's IP. It isn't needed yet; Stage 6 uses it for authentication.

### One rule Node is strict about: `error` listeners

In Node, an EventEmitter that emits `error` **with no `error` listener attached throws**. If nothing catches it, that **crashes the whole process**, which means every connected client is dropped because one client misbehaved.

So every socket gets an `error` listener, even one that only logs. After an `error`, `close` follows, the same as in the browser.

### Per-client state

The server talks to many clients at once, and often needs to remember something **about each one**: who it is, when it connected, whether it's frozen (Stage 4), its last ping.

There are two common places for it:

1. **Variables inside the `connection` handler.** Every connection runs the handler once, so each gets its own copies. The old server's `let frozen = false` worked like this. It's simple, but other code can't see it, e.g. a broadcast loop that needs to skip frozen clients.
2. **A `Map` from socket to state:** `const clients = new Map<WebSocket, ClientState>()`. Add the entry in `connection`, and **delete it in `close`**. Otherwise the map keeps growing, which is a memory leak. Everything that loops over clients can read it.

We'll use the **Map**, because 5b–5d all need to look at "every client and its state". A client's state starts small:

```ts
type ClientState = { connectedAt: number; id: number };
```

The `id` is a simple counter (`#1`, `#2`, …), only for readable logs: `[#3] message: hi` is easier to follow than "some socket".

(`ws` also keeps its own `wss.clients`, a `Set` of open sockets with no extra data. The Map is ours, for our state.)

### What 5a builds

A new file `src/server.ts`, run with a new script `pnpm server`, listening on **port 8081**. That's the same port as `pnpm broadcast`, so **stop the old server** before starting the new one. Only one process can listen on a port.

For this step it does very little on purpose:

- On `connection`: gives the client the next id, stores its state in the Map, and logs `[#1] connected (clients: 1)`.
- On `message`: decodes the Buffer, logs `[#1] message: hi`, and **echoes it back to the sender only**. Broadcasting to everyone comes in 5b.
- On `close`: removes the client from the Map and logs `[#1] closed code=1001 … (clients: 0)`.
- On `error`: logs it, so a bad client can't crash the process.
- On `listening`: logs `Server listening on ws://localhost:8081`.

Against this server, the Stage 2 `/chat` page works for one tab (you see your own messages). `/shared-chat` connects but shows **nothing**: since 4f it only accepts JSON `{id, text}` frames, and this server echoes plain strings, so every frame is logged as `Ignored invalid message`. There's no `__pong__` either, so its heartbeat closes the connection every ~15 s. Both are expected until 5c.

---

## §2. Broadcasting and tracking connected clients

### Broadcasting is just a loop

There's no `wss.broadcast()`. "Send to everyone" means: go through all connected clients and `send` to each one.

```ts
const broadcast = (text: string) => {
  for (const socket of clients.keys()) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(text);
    }
  }
};
```

- **Why check `readyState`?** A socket can still be in the Map while it's **closing**: the close handshake has started, but its `close` event (where we delete it) hasn't fired yet. `ws` silently drops a `send` on a closing socket, so the check isn't strictly needed. It makes the intent explicit, and it's the same rule you followed in the client: only send when `OPEN`.
- **Include the sender?** Yes. Your clients don't add their own message to the list when they send it. They wait for it to come back from the server. That way every tab shows the same messages **in the same order**, the order the server saw them. The server is the single source of truth for order.
- **Our Map or `wss.clients`?** Both hold the open sockets. We loop over our Map, because in 5c and 5d the loop needs each client's state (e.g. "does this client want JSON?").

### What "tracking clients" gives you

The Map from 5a already knows who is connected. Things a real server does with that:

- **Count and list them:** an admin page, metrics, "3 people online".
- **Presence:** tell others when someone joins or leaves ("Anna joined"). Our clients have no message type for that, so we won't send it. The requirement is that your client stays unchanged.
- **Target one client**, not everyone: a reply, a private message, an error.

To see the tracking without touching the client, the server gets a test command, the same kind as `/burst`:

| Client sends  | Server does                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `/who`        | Replies **to the sender only** with a list of the connected clients: `#1 (12s), #2 (you, 3s)`  |
| `/burst`      | Broadcasts 5 messages back to back, like the Stage 2 server (for the `lastMessage` experiment) |
| anything else | Broadcast to everyone, including the sender                                                    |

`/who` is the first time the server treats a message as a **command for itself** rather than a chat message. In 5c, `__ping__` and `__resume__` work the same way.

### One thing broadcasting hides: slow clients

`socket.send()` doesn't wait for the data to reach the client. It puts the data into that socket's **send buffer** and returns. A client on a slow network can't keep up, and its buffer grows. That's `bufferedAmount` from Stage 1, seen from the other side. With many messages and one very slow client, the server's memory grows.

Real servers check the buffered amount before sending, and skip or disconnect clients that fall too far behind. We'll only note it here; our sandbox never gets that much traffic.

### What 5b builds

In `src/server.ts`:

- A `broadcast(text)` function: the loop above, logging how many clients it reached.
- In the `message` handler, the echo is replaced with three cases: `/who` → reply to the sender, `/burst` → 5 broadcasts, anything else → `broadcast(text)`.

After this, the Stage 2 `/chat` page works across tabs again, the same as with `pnpm broadcast`. `/shared-chat` is still waiting for 5c.

---

## §3. Our app protocol: control messages, ids, history, resume

### The problem you just saw

In 5b every string that isn't `/who` or `/burst` is broadcast. So the shared store's `__ping__` and `__resume__:0` showed up in everyone's chat. The server can't tell **control messages** (meant for the server) from **chat messages** (meant for everyone) unless it knows the protocol.

The protocol is the one your client already speaks since Stage 4. In 5c the server learns it.

### The message handler becomes a router

Every incoming message goes through a fixed order of checks. The first one that matches handles it and stops:

```
message
  ├─ "__ping__"         → reply "__pong__" to the sender (unless this client is frozen)   ┐
  ├─ "__resume__:<id>"  → switch this client to JSON, replay history after <id>          │ control:
  ├─ "/freeze"          → stop answering this client's pings                              │ sender only,
  ├─ "/dupe"            → re-send the last 3 history messages to the sender               │ never broadcast
  ├─ "/who", "/burst"   → as in 5b                                                        ┘
  └─ anything else      → a chat message: give it an id, store it, broadcast it
```

The rule that fixes the bug: **control messages are answered to the sender and never reach `broadcast()`.**

### Each client gets its own format

Two kinds of clients connect to the same server:

| Client                         | Sends `__resume__`? | Wants                        |
| ------------------------------ | ------------------- | ---------------------------- |
| `/chat` (Stage 2 hook)         | no                  | plain strings: `hi`          |
| `/shared-chat` (Stage 4 store) | yes, on every open  | JSON: `{"id":7,"text":"hi"}` |

So "does this client want JSON?" is **per-client state**, exactly what the Map from 5a is for. `ClientState` grows two fields:

```ts
type ClientState = { connectedAt: number; frozen: boolean; id: number; wantsJson: boolean };
```

- `wantsJson` starts `false` and becomes `true` when the client sends `__resume__`.
- `frozen` replaces the old `let frozen` inside the connection handler (§1 explained why the Map is the better home).

`broadcast()` then builds the frame **per client**: JSON for `wantsJson` clients, plain text for the others. This is the same broadcast loop as before, with one decision inside it.

### Ids and history

These work exactly as in Stage 4 §7–§8, now inside the new server:

- A module-level `nextId` counter, and `history`, the last 100 chat messages as `{ id, text }`.
- `broadcast(text)` gives the message the next id, pushes it to `history` (dropping the oldest past 100), then sends it.
- `__resume__:<lastId>`: if `lastId >= nextId`, this server never issued that id (it restarted), so send `__reset__` first and replay from 0. Otherwise replay `history` entries with `id > lastId`, to this client only.

Note that `history` and `nextId` are **server-wide state**, while `wantsJson` and `frozen` are **per-client state**. Telling the two apart is half of server design: one belongs to the app, the other to a single connection.

### Commands for `/chat` only

`/who` replies with a plain string. A JSON client (`/shared-chat`) logs it as `Ignored invalid message`. That's fine: `/who` is a debugging tool for the `/chat` page. A real protocol would give it a message type of its own.

### After 5c

`server.ts` can fully replace `broadcast.ts`: both pages work against it, with every Stage 4 feature. `broadcast.ts` stays in the repo as the reference version.

---

## §4. Server-side ping/pong: finding and terminating dead clients

### The same problem, seen from the server

In Stage 4 §3 your **client** learned that a connection can look `OPEN` while it's dead (a half-open connection), and fixed it with a heartbeat. The server has the same problem, the other way round:

- A laptop lid closes, a phone loses signal, a browser crashes. **No close frame is sent**, so the server's `close` event doesn't fire.
- The server keeps that client in the Map, **forever**. It keeps broadcasting to it; `send()` succeeds locally, and the bytes pile up in that socket's buffer. `/who` lists a ghost.
- With thousands of users, ghosts add up: memory, file handles, wrong "online" counts.

The client's `__ping__` heartbeat doesn't help here. It lets the **client** detect a dead **server**. For the server to detect a dead **client**, the server has to ask.

### This time, use the real protocol ping

The browser API has no `ping()` (Stage 4 §3), but `ws` on the server does:

- `socket.ping()` sends a **ping control frame** (Stage 0).
- **Every browser answers a ping frame with a pong frame automatically.** No client code is involved, and the page can't even see it. So your client stays unchanged.
- The server gets a `pong` event: `socket.on('pong', () => …)`.

So there are now **two independent heartbeats**, one per direction:

| Heartbeat                  | Who sends    | Detects           | Level                      | Built in   |
| -------------------------- | ------------ | ----------------- | -------------------------- | ---------- |
| `__ping__` / `__pong__`    | client, 10 s | a dead **server** | app (ordinary text frames) | Stage 4 §3 |
| ping / pong control frames | server, 10 s | a dead **client** | protocol (control frames)  | this step  |

### The `isAlive` pattern

The standard approach (it's in the `ws` README) needs only one boolean per client and **one** timer for the whole server, not one per client:

```
every 10 s, for each client:
  isAlive is false?  → no pong since the last round: it's dead → terminate()
  otherwise          → isAlive = false, then ping()

on pong              → isAlive = true
```

A client that answers sets `isAlive` back to `true` before the next round. A client that doesn't is still `false` when the next round comes, so it gets between 10 and 20 s to answer.

- `isAlive` is **per-client state**, so it goes into `ClientState`, next to `frozen` and `wantsJson`.
- The interval is **server-wide**. It's created once, and cleared when the server closes (`wss.on('close')`), so it doesn't keep running for a server that's gone.

### `terminate()`, not `close()`

| Method               | What it does                                                                      | For a dead client                                               |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `socket.close()`     | Sends a close frame, then **waits** for the client's answer (the close handshake) | Waits for an answer that never comes (`ws` gives up after 30 s) |
| `socket.terminate()` | Destroys the TCP connection **immediately**, with no handshake                    | ✅ Gone now                                                     |

After `terminate()`, the normal `close` event still fires, with code **`1006`** (abnormal: no close frame). So your existing `close` handler does the cleanup: it removes the client from the Map, and that's all that's needed.

### How to test a dead client

A browser always answers pings, so it can't play a dead client on demand. Instead, a tiny Node script does it. It connects with `ws`'s option **`autoPong: false`**, which turns off the automatic pong reply. To the server, that looks exactly like a laptop that went to sleep.

| Script             | What it does                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| `pnpm dead-client` | Connects to `ws://localhost:8081`, never answers pings, logs what happens to it |

---

## §5. Attaching to an HTTP server and handling `upgrade` yourself

### Why a WebSocket usually shares a server with HTTP

So far `new WebSocketServer({ port: 8081 })` owned the whole port. Real apps rarely work like that. The same backend usually also serves a REST API (`GET /recipes`, `POST /login`), and you want both on **one port and one origin**:

- **Hosting** often gives you exactly one port (Render, Heroku, most PaaS).
- **Cookies** set by `POST /login` are sent with the WebSocket handshake too, since it's the same origin. Stage 6 uses this for authentication.
- **One process** holds the shared state. The HTTP routes can read the same `history` and `clients` the socket code uses.

### How one port serves both

Remember Stage 0: a WebSocket starts as an ordinary HTTP `GET` with an `Upgrade: websocket` header. Node's `http` server sorts incoming requests into two kinds:

| Request                  | Node event on the HTTP server | Who handles it                |
| ------------------------ | ----------------------------- | ----------------------------- |
| Normal (`GET /health`)   | `request`                     | Express (your routes)         |
| Has `Upgrade: websocket` | `upgrade`                     | **you**, then hand it to `ws` |

The `upgrade` handler receives three things:

- `request`: the HTTP request (URL, headers, cookies).
- `socket`: the **raw TCP connection**, not a WebSocket yet. Nothing has been answered.
- `head`: the first bytes that arrived after the headers (usually empty). You just pass it on.

You look at the request and decide:

```ts
server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/') {
    // reject: answer with a plain HTTP error and hang up
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  // accept: let ws finish the handshake (101 Switching Protocols)
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
```

- **`new WebSocketServer({ noServer: true })`**: `ws` no longer opens a port. It waits for you to call `handleUpgrade`.
- **`wss.emit('connection', ws, request)`** fires the same `connection` event as before, so **all your code from 5a–5d keeps working unchanged**.
- **Rejecting** happens before the handshake, so you can only answer in plain HTTP. In the browser, a rejected socket fails with `error`, then `close` with code `1006` (Stage 1). The browser never shows the server's status code to your JavaScript, only in DevTools → Network.

This one handler is the seam where real servers do their checks: **path** (now), **authentication** and **`Origin`** (Stage 6), rate limits.

### Express in two lines

[Express](https://expressjs.com/) is the most common Node web framework. An Express `app` is a request handler, so you can pass it to Node's `http.createServer`:

```ts
const app = express();
const server = http.createServer(app); // HTTP requests → Express
server.on('upgrade', …);               // upgrade requests → you → ws
server.listen(8081);
```

The `listening` and `error` events move from `wss` to `server`, because `server` now owns the port.

### Two HTTP routes for the sandbox

| Route                   | Returns                                    | Why                                                                                         |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET /health`           | `{ clients, historySize, uptimeSeconds }`  | The usual "is the server up?" check that hosts poll                                         |
| `GET /messages?after=7` | The history entries with `id > 7`, as JSON | **Refetching state over HTTP** from Stage 4 §7: the same data as a resume, without a socket |

Both read the **same** `clients` and `history` as the WebSocket code. That's the point of sharing one process.

You can open both straight in the browser's address bar: `http://localhost:8081/health`.

A side note for Stage 6: a `fetch` from your Vite app (`localhost:5173`) to these routes would be blocked by **CORS**, because it's a different origin. WebSockets are **not** covered by CORS at all. Any website can open a socket to your server, and that's why Stage 6 checks the `Origin` header by hand in the `upgrade` handler.

### What 5e builds

- Adds `express` (and its types) to the server's dependencies.
- In `server.ts`: an Express app with the two routes, a Node HTTP server on 8081, `ws` switched to `noServer: true`, and an `upgrade` handler that accepts only the path `/` (what your clients use) and rejects everything else with `404`.
- The rest of the server (5a–5d) stays as it is. Both pages keep working unchanged.

---

## §6. Graceful shutdown

### Servers stop all the time

Every deploy stops the old server and starts a new one. So do a crash restart, scaling down, or `Ctrl+C` in your terminal. The question isn't **whether** the server stops, but **how**.

The operating system tells the process to stop with a **signal**:

| Signal    | Sent by                                             |
| --------- | --------------------------------------------------- |
| `SIGINT`  | `Ctrl+C` in the terminal                            |
| `SIGTERM` | Hosts and tools: Render, Docker, Kubernetes, `kill` |

By default, Node **exits immediately** on both. Every TCP connection just disappears, with **no close frames**. Your clients see:

```
Closed: code 1006 - reason="". Was clean: no
```

The same code as a network failure (Stage 1). The client can't tell "the server is restarting, come back soon" from "something broke".

### Shutting down gracefully

Instead, the server catches the signal (`process.on('SIGINT', …)`) and leaves in order:

1. **Stop taking new work.** `server.close()` stops listening, so no new connections arrive. The `upgrade` handler also refuses any that slip in.
2. **Stop the timers.** Clear the heartbeat interval. `wss.close()` does it for us, because 5d already clears the interval in `wss.on('close')`.
3. **Say goodbye to every client:** `socket.close(1001, 'server shutting down')`. `1001` means **"going away"** (Stage 0).
4. **Wait for the goodbyes.** Each client answers the close frame, its `close` event fires, and it leaves the Map. When the Map is empty, exit.
5. **But don't wait forever.** A dead client never answers (§4), so after a timeout (3 s here), `terminate()` whatever is left and exit anyway.

```
SIGINT ──► stop listening ──► clear heartbeat ──► close(1001) to everyone
              ──► each client answers → removed from the Map ──► Map empty → exit
              ──► or 3 s pass → terminate the rest → exit
```

And one convenience that's nearly universal: **a second `Ctrl+C` forces the exit**, for when you don't want to wait.

**A trap with dev tools:** one `Ctrl+C` can reach the server **several times**. The terminal sends `SIGINT` to the whole process group (`pnpm`, `tsx watch` and `node` together), and each wrapper also passes the signal on to its child. So the server ignores repeats that arrive within 1 s of the first. A real second `Ctrl+C` from a person comes later than that. In production this doesn't happen: the host sends one `SIGTERM` to one process, which usually runs plain `node`, not `pnpm` + `tsx`.

### What your client does with 1001

Your Stage 4 client already handles it correctly:

- `1001` is on the **"retry"** side of the table in Stage 4 §2. A restart is temporary.
- So it reconnects with **backoff + jitter**. This is the moment jitter was made for: **every** client gets `1001` at the same instant, and without jitter they'd all hit the new server at once (the thundering herd, Stage 4 §1).
- When the new server is up, the client resumes. The new server's ids start again at 1, so it sends `__reset__` (Stage 4 §8). Every Stage 4 step fits together here.

### What "graceful" doesn't save

The history and ids live in memory, so a restart loses them even when it's graceful. A graceful shutdown makes the **ending** clean; keeping **data** across restarts needs a database. That's the same limit as in Stage 4 §7.

### What 5f builds

In `server.ts`:

- A `shuttingDown` flag and a `shutdown(signal)` function doing steps 1–5, registered for `SIGINT` and `SIGTERM`.
- The `close` handler checks "shutting down and the Map is empty → exit".
- The `upgrade` handler answers `503 Service Unavailable` while shutting down.
- A second signal while shutting down exits immediately.
