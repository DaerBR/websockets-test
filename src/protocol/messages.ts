import { z } from 'zod';

export type ClientMessage =
  | { payload: { room: string; user: string }; type: 'join' }
  | { payload: { room: string }; type: 'leave' }
  | { id: string; payload: { room: string; text: string }; type: 'chat.send' }
  | { payload: { isTyping: boolean; room: string }; type: 'typing' };

const chatMessageSchema = z.object({
  type: z.literal('chat.message'),
  payload: z.object({
    id: z.string(),
    room: z.string(),
    user: z.string(),
    text: z.string(),
    ts: z.number(),
  }),
});

const ackSchema = z.object({
  type: z.literal('ack'),
  payload: z.object({
    id: z.string(),
    ts: z.number(),
  }),
});

const typingSchema = z.object({
  type: z.literal('typing'),
  payload: z.object({
    room: z.string(),
    user: z.string(),
    isTyping: z.boolean(),
  }),
});

const errorSchema = z.object({
  type: z.literal('error'),
  payload: z.object({
    message: z.string(),
    id: z.string().optional(),
  }),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  chatMessageSchema,
  ackSchema,
  typingSchema,
  errorSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const parseServerMessage = (raw: string): ServerMessage | null => {
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    console.warn('Dropped a message that is not JSON:', raw);

    return null;
  }

  const result = serverMessageSchema.safeParse(json);

  if (!result.success) {
    console.warn(`Dropped an invalid message:\n${z.prettifyError(result.error)}`, json);

    return null;
  }

  return result.data;
};
