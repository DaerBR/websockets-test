import { FormEvent, useState } from 'react';
import { send } from '../../socket/chatStore.ts';
import { useChatMessages, useChatStatus } from '../../socket/hooks.ts';
import { useAppTheme } from '../../styles/hooks.ts';
import {
  containerStyles,
  inputRowStyles,
  inputStyles,
  messageListStyles,
  messageStyles,
  sendButtonStyles,
  statusBadgeStyles,
} from '../Chat/styles.ts';

export const SharedChat = () => {
  const theme = useAppTheme();
  const status = useChatStatus();
  const chatMessages = useChatMessages();
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
      <div css={statusBadgeStyles(theme, statusColors)}>{`Status: ${status}`}</div>
      <div css={messageListStyles(theme)}>
        {chatMessages.map((message, index) => (
          <span key={`message-${index}`} css={messageStyles(theme)}>
            {`${new Date(message.receivedAt).toLocaleTimeString()}: ${message.text}`}
          </span>
        ))}
      </div>
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
