import { z } from 'zod';
import { apiRequest } from './apiRequest.ts';

const userSchema = z.object({ name: z.string().nullable(), role: z.enum(['admin', 'user']).nullable() });
const loggedInUserSchema = z.object({ name: z.string(), role: z.enum(['admin', 'user']) });

export const fetchUser = async () => {
  const response = await apiRequest.get('/user');

  return userSchema.parse(response.data);
};

export const login = async (name: string, password: string) => {
  const response = await apiRequest.post('/login', { name, password });

  return loggedInUserSchema.parse(response.data);
};

export const logout = async (): Promise<void> => {
  await apiRequest.post('/logout');
};
