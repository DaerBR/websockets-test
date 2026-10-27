import { BrowserRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@emotion/react';

import { ChatStatusBadge } from './components/atoms/ChatStatusBadge';
import { Chat, Error, Homepage, Rooms, SharedChat } from './pages';
import { theme } from './styles/theme.ts';
import './index.css';

export const App = () => (
  <BrowserRouter>
    <ThemeProvider theme={theme}>
      <ChatStatusBadge />
      <Routes>
        <Route path="/" element={<Homepage />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/shared-chat" element={<SharedChat />} />
        <Route path="/rooms" element={<Rooms />} />
        <Route path="/not-found" element={<Error errorCode={404} />} />
        <Route path="*" element={<Error errorCode={404} />} />
      </Routes>
    </ThemeProvider>
  </BrowserRouter>
);
