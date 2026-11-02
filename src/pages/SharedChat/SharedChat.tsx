import { FormEvent, useState } from 'react';
import { connect, disconnect, send } from '../../socket/chatStore.ts';
import { useChatMessages, useChatStatus } from '../../socket/hooks.ts';
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
} from '../Chat/styles.ts';
import { leaveButtonStyles, ownMessageStyles, roomHeaderStyles } from '../Rooms/styles.ts';
import { connectionButtonsStyles } from './styles.ts';
import { MAX_MESSAGE_LENGTH, SERVER_URL } from '../../api/constants.ts';
import { useAuth } from '../../auth/hooks.ts';

export const SharedChat = () => {
  const theme = useAppTheme();
  const status = useChatStatus();
  const chatMessages = useChatMessages();
  const { user } = useAuth();
  const [messageDraft, setMessageDraft] = useState('');

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
      <div css={roomHeaderStyles(theme)}>
        <div css={statusBadgeStyles(theme, statusColors)}>{`Status: ${status}`}</div>
        <div css={connectionButtonsStyles(theme)}>
          <button
            type="button"
            disabled={status !== 'closed'}
            onClick={() => connect(SERVER_URL)}
            css={leaveButtonStyles(theme)}
          >
            Connect
          </button>
          <button type="button" onClick={disconnect} css={leaveButtonStyles(theme)}>
            Disconnect
          </button>
        </div>
      </div>
      <div css={messageListStyles(theme)}>
        {chatMessages.map((message, index) => {
          const time = new Date(message.receivedAt).toLocaleTimeString();

          if (message.kind === 'system') {
            return (
              <span key={`message-${index}`} css={lastMessageStyles(theme)}>
                {`${time}: ${message.text}`}
              </span>
            );
          }

          return (
            <span
              key={`message-${index}`}
              css={message.author === user ? ownMessageStyles(theme) : messageStyles(theme)}
            >
              {`${time} ${message.author}: ${message.text}`}
            </span>
          );
        })}
      </div>
      <form css={inputRowStyles(theme)} onSubmit={handleSend}>
        <input
          type="text"
          value={messageDraft}
          onChange={(e) => setMessageDraft(e.target.value)}
          css={inputStyles(theme)}
          maxLength={MAX_MESSAGE_LENGTH}
        />

        <button disabled={messageDraft.trim() === ''} type="submit" css={sendButtonStyles(theme)}>
          Send
        </button>
      </form>
    </div>
  );
};
