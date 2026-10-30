# Stage 3: Message design

So far every message was a plain string, and the server broadcast it to everyone. That's enough for "type text, see text", but a real app needs to say much more: _which room_, _who sent it_, _is this a chat message or a "typing…" signal_, _did the server receive my message_. WebSockets give you a pipe for strings and bytes, nothing else. Everything on top is a **protocol you design yourself**. This stage is about designing it well.

---

## §1. The envelope: `{ type, payload }`

### Why plain strings stop working

With plain strings, the receiver can only guess what a message means. Is `"alice"` a chat message, a user who joined, or a room name? You could invent prefixes (`"JOIN:alice"`, `"MSG:general:hi"`), but then you're writing a parser, and escaping, and versioning, by hand.

The standard answer is to send **JSON** with the same outer shape for every message, called an **envelope**:

```json
{ "type": "chat.send", "id": "6f1c…", "payload": { "room": "general", "text": "hi" } }
```

| Field     | What it is                                                                 | Why it's there                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`    | A string naming the kind of message: `'join'`, `'chat.send'`, `'typing'` … | The receiver reads it **first** to decide what to do. It's the only field every message has, so code can always check it.                                             |
| `payload` | The data for that kind of message. Its shape depends on `type`.            | Keeps the message's content apart from the protocol fields, so the envelope's own fields never clash with content field names.                                        |
| `id`      | Optional. A unique ID, only on messages that expect a reply (§4).          | It's **metadata about the message**, not part of its content, so it sits on the envelope next to `type`. Any message type can carry one without changing its payload. |
| `ts`      | Optional. A timestamp, usually set by the server.                          | Gives every client the same time for the same event. Client clocks differ, so the server's time is the one everyone agrees on.                                        |

Naming: a dotted style like `chat.send` / `chat.message` groups related types and reads well in logs. Pick a style and stick to it.

### Sending and receiving JSON

The socket still carries strings. You convert at the edges:

```ts
socket.send(JSON.stringify(message)); // object -> string, on the way out

socket.addEventListener('message', (event) => {
  const data: unknown = JSON.parse(event.data); // string -> object, on the way in
});
```

Two things to know:

- **`JSON.parse` throws** on anything that isn't valid JSON (`"hello"`, a truncated string, an old client sending plain text). An uncaught throw inside a listener doesn't close the socket, but that message is silently gone and you get an error in the console. Always wrap it in `try/catch`.
- **The result is typed `any`.** TypeScript has no idea what came over the wire. Store it as `unknown` (as above), so TypeScript forces you to check it before use. §3 shows how.

---

## §2. Typing the protocol: discriminated unions

### One union per direction

There are two separate sets of messages:

- **Client → server** (`ClientMessage`): what _your_ code sends.
- **Server → client** (`ServerMessage`): what your code receives.

Each is a **discriminated union**: a union of object types that all share one literal field, here `type`. That field is the _discriminant_.

```ts
type ClientMessage =
  | { type: 'join'; payload: { room: string; user: string } }
  | { type: 'chat.send'; id: string; payload: { room: string; text: string } };
// …one line per message type
```

### What it gives you

**1. Typed sending.** If `send` accepts `ClientMessage` instead of `string`, TypeScript checks every message you build:

```ts
const send = (message: ClientMessage) => socket.send(JSON.stringify(message));

send({ type: 'join', payload: { room: 'general' } }); // ❌ error: payload is missing `user`
send({ type: 'chat.send', payload: { room: 'general', text: 'hi' } }); // ❌ error: `id` is required for chat.send
```

**2. Narrowing.** When you check `type`, TypeScript narrows the whole object to that member of the union, so `payload` gets the right type inside each branch:

```ts
const handle = (message: ServerMessage) => {
  switch (message.type) {
    case 'ack':
      message.payload.id; // ✅ TypeScript knows this is the ack payload
      break;
    case 'typing':
      message.payload.isTyping; // ✅ and this is the typing payload
      break;
  }
};
```

**3. Exhaustiveness checks.** Add a `default` branch that assigns the message to `never`:

