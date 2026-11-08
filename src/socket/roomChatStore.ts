import { useSyncExternalStore } from 'react';
import type { Status } from '../hooks/useWebSocket.ts';
import { ClientMessage, ServerMessage, parseServerMessage } from '../protocol/messages.ts';

export type Delivery = 'pending' | 'sent' | 'failed';

export type ChatEntry = {
  // null for other people's messages
  delivery: Delivery | null;
  id: string;
  own: boolean;
  text: string;
  ts: number;
  user: string;
};

export type RoomChatState = {
  messages: ChatEntry[];
  // null = not joined to any room
  room: string | null;
  status: Status;
  typingUsers: string[];
  user: string | null;
};

type Timer = ReturnType<typeof setTimeout>;

const ACK_TIMEOUT_MS = 5000;
const TYPING_IDLE_MS = 2000;
const TYPING_EXPIRY_MS = 5000;

let state: RoomChatState = { status: 'closed', user: null, room: null, messages: [], typingUsers: [] };
let socket: WebSocket | null = null;
const listeners = new Set<() => void>();

// id of each own message still waiting for an ack -> its timeout timer (§4)
const pendingAcks = new Map<string, Timer>();
// Sender side: not null while we've told the room "I'm typing" (§6)
let typingIdleTimer: Timer | null = null;
// Receiver side: user -> timer that hides their "is typing…" if no `false` arrives (§6)
const typingExpiryTimers = new Map<string, Timer>();

const setState = (patch: Partial<RoomChatState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;

const sendMessage = (message: ClientMessage) => {
  if (socket?.readyState !== WebSocket.OPEN) {
    console.warn(`Not sent: socket is ${socket ? socket.readyState : 'missing'}`, message);

    return false;
  }

  socket.send(JSON.stringify(message));

  return true;
};

// --- Acks (§4) ---

const updateOwnMessage = (id: string, patch: Partial<ChatEntry>) => {
  setState({
    messages: state.messages.map((message) => (message.own && message.id === id ? { ...message, ...patch } : message)),
  });
};

// Settles one pending message. An id that isn't pending (e.g. a late ack after the timeout) is ignored.
const settleAck = (id: string, patch: Partial<ChatEntry>) => {
  const timer = pendingAcks.get(id);

  if (timer === undefined) {
    return;
  }

  clearTimeout(timer);
  pendingAcks.delete(id);
  updateOwnMessage(id, patch);
};

const clearPendingAcks = () => {
  pendingAcks.forEach((timer) => clearTimeout(timer));
  pendingAcks.clear();
};

// No ack can arrive on a closed socket, so every pending message has failed.
const failAllPending = () => {
  if (pendingAcks.size === 0) {
    return;
  }

  const failedIds = new Set(pendingAcks.keys());
  clearPendingAcks();
  setState({
    messages: state.messages.map((message) =>
      failedIds.has(message.id) ? { ...message, delivery: 'failed' } : message,
    ),
  });
};

// --- Typing, sender side (§6) ---

const stopTyping = () => {
  if (typingIdleTimer === null) {
    return;
  }

  clearTimeout(typingIdleTimer);
  typingIdleTimer = null;

  if (state.room !== null) {
    sendMessage({ type: 'typing', payload: { room: state.room, isTyping: false } });
  }
};

// --- Typing, receiver side (§6) ---

const removeTypingUser = (user: string) => {
  clearTimeout(typingExpiryTimers.get(user));
  typingExpiryTimers.delete(user);

  if (state.typingUsers.includes(user)) {
    setState({ typingUsers: state.typingUsers.filter((typingUser) => typingUser !== user) });
  }
};

const addTypingUser = (user: string) => {
  clearTimeout(typingExpiryTimers.get(user));
  typingExpiryTimers.set(
    user,
    setTimeout(() => removeTypingUser(user), TYPING_EXPIRY_MS),
  );

  if (!state.typingUsers.includes(user)) {
    setState({ typingUsers: [...state.typingUsers, user] });
  }
};

const clearTypingUsers = () => {
  typingExpiryTimers.forEach((timer) => clearTimeout(timer));
  typingExpiryTimers.clear();
};

// --- Incoming messages ---

const handleServerMessage = (message: ServerMessage) => {
  switch (message.type) {
    case 'chat.message': {
      const { id, room, user, text, ts } = message.payload;

      // A message from a room we've just left can still be on the wire (§5).
      if (room !== state.room) {
        return;
      }

      setState({ messages: [...state.messages, { id, user, text, ts, own: false, delivery: null }] });

      return;
    }
    case 'ack': {
      settleAck(message.payload.id, { delivery: 'sent', ts: message.payload.ts });

      return;
    }
    case 'typing': {
      const { room, user, isTyping } = message.payload;

      if (room !== state.room) {
        return;
      }

      if (isTyping) {
        addTypingUser(user);
      } else {
        removeTypingUser(user);
      }

      return;
    }
    case 'error': {
      console.warn(`Server error: ${message.payload.message}`);

      if (message.payload.id !== undefined) {
        settleAck(message.payload.id, { delivery: 'failed' });
      }

      return;
    }
    default: {
      const unhandled: never = message;
      console.warn('Unhandled message', unhandled);
    }
  }
};

// --- Public API ---

const setStatus = (status: Status) => {
  setState({ status });
};

export const connect = (url: string) => {
  if (socket) {
    return;
  }

  socket = new WebSocket(url);
  setStatus('connecting');

  socket.addEventListener('open', () => {
    console.info('Opened websocket connection');
    setStatus('open');
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      console.warn('Binary message ignored');

      return;
    }

    const message = parseServerMessage(event.data);

    if (message) {
      handleServerMessage(message);
    }
  });

  socket.addEventListener('error', () => {
    console.info('Error event');
  });

  socket.addEventListener('close', (event) => {
    console.info(`Closed: code ${event.code} - reason="${event.reason}". Was clean: ${event.wasClean ? 'yes' : 'no'}`);
    socket = null;

    if (typingIdleTimer !== null) {
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
    }

    clearTypingUsers();
    failAllPending();
    // `room` is kept so the failed messages stay visible. The server has forgotten our membership,
    // so after a reconnect (Stage 4) we'd have to join again (§5).
    setState({ status: 'closed', typingUsers: [] });
  });
};

