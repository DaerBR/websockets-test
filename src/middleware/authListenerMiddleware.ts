import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import { fetchUser, signIn, signOut } from '../store/thunks/auth.ts';
import { connectRequested, disconnectRequested } from '../store/slices/chatSlice.ts';
import { SERVER_URL } from '../api/constants.ts';

export const authListenerMiddleware = createListenerMiddleware();

authListenerMiddleware.startListening({
  actionCreator: signIn.fulfilled,
  effect: (_action, listenerApi) => {
    listenerApi.dispatch(connectRequested(SERVER_URL));
  },
});

authListenerMiddleware.startListening({
  actionCreator: fetchUser.fulfilled,
  effect: (action, listenerApi) => {
    if (action.payload) {
      listenerApi.dispatch(connectRequested(SERVER_URL));
    } else {
      listenerApi.dispatch(disconnectRequested());
    }
  },
});

authListenerMiddleware.startListening({
  matcher: isAnyOf(signOut.fulfilled, fetchUser.rejected),
  effect: (_action, listenerApi) => {
    listenerApi.dispatch(disconnectRequested());
  },
});
