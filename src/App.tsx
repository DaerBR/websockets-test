import { BrowserRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@emotion/react';

import { Error, Homepage } from './pages';
import { theme } from './styles/theme.ts';
import './index.css';

export const App = () => (
	<BrowserRouter>
		<ThemeProvider theme={theme}>
			<Routes>
				<Route path="/" element={<Homepage />} />
				<Route path="/not-found" element={<Error errorCode={404}/>} />
				<Route path="*" element={<Error errorCode={404}/>} />
			</Routes>
		</ThemeProvider>
	</BrowserRouter>
);
