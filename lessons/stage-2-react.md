# Stage 2: Using WebSockets in React

In Stage 1 the socket lived in a plain module, created when you clicked a button. In React, the socket has to follow the **component lifecycle**: it opens when a component mounts, closes when the component unmounts, and doesn't break when React mounts things twice. Everything here builds on the Stage 1 lesson, especially the "listeners use their own local `socket`" takeaway.

---

## §1. Where the socket lives

There are four common places. They differ in **how long the socket lives** and **who can use it**.

| Where                                      | Socket lives as long as…                  | Shared between components?              | Good for                                                 |
| ------------------------------------------ | ----------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Inside one component (`useEffect`)         | that component is mounted                 | No                                      | Quick experiments                                        |
| A custom hook (`useWebSocket`)             | the component _using the hook_ is mounted | No, each call opens its own socket      | One screen that needs one connection (this stage)        |
| A module singleton (a plain `.ts` file)    | the whole page (until you close it)       | Yes, everyone imports the same object   | One app-wide connection                                  |
| React context (a provider owns the socket) | the provider is mounted                   | Yes, for everything inside the provider | App-wide connection that still follows React's lifecycle |

A custom hook is the first step: the logic is reusable, but each component that calls it gets its own connection. Two components calling `useWebSocket(url)` means **two sockets** (your server would show `clients=2`). When several parts of an app need the _same_ connection, you move the socket out of the hook into a singleton or context. §7 shows how components can then subscribe to it. Stage 7 does the same thing with Redux.

In this stage you build the custom hook.

---

## §2. Creating the socket in `useEffect`, closing it in cleanup

```tsx
useEffect(() => {
  const socket = new WebSocket(url);
  // attach listeners to `socket`…

  return () => {
    socket.close(1000, 'component unmounted');
  };
}, [url]);
```

- **Why `useEffect`:** opening a connection is a _side effect_. It reaches outside React. Effects are the place for side effects, because they run after the component has appeared on screen, and they come with a cleanup function.
- **Why not in the component body:** the body runs on **every render**, and renders happen often (every state change). A `new WebSocket()` there would open a new connection each time. React also expects rendering to be _pure_, so it may run the body more than once for a single update.
- **Why not in `useState(() => new WebSocket(url))` or `useMemo`:** these run during render too. They may run twice in development, and they have **no cleanup**, so nothing would ever close the socket.
- **The cleanup function** runs when the component unmounts, and also _before the effect runs again_ when a dependency changes. With `[url]` as dependencies: if `url` changes, React closes the old socket (cleanup) and then opens one to the new URL (effect). If `url` stays the same, the socket stays open across re-renders.

**Closing while CONNECTING is allowed.** If the cleanup runs before the handshake finished, `close()` aborts the connection attempt. Chrome prints a Console warning, _"WebSocket is closed before the connection is established."_ That socket then fires `close` with code `1006`, because no close handshake took place. You will see exactly this in §3.

---

## §3. The StrictMode double-mount trap

`<StrictMode>` is a wrapper you put around your app in `main.tsx`. **In development only**, it mounts every component, immediately runs its effect cleanups, and then mounts again:

```
mount → effect runs → cleanup runs → effect runs again
```

It does this on purpose: if your cleanup is missing or incomplete, the bug shows up straight away in dev, not later in production. Real remounts happen in production too: navigating away and back, a changed `key`, and Vite's Fast Refresh while you edit code.

For a socket, the sequence is:

1. Effect #1 creates **socket A** (state: CONNECTING).
2. Cleanup #1 calls `A.close()`. A was still connecting, so you get the Chrome warning from §2.
3. Effect #2 creates **socket B**, which connects normally.
4. Some milliseconds later, **A fires its `close` event** (code `1006`).

There are two ways this goes wrong:

**Trap 1: no cleanup.** A is never closed. You now have **two live connections**. Every broadcast arrives twice, and the server shows `clients=2` for one tab.

**Trap 2: cleanup closes A, but A's listeners still update state.** At step 4, A's `close` listener runs `setStatus('closed')`, even though **B is open and working**. Your UI says "closed" while the connection is fine. This is the same old-socket/new-socket bug you fixed in Stage 1 with `if (ws === socket)`.

**The fix:** every listener first checks that its socket is still the current one, and ignores the event otherwise:

```tsx
const wsRef = useRef<WebSocket | null>(null);

useEffect(() => {
  const socket = new WebSocket(url);
  wsRef.current = socket;

  socket.addEventListener('close', () => {
    if (wsRef.current !== socket) return; // an old socket: ignore it
    setStatus('closed');
  });
  // …same guard in the other listeners

  return () => {
    if (wsRef.current === socket) wsRef.current = null;
    socket.close(1000, 'component unmounted');
  };
}, [url]);
```

Notice the order in the cleanup: `wsRef.current` is cleared **before** `close()`, so even A's later events fail the guard.

