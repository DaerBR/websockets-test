# Stage 4: Reliability

Real connections drop: the server restarts during a deploy, the laptop sleeps, Wi-Fi switches networks, a proxy closes a connection that has been quiet for too long. This stage makes the chat survive all of that.

It's split into small steps, each adding **one idea** to the Stage 2 shared store (`src/socket/chatStore.ts`, page `/shared-chat`). Each step has its own section here, added when we get to it.

| Step | Idea                                                       | Status |
| ---- | ---------------------------------------------------------- | ------ |
| 4a   | Reconnect automatically, with exponential backoff + jitter | ✅     |
| 4b   | Stop on purpose vs. retry                                  | ✅     |
| 4c   | Detect a dead connection: heartbeat                        | ✅     |
| 4d   | React to `online` / `offline` and `visibilitychange`       | ✅     |
| 4e   | Queue outgoing messages while disconnected                 | ✅     |
| 4f   | Catch up after a reconnect, without duplicates             | ✅     |

---

## §1. Reconnecting with exponential backoff + jitter

### The browser never reconnects for you

A `WebSocket` object is single-use. Once it reaches `CLOSED`, it stays closed forever: there's no `socket.reconnect()`. To reconnect, you create a **new** `WebSocket` with the same URL.

Your store is already almost ready for that:

- `connect(url)` creates a socket, unless one exists (`if (socket) return;`).
- The `close` listener sets `socket = null`.

So after a close, calling `connect(url)` again simply opens a fresh socket. What's missing is **when** to call it.

### Why not reconnect immediately?

The obvious version, "on `close`, call `connect()` again", has two problems:

1. **A tight loop while the server is down.** When the server isn't running, a connection attempt fails within milliseconds: `error`, then `close` with code `1006` (Stage 1). That `close` triggers the next attempt, which fails again, and so on: hundreds of attempts a second, burning CPU and battery and flooding the console.
2. **The thundering herd.** Imagine 1,000 users connected when the server restarts. All 1,000 get `close` at the same moment, and all reconnect at the same moment, hitting the server just as it's starting up. If that overloads it, they all fail and all retry together again.

### Exponential backoff: wait longer after each failure

Wait before each attempt, and **double** the wait after each failure, up to a maximum:

| Attempt | Wait (base 1 s, max 30 s) |
| ------- | ------------------------- |
| 1       | 1 s                       |
| 2       | 2 s                       |
| 3       | 4 s                       |
| 4       | 8 s                       |
| 5       | 16 s                      |
| 6+      | 30 s (the cap)            |

```ts
const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt); // attempt counts from 0
```

- A short outage (a server restart) is recovered within a second or two.
- A long outage costs only one attempt every 30 s.
- The **cap** matters: without it, attempt 15 would wait 9 hours.

**Reset the counter when a connection succeeds** (in the `open` listener), not when an attempt starts. Otherwise, after the server comes back, the _next_ drop would start at 30 s instead of 1 s.

### Jitter: spread the clients out

Backoff alone doesn't fix the thundering herd: 1,000 clients that disconnected together all compute the same 1 s, 2 s, 4 s… and keep arriving together. **Jitter** adds randomness so they spread out. The common version, called _full jitter_, picks a random wait between 0 and the backoff value:

```ts
const delay = Math.random() * backoff;
```

Now the 1,000 clients arrive spread across the whole window instead of all at once. For a single user, the only visible effect is that waits vary a bit.

### The reconnect loop

```
close event
  → was this a close we wanted? (step 4b; for now: always reconnect)
  → delay = random(0, min(max, base × 2^attempt))
  → attempt += 1
  → setTimeout(() => connect(url), delay)

connect(url) → new WebSocket
  → fails?  → close event → (loop again, with a longer delay)
  → opens?  → open event → attempt = 0
```

Note that you don't need separate "retry on failure" code: a failed attempt fires `close` too, so the same `close` listener schedules the next one.

Two practical details:

- **The store needs the URL later.** The `close` listener calls `connect(url)` again, so `connect` has to remember the URL it was given, e.g. in a module variable.
- **Keep the timer.** Store the `setTimeout` id in a module variable. Nothing uses it yet, but step 4b will need to cancel a scheduled reconnect.

### What you'll see while the server is down

Each failed attempt makes the browser print a red `WebSocket connection to 'ws://localhost:8081/' failed` in the Console. That's the browser, not your code, and it can't be turned off. It's a useful signal here: the gaps between those lines should grow.

