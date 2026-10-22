import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { FormError, PasswordField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/form-errors";
import { type LoginValues, loginSchema } from "@/lib/schemas";
import { AuthLayout } from "./auth-layout";
import { useLogin } from "./queries";
import { safeRedirectPath } from "./route-guards";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login.mutateAsync(values);
      navigate(safeRedirectPath((location.state as { from?: unknown } | null)?.from), { replace: true });
    } catch (err) {
      setServerError(describeError(err));
    }
  });

  return (
    <AuthLayout
      title="Iniciar sesión"
      description="Accede a tus grafos de relaciones."
      footer={
        <>
          ¿No tienes cuenta?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Crear cuenta
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={serverError} />
        <TextField label="Correo electrónico" type="email" autoComplete="username" autoFocus error={errors.email?.message} {...register("email")} />
        <PasswordField label="Contraseña" autoComplete="current-password" error={errors.password?.message} {...register("password")} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-primary hover:underline">
            ¿Has olvidado tu contraseña?
          </Link>
        </div>
        <Button type="submit" loading={login.isPending}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
