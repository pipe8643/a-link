import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { FormError, PasswordField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { applyServerErrors } from "@/lib/form-errors";
import { PASSWORD_MIN, type RegisterValues, registerSchema } from "@/lib/schemas";
import { AuthLayout } from "./auth-layout";
import { useRegister } from "./queries";

export function RegisterPage() {
  const navigate = useNavigate();
  const registerUser = useRegister();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await registerUser.mutateAsync({
        email: values.email,
        password: values.password,
        ...(values.displayName ? { displayName: values.displayName } : {}),
      });
      toast.success("Cuenta creada. ¡Bienvenido a A-Link!");
      navigate("/", { replace: true });
    } catch (err) {
      setServerError(applyServerErrors<RegisterValues>(err, setError, ["email", "password", "displayName"]));
    }
  });

  return (
    <AuthLayout
      title="Crear cuenta"
      description="Empieza a organizar y visualizar tus relaciones."
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Iniciar sesión
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={serverError} />
        <TextField label="Nombre (opcional)" autoComplete="name" error={errors.displayName?.message} {...register("displayName")} />
        <TextField label="Correo electrónico" type="email" autoComplete="username" error={errors.email?.message} {...register("email")} />
        <PasswordField
          label="Contraseña"
          autoComplete="new-password"
          hint={`Mínimo ${PASSWORD_MIN} caracteres. Una frase larga es más segura que una palabra con símbolos.`}
          error={errors.password?.message}
          {...register("password")}
        />
        <PasswordField label="Repite la contraseña" autoComplete="new-password" error={errors.confirmPassword?.message} {...register("confirmPassword")} />
        <Button type="submit" loading={registerUser.isPending}>
          Crear cuenta
        </Button>
      </form>
    </AuthLayout>
  );
}
