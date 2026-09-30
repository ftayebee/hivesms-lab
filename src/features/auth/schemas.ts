import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";
import { normalizeBdPhone } from "@/lib/phone";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254)
  .pipe(z.email("Enter a valid email address."));

export const bdPhoneSchema = z
  .string()
  .trim()
  .min(1, "Enter your mobile number.")
  .transform((v, ctx) => {
    const n = normalizeBdPhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a valid Bangladesh mobile number, e.g. 01712345678." });
      return z.NEVER;
    }
    return n;
  });

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name.").max(100),
    company: z.string().trim().min(2, "Enter your company or organization name.").max(120),
    email: emailSchema,
    phone: bdPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: "You must accept the Terms and Privacy Policy." }),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or mobile number.").max(254),
  password: z.string().min(1, "Enter your password.").max(128),
  remember: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const otpSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
