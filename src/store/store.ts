import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { authReducer } from './slices/authSlice.ts';
import { chatReducer } from './slices/chatSlice.ts';
import { socketMiddleware } from '../middleware/socketMiddleware.ts';
import { authListenerMiddleware } from '../middleware/authListenerMiddleware.ts';

const rootReducer = combineReducers({
  auth: authReducer,
  chat: chatReducer,
});

export function setupStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(authListenerMiddleware.middleware).concat(socketMiddleware),
    preloadedState,
  });
}

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(authListenerMiddleware.middleware).concat(socketMiddleware),
});

export type AppDispatch = typeof store.dispatch;

export type RootState = ReturnType<typeof store.getState>;
export type AppStore = ReturnType<typeof setupStore>;
