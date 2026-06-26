import { z } from 'zod';

export const AgentSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  tags: z.array(z.union([z.number(), z.string()])).min(1),
});
export type Agent = z.infer<typeof AgentSchema>;

export const TaskSchema = z.object({
  task: z.string().min(1),
  needTags: z.array(z.union([z.number(), z.string()])).default([]),
});
export type Task = z.infer<typeof TaskSchema>;