export const leave = () => {
  if (state.room === null) {
    return;
  }

  stopTyping();
  sendMessage({ type: 'leave', payload: { room: state.room } });
  clearPendingAcks();
  clearTypingUsers();
  setState({ room: null, messages: [], typingUsers: [] });
};

export const join = (room: string, user: string) => {
  leave();

  if (!sendMessage({ type: 'join', payload: { room, user } })) {
    return;
  }

  setState({ room, user, messages: [], typingUsers: [] });
};

export const sendChat = (text: string) => {
  if (state.room === null || state.user === null) {
    return;
  }

  stopTyping();

  const id = crypto.randomUUID();
  setState({
    messages: [...state.messages, { id, user: state.user, text, ts: Date.now(), own: true, delivery: 'pending' }],
  });

  if (!sendMessage({ type: 'chat.send', id, payload: { room: state.room, text } })) {
    updateOwnMessage(id, { delivery: 'failed' });

    return;
  }

  pendingAcks.set(
    id,
    setTimeout(() => settleAck(id, { delivery: 'failed' }), ACK_TIMEOUT_MS),
  );
};

// Call on every input change: sends `isTyping: true` once, then `false` after a pause (§6).
export const notifyTyping = () => {
  if (state.room === null) {
    return;
  }

  if (typingIdleTimer === null) {
    sendMessage({ type: 'typing', payload: { room: state.room, isTyping: true } });
  } else {
    clearTimeout(typingIdleTimer);
  }

  typingIdleTimer = setTimeout(stopTyping, TYPING_IDLE_MS);
};

export const useRoomChat = () => useSyncExternalStore(subscribe, getSnapshot);
