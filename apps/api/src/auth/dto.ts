import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export const PASSWORD_MIN = 12;
/** Tope alto pero finito: evita que contraseñas gigantes se usen para agotar CPU/memoria con Argon2. */
export const PASSWORD_MAX = 128;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  displayName?: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // En el login NO se exige la longitud mínima: no debe revelar la política ni rechazar cuentas antiguas.
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ForgotPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  @MaxLength(128)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  displayName?: string;
}
