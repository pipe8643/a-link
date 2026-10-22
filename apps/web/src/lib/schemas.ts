import { z } from "zod";

/**
 * Validación en el cliente SOLO para dar respuesta inmediata. La fuente de verdad es la API, que
 * vuelve a validar todo (y rechaza campos no declarados).
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 2000;

const noControlChars = (s: string) => !/[\u0000-\u001f\u007f]/.test(s);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Introduce tu correo")
  .max(254, "El correo es demasiado largo")
  .pipe(z.email("Introduce un correo válido"));

const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Usa al menos ${PASSWORD_MIN} caracteres`)
  .max(PASSWORD_MAX, `Usa como máximo ${PASSWORD_MAX} caracteres`);

/** Refleja `passwordViolatesPolicy` del servidor para avisar antes de enviar. */
export function passwordContainsEmail(password: string, emailValue: string): boolean {
  const local = emailValue.split("@")[0] ?? "";
  const lower = password.toLowerCase();
  return lower === emailValue.toLowerCase() || (local.length >= 4 && lower.includes(local.toLowerCase()));
}

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Introduce tu contraseña").max(PASSWORD_MAX),
});

export const registerSchema = z
  .object({
    displayName: z.string().trim().max(120, "Máximo 120 caracteres"),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Las contraseñas no coinciden" })
  .refine((v) => !passwordContainsEmail(v.password, v.email), {
    path: ["password"],
    message: "La contraseña no puede contener tu correo",
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ newPassword, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Las contraseñas no coinciden" });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Introduce tu contraseña actual").max(PASSWORD_MAX),
    newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Las contraseñas no coinciden" })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "La nueva contraseña debe ser distinta de la actual",
  });

export const profileSchema = z.object({ displayName: z.string().trim().max(120, "Máximo 120 caracteres") });

const name = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio")
  .max(NAME_MAX, `Máximo ${NAME_MAX} caracteres`)
  .refine(noControlChars, "El nombre contiene caracteres no permitidos");

export const folderSchema = z.object({ name });

export const graphSchema = z.object({
  name,
  description: z.string().trim().max(DESCRIPTION_MAX, `Máximo ${DESCRIPTION_MAX} caracteres`),
  /** "" = sin carpeta (raíz). */
  folderId: z.string(),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
export type ProfileValues = z.infer<typeof profileSchema>;
export type FolderValues = z.infer<typeof folderSchema>;
export type GraphValues = z.infer<typeof graphSchema>;