---

## §2. Stopping on purpose vs. retrying

### Not every close should be retried

After 4a, the store reconnects after **every** `close`. That's wrong in two kinds of cases:

**1. We closed it ourselves, on purpose.** A "Disconnect" button, the user logging out, leaving the part of the app that needs live updates. If the store then reconnects, the button doesn't work.

**2. The server told us not to come back.** Some close codes mean "retrying won't help" (Stage 0):

| Code        | Meaning                                   | Retry?                                             |
| ----------- | ----------------------------------------- | -------------------------------------------------- |
| `1006`      | Abnormal: no close frame (crash, network) | ✅ yes, the classic case for reconnecting          |
| `1001`      | Going away (server restart, deploy)       | ✅ yes                                             |
| `1011`      | Server hit an unexpected error            | ✅ yes, with backoff                               |
| `1008`      | Policy violation                          | ❌ no, the same request will be rejected again     |
| `4000–4999` | App-defined, e.g. `4001` "unauthorized"   | ❌ usually no; it depends on what your app defines |

The rule of thumb: retry when the problem is **temporary** (network, restart). Don't retry when it's **about you** (not allowed, invalid session). Retrying those just hammers the server with requests it will keep rejecting.

### How do we know _we_ closed it?

The `close` event can't tell you reliably who started the close. Code `1000` can come from your own `socket.close(1000)` or from the server. So the store keeps its own flag:

```ts
let shouldReconnect = true;
```

- `connect()` sets it to `true`: "I want to be connected".
- `disconnect()` sets it to `false`: "I want to stay disconnected".
- The `close` listener checks it **before** scheduling a reconnect.

The flag records **what the app wants**, which only the app knows. The socket can only report what happened.

### `disconnect()` has to cover three situations

When the user clicks "Disconnect", the store can be in any of these states:

| State when called                              | What stops it                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Connected (`OPEN`)                             | `socket.close(1000, …)` → `close` fires → the flag says "don't reconnect"                   |
| Connecting (`CONNECTING`)                      | Same: `close()` on a connecting socket aborts it, and `close` fires                         |
| **Waiting between retries** (no socket at all) | Only `clearTimeout(reconnectTimer)`. There's no socket to close, only a scheduled `connect` |

The third case is why 4a kept the timer: without it, a scheduled reconnect would fire after the user clicked "Disconnect".

### And `connect()` should cancel a pending retry

If `connect()` is called by hand (a "Connect" button) while a retry is already scheduled, the timer would later call `connect()` a second time. The `if (socket) return;` guard would catch that, but it's cleaner to `clearTimeout(reconnectTimer)` at the start of `connect()`, so only one path is ever active.

---

## §3. Detecting a dead connection: heartbeat

### A connection can look open while it's dead

Your reconnect logic from 4a starts on the `close` event. But sometimes **no `close` event comes**, even though the connection is gone:

- The laptop sleeps, and wakes up on a different network.
- Wi-Fi drops, or a phone switches from Wi-Fi to mobile data.
- A router or proxy in between silently forgets the connection (e.g. after it was idle too long).

In all these cases **no packet arrives to say "closed"**. A TCP connection is only an agreement between two endpoints. If one side vanishes without saying goodbye, the other side finds out only when it **tries to send** something and gets no answer. Even then, TCP retries for **minutes** before giving up.

So when the chat is quiet, the socket can sit in `OPEN` with the badge green, while nothing will ever arrive again. This is called a **half-open** connection. The user sees "online" but gets no messages.

### The fix: ask "are you there?" regularly

A **heartbeat** (also called _keep-alive_) is a tiny message sent on a timer just to prove the connection works:

1. Every **10 s** while open, the client sends `ping`.
2. The server answers `pong` straight away.
3. If no `pong` arrives within **5 s**, the client decides the connection is dead and closes it itself. From there the normal close → reconnect path from 4a takes over.

```
open ──10 s──► ping ──► pong ✓ ──10 s──► ping ──► pong ✓ ──10 s──► ping ──── 5 s, no pong ✗ ──► close → reconnect
```

The worst case is now about 15 s to notice a dead connection, instead of "never".

Bonus: the regular traffic also stops proxies and load balancers from closing the connection as "idle". Many close quiet connections after 60 s.

### Why an app-level ping, not the protocol's ping frame?

The WebSocket protocol has real ping and pong **control frames** (Stage 0). But the browser API doesn't let you send them: there's no `socket.ping()`. Browsers do **answer** a server's ping automatically, but that only lets the **server** detect dead clients (Stage 5).

