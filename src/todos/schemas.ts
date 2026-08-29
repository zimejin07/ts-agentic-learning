import { z } from 'zod';

export const createTodoSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const patchTodoSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    completed: z.boolean().optional(),
  })
  .refine((value) => value.title !== undefined || value.completed !== undefined, {
    message: 'Provide title and/or completed',
  });

export const todoIdSchema = z.object({
  id: z.string().uuid(),
});

export type TodoDto = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
};
