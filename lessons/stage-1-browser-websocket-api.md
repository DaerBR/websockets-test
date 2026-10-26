# Stage 1: The browser `WebSocket` API

The whole API is one class with 4 events, 2 methods and a few properties.

---

## §1. Creating a socket

```ts
const ws = new WebSocket('ws://localhost:8080');
// or, with subprotocols:
const ws = new WebSocket('wss://api.example.com/chat', ['chat.v2', 'chat.v1']);
```

- **The connection starts immediately.** There's no `connect()` method: creating the object starts the handshake.
- **A malformed URL throws synchronously**, as a `SyntaxError`. Examples are an unsupported scheme like `ftp://` or a URL with a `#fragment`. This is the only failure you can catch with `try/catch`, because it happens before any network activity.
  - Recent browsers also accept `http://` / `https://` and relative URLs, and convert them to `ws://` / `wss://`. That's why Chrome's error message lists four allowed schemes. Writing `ws://` / `wss://` explicitly is still the clearest.
  - Watch out for `'localhost:8080'` without a scheme: it's parsed as a URL whose _scheme_ is `localhost`, so it throws.
- **A failure to connect never throws.** If the server is down or the port is wrong, the constructor still succeeds and you find out later through events (§3). The network work happens in the background after the constructor returns.
- The second argument is the subprotocol list from Stage 0. After the connection opens, `ws.protocol` holds the one the server picked (or `''`), and `ws.extensions` holds the negotiated extensions, e.g. `permessage-deflate`.
- **A socket object is single-use.** Once it's closed it can never reopen. Reconnecting always means creating a _new_ `WebSocket`. Stage 4 builds on this.

---

## §2. `readyState`: the four states

```
 new WebSocket()
       │
  0 CONNECTING ──handshake ok──▶ 1 OPEN ──close() or server closes──▶ 2 CLOSING ──▶ 3 CLOSED
       │                                                                              ▲
       └──────────────────── handshake failed ───────────────────────────────────────┘
```

Compare against the named constants (`ws.readyState === WebSocket.OPEN`), not magic numbers.

**There's no "state changed" event.** You learn about state changes through the events in §3 (`open` means it's now OPEN, `close` means it's now CLOSED). The one exception is the switch to CLOSING when _you_ call `close()`, which happens synchronously inside that call.

How `send()` behaves depends on the state:

| State                | `send()` behaviour                                                                     |
| -------------------- | -------------------------------------------------------------------------------------- |
| `CONNECTING`         | **Throws** `InvalidStateError`. You called it too early, which is a programming error. |
| `OPEN`               | Queues the data for sending.                                                           |
| `CLOSING` / `CLOSED` | **Does not throw.** The data is silently thrown away.                                  |

**Chrome detail:** after a send in CLOSING/CLOSED, Chrome _prints_ a red Console message, "WebSocket is already in CLOSING or CLOSED state.", but it is **not an exception**. Your code keeps running and can't catch it. The discarded data is still added to `bufferedAmount`, as the spec requires.

The reasoning: sending while connecting is always a bug in your code. But the connection can drop at any moment without your code knowing, so throwing there would turn every network blip into an exception. As a result, `send()` succeeding doesn't mean anything was sent. If it matters, check `readyState` first.

---

## §3. Events

```ts
ws.addEventListener('open', () => {
  /* now OPEN, send() is allowed */
});
ws.addEventListener('message', (e: MessageEvent) => {
  e.data; /* string | Blob | ArrayBuffer */
});
ws.addEventListener('error', (e: Event) => {
  /* something failed, no details, see §7 */
});
ws.addEventListener('close', (e: CloseEvent) => {
  e.code;
  e.reason;
  e.wasClean;
});
```

`ws.onopen = …` also works. The difference is the usual DOM one: `onX` holds a single handler and assigning again replaces it, while `addEventListener` stacks handlers.

**Why attaching handlers _after_ `new WebSocket()` is safe:** the browser never fires these events in the middle of your code. They go onto the task queue and only run once your current synchronous code has finished. Even a localhost handshake can't fire `open` before the next line runs.

**Order guarantees:**

- **Normal session:** `open` → `message`* → `close`.
- **Failed connection:** `error` → `close`, and `open` never fires.
- **Dropped connection:** `error` (usually) → `close`.
- **`close` always fires exactly once** at the end, whether or not the socket ever opened. Put cleanup and "reconnect?" logic in `close`, not in `error`.

---

## §4. Closing and `CloseEvent`

```ts
ws.close(); // sends a close frame with no code → the other side reports 1005
ws.close(1000, 'user left'); // normal close with a reason
ws.close(4001, 'token expired'); // app-defined code
```

- `close()` sets `readyState` to CLOSING right away and sends a close frame. The `close` event fires later, once the server has replied with its own close frame and TCP has shut down.
- Allowed codes from JS are **`1000` or `3000–4999`**. Anything else, including `1001`, throws `InvalidAccessError`. The reasoning is that `1001`–`1015` describe protocol-level situations, so only the browser or server should claim them.
- The reason must be ≤123 bytes of UTF-8, or the call throws `SyntaxError`.
- Calling `close()` with no code sends a close frame that has **no code at all**. The other side then reports **`1005` "no status received"**. Like `1006`, `1005` is never sent on the wire; it's a local label for "the close frame had no code".