For the **client** to detect a dead server, it has to send an ordinary message the server agrees to answer. That's an **app-level** heartbeat. In the Stage 2 broadcast server, the agreed messages are two reserved strings:

| Client sends | Server replies                 |
| ------------ | ------------------------------ |
| `__ping__`   | `__pong__`, to the sender only |

Two consequences for the client:

- `__pong__` is **not a chat message**. The `message` listener has to recognize it and stop there, so it never lands in the message list.
- The pings and pongs **do** show up in DevTools → Messages, every 10 s. That's expected.

(With the typed protocol from Stage 3, this would be `{ type: 'ping' }` and `{ type: 'pong' }` instead of magic strings.)

### Timers: start on open, stop on close

The heartbeat must run only while the socket is `OPEN`:

- **Start it in the `open` listener.** Sending before `OPEN` throws (Stage 1).
- **Stop both timers in the `close` listener.** Otherwise the interval keeps firing for a socket that no longer exists, and after a reconnect you'd have two heartbeats running.
- **When a `pong` arrives, cancel the 5 s "pong timeout".**

There are two timers, with different jobs:

| Timer            | Kind          | Job                                                          |
| ---------------- | ------------- | ------------------------------------------------------------ |
| `heartbeatTimer` | `setInterval` | Every 10 s: send `__ping__` and start the pong timeout       |
| `pongTimer`      | `setTimeout`  | Fires only if the `pong` is late: closes the dead connection |

### Closing a dead connection

When the pong timeout fires, call `socket.close(4000, 'heartbeat timeout')`:

- `4000` is in the **app-defined range** (`4000–4999`, Stage 0). It's our own code, meaning "we gave up on this connection". The browser's `close()` only accepts `1000` or `3000–4999`.
- `shouldReconnect` is still `true`, so the `close` listener schedules a reconnect as usual.

**A caveat for real networks:** `close()` starts the closing handshake, and the browser waits for the server's reply. If the network is really gone, that reply never comes, and Chrome waits up to about a minute before firing `close`. Production code often doesn't wait: it drops the old socket immediately and starts a new one, using a guard like the Stage 2 `wsRef.current !== socket` check to ignore the old socket's late events. For this step, plain `close()` is enough, because the test server stays reachable (see `/freeze` below).

### How to test it without breaking your network

The broadcast server has a test command for this step: sending **`/freeze`** makes it stop answering **your** pings, while the connection stays open. To your client that looks exactly like a dead connection. After the reconnect you get a fresh, unfrozen connection.

---

## §4. Listening to the browser: `online` / `offline`

4d has two halves. This one is about the network; `visibilitychange` (a hidden or sleeping tab) comes next, in §5.

### The browser knows things your socket doesn't

So far the store learns about problems only from the socket: a `close` event, or a missing pong (up to ~15 s). But the browser often knows **earlier** that the network changed, and it tells the page through two `window` events:

| Event     | Fires when                                                 | `navigator.onLine` |
| --------- | ---------------------------------------------------------- | ------------------ |
| `offline` | The device lost its network connection (Wi-Fi off, cable…) | `false`            |
| `online`  | The device has a network connection again                  | `true`             |

These are **hints**, not guarantees:

- `offline` is reliable: no network interface means no connection, for sure.
- `online` only means "there is _some_ network". The server may still be unreachable (captive portal, VPN, server down). So `online` is a good moment to **try**, not a promise that it will work. If it fails, the normal backoff from 4a takes over.

### What the store should do with them

**On `offline`: give up on the socket now.**

- Close the socket yourself (`socket.close(4001, 'offline')`). The badge turns `closed` right away, instead of staying green until the heartbeat notices.
- Cancel a pending retry (`clearReconnectTimer()`), if one is waiting.
- `4001` is our own app-defined code, like `4000` in §3. Since the client chose it, the client decides what it means: here, "closed because offline, reconnect when online".

**While offline: don't retry at all.**

Every attempt would fail instantly, and backoff would only push the wait up to 30 s, so the reconnect after `online` would come late. Instead, the `close` listener checks `navigator.onLine` and, when it's `false`, simply stops and waits for the `online` event.

**On `online`: reconnect immediately, with a fresh counter.**