```ts
    default: {
      const unhandled: never = message;
      console.warn('Unhandled message', unhandled);
    }
```

`never` is the type with no values. If every `type` has a `case`, nothing is left to reach `default`, so `message` is `never` there and the assignment compiles. If someone later adds a new message type to `ServerMessage` and forgets a `case`, the leftover type reaches `default`, can't be assigned to `never`, and **the type-check (`tsc -b`) fails** pointing at this line. The compiler finds the forgotten handler for you.

Note this check is **compile-time only**. At runtime, a message with a `type` your code doesn't know can still arrive (e.g. from a newer server). §3 handles that case.

---

## §3. Never trust the wire: runtime validation with Zod

### Why TypeScript types aren't enough

This line is very common, and it's a lie:

```ts
const message = JSON.parse(event.data) as ServerMessage; // ❌
```

TypeScript types are **erased** when the code is compiled to JavaScript. `as ServerMessage` checks nothing at runtime. It only tells the compiler "trust me". If the server sends `{ "type": "chat.message", "payload": { "text": 42 } }`, your code believes `text` is a string, and crashes later somewhere far away, e.g. on `text.toUpperCase()`, in a render, where the cause is hard to find.

Ways the data can be wrong even when you also wrote the server:

- The server is a **different version** (deployed earlier or later than the client), so a field was renamed or added.
- A **bug** on the server sends the wrong shape.
- **Someone else** connects to your server or sits in between and sends you anything they want. The socket is a public endpoint.

The rule: **everything that comes from outside is `unknown` until it has been checked.** This is the same rule as for HTTP responses and form input.

### Zod in a nutshell

