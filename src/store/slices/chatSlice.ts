import { PayloadAction, createAction, createSlice, nanoid } from '@reduxjs/toolkit';

export type Status = 'connecting' | 'open' | 'closed';
export type Delivery = 'pending' | 'sent' | 'failed';

interface ChatState {
  messages: SharedChatMessage[];
  status: Status;
}

export type SharedChatMessage =
  | {
      author: string;
      // 7e: the id a client gave its message (the server echoes it). `delivery` is set only on messages sent from this tab.
      clientId?: string;
      delivery?: Delivery;
      failReason?: string;
      kind: 'chat';
      receivedAt: number;
      text: string;
    }
  | { kind: 'system'; receivedAt: number; text: string };

const initialState: ChatState = {
  messages: [],
  status: 'closed',
};

export const connectRequested = createAction<string>('chat/connectRequested');
export const disconnectRequested = createAction('chat/disconnectRequested');
export const sendRequested = createAction<string>('chat/sendRequested');

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    statusChanged(state, action: PayloadAction<Status>) {
      state.status = action.payload;
    },
    messageReceived(state, action: PayloadAction<SharedChatMessage>) {
      const received = action.payload;
      const pending =
        received.kind === 'chat' && received.clientId
          ? state.messages.find(
              (message) =>
                message.kind === 'chat' && message.delivery !== undefined && message.clientId === received.clientId,
            )
          : undefined;

      // The echo of our own optimistic message: confirm it instead of adding a second copy.
      if (pending?.kind === 'chat') {
        pending.delivery = 'sent';

        return;
      }

      state.messages.push(received);
    },
    messageSent: {
      reducer(state, action: PayloadAction<{ author: string; clientId: string; sentAt: number; text: string }>) {
        const { author, clientId, sentAt, text } = action.payload;

        state.messages.push({ author, clientId, delivery: 'pending', kind: 'chat', receivedAt: sentAt, text });
      },
      // Impure values (a random id, the time) are made here, so the reducer stays pure.
      prepare(text: string, author: string) {
        return { payload: { author, clientId: nanoid(), sentAt: Date.now(), text } };
      },
    },
    messageRejected(state, action: PayloadAction<{ clientId: string; reason: string }>) {
      const rejected = state.messages.find(
        (message) => message.kind === 'chat' && message.clientId === action.payload.clientId,
      );

      if (rejected?.kind === 'chat') {
        rejected.delivery = 'failed';
        rejected.failReason = action.payload.reason;
      }
    },
  },
});

export const { statusChanged, messageReceived, messageSent, messageRejected } = chatSlice.actions;
export const chatReducer = chatSlice.reducer;
