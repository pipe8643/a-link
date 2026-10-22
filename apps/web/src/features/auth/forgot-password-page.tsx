import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { FormError, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/form-errors";
import { type ForgotPasswordValues, forgotPasswordSchema } from "@/lib/schemas";
import { AuthLayout } from "./auth-layout";
import { useForgotPassword } from "./queries";

export function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await forgot.mutateAsync(values);
      setSent(true);
    } catch (err) {
      setServerError(describeError(err));
    }
  });

  const backToLogin = (
    <Link to="/login" className="font-medium text-primary hover:underline">
      Volver a iniciar sesión
    </Link>
  );

  if (sent) {
    return (
      <AuthLayout title="Revisa tu correo" footer={backToLogin}>
        <div className="flex flex-col items-center gap-3 text-center" role="status">
          <MailCheck className="size-10 text-success" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Si existe una cuenta con ese correo, te hemos enviado un enlace para restablecer la contraseña. Caduca en poco
            tiempo y solo se puede usar una vez.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Recuperar contraseña" description="Te enviaremos un enlace para crear una nueva." footer={backToLogin}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={serverError} />
        <TextField label="Correo electrónico" type="email" autoComplete="username" autoFocus error={errors.email?.message} {...register("email")} />
        <Button type="submit" loading={forgot.isPending}>
          Enviar enlace
        </Button>
      </form>
    </AuthLayout>
  );
}
