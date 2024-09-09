import { z } from 'zod';

export const userSchema = z.object({
  username: z
    .string()
    .min(3, { message: 'Username must be at least 3 characters long' })
    .max(20, { message: 'Username must be at most 20 characters long' })
    .regex(/^[a-zA-Z0-9_]+$/, {
      message: 'Username can only contain letters, numbers, and underscores',
    }),
  password: z.string().min(8),
  displayName: z.string().min(3),
  unit: z.enum(['imperial', 'metric']).default('metric'),
  role: z.enum(['user', 'admin']).default('user'),
});

export const editUserSchema = userSchema.omit({ password: true, role: true });

export const addUserSchema = userSchema;
