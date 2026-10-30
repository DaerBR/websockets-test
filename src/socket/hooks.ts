import { useSyncExternalStore } from 'react';
import { messagesStore, statusStore } from './chatStore.ts';

export const useChatStatus = () => useSyncExternalStore(statusStore.subscribe, statusStore.getSnapshot);

export const useChatMessages = () => useSyncExternalStore(messagesStore.subscribe, messagesStore.getSnapshot);