The three fields of `CloseEvent`:

- **`code`** is what the other side sent, or one of the local labels `1005`/`1006`.
- **`reason`** is the text from the close frame, often `''`.
- **`wasClean`** is `true` only if the closing handshake completed (close frame sent _and_ received). If TCP just died, it's `false` and the code is `1006`.

Close codes from Stage 0, for reference:

| Code        | Meaning                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `1000`      | Normal closure                                                                                                       |
| `1001`      | Going away (server shutting down, tab navigating)                                                                    |
| `1005`      | **Never sent on the wire.** The close frame had no code.                                                             |
| `1006`      | **Never sent on the wire.** The connection died with no close frame (killed server, network drop, failed handshake). |
| `1008`      | Policy violation (e.g. auth failed)                                                                                  |
| `1011`      | Server internal error                                                                                                |
| `4000–4999` | Yours to define (e.g. `4001` = token expired)                                                                        |

---

## §5. Sending and receiving data

**Sending:** the type you pass determines the frame type.

| You pass                                                       | Frame sent         |
| -------------------------------------------------------------- | ------------------ |
| `string`                                                       | text frame (UTF-8) |
| `Blob`, `ArrayBuffer`, typed array (`Uint8Array`…), `DataView` | binary frame       |

So `ws.send(JSON.stringify(obj))` sends text, and `ws.send(new Uint8Array([1, 2, 3]))` sends binary. Objects are **not** serialized for you: `ws.send({a: 1})` sends the string `"[object Object]"`.

**Receiving:** the frame type determines what `e.data` is.

| Server sent  | `binaryType`       | `e.data` is   |
| ------------ | ------------------ | ------------- |
| text frame   | any                | `string`      |
| binary frame | `'blob'` (default) | `Blob`        |
| binary frame | `'arraybuffer'`    | `ArrayBuffer` |

The difference is practical:

- A **`Blob`** is a handle to data the browser may not have loaded into JS memory yet. Reading it is **async**: `await e.data.arrayBuffer()` or `await e.data.text()`.
- An **`ArrayBuffer`** is a raw block of memory with no methods for reading its contents. You read it **synchronously** by wrapping it in a _view_: `new Uint8Array(e.data)` treats the memory as a list of bytes (0–255).

**Telling them apart:** `typeof` works for strings, but it returns `"object"` for _both_ `Blob` and `ArrayBuffer`. Use `instanceof Blob` / `instanceof ArrayBuffer` for the binary cases.

**Log order with `async`:** if your `message` handler `await`s a `Blob`, a text message that arrives _after_ the Blob can be logged _before_ it. With `ArrayBuffer` nothing is awaited, so the order is kept. For any protocol where you parse binary messages, set `binaryType = 'arraybuffer'` right after creating the socket. A `Blob` mainly helps when you just pass the data along, e.g. into a download or an `<img>` via `URL.createObjectURL`.

The echo server keeps the frame type: text comes back as text and binary as binary.

---

## §6. `bufferedAmount` and backpressure

`send()` never waits. It copies your data into the browser's outgoing queue and returns at once. `ws.bufferedAmount` is the **number of bytes still in that queue**, not yet handed to the network.

- **Why it matters:** if you send faster than the connection can carry (a big file, a stream of frequent updates on a slow network), the queue and your tab's memory keep growing, and messages arrive later and later. This is the "backpressure" problem: the sender has to slow down when the receiver or network can't keep up.
- **The basic pattern:** before sending something large or frequent, check `ws.bufferedAmount`. If it's above some threshold (e.g. 1 MB), wait and try again later. There's no "drain" event, so you have to poll, e.g. with `setTimeout`.
- **What it does _not_ mean:** `bufferedAmount === 0` only means the bytes **left the browser**. It says nothing about whether the server received or processed them. Confirming delivery requires the server to reply with an acknowledgement, which is Stage 3.

---

## §7. Why the `error` event tells you nothing

The `error` event is a plain `Event`. It has no message, no code and no reason. All failures look identical to your JS: server down, wrong port, TLS problem, server answering `404` instead of `101`. You get `error`, then `close` with `1006`.

**This is deliberate, for security.** Imagine a malicious website you visit. If its JS could tell "connection refused" from "TLS error" from "some server answered", it could probe `ws://192.168.1.1:22`, `ws://192.168.1.1:80`, `ws://10.0.0.5:5432`… and map **your home or office network** from inside your browser: which machines exist and which services they run (port scanning). Making every failure look the same kills that attack.

The details aren't lost: the browser prints them to the **DevTools Console** (e.g. "WebSocket connection to … failed: …"), which humans can read and page JS can't. In code, you react to `close` and its `code`; for diagnosis, you read the Console.

---

## Self-check

Each question is covered in the section shown.

1. You attach `onopen` on the line _after_ `new WebSocket(...)`. Why can't you miss the event? _(§3)_
2. `send()` while CONNECTING versus `send()` after CLOSED: what does each do, and why the difference? _(§2)_
3. Your app gets `close` with `1006`. List three possible causes. Why won't the browser tell your code which one it was? _(§4, §7)_
4. Binary messages arrive as `Blob`. How do you read the bytes, and how do you get `ArrayBuffer`s instead? _(§5)_
5. `bufferedAmount` is `0`. Does that mean the server received your message? _(§6)_