- Skip the backoff wait: the reason for the outage is gone, so there's nothing to wait for.
- Reset `reconnectAttempt` to `0`, so that if this attempt fails, the backoff starts again from 1 s.
- But only if the app still wants to be connected (`shouldReconnect`) and there's no socket already. If the user clicked Disconnect before going offline, coming back online must not reconnect.

```
online ──► offline event ──► close(4001) ──► close listener: offline? → wait (no retry)
                                                         │
                         online event ──► reconnect now, attempt = 0 ──► open ✓
```

### Where to register the listeners

The store is a module singleton that lives as long as the page, so it can register the `window` listeners **once, at module level**, like the socket itself. There's no component and no cleanup involved. (A hook or component that registered them would have to remove them in its `useEffect` cleanup.)

### Testing with DevTools "Offline"

DevTools → Network → the throttling dropdown (it usually says "No throttling") → **Offline**. This fires the real `offline` event and sets `navigator.onLine = false`; switching back to "No throttling" fires `online`.

One caveat: depending on the Chrome version, emulated offline may not actually cut an **already open** WebSocket. That doesn't matter here, because your `offline` handler closes the socket itself.

On a real network outage, `close()` can be slow to fire `close` (the §3 caveat). If `online` arrives before that, the store still has a socket and skips the immediate reconnect. Nothing is lost: when `close` finally fires, `navigator.onLine` is `true` and the normal backoff reconnects.

---

## §5. Listening to the browser: `visibilitychange`

The second half of 4d. §4 handled "the network went away". This one handles "**the page** went away for a while": a background tab, or a laptop that went to sleep.

### What happens to a hidden tab

When a tab is hidden (another tab is active, the window is minimized) or the laptop sleeps:

- **Timers slow down or stop.** Browsers throttle `setTimeout` / `setInterval` in hidden tabs to save battery: at most about once a second, and in some cases much less often. The details differ between browsers and change between versions. During sleep, nothing runs at all.
- So your **heartbeat runs late, or not at all**. The 10 s interval from §3 is no longer a promise.
- And your **backoff waits stretch**. A retry scheduled "in 16 s" may fire minutes later.

When the user comes back, the store can be in a bad state that it hasn't noticed yet:

| State when the tab becomes visible | Problem                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Socket `OPEN`                      | It may be half-open (§3), e.g. after sleep on another network. The next ping could be up to 10 s away        |
| No socket, retry scheduled         | The backoff may still have a long wait to go, while the user stares at a `closed` badge on a working network |

### The fix: check right away when the user comes back

The browser fires `visibilitychange` on `document` whenever the page is hidden or shown. The current state is in `document.visibilityState`: `'visible'` or `'hidden'`.

When it becomes `'visible'`:

- **If the socket is `OPEN`: send a ping now**, instead of waiting for the next interval tick. If the connection is dead, the pong timeout closes it within 5 s, and the reconnect path takes over.
- **If there's no socket: reconnect now**, skipping the rest of the backoff wait. That's exactly what `handleOnline` already does, so it makes sense to turn it into one shared function, `reconnectNow(reason)`, with the same guards: the app wants to be connected (`shouldReconnect`), there's no socket yet, and the browser is online.

When it becomes `'hidden'`, do nothing. (Some apps disconnect on purpose after the tab has been hidden for a long time, to save server resources. That's a product decision, not a reliability one; we won't do it.)

### One ping at a time

"Ping now" means the ping code is needed in two places: the interval, and the visibility handler. So it moves into its own function, `sendPing()`.

`sendPing()` needs one new guard: **don't send a ping while the previous one is still waiting for its pong** (`pongTimer !== null`). Otherwise a "ping now" right after an interval ping would start a second pong timeout and overwrite `pongTimer`. The first timeout could then no longer be cancelled, and it would close a healthy connection 5 s later.

```
tab visible ──► OPEN?  ── yes ──► sendPing() ──► pong ✓            (all good)
                  │                         └──► 5 s, no pong ✗ ──► close(4000) → reconnect
                  └──── no ───► reconnectNow('Tab is visible')
```

### How to test it

Real sleep is hard to reproduce on demand, so the checklist fakes it:

- **A dead connection while you were away:** `/freeze` (the server stops answering pings), switch to another tab and straight back. The "ping now" goes out at once and gets no pong, so the close comes within ~5 s of your return, instead of up to 15 s.
- **A long backoff wait:** stop the server and let the retries grow to a long wait. Start the server, then switch tabs away and back. It reconnects at once.

---

## §6. Queueing outgoing messages while disconnected

### The problem

