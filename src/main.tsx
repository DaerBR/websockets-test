import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { StrictMode } from 'react';

import { App } from './App.tsx';
import { connect } from './socket/chatStore.ts';
// import { connect as connectRoomChat } from './socket/roomChatStore.ts';
import { store } from './store';

connect('ws://localhost:8081');
// connectRoomChat('ws://localhost:8082');

const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);

root.render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
