import type { ReceivedMessage, Status } from '../hooks/useWebSocket.ts';

let status: Status = 'closed';
let messages: ReceivedMessage[] = [];
let socket: WebSocket | null = null;
const listeners = new Set<() => void>();

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

    addMessage({ text: event.data, receivedAt: Date.now() });
  });

  socket.addEventListener('error', () => {
    console.info('Error event');
  });

  socket.addEventListener('close', (event) => {
    console.info(`Closed: code ${event.code} - reason="${event.reason}". Was clean: ${event.wasClean ? 'yes' : 'no'}`);
    socket = null;
    setStatus('closed');
  });
};

export const send = (text: string) => {
  if (socket?.readyState !== WebSocket.OPEN) {
    console.warn(`Not sent: socket is ${socket ? socket.readyState : 'missing'}`);

    return;
  }

  socket.send(text);
};

export const statusStore = {
  subscribe,
  getSnapshot: () => status,
};

export const messagesStore = {
  subscribe,
  getSnapshot: () => messages,
};
