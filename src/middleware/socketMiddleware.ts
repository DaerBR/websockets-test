import { Middleware } from '@reduxjs/toolkit';
import { z } from 'zod';
import type { AppDispatch } from '../store';
import { fetchUser } from '../store/thunks/auth.ts';
import {
  connectRequested,
  disconnectRequested,
  messageReceived,
  messageRejected,
  messageSent,
  sendRequested,
  statusChanged,
} from '../store/slices/chatSlice.ts';
import type { SharedChatMessage, Status } from '../store/slices/chatSlice.ts';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 10000;
const PONG_TIMEOUT_MS = 5000;
const MAX_OUTBOX_SIZE = 50;
const MAX_OUTBOX_AGE_MS = 30000;

// The two kinds of JSON frames the server sends (6d). `type` tells them apart.
const chatEventSchema = z.object({
  type: z.literal('chat'),
  id: z.number().int(),
  author: z.string(),
  text: z.string(),
  clientId: z.string().optional(),
});
const systemEventSchema = z.object({
  type: z.literal('system'),
  text: z.string(),
});
// 7e: the server refused one of our messages, named by its client id.
const rejectedEventSchema = z.object({
  type: z.literal('rejected'),
  clientId: z.string(),
  reason: z.string(),
});
const serverEventSchema = z.discriminatedUnion('type', [chatEventSchema, systemEventSchema, rejectedEventSchema]);

const parseServerEvent = (raw: string) => {
  try {
    const result = serverEventSchema.safeParse(JSON.parse(raw));

    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

// Runs once per store: everything below lives as long as the store does.
export const socketMiddleware: Middleware = (api) => {
  // `api.dispatch` is typed without thunks; the store's real dispatch accepts them (fetchUser).
  const dispatch = api.dispatch as AppDispatch;

  let socket: WebSocket | null = null;
  let serverUrl: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  // `clientId`: set for chat messages (7e), so a dropped one can be marked failed.
  let outbox: Array<{ clientId?: string; queuedAt: number; text: string }> = [];
  let lastSeenId = 0;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;

  // 7e: a chat message dropped from the outbox never reached the server, so its optimistic entry has failed.
  const markNotSent = (queuedMessage: { clientId?: string }) => {
    if (queuedMessage.clientId) {
      dispatch(messageRejected({ clientId: queuedMessage.clientId, reason: 'Not sent' }));
    }
  };

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
        markNotSent(queuedMessage);
      } else {
        socket?.send(queuedMessage.text);
      }
    });

    if (queued.length > 0) {
      console.info(`Flushed ${queued.length} queued message(s)`);
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

  const setStatus = (next: Status) => {
    dispatch(statusChanged(next));
  };

  const addMessage = (message: SharedChatMessage) => {
    dispatch(messageReceived(message));
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

  const connect = (url: string) => {
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
      const serverEvent = parseServerEvent(event.data);

      if (!serverEvent) {
        console.warn(`Ignored invalid message: ${event.data}`);

        return;
      }

      // No id: not part of the chat history, so no dedup and no lastSeenId.
      if (serverEvent.type === 'system') {
        addMessage({ kind: 'system', text: serverEvent.text, receivedAt: Date.now() });

        return;
      }

      // 7e: also no id, and only ever about one of our own messages.
      if (serverEvent.type === 'rejected') {
        dispatch(messageRejected({ clientId: serverEvent.clientId, reason: serverEvent.reason }));

        return;
      }

      if (serverEvent.id <= lastSeenId) {
        console.info(`Ignored duplicate #${serverEvent.id}`);

        return;
      }
      lastSeenId = serverEvent.id;
      addMessage({
        kind: 'chat',
        author: serverEvent.author,
        clientId: serverEvent.clientId,
        text: serverEvent.text,
        receivedAt: Date.now(),
      });
    });

    socket.addEventListener('error', () => {
      console.info('Error event');
    });

    socket.addEventListener('close', (event) => {
      console.info(
        `Closed: code ${event.code} - reason="${event.reason}". Was clean: ${event.wasClean ? 'yes' : 'no'}`,
      );
      stopHeartbeat();
      socket = null;
      setStatus('closed');

      if (event.code === 4401) {
        console.info('Not reconnecting: unauthorized');
        shouldReconnect = false;

        dispatch(fetchUser());

        return;
      }

      if (event.code === 4403) {
        console.info(`Not reconnecting: ${event.reason}`);
        shouldReconnect = false;
        addMessage({ kind: 'system', text: `You were disconnected: ${event.reason}`, receivedAt: Date.now() });

        return;
      }

      if (event.code === 1008) {
        console.info(`Not reconnecting: policy violation (${event.reason})`);
        shouldReconnect = false;

        return;
      }

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

  const disconnect = () => {
    shouldReconnect = false;
    reconnectAttempt = 0;
    clearReconnectTimer();

    if (outbox.length > 0) {
      console.info(`Dropped ${outbox.length} queued message(s)`);
    }

    outbox.forEach(markNotSent);
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

  const send = (text: string, clientId?: string) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(text);

      return;
    }

    if (!shouldReconnect) {
      console.warn('Not sent: disconnected on purpose');
      markNotSent({ clientId });

      return;
    }

    if (outbox.length >= MAX_OUTBOX_SIZE) {
      console.warn('Not sent: outbox is full');
      markNotSent({ clientId });

      return;
    }

    outbox.push({ clientId, queuedAt: Date.now(), text });
    console.info(`Queued "${text}" (${outbox.length} waiting)`);
  };

  // Runs for every dispatched action: pass it on first, then act on the commands this middleware owns.
  return (next) => (action) => {
    const result = next(action);

    if (connectRequested.match(action)) {
      connect(action.payload);
    } else if (disconnectRequested.match(action)) {
      disconnect();
    } else if (sendRequested.match(action)) {
      send(action.payload);
    } else if (messageSent.match(action)) {
      const { clientId, text } = action.payload;
      send(JSON.stringify({ type: 'chat', clientId, text }), clientId);
    }

    return result;
  };
};