**What not to do:**

- **Don't remove `<StrictMode>`** to make the warning go away. The bug stays and appears in production on the next real remount.
- **Don't add a "did I already connect?" ref** that skips the second effect. It does make StrictMode quiet. But then the cleanup has closed A and nothing creates B, so you're left with no connection, and real remounts break the same way.

---

## §4. Refs vs state: which value goes where

The question to ask: **does the screen need to update when this value changes?**

| Value                                | Where      | Why                                                                                                     |
| ------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------- |
| The `WebSocket` object               | `useRef`   | It's a mutable external object. The UI never displays it, and swapping it shouldn't re-render anything. |
| `status` (`'connecting'`, `'open'`…) | `useState` | The UI shows it, so changes must trigger a re-render.                                                   |
| `lastMessage`                        | `useState` | Same: the UI shows it.                                                                                  |

**Why not just read `wsRef.current.readyState` in the JSX?** Changing a ref does **not** trigger a re-render. The socket's `readyState` changes inside the browser, React doesn't know about it, and the screen would keep showing whatever the value was at the last render. So you _copy_ each state change into React state from inside the event listeners: `open` → `setStatus('open')`, and so on. The project's ESLint (`eslint-plugin-react-hooks` v7) also flags reading `ref.current` during render, for this reason.

---

## §5. Stale closures in socket listeners

A listener is a function created inside the effect. Like every JS function, it **remembers the variables from the moment it was created**. An effect with `[url]` dependencies runs once (per URL), so its listeners keep seeing the values from that **first render** forever. A value that's out of date like this is called a _stale closure_.

**Example: the classic bug**

```tsx
const [messages, setMessages] = useState<string[]>([]);

useEffect(() => {
  const socket = new WebSocket(url);
  socket.addEventListener('message', (e) => {
    setMessages([...messages, e.data]); // ❌ `messages` is always [] here
  });
  // …
}, [url]);
```

Every message replaces the list with `[]` plus one item, so you only ever see the latest message.

**Fix for state: the functional updater.** Don't read the state; let React give you the current value:

```tsx
setMessages((prev) => [...prev, e.data]); // ✅ `prev` is always current
```

**Callback props are harder.** Say the hook accepts an `onMessage` callback from the component. The listener needs the _latest_ `onMessage`, but:

- Adding `onMessage` to the effect's dependencies would **close and reopen the socket** every time the component re-renders, because the component creates a new function on every render.
- Leaving it out means the listener calls the **stale** `onMessage` from the first render.

Why both obvious approaches fail, assuming the component calls the hook with an inline callback that reads state:

```tsx
const [muted, setMuted] = useState(false);
useWebSocket({
  url,
  options: {
    onMessage: (m) => {
      if (!muted) playSound();
    },
  },
});
```

- **Call `options.onMessage` directly in the listener, without listing it as a dependency:** the listener keeps the first render's `options`. After the user clicks "Mute", the sound keeps playing, because the old callback still sees `muted === false`. ESLint's `exhaustive-deps` rule also flags this.
- **Add `options` to the dependencies:** `options` is a new object on every render, so the effect re-runs on every render. Each re-run means cleanup (close) and a new socket: a **reconnect on every message and every keystroke**, with messages lost during each reconnect.

Note that what we're avoiding is the **effect re-running**, not re-rendering: the component still re-renders as often as before, and that's fine.

There are two fixes:

**Fix A: `useEffectEvent` (new in React 19.2, Oct 2025; this project has 19.3).** It wraps a function so that it **always runs with the latest props and state**, and it is **not a dependency**: you call it from an effect without listing it, and the `react-hooks` ESLint plugin knows this. So the effect only re-runs when its real dependencies (`url`) change, and the callback is never stale.

In one sentence: _`useEffectEvent` lets an effect call the component's latest logic without that logic becoming a reason to re-run the effect._

```tsx
const handleMessage = useEffectEvent((text: string) => {
  onMessage?.(text); // always the latest onMessage
});

useEffect(() => {
  const socket = new WebSocket(url);
  socket.addEventListener('message', (e) => handleMessage(e.data));
  // …
}, [url]); // handleMessage is intentionally NOT a dependency
```

Rules: only call a `useEffectEvent` function from inside effects (or listeners attached in effects), never during render, and don't pass it to other components.

**Fix B: the "latest ref" pattern (the classic version, what Fix A does underneath).** Keep the newest callback in a ref, update the ref after each render, and have the listener read the ref:

```tsx
const onMessageRef = useRef(onMessage);

useEffect(() => {
  onMessageRef.current = onMessage; // updated after every render
});

// in the socket effect:
socket.addEventListener('message', (e) => onMessageRef.current?.(e.data));
```

