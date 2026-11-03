import { createSlice } from '@reduxjs/toolkit';
import { fetchUser, signIn, signOut } from '../thunks/auth.ts';

export interface UserData {
  name: string;
  role: string;
}
interface AuthState {
  isLoading: boolean;
  isUserFetched: boolean;
  userData: UserData | null;
}

const initialState: AuthState = {
  isLoading: false,
  isUserFetched: false,
  userData: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers(builder) {
    builder.addCase(fetchUser.pending, (state) => {
      state.isLoading = true;
    });
    builder.addCase(fetchUser.fulfilled, (state, action) => {
      state.isLoading = false;
      state.userData = action.payload;
      state.isUserFetched = true;
    });
    builder.addCase(fetchUser.rejected, (state) => {
      state.isLoading = false;
      state.userData = null;
      state.isUserFetched = true;
    });
    builder.addCase(signIn.pending, (state) => {
      state.isLoading = true;
    });
    builder.addCase(signIn.fulfilled, (state, action) => {
      state.isLoading = false;
      state.userData = action.payload;
      state.isUserFetched = true;
    });
    builder.addCase(signIn.rejected, (state) => {
      state.isLoading = false;
    });
    builder.addCase(signOut.pending, (state) => {
      state.isLoading = true;
    });
    builder.addCase(signOut.fulfilled, (state) => {
      state.isLoading = false;
      state.userData = null;
    });
    builder.addCase(signOut.rejected, (state) => {
      state.isLoading = false;
    });
  },
});

export const authReducer = authSlice.reducer;
