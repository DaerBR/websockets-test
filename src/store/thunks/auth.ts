import { createAsyncThunk } from '@reduxjs/toolkit';
import type { AxiosError } from 'axios';

import { apiRequest } from '../../api/apiRequest';
import { UserData } from '../slices/authSlice.ts';

interface SignInParams {
  name: string;
  password: string;
}

export const signIn = createAsyncThunk<UserData, SignInParams, { rejectValue: { message: string } }>(
  'auth/signIn',
  async (params, { rejectWithValue }) => {
    try {
      const response = await apiRequest.request<UserData>({
        url: `/login`,
        method: 'post',
        data: params,
      });

      return response.data;
    } catch (error: unknown) {
      return rejectWithValue({
        message: (error as AxiosError<{ error?: string }>).response?.data?.error ?? 'Login failed, try again',
      });
    }
  },
);

export const signOut = createAsyncThunk<void, void>('auth/signOut', async (_, { rejectWithValue }) => {
  try {
    const response = await apiRequest.request({
      url: `/logout`,
      method: 'post',
    });

    return response.data;
  } catch (error: unknown) {
    return rejectWithValue((error as AxiosError).response?.data);
  }
});

export const fetchUser = createAsyncThunk<UserData | null, void>('api/fetchUser', async (_, { rejectWithValue }) => {
  try {
    const response = await apiRequest.request<{ name: string | null; role: UserData['role'] | null }>({
      url: `/user`,
      method: 'get',
    });
    const { name, role } = response.data;

    return name && role ? { name, role } : null;
  } catch (error: unknown) {
    return rejectWithValue((error as AxiosError).response?.data);
  }
});
