import { useState } from 'react';
import { ReceivedMessage, useWebSocket } from '../../hooks/useWebSocket.ts';
import { useAppTheme } from '../../styles/hooks.ts';
import {
  containerStyles,
  inputRowStyles,
  inputStyles,
  lastMessageStyles,
  messageListStyles,
  messageStyles,
  sendButtonStyles,
  statusBadgeStyles,
} from './styles.ts';

const SERVER_URL = 'ws://localhost:8081';

export const Chat = () => {
  const theme = useAppTheme();
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [draft, setDraft] = useState('');

  const { status, lastMessage, send } = useWebSocket({
    url: SERVER_URL,
    options: {
      onMessage: (message) => {
        setMessages((prevMessages) => [...prevMessages, message]);
      },
    },
  });

  const handleSend = () => {
    const trimmedDraft = draft.trim();

    if (trimmedDraft !== '') {
      send(trimmedDraft);
      setDraft('');
    }
  };

  const statusColors = {
    connecting: theme.colors.primary,
    open: theme.colors.success,
    closed: theme.colors.error,
  }[status];

  return (
    <div css={containerStyles(theme)}>
      <div css={statusBadgeStyles(theme, statusColors)}>{`Status: ${status}`}</div>
      <div css={messageListStyles(theme)}>
        {messages.map((message, index) => (
          <span key={`message-${index}`} css={messageStyles(theme)}>
            {`${new Date(message.receivedAt).toLocaleTimeString()}: ${message.text}`}
          </span>
        ))}
      </div>
      <div css={lastMessageStyles(theme)}>{lastMessage?.text ?? '-'}</div>
      <div css={inputRowStyles(theme)}>
        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} css={inputStyles(theme)} />

        <button disabled={draft.trim() === '' || status !== 'open'} onClick={handleSend} css={sendButtonStyles(theme)}>
          Send
        </button>
      </div>
    </div>
  );
};
