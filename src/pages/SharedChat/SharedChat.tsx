import { FormEvent, useState } from 'react';
import { connectRequested, disconnectRequested, messageSent, sendRequested } from '../../store/slices/chatSlice.ts';
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
} from '../../styles/chatStyles.ts';
import { deliveryStyles, leaveButtonStyles, ownMessageStyles, roomHeaderStyles } from '../Rooms/styles.ts';
import { connectionButtonsStyles } from './styles.ts';
import { MAX_MESSAGE_LENGTH, SERVER_URL } from '../../api/constants.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks/hooks.ts';

// The same icons as /rooms (Stage 3).
const deliveryLabels = {
  pending: { icon: '⏳', title: 'Sending…' },
  sent: { icon: '✓', title: 'Delivered to the server' },
  failed: { icon: '✗', title: 'Not delivered' },
};

export const SharedChat = () => {
  const theme = useAppTheme();
  const status = useAppSelector((state) => state.chat.status);
  const chatMessages = useAppSelector((state) => state.chat.messages);
  const user = useAppSelector((state) => state.auth.userData?.name);
  const [messageDraft, setMessageDraft] = useState('');
  const dispatch = useAppDispatch();

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessageDraft = messageDraft.trim();

    if (trimmedMessageDraft === '' || !user) {
      return;
    }

    // Commands get a system answer, not a place in the list: plain text, not optimistic (7e).
    if (trimmedMessageDraft.startsWith('/')) {
      dispatch(sendRequested(trimmedMessageDraft));
    } else {
      dispatch(messageSent(trimmedMessageDraft, user));
    }

    setMessageDraft('');
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
            onClick={() => dispatch(connectRequested(SERVER_URL))}
            css={leaveButtonStyles(theme)}
          >
            Connect
          </button>
          <button type="button" onClick={() => dispatch(disconnectRequested())} css={leaveButtonStyles(theme)}>
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

          const delivery = message.delivery ? deliveryLabels[message.delivery] : null;

          return (
            <span
              key={`message-${index}`}
              css={message.author === user ? ownMessageStyles(theme) : messageStyles(theme)}
            >
              {`${time} ${message.author}: ${message.text}`}
              {delivery && (
                <span title={delivery.title} css={deliveryStyles(theme, message.delivery === 'failed')}>
                  {delivery.icon}
                  {message.failReason && ` ${message.failReason}`}
                </span>
              )}
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
