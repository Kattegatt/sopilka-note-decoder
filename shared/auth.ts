import { z } from "zod";

export const loginSchema = z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/).transform((value) => value.toLowerCase());
export const credentialsSchema = z.object({
  login: loginSchema,
  password: z.string().min(1).max(128),
});
export const registrationSchema = credentialsSchema.extend({ password: z.string().min(8).max(128) });
