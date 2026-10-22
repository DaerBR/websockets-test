import { useNavigate } from 'react-router';
import { useCallback, useContext, useState } from 'react';
import { toast } from 'sonner';

import { ThunkAppDispatch, useAppDispatch } from './hooks';
import { RootState } from '../store.ts';
import { GlobalLoadingIndicatorContext } from '../../contexts/GlobalLoadingIndicator.tsx';

interface ServerErrorResponse {
	data: {
		messages?: string[];
	};
}

interface ServerError {
	error?: string;
	message?: string;
	status?: string;
	statusText?: string;
}

interface UseThunkOptions {
	successMessage?: string;
	successRedirectRoute?: string;
	useGlobalLoader?: boolean;
}

const getErrorText = (error: ServerError) => {
	if (typeof error !== 'object') {
		return 'Unknown error occurred.';
	}

	if (error.message) {
		return error.message;
	}

	if ('status' in error && error.status && error.statusText) {
		return `Server rejected with error status ${error.status} - ${error.statusText}`;
	}

	if ('message' in error && error.message === 'Rejected') {
		return 'Unauthorized access - request was rejected';
	}

	return 'Unknown error occurred.';
};

export const useThunk = <TThunkArgs>(
	thunk: (args: TThunkArgs) => (dispatch: ThunkAppDispatch, getState: () => RootState, extra: unknown) => any,
	options: UseThunkOptions | undefined = undefined,
): [(args?: TThunkArgs) => Promise<void>, ServerErrorResponse | ServerError | null] => {
	const [error, setError] = useState<ServerError | ServerErrorResponse | null>(null);
	const dispatch = useAppDispatch();
	const navigate = useNavigate();

	// Primitive deps only — inline `options` objects must not recreate the callback every render.
	const successMessage = options?.successMessage;
	const successRedirectRoute = options?.successRedirectRoute;

	const useGlobalLoader = options?.useGlobalLoader ?? false;
	const { handleShowLoadingIndicator } = useContext(GlobalLoadingIndicatorContext);

	const dispatchThunk = useCallback(
		async (args?: TThunkArgs) => {
			if (useGlobalLoader) {
				handleShowLoadingIndicator(true);
			}

			try {
				await dispatch(thunk(args as TThunkArgs)).unwrap();

				if (successMessage) {
					toast.success(successMessage);
				}

				if (successRedirectRoute) {
					navigate(successRedirectRoute);
				}
			} catch (e) {
				const errorText = getErrorText(e as ServerError);

				toast.error(errorText);
				setError(e as ServerError);
			} finally {
				if (useGlobalLoader) {
					handleShowLoadingIndicator(false);
				}
			}
		},
		[dispatch, thunk, successMessage, successRedirectRoute, useGlobalLoader, handleShowLoadingIndicator, navigate],
	);

	return [dispatchThunk, error];
};