The listener itself is stale, but what it _reads_ (`onMessageRef.current`) is always up to date. Update the ref in an effect, not directly in the component body, because writing refs during render is also flagged by ESLint (§4).

Use Fix A in new code. Knowing Fix B helps you read older code and libraries.

---

## §6. Designing the hook's return value

### `status`

```ts
type Status = 'connecting' | 'open' | 'closing' | 'closed';
```

Each value comes from a specific moment:

| Moment                                                          | Set status to  |
| --------------------------------------------------------------- | -------------- |
| Effect creates the socket                                       | `'connecting'` |
| `open` event                                                    | `'open'`       |
| You call `close()` (only if the hook offers a `close` function) | `'closing'`    |
| `close` event                                                   | `'closed'`     |

There's no `'error'` status: an `error` event is always followed by `close` (Stage 1, §3), so `'closed'` covers it.

### `send`

- It reads the socket from the ref, and sends only when the socket is `OPEN` (Stage 1, §2). Otherwise it warns (`console.warn`) and does nothing.
- Wrap it in **`useCallback` with no dependencies**. It reads everything from the ref, so it never needs to change. A stable `send` function means components that put `send` in their own effect dependencies don't re-run those effects on every render.

### `lastMessage`: two traps

**Trap 1: identical messages.** If `lastMessage` is a plain string and the same text arrives twice in a row, `setLastMessage('hi')` is called with a value equal to the current one. React compares with `Object.is`, sees no change, and **skips the update**. Any `useEffect(…, [lastMessage])` in the component doesn't run for the second message.

**Fix:** make each message a **new object**, e.g. `{ text: string; receivedAt: number }`. Two objects are never `Object.is`-equal, even with the same contents.

**Trap 2: bursts.** Suppose the component collects messages like this:

```tsx
useEffect(() => {
  if (lastMessage) setMessages((prev) => [...prev, lastMessage]);
}, [lastMessage]);
```

If several messages arrive quickly, the `message` listener can call `setLastMessage` several times **before React renders**. React then renders once, with only the **last** value. The effect runs once, and the earlier messages are never added. They're lost, even though every one of them arrived.

**What this means for the design:**

- `lastMessage` is fine for UIs that only care about the **latest value**: a price ticker, "last seen 2 min ago", a live score.
- For anything that needs **every** message (chat, a log), the hook should hand each message to the component as it arrives, through an **`onMessage` callback**. The callback runs inside the listener, once per message, so nothing can be skipped. Inside it, the component uses the functional updater from §5.

The hook in this stage offers both: `lastMessage` for display, and `onMessage` for collecting.

---

## §7. `useSyncExternalStore`: subscribing to something outside React

### The problem it solves

React re-renders a component when **React's own state** changes: `useState`, `useReducer`, context. Some data lives **outside React**, and React has no idea when it changes:

- a module-level variable, e.g. the status of a **singleton socket** (§1)
- browser state: `navigator.onLine`, `window.innerWidth`, `document.visibilityState`
- a store from a library: Redux, Zustand

The hook from §2–§6 doesn't have this problem: it owns its socket _inside_ the component and copies every change into `useState`. The problem appears as soon as the socket moves **out** of the component, so that several components can share one connection. Then the question is: _how do many components read a value that lives outside React, and re-render when it changes?_

Here's the store used in all the examples below: one shared socket plus its status, in a plain `.ts` file with no React:

```ts
// socketStore.ts
type Status = 'connecting' | 'open' | 'closed';

let status: Status = 'closed';
let socket: WebSocket | null = null;
const listeners = new Set<() => void>();

const setStatus = (next: Status) => {
  status = next;
  listeners.forEach((listener) => listener()); // tell every subscriber "something changed"
};

export const connect = (url: string) => {
  if (socket) return;
  socket = new WebSocket(url);
  setStatus('connecting');
  socket.addEventListener('open', () => setStatus('open'));
  socket.addEventListener('close', () => {
    socket = null;
    setStatus('closed');
  });
};

export const socketStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener); // the unsubscribe function
  },
  getSnapshot: () => status,
};
```

### Approach 1: read the value directly in render ❌

```tsx
const StatusBadge = () => <span>{socketStore.getSnapshot()}</span>;
```

It shows the value **at the moment of rendering**, and never updates afterwards. When the store calls `setStatus('open')`, nothing tells React to re-render `StatusBadge`. This is the same problem as reading `wsRef.current.readyState` in JSX (§4).

### Approach 2: `useState` + a subscription in `useEffect` ⚠️ (the classic way)

```tsx
const StatusBadge = () => {
  const [status, setStatus] = useState(socketStore.getSnapshot());

  useEffect(() => {
    return socketStore.subscribe(() => setStatus(socketStore.getSnapshot()));
  }, []);

  return <span>{status}</span>;
};
```

This mostly works, and it's how it was done before React 18. It has three weaknesses:

