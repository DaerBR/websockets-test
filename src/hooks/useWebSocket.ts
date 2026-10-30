import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

export type Status = 'connecting' | 'open' | 'closed';
export type ReceivedMessage = { receivedAt: number; text: string };
export type Options = { onMessage?: (message: ReceivedMessage) => void };

interface UseWebSocketResult {
  lastMessage: ReceivedMessage | null;
  send: (text: string) => void;
  status: Status;
}

interface UseWebSocketProps {
  options?: Options;
  url: string;
}

export const useWebSocket = ({ options, url }: UseWebSocketProps): UseWebSocketResult => {
  const [status, setStatus] = useState<Status>('connecting');
  const [lastMessage, setLastMessage] = useState<ReceivedMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const handleMessage = useEffectEvent((message: ReceivedMessage) => {
    if (options?.onMessage) {
      options.onMessage(message);
    }
  });

  useEffect(() => {
    const socket = new WebSocket(url);
    wsRef.current = socket;
    setStatus('connecting');

    socket.addEventListener('open', () => {
      if (wsRef.current !== socket) {
        return;
      }

      console.info('Opened websocket connection');
      setStatus('open');
    });

    socket.addEventListener('message', (event) => {
      if (wsRef.current !== socket) {
        return;
      }

      if (typeof event.data !== 'string') {
        console.warn('Binary message ignored');

        return;
      }

      const message: ReceivedMessage = {
        text: event.data,
        receivedAt: Date.now(),
      };
      setLastMessage(message);
      handleMessage(message);
    });

    socket.addEventListener('error', () => {
      console.info('Error event');
    });

    socket.addEventListener('close', (event) => {
      console.info(
        `Closed: code ${event.code} - reason="${event.reason}". Was clean: ${event.wasClean ? 'yes' : 'no'}`,
      );

      if (wsRef.current !== socket) {
        return;
      }

      setStatus('closed');
    });

    return () => {
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      socket.close(1000, 'component unmounted');
    };
  }, [url]);

  const send = useCallback((text: string) => {
    const socket = wsRef.current;

    if (socket?.readyState !== WebSocket.OPEN) {
      console.warn(`Not sent: socket is ${socket ? socket.readyState : 'missing'}`);

      return;
    }

    socket.send(text);
  }, []);

  return { status, lastMessage, send };
};
