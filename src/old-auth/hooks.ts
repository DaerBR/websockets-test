import { useSyncExternalStore } from 'react';
import { authStore } from './authStore.ts';

export const useAuth = () => useSyncExternalStore(authStore.subscribe, authStore.getSnapshot);