1. **A gap between render and subscribe.** The component reads the value during render, but subscribes only in the effect, _after_ the screen has updated. If the store changes in between, the component misses that change and shows an old value until the next one.
2. **Tearing with concurrent rendering.** Since React 18, React can **pause** a render partway through, e.g. inside `startTransition`, and continue later. If the store changes during the pause, the components rendered _before_ the pause show the old value and the ones rendered _after_ show the new one, both on screen at the same time. A header saying `open` while the chat says `connecting` is called _tearing_: the UI is "torn" between two versions of the data.
3. **Boilerplate in every component.** Each one repeats the `useState` + `useEffect` pair.

### Approach 3: `useSyncExternalStore` ✅

```tsx
const StatusBadge = () => {
  const status = useSyncExternalStore(socketStore.subscribe, socketStore.getSnapshot);
  return <span>{status}</span>;
};
```

You give React two functions and **React does the subscribing itself**. Because React controls it, it can close the gaps from Approach 2:

- It reads the value with `getSnapshot()` **during render**, so the first render is always current.
- It checks `getSnapshot()` again before showing the result. If the store changed during the render, it **re-renders synchronously** with the new value before anything reaches the screen. That's the "Sync" in the name, and it's what prevents tearing: all components in one update show the same snapshot.

### How it works, step by step

| When                        | What React does                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render                      | Calls `getSnapshot()` and uses the result as the value.                                                                                                                          |
| After the component appears | Calls `subscribe(callback)` once and keeps the returned unsubscribe function.                                                                                                    |
| The store changes           | The store calls `callback()`. React calls `getSnapshot()` and compares the result with the previous one using `Object.is`. **Only if it's different**, the component re-renders. |
| Unmount                     | Calls the unsubscribe function.                                                                                                                                                  |

So the store's only responsibilities are: keep the value, call the listeners when it changes, and return the current value from `getSnapshot`.

### The rules, and the bug each one prevents

**1. `getSnapshot` must return the same value when nothing changed.**
React calls `getSnapshot` very often: on every render and on every consistency check. It decides "changed or not" with `Object.is`. If `getSnapshot` builds a **new object on each call**:

```ts
getSnapshot: () => ({ status }); // ❌ a new object every call
```

then every call looks like a change: React re-renders, calls it again, sees another "change", and so on. React detects this and throws an error saying the result of `getSnapshot` should be cached to avoid an infinite loop. **Fix:** return a primitive (as `status` is above), or keep one object in the store and replace it only when the data actually changes.

**2. When the data changes, the snapshot must be a new value.**
This is the reverse of rule 1. If the snapshot is an object and the store **mutates it in place** (`state.status = 'open'`), `Object.is` sees the same object and React **doesn't re-render**. Create a new object instead (`state = { ...state, status: 'open' }`), the same rule as with `setState`.

**3. `subscribe` should be a stable function.**
Define it once, outside the component (at module level, as above). If you write it inline, `useSyncExternalStore(() => …, …)`, it's a new function on every render, and React unsubscribes and resubscribes on every render. It still works, but it's wasted work.

(There's also an optional third argument, `getServerSnapshot`, for server-side rendering. It isn't needed in a Vite app.)

### You've already used it: Redux's `useSelector`

`react-redux` (v8 and later) builds `useSelector` on `useSyncExternalStore`. Roughly:

```ts
useSyncExternalStore(store.subscribe, () => selector(store.getState()));
```

That's why `useSelector` warns in development when a selector returns a new object on every call (e.g. `state => ({ a: state.a })`). It's rule 1, applied to Redux. Zustand and TanStack Query use the same mechanism.

### When to use which

| Situation                                                          | Use                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| The socket lives inside one component or hook (this stage's task)  | `useState`, set from the socket's listeners (§4, §6)     |
| The socket lives outside React and several components read from it | `useSyncExternalStore`                                   |
| The socket lives in Redux (Stage 7)                                | `useSelector`, which uses `useSyncExternalStore` for you |

---

## Self-check

Each question is covered in the section shown.

1. Why is the socket created in `useEffect`, and not in the component body or a `useState` initializer? _(§2)_
2. With `<StrictMode>`, what happens to sockets when the component mounts in development? What goes wrong if the listeners update state without a guard? _(§3)_
3. Why is the socket kept in a ref, but `status` in state? Why can't the JSX just read `readyState`? _(§4)_
4. The hook takes an `onMessage` prop. Why not add it to the effect's dependencies, and what are the two fixes? _(§5)_
5. Why should `lastMessage` be an object and not a string? Why can collecting messages from `lastMessage` in an effect lose messages? _(§6)_
6. `getSnapshot` is written as `() => ({ status })`. What happens, and why? _(§7)_
7. Why is `useState` + a subscription in `useEffect` weaker than `useSyncExternalStore`? Name two of the three weaknesses. _(§7)_
