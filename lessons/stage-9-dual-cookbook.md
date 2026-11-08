# Stage 9 sketch: live updates in dual-cookbook

How I'd add live updates to `dual-cookbook-client` + `dual-cookbook-server`, using what this sandbox built in Stages 4–7. This is a design sketch, not a step plan, and nothing here is implemented or tested. It's written against the two repos as they are on 2026-11-03.

**Goal:** when one user creates, edits or deletes a recipe or a category, the other user's screen updates without a refresh, with a toast saying who changed what.

---

## 1. What the existing apps already decide for us

| Fact in the cookbook | Consequence for the socket |
| --- | --- |
| Server: Express 5 started with `app.listen(port)` (`src/index.ts`) | Switch to `http.createServer(app)` + `server.listen`, so `ws` can share the port through the `upgrade` event (Stage 5e). |
| Sessions: `cookie-session` (the whole session lives in a signed cookie `session` + `session.sig`), Passport stores the user id in it | No session store to look up. The handshake reads and **verifies** that cookie itself (§3.2). |
| Production is **cross-site**: client on Vercel, API on `dual-cookbook-server.onrender.com`; the cookie is `SameSite=None; Secure` | The browser sends the cookie on a WebSocket handshake from **any** site. SameSite gives zero CSWSH protection here, so the **Origin check is mandatory** (Stage 6e), against the existing `CORS_ORIGIN` allowlist. |
| No dev proxy: the client calls `API_URL` (`VITE_BASE_API_URL`) directly | The socket URL is derived from `API_URL`: `https://…` → `wss://…/ws`, `http://localhost:4000` → `ws://localhost:4000/ws`. |
| Writes are already protected: `requireLoginExceptSafeMethods` on `/api/recipes`, `/api/categories` | The socket is **read-only** for clients: the server pushes events, clients never send data changes over it. Writes stay HTTP, with all their validation. |
| One Render instance, two users | Broadcasting from memory is enough. No Redis (that's Stage 8, needed only with 2+ instances). |
| Render free tier sleeps after ~15 min idle; deploys send `SIGTERM` | The client must reconnect and **resync** (§4.4); the server closes with `1001` on shutdown (Stage 5f). |
| Lists are server-paginated and server-searched (`paginatedRecipes`, `search` in `recipesSlice`) | The client can't safely patch a page locally (sort, filters, page boundaries). Events are **thin** and the client **refetches** (§2). |
| The client already has `sonner` mounted (`StyledToaster`) | Toasts come for free. |
| Login is a Google OAuth popup that dispatches `setUserData`; `fetchUser` on load; `signOut` thunk | These are the auth actions the listener middleware reacts to (Stage 7d). |

---

## 2. Events

One envelope, server → client only:

```ts
type CookbookEvent = {
  type: 'recipe.created' | 'recipe.updated' | 'recipe.deleted' | 'category.created' | 'category.updated' | 'category.deleted';
  id: string;        // the recipe/category id (already renamed for the client, like the REST responses)
  title: string;     // for the toast: "Anna updated “Borscht”"
  actor: { id: string; name: string };
  at: string;        // ISO time of the write
};
```

**Thin events (ids, not documents).** The event says _what changed_, and the client refetches what it is showing. Reasons:

- the lists are paginated and searched on the server, so a full document can't be inserted into "page 2 of the search for soup" correctly;
- recipes carry images and long text; pushing whole documents to every client wastes bandwidth for screens that don't show them;
- the REST endpoints stay the single source of truth (one serialization, one access check).

The cost is one extra GET after an event, which for two users is nothing.

**No history, no ids for resume.** Stage 4's `__resume__` replay made sense for a chat (every message matters). Here, after a reconnect, the client just refetches its current screen: state, not a log. Simpler, and correct even after the server slept.

**The actor gets the event too.** The server broadcasts to everyone; the client skips the toast when `actor.id` is the current user (its own screen is already updated by the HTTP response).

---

## 3. Server (`dual-cookbook-server`)

### 3.1 Files

| File | What |
| --- | --- |
| `src/realtime/realtimeServer.ts` (new) | `attachRealtime(server)`: a `WebSocketServer({ noServer: true })`, the `upgrade` handler (path, Origin, session), the clients `Map<WebSocket, { userId, isAlive }>`, heartbeat, `closeAll()` for shutdown. |
| `src/realtime/publish.ts` (new) | `publish(event: CookbookEvent)`: loop over open clients, `socket.send(JSON.stringify(event))` (Stage 5b's broadcast). |
| `src/realtime/events.ts` (new) | The `CookbookEvent` type. |
| `src/index.ts` | `const server = http.createServer(app); attachRealtime(server); server.listen(port)`, plus a `SIGTERM` handler: stop accepting, close sockets with `1001`, exit (Stage 5f). |
| `src/controllers/recipeController.ts`, `categoryController.ts` | One `publish(...)` line in `create*`, `update*`, `delete*`, **after** the DB write succeeded and right before the response. |
| `src/config/corsOrigins.ts` | Reused as is for the Origin allowlist. |

### 3.2 The handshake (Stages 6c, 6e)

```ts
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return reject(socket, 404);

  // SameSite=None in production: without this check, any site could open the socket with the user's cookie.
  if (!allowlist.includes(req.headers.origin ?? '')) return reject(socket, 403);

  const userId = readUserIdFromSessionCookie(req); // null if missing or the signature doesn't match
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!userId) return ws.close(4401, 'unauthorized'); // accept-then-close, so the client can tell "log in" from "down"
    registerClient(ws, userId);
  });
});
```

`readUserIdFromSessionCookie` does what `cookie-session` does on every request: read the `session` cookie, check `session.sig` with the same `COOKIE_KEY` (the `cookies` + `keygrip` packages that `cookie-session` itself uses), base64-decode the JSON, take `passport.user`. Then `User.findById` once, for the actor's name and to make sure the user still exists (and is still in `allowedEmails`).

**Revocation** (Stage 6g–6h): with `cookie-session` there's no server-side session to delete, so "logout" only clears the cookie in that browser. The socket keeps running until it closes. Good enough here: the socket is read-only, and it only ever carries what the user could GET anyway (recipes and categories are public reads). If that changed, the client's `signOut` → `disconnectRequested` (§4) already closes it on the logging-out tab.

### 3.3 Heartbeat and hosting

- Protocol pings from the server every **30 s**, terminate clients that missed one (Stage 5d). This also keeps Render's proxy from closing idle connections.
- `maxPayload` small (a few KiB) and ignore everything a client sends except pings: there are no client messages (Stage 6f, cheap insurance).
- Log connects/disconnects with the user id, not the cookie.

---

## 4. Client (`dual-cookbook-client`)

The Stage 7 architecture, almost one-to-one.

### 4.1 Files

| File | From this sandbox | Changes |
| --- | --- | --- |
| `src/store/middleware/realtimeMiddleware.ts` | `socketMiddleware.ts` (7c) | Keep: connect/disconnect commands, backoff + jitter, heartbeat answer, offline/visibility handling, 4401 → `fetchUser`. Drop: outbox, `lastSeenId`/resume, `send`, client ids (the socket is receive-only). Parse frames with a Zod schema of `CookbookEvent`, dispatch `realtime/eventReceived(event)`. |
| `src/store/slices/realtimeSlice.ts` | `chatSlice.ts` (7b) | Only `status` (for a small "live" dot in the header) and `connectRequested` / `disconnectRequested` / `statusChanged` / `eventReceived`. No message list. |
| `src/store/middleware/realtimeListeners.ts` | `authListenerMiddleware.ts` (7d) | Auth → socket: `setUserData` and `fetchUser.fulfilled` with a user → `connectRequested(WS_URL)`; `signOut.fulfilled` → `disconnectRequested()`. Events → refetch + toast (§4.2). Reconnect → resync (§4.4). |
| `src/api/constants.ts` | `SERVER_URL` (6a) | `WS_URL` derived from `API_URL` (`https` → `wss`, path `/ws`). |
| `src/store/store.ts` | 7c/7d | `getDefaultMiddleware().prepend(realtimeListeners.middleware).concat(realtimeMiddleware)` in both `configureStore` calls (the cookbook's `store` currently repeats the reducers instead of using `rootReducer`; worth fixing first). |

### 4.2 What an event does

One listener on `eventReceived`; it reads the current state to decide what to refetch, so only visible data is reloaded:

| Event | If the user is looking at… | Then |
| --- | --- | --- |
| `recipe.created` / `updated` / `deleted` | the recipes list | `fetchRecipes` with the current page/pagination |
| | search results (`search.wasSearchInitiated`) | `searchRecipes` with `search.query` |
| `recipe.updated` | that recipe's details (`recipeDetails.recipeData.id === event.id`) | `fetchRecipeDetails(event.id)` |
| `recipe.deleted` | that recipe's details | a toast "Anna deleted this recipe" and navigate to the list |
| `recipe.updated` | that recipe's **edit form** | do **not** reload the form (it would wipe the user's typing); a sticky toast "Anna changed this recipe while you were editing" |
| `category.*` | anything | `fetchAllCategories` (small list, used in filters and forms); the categories page refetches its page |
| any, from someone else | | `toast.info(\`${actor.name} updated “${title}”\`)` |

"What is the user looking at" comes from the slices (what's loaded) plus the current route (the listener can't use `useLocation`; keep the route in a tiny `uiSlice`, or read `window.location.pathname`).

### 4.3 Thunks stay as they are

Events dispatch the **existing** thunks (`fetchRecipes`, `searchRecipes`, `fetchRecipeDetails`, `fetchAllCategories`), so loading flags, error handling and serialization are shared with normal navigation. No new reducers for recipe data. Rapid events (an import creating ten recipes) are debounced in the listener: `listenerApi.cancelActiveListeners(); await listenerApi.delay(300);` before refetching, so ten events cause one refetch.

### 4.4 Resync after a reconnect

Every `statusChanged('open')` that follows a `'closed'` (not the first connect) runs the same refetch as an event for the current screen, without a toast. That covers missed events while the laptop slept, the Render instance woke up, or a deploy restarted the server.

---

## 5. Checking it on Render

1. Two browsers (or one normal + one private window), two accounts, the production URLs.
2. Network → WS: the handshake goes to `wss://dual-cookbook-server.onrender.com/ws`, `101`, the request carries the `session` cookie and the Vercel `Origin`.
3. Create / edit / delete in one window: the other one updates and toasts; the actor's window doesn't toast.
4. A third origin (a local file opening `new WebSocket(...)`) gets `403`.
5. Leave it idle for 20 minutes (the free tier sleeps), then edit from the other window: the sleeping side reconnects (backoff), resyncs, and shows the change.
6. Redeploy the server while both are open: both see `1001`, reconnect, resync.
7. Safari / strict third-party cookie settings: if the cookie isn't sent cross-site, the socket gets `4401` (same failure as the existing REST calls; the long-term fix for both is serving the API from a subdomain of the client's domain, which makes the cookie first-party).

---

## 6. Deliberately left out

| Not doing | Because | When it would be needed |
| --- | --- | --- |
| Redis pub/sub | one instance | 2+ server instances (Stage 8) |
| Socket.IO | plain `ws` + the Stage 7 middleware already cover reconnect, heartbeat and typed events | if rooms, acks and fallbacks were needed by many features |
| Event history / replay | the client resyncs state instead | if events were the data (a chat, an activity feed) |
| Client → server messages, optimistic UI over the socket | writes stay HTTP | collaborative editing |
| Server-Sent Events instead of WebSockets | would actually fit (server → client only) and survives proxies more easily; WebSockets chosen to reuse this sandbox's code | worth it if the socket stays receive-only forever |
