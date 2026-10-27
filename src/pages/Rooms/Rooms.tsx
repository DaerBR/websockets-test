import { FormEvent, useState } from 'react';
import { ChatEntry, join, leave, notifyTyping, sendChat, useRoomChat } from '../../socket/roomChatStore.ts';
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
import {
  deliveryStyles,
  fieldLabelStyles,
  joinFormStyles,
  leaveButtonStyles,
  messageMetaStyles,
  ownMessageStyles,
  roomHeaderStyles,
  roomTitleStyles,
  typingStyles,
} from './styles.ts';

const deliveryLabels = {
  pending: { icon: '⏳', title: 'Sending…' },
  sent: { icon: '✓', title: 'Delivered to the server' },
  failed: { icon: '✗', title: 'Not delivered' },
};

const formatTyping = (users: string[]) => {
  if (users.length === 0) {
    return '';
  }

  if (users.length === 1) {
    return `${users[0]} is typing…`;
  }

  if (users.length === 2) {
    return `${users[0]} and ${users[1]} are typing…`;
  }

  return `${users.length} people are typing…`;
};

export const Rooms = () => {
  const theme = useAppTheme();
  const { status, user, room, messages, typingUsers } = useRoomChat();
  const [userDraft, setUserDraft] = useState('');
  const [roomDraft, setRoomDraft] = useState('general');
  const [messageDraft, setMessageDraft] = useState('');

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUser = userDraft.trim();
    const trimmedRoom = roomDraft.trim();

    if (trimmedUser !== '' && trimmedRoom !== '') {
      join(trimmedRoom, trimmedUser);
    }
  };

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessageDraft = messageDraft.trim();

    if (trimmedMessageDraft !== '') {
      sendChat(trimmedMessageDraft);
      setMessageDraft('');
    }
  };

  const handleMessageChange = (value: string) => {
    setMessageDraft(value);
    notifyTyping();
  };

  const statusColors = {
    connecting: theme.colors.primary,
    open: theme.colors.success,
    closed: theme.colors.error,
  }[status];

  const renderMessage = (message: ChatEntry) => {
    const time = new Date(message.ts).toLocaleTimeString();

    if (!message.own) {
      return (
        <span key={message.id} css={messageStyles(theme)}>
          <span css={messageMetaStyles(theme)}>{`${message.user} · ${time}`}</span>
          <br />
          {message.text}
        </span>
      );
    }

    const delivery = message.delivery ? deliveryLabels[message.delivery] : null;

    return (
      <span key={message.id} css={ownMessageStyles(theme)}>
        <span css={messageMetaStyles(theme)}>{`You · ${time}`}</span>
        {delivery && (
          <span title={delivery.title} css={deliveryStyles(theme, message.delivery === 'failed')}>
            {delivery.icon}
          </span>
        )}
        <br />
        {message.text}
      </span>
    );
  };

  return (
    <div css={containerStyles(theme)}>
      <div css={statusBadgeStyles(theme, statusColors)}>{`Status: ${status}`}</div>

      {room === null ? (
        <form css={joinFormStyles(theme)} onSubmit={handleJoin}>
          <label css={fieldLabelStyles(theme)}>
            Your name
            <input
              type="text"
              value={userDraft}
              onChange={(e) => setUserDraft(e.target.value)}
              css={inputStyles(theme)}
            />
          </label>
          <label css={fieldLabelStyles(theme)}>
            Room
            <input
              type="text"
              value={roomDraft}
              onChange={(e) => setRoomDraft(e.target.value)}
              css={inputStyles(theme)}
            />
          </label>
          <button
            type="submit"
            disabled={userDraft.trim() === '' || roomDraft.trim() === '' || status !== 'open'}
            css={sendButtonStyles(theme)}
          >
            Join
          </button>
        </form>
      ) : (
        <>
          <div css={roomHeaderStyles(theme)}>
            <h2 css={roomTitleStyles(theme)}>{`#${room} as ${user ?? '?'}`}</h2>
            <button type="button" onClick={leave} css={leaveButtonStyles(theme)}>
              Leave
            </button>
          </div>
          <div css={messageListStyles(theme)}>{messages.map(renderMessage)}</div>
          <div css={typingStyles(theme)}>{formatTyping(typingUsers)}</div>
          <form css={inputRowStyles(theme)} onSubmit={handleSend}>
            <input
              type="text"
              value={messageDraft}
              onChange={(e) => handleMessageChange(e.target.value)}
              css={inputStyles(theme)}
            />

            <button
              disabled={messageDraft.trim() === '' || status !== 'open'}
              type="submit"
              css={sendButtonStyles(theme)}
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
};
