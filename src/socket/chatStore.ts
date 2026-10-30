import { z } from 'zod';
import type { ReceivedMessage, Status } from '../hooks/useWebSocket.ts';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 10000;
const PONG_TIMEOUT_MS = 5000;
const MAX_OUTBOX_SIZE = 50;
const MAX_OUTBOX_AGE_MS = 30000;

let status: Status = 'closed';
let messages: ReceivedMessage[] = [];
let socket: WebSocket | null = null;
let serverUrl: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
let outbox: Array<{ queuedAt: number; text: string }> = [];
let lastSeenId = 0;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shouldReconnect = true;
const listeners = new Set<() => void>();

const chatEventSchema = z.object({ id: z.number().int(), text: z.string() });

const flushOutbox = () => {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }
  const queued = outbox;
  outbox = [];
  const nowDate = Date.now();

  queued.forEach((queuedMessage) => {
    if (nowDate - queuedMessage.queuedAt > MAX_OUTBOX_AGE_MS) {
      console.warn(`Dropped stale message "${queuedMessage.text}"`);
    } else {
      socket?.send(queuedMessage.text);
    }
  });

  if (queued.length > 0) {
    console.info(`Flushed ${queued.length} queued message(s)`);
  }
};

const parseChatEvent = (raw: string) => {
  try {
    const result = chatEventSchema.safeParse(JSON.parse(raw));

    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const stopHeartbeat = () => {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);

    heartbeatTimer = null;
  }

  if (pongTimer !== null) {
    clearTimeout(pongTimer);

    pongTimer = null;
  }
};

const sendPing = () => {
  if (socket?.readyState !== WebSocket.OPEN || pongTimer !== null) {
    return;
  }

  socket.send('__ping__');
  pongTimer = setTimeout(() => {
    console.warn('No pong in 5s: connection is dead');
    socket?.close(4000, 'heartbeat timeout');
  }, PONG_TIMEOUT_MS);
};

const startHeartbeat = () => {
  stopHeartbeat();
  heartbeatTimer = setInterval(sendPing, HEARTBEAT_INTERVAL_MS);
};

const notify = () => {
  listeners.forEach((listener) => listener());
};

const setStatus = (next: Status) => {
  status = next;
  notify();
};

const addMessage = (message: ReceivedMessage) => {
  messages = [...messages, message];
  notify();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const getReconnectDelay = () => {
  const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** reconnectAttempt);

  return Math.random() * backoff;
};

const clearReconnectTimer = () => {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

export const connect = (url: string) => {
  shouldReconnect = true;
  clearReconnectTimer();

  if (socket) {
    return;
  }

  socket = new WebSocket(url);
  serverUrl = url;
  setStatus('connecting');

  socket.addEventListener('open', () => {
    console.info('Opened websocket connection');
    startHeartbeat();
    setStatus('open');
    reconnectAttempt = 0;
    socket?.send(`__resume__:${lastSeenId}`);
    flushOutbox();
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      console.warn('Binary message ignored');

      return;
    }

    if (event.data === '__pong__') {
      if (pongTimer) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }

      return;
    }

    if (event.data === '__reset__') {
      console.info('Server history was reset: starting from 0');
      lastSeenId = 0;

      return;
    }
    const chatEvent = parseChatEvent(event.data);

    if (!chatEvent) {
      console.warn(`Ignored invalid message: ${event.data}`);

      return;
    }

    if (chatEvent.id <= lastSeenId) {
      console.info(`Ignored duplicate #${chatEvent.id}`);

      return;
    }
    lastSeenId = chatEvent.id;
    addMessage({ text: chatEvent.text, receivedAt: Date.now() });
  });

  socket.addEventListener('error', () => {
    console.info('Error event');
  });

  socket.addEventListener('close', (event) => {
    console.info(`Closed: code ${event.code} - reason="${event.reason}". Was clean: ${event.wasClean ? 'yes' : 'no'}`);
    stopHeartbeat();
    socket = null;
    setStatus('closed');

    if (!shouldReconnect) {
      console.info('Not reconnecting: closed on purpose');

      return;
    }

    if (!navigator.onLine) {
      console.info('Offline: waiting for the online event');

      return;
    }

    const delay = getReconnectDelay();
    reconnectAttempt += 1;
    console.info(`Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempt})`);
    const reconnectUrl = serverUrl;

    if (reconnectUrl) {
      reconnectTimer = setTimeout(() => connect(reconnectUrl), delay);
    }
  });
};

export const disconnect = () => {
  shouldReconnect = false;
  reconnectAttempt = 0;
  clearReconnectTimer();

  if (outbox.length > 0) {
    console.info(`Dropped ${outbox.length} queued message(s)`);
  }

  outbox = [];

  if (socket) {
    socket.close(1000, 'user disconnected');
  }
};

const handleOffline = () => {
  console.info('Browser went offline');
  clearReconnectTimer();
  socket?.close(4001, 'offline');
};

const reconnectNow = (reason: string) => {
  if (!shouldReconnect || socket || serverUrl === null || !navigator.onLine) {
    return;
  }

  console.info(`${reason}: reconnecting now`);
  reconnectAttempt = 0;
  connect(serverUrl);
};

const handleVisibilityChange = () => {
  if (document.visibilityState !== 'visible') {
    return;
  }

  if (socket?.readyState === WebSocket.OPEN) {
    console.info('Tab is visible: checking the connection');
    sendPing();
  } else {
    reconnectNow('Tab is visible');
  }
};

window.addEventListener('offline', handleOffline);
window.addEventListener('online', () => reconnectNow('Browser is online'));
document.addEventListener('visibilitychange', handleVisibilityChange);

export const send = (text: string) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(text);

    return;
  }

  if (!shouldReconnect) {
    console.warn('Not sent: disconnected on purpose');

    return;
  }

  if (outbox.length >= MAX_OUTBOX_SIZE) {
    console.warn('Not sent: outbox is full');

    return;
  }

  outbox.push({ queuedAt: Date.now(), text });
  console.info(`Queued "${text}" (${outbox.length} waiting)`);
};

export const statusStore = {
  subscribe,
  getSnapshot: () => status,
};

export const messagesStore = {
  subscribe,
  getSnapshot: () => messages,
};