[Zod](https://zod.dev) lets you describe a shape **once, as a value that exists at runtime**, and then check data against it. It's already a dependency of this project (`zod` v4).

```ts
import { z } from 'zod';

const ackSchema = z.object({
  type: z.literal('ack'), // must be exactly the string 'ack'
  payload: z.object({
    id: z.string(),
    ts: z.number(),
  }),
});
```

**Checking data:** `schema.safeParse(data)` never throws. It returns either `{ success: true, data }`, where `data` is fully typed, or `{ success: false, error }`, with a description of everything that's wrong:

```ts
const result = ackSchema.safeParse(json);

if (!result.success) {
  console.warn('Invalid message', z.prettifyError(result.error));
  return; // drop it, don't crash
}

result.data.payload.id; // ✅ a real string, checked at runtime
```

(`schema.parse(data)` does the same but **throws** on invalid data. In a socket listener, `safeParse` is easier to handle.)

**Types come from the schema:** `z.infer` turns a schema into a TypeScript type, so you don't write the shape twice and the two can never drift apart:

```ts
type Ack = z.infer<typeof ackSchema>;
// { type: 'ack'; payload: { id: string; ts: number } }
```

### A union of messages: `z.discriminatedUnion`

To validate _any_ server message, combine one schema per message type:

```ts
const serverMessageSchema = z.discriminatedUnion('type', [
  ackSchema,
  typingSchema,
  // …one schema per server → client message type
]);

type ServerMessage = z.infer<typeof serverMessageSchema>; // the discriminated union from §2, for free
```

You tell Zod which field is the discriminant (`'type'`). Zod reads `type` first and then checks the payload against **only** the matching schema, which is faster and gives clearer errors than trying every member. A message with an unknown `type` fails validation, so it's dropped at the edge instead of reaching your `switch`.

### Where validation goes

```
socket 'message' event
  → JSON.parse inside try/catch    (not JSON? log + drop)
  → serverMessageSchema.safeParse  (wrong shape? log + drop)
  → switch (message.type)          (fully typed from here on)
```

Validate **once, at the edge**, as soon as the data arrives. Everything after that point works with typed data and needs no more checks.

**Outgoing messages** don't need Zod on the client. You build them in your own code, so TypeScript's `ClientMessage` type already checks them at compile time. The **server**, though, must validate what it receives, for the same "never trust the wire" reason. The Stage 3 helper server does this with Zod too (`websockets-server/src/rooms.ts`).

---

## §4. Request/response over a socket: correlation IDs and acks

### The problem

HTTP has request/response built in: every `fetch` gets exactly its own response. A WebSocket has nothing like that. It's two independent streams of messages. If you send a message and then something arrives, you can't tell whether it's the reply to _your_ message, a reply to an earlier one, or something unrelated that happened to arrive at that moment.

For chat, you want to know **"did the server receive my message?"**. Until you know, the message might have been lost: the connection could have died just as you sent it (Stage 1: `send()` only hands data to the browser, it doesn't confirm delivery).

### Correlation IDs

The fix is a **correlation ID**:

1. The client generates a unique ID for the message: `crypto.randomUUID()` is built into browsers.
2. It sends the message with that `id` on the envelope.
3. The server replies with a message that carries **the same `id`**. Here that reply is an **ack** (acknowledgement): `{ type: 'ack', payload: { id } }`.
4. The client matches the reply to the original message by `id`.

### The pending map and the timeout

The client keeps the messages that are still waiting for an ack, keyed by ID:

```ts
const pending = new Map<string, ReturnType<typeof setTimeout>>(); // id -> its timeout timer
```

Each message then goes through one of three outcomes:

| Outcome      | Trigger                                                      | Client does                                                   |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------- |
| **Sent** ✓   | An `ack` with this `id` arrives                              | Clear the timer, remove the `id` from `pending`, mark it sent |
| **Failed** ✗ | An `error` with this `id` arrives (a "negative ack")         | Same cleanup, mark it failed                                  |
| **Failed** ✗ | The timer fires first, e.g. after 5 s, with no answer at all | Remove the `id` from `pending`, mark it failed                |

The timeout matters most: **without it, a lost message stays "sending…" forever.** You can't wait for a reply that may never come.

Two edge cases:

- **A late ack.** The timer fired, the message is marked failed, and _then_ the ack arrives. Because the `id` is no longer in `pending`, the ack handler finds nothing and simply ignores it. (Whether to flip the message back to "sent" is a product decision. Ignoring it is the simple, safe choice. Stage 4 handles retries properly.)
- **The socket closes.** No ack can arrive on a closed socket, so there's no point waiting for the timers: mark every pending message failed and clear `pending` in the `close` listener.

### Optimistic display

The sender adds **its own message to the list immediately**, marked pending (⏳), without waiting for the server. Once the ack arrives it becomes ✓. This is an _optimistic update_: the UI assumes success and corrects itself if that turns out wrong.

That's also why the Stage 3 server **doesn't echo your message back to you** (the Stage 2 broadcast server did). The sender already shows the message, so an echo would show it twice. The server sends `chat.message` to the **others** in the room and an `ack` to the sender.

### A Promise-based alternative (just to know)

The same mechanism can be wrapped in a function returning a Promise, such as `sendWithAck(message): Promise<Ack>`: resolve it on ack, reject it on error or timeout. That's handy for one-off requests (`await getRoomList()`). For a chat list, storing the delivery status **on each message**, as above, fits better, because the UI renders that status directly.

---

## §5. Rooms from the client's side

A **room** (also called a _channel_ or _topic_) is a named group on the server. A message sent to a room goes only to the clients that have **joined** it. The server keeps track of who is in which room. The client only says what it wants:

- `join { room, user }`: "send me this room's messages; this is my name".
- `leave { room }`: "stop sending me this room's messages".

Things the client is responsible for:

**1. Leaving the old room when switching.** Otherwise the server keeps sending you messages from a room you no longer look at. Switching room = `leave` the old one, clear the local messages, `join` the new one.

**2. Checking `payload.room` on incoming messages.** Even though the server only sends you messages from your rooms, a message from the old room can already be **on the wire** when you switch: the server sent it just before your `leave` arrived. If you don't compare `payload.room` with your current room, that message lands in the wrong room's list.

**3. Joining again after a reconnect.** Room membership is per **connection**. When the socket closes, the server forgets you. A new socket starts in no rooms, so the client must `join` again. (Stage 4 covers reconnecting. For now it's enough to know why.)

---

## §6. The "user is typing…" indicator

Typing signals are a good example of an **ephemeral** message: useful for a moment, worthless a second later. That changes the design:

- **No ack, no history, no retry.** If a typing signal is lost, nothing bad happens, so don't pay for acks.
- **Don't send one per keystroke.** Fast typing would send dozens of messages a second. The sender sends `typing { isTyping: true }` **once**, when typing starts. Then it waits for a pause: each keystroke restarts a timer (e.g. 2 s), and when the timer fires it sends `typing { isTyping: false }`. Sending the message also ends typing: send `false` and clear the timer.
- **The receiver doesn't fully trust `false` to arrive.** The other user might close the tab mid-sentence, and their `false` never comes. So when the receiver gets `isTyping: true`, it also starts its **own** expiry timer (e.g. 5 s) and removes "Alice is typing…" when it fires, unless another `true` restarts it. (The Stage 3 server also sends `isTyping: false` for a user who disconnects or leaves the room, but the client shouldn't depend on it.)

---

## §7. The Stage 3 protocol

This is the exact protocol the helper server speaks. Server: `../websockets-server/src/rooms.ts`, run with `pnpm rooms`, at **`ws://localhost:8082`**.

### Client → server

| `type`      | `id`     | `payload`                             | Server does                                                                                  |
| ----------- | -------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `join`      | —        | `{ room: string; user: string }`      | Adds you to the room and remembers your name. No reply.                                      |
| `leave`     | —        | `{ room: string }`                    | Removes you from the room. No reply.                                                         |
| `chat.send` | required | `{ room: string; text: string }`      | Sends `chat.message` to the **others** in the room, and `ack` to you. `error` if not joined. |
| `typing`    | —        | `{ room: string; isTyping: boolean }` | Sends `typing` to the others in the room. No reply.                                          |

### Server → client

| `type`         | `payload`                                                              | Meaning                                                                                |
| -------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `chat.message` | `{ id: string; room: string; user: string; text: string; ts: number }` | Someone else's message. `id` is the sender's correlation ID.                           |
| `ack`          | `{ id: string; ts: number }`                                           | Your `chat.send` with this `id` was received.                                          |
| `typing`       | `{ room: string; user: string; isTyping: boolean }`                    | Another user started or stopped typing.                                                |
| `error`        | `{ message: string; id?: string }`                                     | Something you sent was rejected. If `id` is present, that `chat.send` failed (a nack). |

### Test commands

Send these as chat text (from a joined room) to trigger the edge cases:

| Text       | What happens                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/slowack` | Delivered normally, but the ack arrives after **3 s**. You should see ⏳ for 3 s, then ✓.                                                                                                                                                   |
| `/noack`   | Delivered, but the ack **never** arrives. After your timeout (5 s) you should see ✗.                                                                                                                                                        |
| `/garbage` | Not delivered. Instead the server sends **you** three invalid messages: not JSON, a wrong payload, an unknown `type`. Your client should log and drop all three without crashing. Your own `/garbage` message gets no ack, so it ends as ✗. |

---

## Self-check

Each question is covered in the section shown.

1. Why does every message have a `type` at the top level, and why does the correlation `id` sit on the envelope rather than inside `payload`? _(§1)_
2. What does the `never` assignment in a `switch`'s `default` branch catch, and what does it _not_ catch at runtime? _(§2, §3)_
3. What does `JSON.parse(data) as ServerMessage` actually check? Name two ways the data could be wrong even though you wrote the server. _(§3)_
4. Why does the client validate incoming messages with Zod, but not its outgoing ones? _(§3)_
5. What are the three outcomes of a `chat.send`, and what triggers each? What happens to an ack that arrives after the timeout? _(§4)_
6. Why does the sender show its own message immediately, and why doesn't the server echo it back? _(§4)_
7. The server only sends you messages from rooms you've joined. Why should the client still check `payload.room`? _(§5)_
8. Why are typing signals not acked, and why does the receiver need its own expiry timer? _(§6)_
