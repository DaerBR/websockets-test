import { FormEvent, useState } from 'react';
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
  const [chatMessages, setChatMessages] = useState<ReceivedMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');

  const { status, lastMessage, send } = useWebSocket({
    url: SERVER_URL,
    options: {
      onMessage: (message) => {
        setChatMessages((prevMessages) => [...prevMessages, message]);
      },
    },
  });

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessageDraft = messageDraft.trim();

    if (trimmedMessageDraft !== '') {
      send(trimmedMessageDraft);
      setMessageDraft('');
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
        {chatMessages.map((message, index) => (
          <span key={`message-${index}`} css={messageStyles(theme)}>
            {`${new Date(message.receivedAt).toLocaleTimeString()}: ${message.text}`}
          </span>
        ))}
      </div>
      <div css={lastMessageStyles(theme)}>{lastMessage?.text ?? '-'}</div>
      <form css={inputRowStyles(theme)} onSubmit={handleSend}>
        <input
          type="text"
          value={messageDraft}
          onChange={(e) => setMessageDraft(e.target.value)}
          css={inputStyles(theme)}
        />

        <button disabled={messageDraft.trim() === '' || status !== 'open'} type="submit" css={sendButtonStyles(theme)}>
          Send
        </button>
      </form>
    </div>
  );
};
