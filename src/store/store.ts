import { configureStore } from '@reduxjs/toolkit';

export function setupStore(preloadedState?: Partial<RootState>) {
	return configureStore({
		reducer: {},
		preloadedState,
	});
}

export const store = configureStore({
	reducer: {},
});

export type AppDispatch = typeof store.dispatch;

export type RootState = ReturnType<typeof store.getState>;
export type AppStore = ReturnType<typeof setupStore>;