Since 4a–4d, the store reconnects by itself. But look at `send()`: while the socket isn't `OPEN`, it logs `Not sent…` and **throws the message away**. And the page disables the Send button unless the status is `open`.

So during every reconnect, even one that lasts a second, the user can't send, or what they typed is lost. With automatic reconnects, short gaps are normal now, and the app should hide them.

### The fix: an outbox

Instead of dropping the message, the store keeps it in a list, the **outbox** (also called the _send queue_ or _buffer_), and sends it as soon as the socket opens:

```
send("hi") ──► OPEN? ── yes ──► socket.send("hi")
                 │
                 └── no ──► outbox.push("hi")

open event ──► flush: send everything in the outbox, oldest first, then empty it
```

- **Oldest first (FIFO).** Messages arrive in the order the user wrote them.
- **The queue lives in the store**, next to the socket, not in a component. A component can unmount during a reconnect; the store can't.
- **Flushing happens in the `open` listener**, right after the status changes. JavaScript runs one event handler at a time, so the user can't send anything new in the middle of a flush, and the order is kept.

### What should _not_ be queued or replayed

A queue is "send it later", and some messages are wrong to send later:

| Message                           | Queue it?                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| A chat message the user wrote     | ✅ yes, that's the point                                                                       |
| `__ping__`                        | ❌ no, a ping from 20 s ago proves nothing about the new connection (`sendPing` already skips) |
| "typing…" (`typing: true`)        | ❌ no, by the time it's sent, the user stopped typing long ago                                 |
| Anything that's **too old**       | ❌ no, a message replayed after 10 minutes offline can be confusing or wrong                   |
| After the user clicked Disconnect | ❌ no, nothing will ever flush it. Refuse it, and empty the queue in `disconnect()`            |

The rule of thumb: **queue what still makes sense later; drop what describes "right now".**

So the queue needs two limits:

- **Max age.** Each item remembers when it was queued (`queuedAt`). At flush time, items older than e.g. 30 s are dropped (with a warning), not sent. 30 s is a choice for this sandbox; a real chat might keep messages for hours and ask the user.
- **Max size.** Without a cap, a long outage with a chatty app grows the queue without limit. Here: 50 items, and `send()` refuses more.

### What the queue does _not_ solve

- **A half-open socket (§3).** If the socket is `OPEN` but dead, `socket.send()` "succeeds" locally, the message goes nowhere, and it's not in the queue anymore. Only **acks** (Stage 3) fix that: keep each message until the server confirms it, and resend unconfirmed ones after a reconnect.
- **Duplicates.** Resending can deliver a message twice, if the first copy did arrive but its ack didn't. The fix is an id per message and a server that ignores ids it has seen: **idempotency**, part of 4f.
- **A page reload.** The queue is a module variable, so a reload or closed tab loses it. Apps that must not lose drafts save the queue in `localStorage` or IndexedDB.
- **Showing it.** Real apps show queued messages in the list, greyed out as "sending…". That's the optimistic UI from Stage 3. We keep it to the Console here.

---

## §7. Catching up after a reconnect

4f has two halves. This one: **getting back what you missed**. The next one (§8): making sure nothing shows up **twice**.

### The gap

Everything so far keeps the connection alive and your outgoing messages safe. But what about **incoming** messages sent while you were disconnected?

```
tab B:  sends "a"        sends "b"        sends "c"
tab A:  ✓ "a"   ── offline ─────────────── back online ──► sees only what comes next
                         ✗ "b"            ✗ "c"
```

The broadcast server sends each message to the sockets that are open **at that moment**. Tab A had no socket when "b" and "c" went out, so it never gets them, and nothing tells it that it missed anything.

### The idea: "last seen" + replay

Two things fix it:

1. **The server numbers every message** with an increasing id (`1, 2, 3, …`) and keeps the recent ones in a **history**.
2. **The client remembers the last id it saw**, and after every (re)connect tells the server: "I have everything up to id 7, send me the rest." The server replays everything with `id > 7`.

```
open ──► client: "__resume__:7" ──► server: history.filter(id > 7) ──► sends 8, 9, 10 ──► then live messages as usual
```

This is the same idea as `Last-Event-ID` in Server-Sent Events, Kafka offsets, or a "since" cursor in an HTTP API.

### Our wire format

The Stage 2 server sent plain strings, which have nowhere to put an id. So for clients that ask for it, the server now sends JSON:

