import { createContext } from 'react';

export const GlobalLoadingIndicatorContext = createContext({
	isVisible: false,
	handleShowLoadingIndicator: (_isOpen: boolean) => {
		/* void */
	},
});
