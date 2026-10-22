import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { FormError, PasswordField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/form-errors";
import { PASSWORD_MIN, type ResetPasswordValues, resetPasswordSchema } from "@/lib/schemas";
import { AuthLayout } from "./auth-layout";
import { useResetPassword } from "./queries";
import { resetTokenFromLocation } from "./reset-token";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const reset = useResetPassword();
  const [serverError, setServerError] = useState<string | null>(null);

  // El token llega en el fragmento (`#`) o, por compatibilidad, en `?token=`. Se guarda en memoria y se
  // quita de la barra de direcciones y del historial para que no quede visible ni se copie por accidente.
  const [token] = useState(() => resetTokenFromLocation(location.search, location.hash));
  useEffect(() => {
    if (location.search || location.hash) navigate({ pathname: location.pathname, search: "", hash: "" }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  if (!token) {
    return (
      <AuthLayout
        title="Enlace no válido"
        footer={
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Solicitar un enlace nuevo
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">Falta el código de recuperación. Abre el enlace completo del correo o solicita uno nuevo.</p>
      </AuthLayout>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await reset.mutateAsync({ token, newPassword: values.newPassword });
      toast.success("Contraseña actualizada. Inicia sesión con la nueva.");
      navigate("/login", { replace: true });
    } catch (err) {
      setServerError(describeError(err));
    }
  });

  return (
    <AuthLayout title="Nueva contraseña" description="Elige una contraseña que no uses en otros sitios.">
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={serverError} />
        <PasswordField
          label="Nueva contraseña"
          autoComplete="new-password"
          autoFocus
          hint={`Mínimo ${PASSWORD_MIN} caracteres.`}
          error={errors.newPassword?.message}
          {...register("newPassword")}
        />
        <PasswordField label="Repite la contraseña" autoComplete="new-password" error={errors.confirmPassword?.message} {...register("confirmPassword")} />
        <Button type="submit" loading={reset.isPending}>
          Cambiar contraseña
        </Button>
      </form>
    </AuthLayout>
  );
}
