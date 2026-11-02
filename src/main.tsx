import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { StrictMode } from 'react';

import { App } from './App.tsx';
import { connect, disconnect } from './socket/chatStore.ts';
import { store } from './store';
import { SERVER_URL } from './api/constants.ts';
import { authStore, loadUser } from './auth/authStore.ts';

loadUser();

authStore.subscribe(() => {
  if (authStore.getSnapshot().user) {
    connect(SERVER_URL);
  } else {
    disconnect();
  }
});

const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);

root.render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