| Direction       | Frame                     | Meaning                                                       |
| --------------- | ------------------------- | ------------------------------------------------------------- |
| client → server | `__resume__:7`            | "I've seen up to id 7". Also switches this connection to JSON |
| server → client | `{"id":8,"text":"hello"}` | One chat message with its id                                  |

- **It's opt-in.** A connection that never sends `__resume__` (the Stage 2 `/chat` page) keeps getting plain strings, so nothing else breaks.
- **`__ping__` / `__pong__` stay plain strings.** Check for the pong **before** parsing JSON.
- **Validate what comes in** with Zod, like Stage 3: `JSON.parse` can throw, and a parsed value can have any shape.

### Where the client keeps "last seen"

A module variable in the store, `lastSeenId`, starting at `0`:

- **Update it** on every chat message received: `lastSeenId = event.id`.
- **Send it** in the `open` listener, **before** flushing the outbox. Then the missed messages arrive before your own queued ones are echoed back, so the order on screen is the real order.
- **Don't reset it** in `disconnect()`. After a manual Disconnect → Connect, catching up is exactly what you want.
- On first load it's `0`, which means "send me everything you have". So a fresh tab (or a reload) now starts with the recent history, for free.

### Limits worth knowing

- **The history is short** (100 messages here) and lives in the server's memory. If you were away longer than that, the oldest missed messages are gone. Real apps then **refetch state over HTTP** (`GET /messages?after=7`) and use the socket only for what's new. The socket is for live updates; the database is the source of truth.
- **A server restart resets ids to 1** and empties the history, because it's all in memory. A real server keeps ids in a database, so they survive restarts. With this sandbox server, reload the page after restarting it.

---

## §8. Without duplicates: idempotency

The second half of 4f, and the last idea of Stage 4.

### Where duplicates come from

Once messages can be **replayed**, the same message can reach you more than once:

- A replay overlaps with what you already have, e.g. the server's idea of "after id 7" is off by one, or a live broadcast and a replay of the same message cross each other.
- Something upstream retries: a proxy, a message broker, or a server that resends when it isn't sure the first copy arrived.
- (In the other direction) **your** outbox resends a message that did arrive, because its ack got lost (§6).

Most real systems deliver **"at least once"**: they'd rather send twice than lose a message. Delivering "exactly once" over an unreliable network isn't possible. What _is_ possible is making the **receiver** handle a repeat as a no-op.

### Idempotency

An operation is **idempotent** when doing it twice has the same effect as doing it once. "Set lastSeenId to 8" is idempotent. "Append the message to the list" is not: twice means two copies on screen.

So you make the receiver idempotent: **apply each id once**. Because the server's ids only grow, the client doesn't need a set of all seen ids. One comparison is enough:

```ts
if (chatEvent.id <= lastSeenId) {
  // already have it: ignore
}
```

This also covers **out-of-order** delivery: an older message arriving after a newer one is dropped instead of being shown in the wrong place. Messages on one WebSocket can't arrive out of order (TCP keeps the order), but replays, multiple connections, or several servers can produce it.

The opposite case, a **gap** (`id > lastSeenId + 1`), means something was missed. A stricter client would react by resuming again or refetching. We'll only notice it here, not handle it.

### The catch: the ids must be trustworthy

"Ignore every id ≤ lastSeenId" only works if ids never go backwards. Our server keeps ids in memory, so a **restart begins again at 1**. A tab that remembers `lastSeenId = 12` would then ignore the server's new messages 1–12 as "duplicates". That's real data loss, caused by the deduplication itself.

So the server now spots that case: when a client resumes with an id it has never issued (`lastId >= nextId`), it sends **`__reset__`** before the replay, meaning "your lastId means nothing here, start from 0". The client sets `lastSeenId = 0`, and the replay that follows is accepted.

(This check is a heuristic: if other clients send enough messages before you resume, the new ids can pass your old one, and the server can't tell. Real servers avoid it with ids that survive restarts (a database sequence), or an **epoch**: a server-instance id sent with the ids, so a client can see "different epoch, reset".)

### The other direction (for Stage 5)

Duplicates going **to** the server are fixed the same way, mirrored: the client gives each outgoing message its own id (like the Stage 3 correlation ids), and the server ignores ids it has already stored. You'll build that when you write the server.

### Test commands

| Send                 | Server does                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `/dupe`              | Re-sends the last 3 history messages to **you** only (same ids)     |
| (restart the server) | Its ids start again at 1. On your resume it sends `__reset__` first |
