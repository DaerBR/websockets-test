# Stage 7: The socket in Redux

So far the app state lives in two small module stores read with `useSyncExternalStore`: `src/old-auth/authStore.ts` (who's logged in) and `src/socket/chatStore.ts` (the socket, its status and the messages). In this stage it moves into **Redux Toolkit, the way dual-cookbook does it**:

- **slices** in `src/store/slices/` (state + reducers),
- **thunks** in `src/store/thunks/` (`createAsyncThunk`, HTTP through `apiRequest`),
- components read with `useAppSelector` and act with `useAppDispatch`.

The new part, which the cookbook doesn't have: a **socket** is a long-lived thing that produces events on its own, at any time. Where does it live in Redux? That's 7c.

This stage is mostly frontend, so you write the code (Claude reviews). The one server change is in 7e (message ids for confirm/reject), which Claude implements after you read §5.

| Step | Idea                                                                                 | Status |
| ---- | ------------------------------------------------------------------------------------ | ------ |
| 7a   | Auth the cookbook way: `authSlice` + thunks replace `authStore`                      | ✅     |
| 7b   | Chat state in a slice: status and messages, read with `useAppSelector`               | ✅     |
| 7c   | A middleware owns the socket: socket events become actions, actions drive the socket | ✅     |
| 7d   | Login/logout drive connect/disconnect inside Redux                                    | ✅     |
| 7e   | Optimistic updates confirmed or reverted by the server                               | ✅     |
| 7f   | Compare the three versions, then remove `/chat`                                       | ✅     |

---

## §1. Auth the cookbook way (7a)

### What maps to what

You built `authStore` by hand in 6b. Every piece of it has a Redux Toolkit counterpart:

| `src/old-auth/authStore.ts` (now)                   | Redux Toolkit (7a)                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `let auth = { isUserFetched, role, user }`              | `initialState` in `src/store/slices/authSlice.ts`                                                |
| `setAuth({ ... })` + `listeners.forEach(...)`           | reducers; Redux notifies subscribers itself                                                      |
| `loadUser()`, `signIn()`, `signOut()` (async functions) | thunks in `src/store/thunks/auth.ts`, made with `createAsyncThunk`                               |
| the `try/catch` inside `loadUser`                       | `fetchUser.rejected` in the slice's `extraReducers`                                             |
| `useAuth()` (`useSyncExternalStore`)                    | `useAppSelector((state) => state.auth)`                                                          |
| `authStore.subscribe(...)` in `main.tsx`                | `store.subscribe(...)`: the same idea, Redux's own (temporary; 7d replaces it)                    |

So nothing new conceptually. What you gain:

- **Redux DevTools** (the browser extension): every login, logout and fetch shows up as actions on a timeline (`auth/fetchUser/pending`, `auth/fetchUser/fulfilled`, ...), with the state before and after. When the socket joins in 7b–7c, you'll see socket events on the same timeline.
- One store and one pattern for the whole app, like the cookbook.
- The "Store does not have a valid reducer" warning from Stage 4 goes away.

### `createAsyncThunk`, in one paragraph

`createAsyncThunk('auth/signIn', async (args, { rejectWithValue }) => { ... })` gives you a function you `dispatch`. It dispatches `auth/signIn/pending` first, runs your async function, then dispatches `auth/signIn/fulfilled` with what you returned, or `auth/signIn/rejected` if it threw or returned `rejectWithValue(...)`. The slice reacts to those three in `extraReducers`. The cookbook does exactly this in `store/thunks/auth.ts` + `store/slices/authSlice.ts`.

Two typing notes compared to the cookbook (which uses `createAsyncThunk<any, any>`):

- Give the generics real types: `createAsyncThunk<Returned, Args, { rejectValue: ... }>`. Then the slice knows what `action.payload` is, and components know what the thunk takes.
- `rejectWithValue(...)` passes the **server's error** to the caller (the cookbook passes `response.data` as is). Our server answers a wrong password with `{ "error": "Wrong name or password" }`, so the login form can show the server's own text (see `useThunk` below for the exact shape).

### Calling it from a component: `useThunk`, like the cookbook

`src/store/hooks/useThunk.ts` (the same template hook as in the cookbook) wraps a thunk for components:

```ts
const [dispatchSignIn, signInError] = useThunk(signIn);

await dispatchSignIn({ name, password });
```

- It dispatches the thunk and calls `.unwrap()` for you. `.unwrap()` turns the thunk's result back into a normal promise that **throws** the `rejected` payload (a plain `await dispatch(...)` never throws: it resolves with the `rejected` action).
- It catches that error and returns it as **state**: `signInError` is the `rejectWithValue` payload after a failed call, `null` before. That's the inline error for the login form.
- Optional extras through its options: `successMessage`, `successRedirectRoute`, `useGlobalLoader`. It also calls `toast.error(...)` on failure; with no `<Toaster />` mounted in this app that's simply invisible, and it's harmless.
- Its toast text comes from `getErrorText`, which reads the error's **`message`** field. Our server's body is `{ "error": "..." }`, so the thunk maps it: `rejectWithValue({ message: data?.error ?? 'Login failed, try again' })`. Then both the toast (if you ever mount one) and the form read the same field.

### The one non-component caller: `chatStore.ts`

On a `4401` close, `chatStore.ts` calls `loadUser()`. It isn't a component, so it can't use hooks; it imports the store and dispatches directly: `store.dispatch(fetchUser())`. That's a stopgap: in 7c the socket moves into a middleware, which gets `dispatch` handed to it.

### Your task

1. **`src/store/slices/authSlice.ts`**
   - State: `{ isLoading: boolean; isUserFetched: boolean; userData: { name: string; role: 'admin' | 'user' } | null }` (close to the cookbook's `isLoading` / `areUserDataFetched` / `userData`).
   - `extraReducers` for the three thunks from step 2:
     - `fetchUser`: `pending` → `isLoading = true`; `fulfilled` → `userData` = the payload (or `null` when the server says `name: null`), `isUserFetched = true`, `isLoading = false`; `rejected` → `userData = null`, `isUserFetched = true`, `isLoading = false` (same "treat as logged out" as `loadUser`'s `catch`).
     - `signIn.fulfilled` → `userData` = the payload.
     - `signOut.fulfilled` → `userData = null`.
   - Export `authReducer = authSlice.reducer`.
2. **`src/store/thunks/auth.ts`** with three thunks. Either call `src/api/old-auth.ts` (keeps its Zod validation; import it as a namespace, `import * as authApi from '../../api/old-auth.ts'`, because its functions are also called `fetchUser`/`login`/`logout`), or call `apiRequest` directly like the cookbook.
   - `fetchUser`: no args; returns `authApi.fetchUser()`'s `{ name, role }`.
   - `signIn`: args `{ name: string; password: string }`; returns `authApi.login(...)`'s `{ name, role }`; on error `rejectWithValue({ message: (error as AxiosError<{ error?: string }>).response?.data?.error ?? 'Login failed, try again' })`.
   - `signOut`: no args; calls `authApi.logout()`.
3. **`src/store/store.ts`**: add `auth: authReducer` to **both** `configureStore` calls (`setupStore` and `store`).
4. **`src/components/UserBar/UserBar.tsx`**, like the cookbook's `Header`:
   - Read `useAppSelector((state) => state.auth)` instead of `useAuth()`.
   - `const [dispatchFetchUser] = useThunk(fetchUser);` and in an effect: `if (!isUserFetched) dispatchFetchUser();`.
   - `const [dispatchSignOut] = useThunk(signOut);` for the **Log out** button.
5. **`src/components/UserBar/LoginForm.tsx`**
   - `const [dispatchSignIn, signInError] = useThunk(signIn);`
   - Submitting: `await dispatchSignIn({ name, password })` (keep `isSubmitting` around it; the `try/catch` goes away, `useThunk` catches).
   - Show `signInError`'s `message` under the form when it's set (it's typed as a union of two error shapes, so narrow it with `'message' in signInError`).
6. **`src/pages/SharedChat/SharedChat.tsx`**: the user for "own message" styling comes from `useAppSelector((state) => state.auth.userData?.name)`.
7. **`src/main.tsx`**
   - Remove `loadUser()` (the `UserBar` fetches now).
   - Replace `authStore.subscribe(...)` with `store.subscribe(() => { ... })`, reading `store.getState().auth.userData`. Same body: a user → `connect(SERVER_URL)`, none → `disconnect()`.
8. **`src/socket/chatStore.ts`**: in the `4401` branch, replace `loadUser()` with `store.dispatch(fetchUser())`.
9. Keep `src/old-auth/` (`authStore.ts`, `hooks.ts`) as an example of the hand-made external store; nothing imports it any more.
10. Run `npx tsc -b` and `npx eslint src`.

Don't forget: `store.subscribe` fires on **every** action, not only auth ones. In 7a that happens to be harmless (only auth actions exist yet), but it breaks in 7b: once the socket's `close` listener dispatches `chat/statusChanged`, the subscriber runs in the middle of the close handler, sees a user, and calls `connect()` at once, bypassing the backoff, the **Disconnect** button and the "don't retry" codes. So react only when `userData` actually **changes** (Redux state is immutable, so comparing references is enough):

```ts
let previousUserData = store.getState().auth.userData;

store.subscribe(() => {
  const { userData } = store.getState().auth;

  // Not an auth change (e.g. chat/statusChanged): leave the socket alone.
  if (userData === previousUserData) {
    return;
  }

  previousUserData = userData;

  if (userData) {
    connect(SERVER_URL);
  } else {
    disconnect();
  }
});
```

7d replaces this with listener middleware that reacts only to the actions it cares about.

---

## §2. Chat state in a slice (7b)

### What goes into Redux, and what stays out

`chatStore.ts` holds a lot of module variables. Only two of them are things the **UI renders**:

| Variable in `chatStore.ts`                                                                         | Rendered? | 7b                     |
| -------------------------------------------------------------------------------------------------- | --------- | ---------------------- |
| `status`                                                                                           | yes (badge, `SharedChat`) | → `chatSlice`          |
| `messages`                                                                                         | yes (`SharedChat`)        | → `chatSlice`          |
| `socket`, `heartbeatTimer`, `pongTimer`, `reconnectTimer`                                          | no        | stay in `chatStore.ts` |
| `outbox`, `lastSeenId`, `reconnectAttempt`, `shouldReconnect`, `serverUrl`                         | no        | stay in `chatStore.ts` |

Two rules decide it:

- **Redux state must be serializable**: plain objects, arrays, strings, numbers, booleans. A `WebSocket` or a timer id isn't: you can't JSON it, DevTools can't show it, and "time travel" in DevTools can't recreate it. RTK's default middleware even checks this: put a `WebSocket` into state or an action and the console prints `A non-serializable value was detected...`. That's why the **socket itself never goes into a slice**; in 7c it moves into a middleware, which lives next to the store, not inside it.
- **Only what the UI needs.** `lastSeenId` and the outbox are protocol bookkeeping: no component reads them. Putting them in the slice would just fill DevTools with noise (`lastSeenIdChanged` on every message).

That's also why `receivedAt` is a number (`Date.now()`), not a `Date` object: numbers serialize, `Date`s don't.

### Reducers in the slice, not only `extraReducers`

`authSlice` only had `extraReducers`: its changes all come from thunks. Chat changes come from **socket events**, which aren't thunks, so `chatSlice` gets ordinary `reducers`. Each one becomes an action creator:

```ts
interface ChatState {
  status: Status; // 'connecting' | 'open' | 'closed', from src/hooks/useWebSocket.ts
  messages: SharedChatMessage[]; // chat and system messages, oldest first
}

const initialState: ChatState = {
  status: 'closed', // same as `let status: Status = 'closed'` in chatStore.ts: no socket yet
  messages: [],
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    statusChanged(state, action: PayloadAction<Status>) {
      state.status = action.payload;
    },
    messageReceived(state, action: PayloadAction<SharedChatMessage>) {
      state.messages.push(action.payload); // Immer: "mutating" here produces a new array
    },
  },
});

export const { statusChanged, messageReceived } = chatSlice.actions;
```

`store.dispatch(statusChanged('open'))` dispatches `{ type: 'chat/statusChanged', payload: 'open' }`.

With `chat: chatReducer` registered next to `auth`, the whole store (what Redux DevTools' **State** tab shows) looks like this:

```ts
{
  auth: { isLoading: false, isUserFetched: true, userData: { name: 'Gena', role: 'user' } },
  chat: {
    status: 'open',
    messages: [
      { kind: 'system', text: 'Connected: #2 Gena (you, 5s)', receivedAt: 1762160000000 },
      { kind: 'chat', author: 'Gena', text: 'hi', receivedAt: 1762160003000 },
    ],
  },
}
```

**Naming:** `statusChanged` / `messageReceived` describe **what happened** (past tense), not `setStatus` / `addMessage` (an order). That's the Redux style guide's advice, and it pays off in 7c: socket events _are_ things that happened, and in DevTools `chat/messageReceived` reads like a log of the connection.

### Who dispatches

`chatStore.ts` already imports `store` (the 7a stopgap for `fetchUser`). Its two private helpers keep their names and call sites; only their bodies change:

```ts
const setStatus = (next: Status) => {
  store.dispatch(statusChanged(next));
};
```

So the module's own `status`, `messages`, `listeners`, `notify`, `subscribe`, `statusStore` and `messagesStore` all go away: Redux now does the storing and the notifying. Components switch from `useSyncExternalStore` to `useAppSelector`, which uses `useSyncExternalStore` under the hood: the same mechanism you built by hand.

### Your task

1. **`src/store/slices/chatSlice.ts`**
   - Move the `SharedChatMessage` type here from `chatStore.ts` and export it. (If the slice imported it from `chatStore.ts`, you'd get an import cycle: `store` → `chatSlice` → `chatStore` → `store`.)
   - State: `{ status: Status; messages: SharedChatMessage[] }`, initially `'closed'` and `[]`. `Status` comes from `src/hooks/useWebSocket.ts` (`import type`).
   - Reducers `statusChanged` and `messageReceived` as above (type the action with `PayloadAction<...>` from `@reduxjs/toolkit`).
   - Export the two actions and `chatReducer = chatSlice.reducer`.
2. **`src/store/store.ts`**: add `chat: chatReducer` next to `auth`.
3. **`src/socket/chatStore.ts`**
   - `setStatus` → `store.dispatch(statusChanged(next))`; `addMessage` → `store.dispatch(messageReceived(message))`.
   - Delete `status`, `messages`, `listeners`, `notify`, `subscribe`, `statusStore`, `messagesStore`, and the `SharedChatMessage` type (import it from the slice where it's still needed).
4. **`src/components/atoms/ChatStatusBadge/ChatStatusBadge.tsx`**: `useAppSelector((state) => state.chat.status)` instead of `useChatStatus()`.
5. **`src/pages/SharedChat/SharedChat.tsx`**: `useAppSelector((state) => state.chat.status)` and `useAppSelector((state) => state.chat.messages)` instead of the two hooks.
6. Delete `src/socket/hooks.ts` (nothing uses it now). If you'd rather keep it as an example like `old-auth`, it won't compile anymore (`statusStore` is gone), so keeping the pre-7b `chatStore.ts` in git history is the simpler "example".
7. Run `npx tsc -b` and `npx eslint src`.

### Check

1. Log in. **Redux DevTools**: `chat/statusChanged` with payload `'connecting'`, then `'open'`. The badge and `/shared-chat` show the same status as before.
2. Send a message from a second tab. DevTools: `chat/messageReceived` with `{ kind: 'chat', author, text, receivedAt }`; the **State** tab shows it in `chat.messages`.
3. `/who`: a `chat/messageReceived` with `kind: 'system'`.
4. Wait 10 s: the heartbeat ping/pong shows in **Network → Socket → Messages** but **not** in Redux DevTools (it never touched rendered state).
5. Log out: `chat/statusChanged` → `'closed'`, after `auth/signOut/fulfilled`.
6. Stop the server: `statusChanged` `'closed'` → `'connecting'` → `'closed'`... as the reconnects run, each one visible on the DevTools timeline.

---

## §3. A middleware owns the socket (7c)

### What's still wrong after 7b

`chatStore.ts` works, but it's a module **outside** Redux that reaches **into** it:

- It imports the `store` singleton (`store.dispatch(...)`). So the socket code is tied to that one store: `setupStore()` (the template's store for tests) would get chat state but no socket, and the import creates a cycle (`store` → … → `chatStore` → `store`) that only works because of load order.
- Components and `main.tsx` call `connect()` / `disconnect()` / `send()` directly. Those calls are invisible in Redux DevTools: you see the _results_ (`statusChanged`) but not what caused them.

The Redux answer to "a long-lived thing that does side effects" is **middleware**.

### Middleware, in one picture

Every `dispatch(action)` passes through the middleware chain before it reaches the reducers:

```
dispatch(action) → thunk middleware → socketMiddleware → ... → reducers → new state
```

A middleware is three nested functions:

```ts
export const socketMiddleware: Middleware = (api) => {
  // 1. Runs ONCE, when the store is created. Long-lived things live here:
  //    the socket, timers, outbox, lastSeenId... (all of chatStore.ts's `let`s).

  return (next) => (action) => {
    // 2. Runs for EVERY dispatched action.
    // Pass it on to the reducers first.
    const result = next(action);

    if (connectRequested.match(action)) {
      // 3. React to the actions it owns.
      connect(action.payload);
    }

    return result;
  };
};
```

- `api` gives the middleware `dispatch` and `getState`, so it no longer needs to import `store`. That's the stopgap from 7a gone.
- The outer function runs once **per store**, so `setupStore()` gets its own socket state too.
- You've used a middleware since Stage 4 without writing one: `createAsyncThunk` works because RTK's default **thunk** middleware lets you dispatch functions.

So the traffic goes both ways, all through actions:

| Direction       | Actions                                                         | Who dispatches                      |
| --------------- | --------------------------------------------------------------- | ----------------------------------- |
| UI → socket     | `connectRequested(url)`, `disconnectRequested()`, `sendRequested(text)` | components, `main.tsx`              |
| socket → UI     | `statusChanged(status)`, `messageReceived(message)` (from 7b)   | the middleware, from socket events  |

### Commands without state: `createAction`

`connectRequested` and friends change **no state** in the slice; only the middleware acts on them. So they aren't `reducers`; they're plain action creators made with `createAction`:

```ts
export const connectRequested = createAction<string>('chat/connectRequested');
export const disconnectRequested = createAction('chat/disconnectRequested');
export const sendRequested = createAction<string>('chat/sendRequested');
```

`connectRequested.match(action)` is a type guard: inside the `if`, TS knows `action.payload` is a `string`. (In RTK 2 a middleware receives `action` as `unknown`, so you need `.match` before touching `payload`.)

Names: still events in the past tense, "connect was **requested**". Whether it actually connects is the middleware's business (it may already be connected).

### Why `next(action)` first

Calling `next(action)` before `connect(...)` makes the timeline read in cause → effect order:

```
chat/connectRequested
chat/statusChanged   'connecting'
chat/statusChanged   'open'
```

If you called `connect` first, `statusChanged('connecting')` would be dispatched (from inside `connect`) before `connectRequested` even reaches DevTools.

### Typing `api.dispatch` for the thunk

`api.dispatch` is typed as a plain `Dispatch`, which doesn't accept thunks, so `api.dispatch(fetchUser())` is a type error. Cast it once at the top:

```ts
// import type { AppDispatch } from '../store';
const dispatch = api.dispatch as AppDispatch;
```

`store.ts` imports the middleware and the middleware imports a **type** from `store.ts`. That's fine because `socketMiddleware` has an explicit `Middleware` annotation: TS doesn't have to infer one from the other. (RTK's docs warn about `Middleware<{}, RootState>` creating circular type errors; the plain `Middleware` + cast avoids that.)

### Your task

1. **`src/store/slices/chatSlice.ts`**: add the three `createAction` commands above (export them). `createAction` is imported from `@reduxjs/toolkit` like `createSlice`.
2. **Move `chatStore.ts` into a middleware.** Create `src/middleware/socketMiddleware.ts` from `src/socket/chatStore.ts` (the socket code moves out of `chatStore.ts`), then reshape it:
   - **Top level, unchanged:** the imports, the `*_MS` / `MAX_*` constants, the Zod schemas, `parseServerEvent` (pure: no socket state).
   - **Inside** `export const socketMiddleware: Middleware = (api) => { ... }`: every `let` (`socket`, `serverUrl`, the timers, `outbox`, `lastSeenId`, `reconnectAttempt`, `shouldReconnect`), all the functions that use them (`flushOutbox`, the heartbeat ones, `setStatus`, `addMessage`, the reconnect ones, `connect`, `disconnect`, `handleOffline`, `reconnectNow`, `handleVisibilityChange`, `send`), and the three `window`/`document` `addEventListener` calls.
   - First line inside: `const dispatch = api.dispatch as AppDispatch;`. Replace every `store.dispatch(` with `dispatch(` and remove the `import { store }`.
   - `connect`, `disconnect` and `send` lose their `export`: nothing outside calls them now.
   - At the end of the outer function, return the handler:
     ```ts
     return (next) => (action) => {
       const result = next(action);

       if (connectRequested.match(action)) {
         connect(action.payload);
       } else if (disconnectRequested.match(action)) {
         disconnect();
       } else if (sendRequested.match(action)) {
         send(action.payload);
       }

       return result;
     };
     ```
3. **`src/store/store.ts`**: register it in **both** `configureStore` calls:
   ```ts
   middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(socketMiddleware),
   ```
   `getDefaultMiddleware()` keeps the thunk (and the serializability check from 7b); `.concat` adds yours after them.
4. **`src/main.tsx`**: in the subscriber, `store.dispatch(connectRequested(SERVER_URL))` / `store.dispatch(disconnectRequested())` instead of `connect` / `disconnect`. (Keep the `previousUserData` check. 7d replaces this whole subscriber.)
5. **`src/pages/SharedChat/SharedChat.tsx`**: `const dispatch = useAppDispatch();`, then:
   - Connect: `dispatch(connectRequested(SERVER_URL))`
   - Disconnect: `dispatch(disconnectRequested())`
   - Send: `dispatch(sendRequested(trimmedMessageDraft))`
6. Keep the hand-made version as an example: `src/socket/oldChatStore.ts` is the Stage 6 `chatStore.ts` (from git, importing `src/old-auth/`); nothing imports it, so its `window` listeners never run. (`src/socket/roomChatStore.ts` stays: it's the Stage 3 `/rooms` reference, nothing to do with this.)
7. Run `npx tsc -b` and `npx eslint src`.

### Check

Everything should behave exactly as after 7b. What's new is on the Redux DevTools timeline:

1. **Log in:** `auth/signIn/fulfilled` → `chat/connectRequested` (payload: the `/ws` URL) → `chat/statusChanged` `'connecting'` → `'open'`.
2. **Send "hi":** `chat/sendRequested` `'hi'`, then the echo `chat/messageReceived`. Network → Socket → Messages shows the outgoing `hi` frame between them.
3. **Disconnect button:** `chat/disconnectRequested` → `chat/statusChanged` `'closed'`, and no reconnect. **Connect** button: `chat/connectRequested` → `'connecting'` → `'open'`.
4. **Offline send:** DevTools → Network → **Offline**, send "queued" (`chat/sendRequested` appears, the console says `Queued "queued"`), back **Online**: it reconnects and the message arrives (outbox still works).
5. **Stop the server:** the backoff delays grow as before (the `previousUserData` fix still holds), status `'closed'` between tries.
6. **`/kick <name>`** from an `Admin` tab, and **log out**: same as in 6g/6h (a system message / `'closed'`, no reconnect).

---

## §4. Login/logout drive connect/disconnect inside Redux (7d)

### What's left outside

One piece still lives outside Redux, in `main.tsx`:

```ts
let previousUserData = store.getState().auth.userData;

store.subscribe(() => {
  const { userData } = store.getState().auth;
  // ...compare with previousUserData, then connect or disconnect
});
```

`store.subscribe` is the lowest-level hook Redux has. Its callback gets **no action**, only "something changed", so it has to:

- run after **every** action (each `chat/statusChanged`, each `messageReceived`...),
- keep its own `previousUserData` to work out whether the thing it cares about changed,
- remember to skip the irrelevant cases, or you get the 7b reconnect loop.

What we actually mean is simpler: **"when a login succeeds, connect; when a logout succeeds, disconnect."** That's a reaction to specific **actions**, not to state.

### Listener middleware

RTK ships a middleware for exactly that: `createListenerMiddleware`. You register "when _this action_ happens, run _this effect_":

```ts
export const authListenerMiddleware = createListenerMiddleware();

authListenerMiddleware.startListening({
  actionCreator: signIn.fulfilled,
  effect: (_action, listenerApi) => {
    listenerApi.dispatch(connectRequested(SERVER_URL));
  },
});
```

- `actionCreator: signIn.fulfilled` says which action to react to. To react to several, use `matcher: isAnyOf(a, b)`.
- `effect` runs **after** the action has reached the reducers, so the state is already updated. `listenerApi` has `dispatch` and `getState` (plus async helpers like `delay` and `take` that we don't need here).
- It's a middleware like the `socketMiddleware` you wrote in 7c, just a generic one: a list of "on action X do Y" rules instead of hand-written `if (x.match(action))` checks.

Compare it to the 7c socket middleware: there, `connectRequested` is the **cause** and the socket is the effect. Here `signIn.fulfilled` is the cause and `connectRequested` is the effect. The DevTools timeline shows the whole chain:

```
auth/signIn/fulfilled → chat/connectRequested → chat/statusChanged 'connecting' → 'open'
```

### Which actions mean what

| Action                                    | Means                               | Effect                    |
| ----------------------------------------- | ----------------------------------- | ------------------------- |
| `signIn.fulfilled`                        | logged in                           | `connectRequested`        |
| `fetchUser.fulfilled` with a user         | page loaded with a valid session    | `connectRequested`        |
| `fetchUser.fulfilled` with `null`         | page loaded, nobody logged in; or the 4401 re-check found the session gone | `disconnectRequested` |
| `signOut.fulfilled`, `fetchUser.rejected` | logged out / couldn't tell          | `disconnectRequested`     |

`fetchUser.fulfilled` needs its own listener because the effect depends on its `payload`. (A `matcher: isAnyOf(signIn.fulfilled, fetchUser.fulfilled)` would cover both, but `startListening` doesn't type `action.payload` through `isAnyOf` (it comes out as a plain `Action`), so keep the payload-reading listener on `actionCreator`.) The last row has no payload to read, so `isAnyOf` is fine there.

`disconnectRequested` when nothing is connected is harmless: `disconnect()` just resets the flags (6c).

### Why this can't loop like 7b did

The listeners only react to **auth** actions. `chat/statusChanged` from a closing socket matches none of them, so a server outage just runs the socket middleware's backoff, with nothing else calling `connect` in between. The `previousUserData` bookkeeping disappears because there's nothing to diff: the action itself says what happened.

### Your task

1. **`src/middleware/authListenerMiddleware.ts`**
   - `export const authListenerMiddleware = createListenerMiddleware();` (`createListenerMiddleware` and `isAnyOf` come from `@reduxjs/toolkit`).
   - Three `startListening` calls, one per row group of the table:
     - `actionCreator: signIn.fulfilled` → `listenerApi.dispatch(connectRequested(SERVER_URL))`.
     - `actionCreator: fetchUser.fulfilled` → `action.payload` ? `connectRequested(SERVER_URL)` : `disconnectRequested()`.
     - `matcher: isAnyOf(signOut.fulfilled, fetchUser.rejected)` → `disconnectRequested()`.
   - Imports: `SERVER_URL` from `src/api/constants.ts`, the two commands from `chatSlice.ts`, the three thunks from `store/thunks/auth.ts`.
2. **`src/store/store.ts`**, in **both** `configureStore` calls:
   ```ts
   middleware: (getDefaultMiddleware) =>
     getDefaultMiddleware().prepend(authListenerMiddleware.middleware).concat(socketMiddleware),
   ```
   Note `.middleware`: the listener object also has `startListening` etc.; only its `.middleware` goes into the chain. RTK's docs put it first with `prepend`.
3. **`src/main.tsx`**: delete `previousUserData`, the whole `store.subscribe(...)` block, and the imports it used (`SERVER_URL`, `connectRequested`, `disconnectRequested`). `main.tsx` is back to just rendering.
4. Run `npx tsc -b` and `npx eslint src`.

### Check

1. **Reload while logged in:** `api/fetchUser/fulfilled` (payload: your user) → `chat/connectRequested` → `'connecting'` → `'open'`.
2. **Log out:** `auth/signOut/fulfilled` → `chat/disconnectRequested` → `chat/statusChanged` `'closed'`.
3. **Reload while logged out:** `api/fetchUser/fulfilled` with payload `null` → `chat/disconnectRequested`, and **no** connection in Network → WS.
4. **Wrong password:** `auth/signIn/rejected`, and no `chat/*` action after it.
5. **Log in:** `auth/signIn/fulfilled` → `chat/connectRequested` → `'open'`.
6. **Stop the server:** backoff delays grow, status `'closed'` between tries; none of the `statusChanged` actions is followed by a `connectRequested` (the 7b loop can't come back).
7. **Restart the server** (sessions are in memory, so yours is gone): the reconnect gets `4401` → `api/fetchUser/fulfilled` with `null` → `chat/disconnectRequested`, and the login form appears.

---

## §5. Optimistic updates, confirmed or rejected by the server (7e)

### The problem

Right now your own message appears only when the server's echo comes back (5b: the server broadcasts to everyone, sender included). On localhost that's instant. On a slow or flaky connection, you press **Send**, the input clears and... nothing, until the round trip finishes. If the server **rejects** it ("Slow down", "Message too long"), you get a system line that doesn't say _which_ message failed.

**Optimistic update:** show the message **immediately**, marked as pending, and let the server's answer settle it:

```
you press Send   → "hi" ⏳   (in the list at once, no server involved)
server echoes it → "hi" ✓
server rejects   → "hi" ✗  Slow down: too many messages
```

You did exactly this in Stage 3 on `/rooms` (`delivery: 'pending' | 'sent' | 'failed'`, the ⏳ ✓ ✗ icons in `Rooms.tsx`). What's new here is doing it the Redux way, and on the shared chat's server.

### Matching the answer to the message: a client id

When the echo arrives, how does the client know it's the confirmation of **this** pending "hi", and not a "hi" someone else sent, or your previous "hi"? Comparing author + text is a guess. The reliable way: the client gives each message an id **before** sending, and the server sends that id back.

- The **server's** `id` (`#1`, `#2`...) can't do this: it doesn't exist until the server has accepted the message.
- So the client makes its own: `clientId`, a random string. The server doesn't interpret it, it just echoes it.

### The protocol change (Claude implements this on the server)

Today the client sends a chat message as **plain text** (`hi`). From 7e it sends a **JSON frame** for chat messages:

```json
{ "type": "chat", "clientId": "V1StGXR8_Z5jdHi6B-myT", "text": "hi" }
```

The server:

1. **Accepts it** like any message today (rate limit, session check, length check), using `text` from the frame.
2. **Echoes the id**: the broadcast chat frame gets an optional `clientId` field. Everyone receives it; only the sender has a pending message with that id, others just ignore it. It's also stored in the history, so a `__resume__` replay after a reconnect can still confirm a message whose echo you missed.
   ```json
   { "type": "chat", "id": 42, "author": "Gena", "text": "hi", "clientId": "V1StGXR8_Z5jdHi6B-myT" }
   ```
3. **Rejects it with the id**: instead of a system line, the sender gets a new frame type:
   ```json
   { "type": "rejected", "clientId": "V1StGXR8_Z5jdHi6B-myT", "reason": "Slow down: too many messages" }
   ```
   For "too many messages" (rate limit) and "Message too long".

Plain-text frames keep working as before: **commands** (`/who`, `/kick`, `/burst`...) and the protocol strings (`__ping__`, `__resume__:`). A command isn't a chat message (it never appears in the list as yours, it gets a system answer), so it stays plain text and **isn't** optimistic.

### Reducers must be pure: `prepare`

The `clientId` is random, and the message gets a timestamp: `nanoid()` and `Date.now()`. Neither may run **inside a reducer**: a reducer must return the same result for the same state and action (that's what makes DevTools' replay and time travel work). Where do impure values come from, then?

**In the action, before it reaches the reducer.** `createSlice` lets a reducer have a `prepare` callback that builds the action's payload:

```ts
messageSent: {
  reducer(state, action: PayloadAction<{ author: string; clientId: string; sentAt: number; text: string }>) {
    state.messages.push({
      kind: 'chat',
      author: action.payload.author,
      clientId: action.payload.clientId,
      delivery: 'pending',
      receivedAt: action.payload.sentAt,
      text: action.payload.text,
    });
  },
  prepare(text: string, author: string) {
    return { payload: { author, clientId: nanoid(), sentAt: Date.now(), text } };
  },
},
```

- `dispatch(messageSent('hi', 'Gena'))` calls `prepare('hi', 'Gena')` first, so the random id and the time are **already in the action** when the reducer runs. Replaying that action in DevTools gives the same state every time.
- `nanoid` is exported by `@reduxjs/toolkit` (RTK uses it for its own request ids); no new dependency.
- The same applies to the 7b `messageReceived` calls: `receivedAt: Date.now()` is computed in the middleware, before dispatching, never in the reducer. You already had that right.

### One action, two listeners

`messageSent` is the first action that **both** a reducer and a middleware react to:

- the **reducer** adds the pending message to the list (that's the optimistic part),
- the **socket middleware** sends the JSON frame (replacing `sendRequested` for chat messages).

That's the normal Redux shape: an action is "something happened"; any number of reducers and middlewares can respond. `sendRequested` stays for commands (plain text, no list entry).

### Settling: confirmed, rejected, or lost

| Event                                                 | Action                                     | Reducer                                                                                     |
| ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| chat frame with a `clientId` you have pending         | `messageReceived` (now carrying `clientId`) | **don't push** a second copy: set the pending one's `delivery` to `'sent'`                   |
| chat frame without a match (others, old history)      | `messageReceived`                          | push, as today                                                                              |
| `rejected` frame                                      | `messageRejected({ clientId, reason })`    | that message: `delivery = 'failed'`, keep the `reason` to show it                            |
| queued in the outbox, then dropped (stale, or **Disconnect**) | `messageRejected({ clientId, reason: 'Not sent' })` | same                                                                       |

The last row: the 6c outbox already queues messages while the socket is down. A queued chat message stays **pending** (it will be sent on reconnect). Only if the outbox **drops** it (older than 30 s, or you clicked **Disconnect**) has it failed, so the middleware dispatches `messageRejected` for it.

"Reverted" here means _marked failed with the reason_, like Stage 3, rather than deleted: a message silently disappearing from the list is worse UX than an ✗ you can see.

### The send path, from the click to the frame

Where a chat message gets its `clientId` and becomes the JSON frame (line numbers as of 7e):

1. **`src/pages/SharedChat/SharedChat.tsx:46`**, `handleSend`: `dispatch(messageSent(trimmedMessageDraft, user))`. (Text starting with `/` takes the `sendRequested` branch instead: plain text, not optimistic.)
2. **`src/store/slices/chatSlice.ts:66–67`**, `messageSent.prepare`: runs first and builds the payload `{ author, clientId: nanoid(), sentAt: Date.now(), text }`. **This is where `clientId` is born.**
3. The action enters the middleware chain. In `socketMiddleware`, `next(action)` runs first, so the **reducer** (`chatSlice.ts:60`, `messageSent.reducer`) adds the message to the list with `delivery: 'pending'` (the ⏳).
4. **`src/middleware/socketMiddleware.ts:374–376`**, the handler's `messageSent.match(action)` branch: takes `clientId` and `text` from the payload and builds the frame:
   ```ts
   send(JSON.stringify({ type: 'chat', clientId, text }), clientId);
   ```
5. **`socketMiddleware.ts:339`**, `send()`: socket open → `socket.send(frame)` at once (line 341); otherwise it's queued in the outbox with its `clientId` (line 360) and sent later by `flushOutbox` (line 89), or marked failed by `markNotSent` if it's dropped.

The frame carries only `type`, `clientId` and `text`. `author` and `sentAt` stay on the client: the server takes the author from your session (6d) and doesn't need the time.

The way back: the server's echo (`chat` frame with the same `clientId`) → `messageReceived` → the pending message becomes `'sent'` (✓); a `rejected` frame → `messageRejected` → `'failed'` (✗ + reason).

### Your task (after Claude's server change)

1. **`src/store/slices/chatSlice.ts`**
   - `export type Delivery = 'pending' | 'sent' | 'failed';`
   - The `kind: 'chat'` variant of `SharedChatMessage` gets optional `clientId?: string`, `delivery?: Delivery`, `failReason?: string` (only your own messages have them).
   - `messageSent` with `reducer` + `prepare` as above (`nanoid` from `@reduxjs/toolkit`).
   - `messageReceived`: if the payload is a chat message with a `clientId` and `state.messages` has a message with that `clientId`, set its `delivery = 'sent'` and return; otherwise push as before.
   - `messageRejected(state, action: PayloadAction<{ clientId: string; reason: string }>)`: find the message by `clientId`, set `delivery = 'failed'` and `failReason = reason`.
2. **`src/middleware/socketMiddleware.ts`**
   - Schemas: `chatEventSchema` gets `clientId: z.string().optional()`; a new `rejectedEventSchema` (`type: z.literal('rejected')`, `clientId`, `reason`) joins the `discriminatedUnion`.
   - Message listener: pass `serverEvent.clientId` into `addMessage({ kind: 'chat', ... })`; a new branch for `serverEvent.type === 'rejected'` → `dispatch(messageRejected({ clientId, reason }))`.
   - Outbox entries get an optional `clientId`. `send` takes it as a second argument and stores it when queuing. Where the outbox **drops** entries (the stale ones in `flushOutbox`, all of them in `disconnect`), dispatch `messageRejected({ clientId, reason: 'Not sent' })` for each entry that has a `clientId`.
   - Handler: `messageSent.match(action)` → `send(JSON.stringify({ type: 'chat', clientId: action.payload.clientId, text: action.payload.text }), action.payload.clientId)`.
3. **`src/pages/SharedChat/SharedChat.tsx`**
   - On submit: text starting with `/` → `dispatch(sendRequested(text))` (a command); anything else → `dispatch(messageSent(text, user))`. `user` can be `undefined` in the type; the form only shows when logged in, so `if (!user) return;` before dispatching is enough.
   - Own messages: show the delivery icon like `Rooms.tsx` does (copy its `deliveryLabels`, reuse `deliveryStyles` from `Rooms/styles.ts`), and for a failed one, its `failReason` next to the ✗.
4. Run `npx tsc -b` and `npx eslint src`.

### Check (after both parts)

1. **Send "hi":** Redux DevTools: `chat/messageSent` (payload with `clientId`, `sentAt`) → then `chat/messageReceived` with the **same** `clientId`. The list shows "hi" once, ⏳ → ✓ (on localhost the ⏳ is too short to see). Network → Socket → Messages: the outgoing frame is JSON now; the incoming echo has the `clientId`.
2. **Second tab:** sees "hi" as a normal message, no icon (it has no pending message with that id).
3. **See ⏳ for real:** DevTools → Network → **Offline**, send "queued": ⏳ stays. Back **Online**: it flushes, ✓.
4. **Dropped from the outbox:** **Offline**, send "lost", click **Disconnect**: ✗ "Not sent".
5. **Rejected by the server, too long:** in Elements, delete the input's `maxlength` attribute, paste more than 500 characters, send: `chat/messageRejected` with "Message too long", the message shows ✗ and the reason.
6. **Rejected, rate limit:** send 12+ messages very fast (type "x", hold Enter... or paste-and-Enter repeatedly): the first ~10 get ✓, the rest ✗ "Slow down: too many messages".
7. **Commands unchanged:** `/who` sends a plain-text frame, no ⏳ entry in the list, the system answer appears as before.

---

## §6. Compare the three versions, then remove `/chat` (7f)

### The three versions

The app has carried the same idea (a socket, its status, its messages) in three shapes:

| | **Stage 2: a hook** (`src/hooks/useWebSocket.ts`, used by `/chat`) | **Stages 4–6: a module store** (`src/socket/oldChatStore.ts` + `useSyncExternalStore`; `/rooms` still works this way) | **Stage 7: Redux** (`chatSlice` + `socketMiddleware`) |
| --- | --- | --- | --- |
| **Where the socket lives** | inside a component, in a `useRef` | in module variables (`let socket`) | inside the middleware's closure |
| **How long it lives** | while the component is mounted: navigate away → closed | as long as the page: created on first import | as long as the store (one per `configureStore` call) |
| **How many sockets** | one per component that calls the hook (two components → two sockets) | one per app | one per store |
| **Who can read status/messages** | only that component (pass props, or lift state up) | anyone, through the store's hooks (`useChatStatus`...) | anyone, with `useAppSelector` |
| **How the UI changes it** | functions returned by the hook (`send`) | exported functions (`connect`, `send`) | actions (`connectRequested`, `messageSent`) |
| **Reacting to login/logout** | the component would have to watch the user itself | `main.tsx` subscribed to `authStore` (6c) | the listener middleware reacts to auth actions (7d) |
| **What you can see while debugging** | React DevTools: one component's state | `console.info` lines | Redux DevTools: every action, state before/after, the cause → effect chain |
| **Testing** | render the component with a fake `WebSocket` | module state is shared by every test; hard to reset | `setupStore()` gives each test a fresh store and its own middleware state |
| **Code you write** | least: one hook | moderate: a hand-written store (state, listeners, `subscribe`, snapshots) | most files (slice, middleware, listeners, store wiring), but each one does one job |
| **Good for** | a socket that belongs to **one screen** (a live widget that should close when you leave) | an **app-wide** connection in an app **without** Redux | an app-wide connection in an app that **already uses Redux**, or one where other state (auth, optimistic UI) has to react to it |

What actually changed between them is **where the socket lives**, and everything else follows from that. A socket inside a component lives and dies with that component. Move it out (module or middleware) and it becomes app-wide; then the question is only how the UI reads and drives it: hand-made subscriptions, or Redux's.

The two lessons the app taught along the way:

- **Long-lived side effects don't belong in render-driven code.** The hook works, but StrictMode's double mount (Stage 2), page changes and multiple components all fight with it. The socket is a service, not UI.
- **Actions make the invisible visible.** With the module store you found bugs by reading `console.info`. With Redux, the 7b reconnect loop and the 7d missing listener were both visible as "an action that should (or shouldn't) be there" on the DevTools timeline.

### Why remove `/chat`

It's the Stage 1–2 page: its own socket per visit, no login, no reconnect state shared with the rest of the app. Since 6c the server needs a login for the socket, so `/chat` is a page that can't work anymore. The hook stays in the repo as the example of the first version (like `old-auth` and `oldChatStore.ts`); the page and route go.

### Your task

1. **`src/App.tsx`**: remove the `<Route path="/chat" ... />` line and `Chat` from the `./pages` import.
2. **`src/pages/index.ts`**: remove `export { Chat } from './Chat';`.
3. **The styles are shared**, so they move instead of being deleted: `src/pages/Chat/styles.ts` is imported by `SharedChat.tsx`, `Rooms.tsx` and `components/UserBar/LoginForm.tsx`.
   - Move it: `git mv src/pages/Chat/styles.ts src/styles/chatStyles.ts`.
   - Fix its own two imports: `'../../styles/defineStyles.ts'` → `'./defineStyles.ts'` and `'../../styles/theme.ts'` → `'./theme.ts'` (it now sits next to them).
   - Update the three importers: `'../Chat/styles.ts'` → `'../../styles/chatStyles.ts'` (in `SharedChat.tsx`, `Rooms.tsx`), and `'../../pages/Chat/styles.ts'` → `'../../styles/chatStyles.ts'` (in `LoginForm.tsx`).
4. Delete what's left of the page: `src/pages/Chat/Chat.tsx` and `src/pages/Chat/index.ts` (the folder disappears).
5. **Keep** `src/hooks/useWebSocket.ts`: nothing renders it now, but `oldChatStore.ts` and `roomChatStore.ts` still import its `Status` type, and it's the Stage 2 example.
6. Run `npx tsc -b` and `npx eslint src`.

### Check

1. Open `/chat`: the 404 page (the `*` route).
2. `/shared-chat`, `/rooms` and the login form look exactly as before (they use the moved styles).
3. `/shared-chat` still works end to end: log in, send, ✓.
