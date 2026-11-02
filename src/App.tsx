import { BrowserRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@emotion/react';

import { TopBar } from './components/TopBar';
import { Chat, Error, Homepage, Rooms, SharedChat } from './pages';
import { theme } from './styles/theme.ts';
import './index.css';
import { useApiNavigate } from './api/apiRequest.ts';

const AppRoutes = () => {
  useApiNavigate();

  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/" element={<Homepage />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/shared-chat" element={<SharedChat />} />
        <Route path="/rooms" element={<Rooms />} />
        <Route path="/not-found" element={<Error errorCode={404} />} />
        <Route path="*" element={<Error errorCode={404} />} />
      </Routes>
    </>
  );
};

export const App = () => (
  <BrowserRouter>
    <ThemeProvider theme={theme}>
      <AppRoutes />
    </ThemeProvider>
  </BrowserRouter>
);
