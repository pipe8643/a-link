import { zodResolver } from "@hookform/resolvers/zod";
import { Laptop, LogOut, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError, PasswordField, TextField } from "@/components/form-fields";
import { PageHeader, QueryError } from "@/components/page";
import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useChangePassword,
  useMe,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
  useUpdateProfile,
} from "@/features/auth/queries";
import { LetterheadCard } from "./letterhead-card";
import { applyServerErrors, describeError } from "@/lib/form-errors";
import { describeUserAgent, formatDateTime, formatRelative } from "@/lib/format";
import {
  type ChangePasswordValues,
  PASSWORD_MIN,
  type ProfileValues,
  changePasswordSchema,
  profileSchema,
} from "@/lib/schemas";

function ProfileCard() {
  const me = useMe();
  const update = useUpdateProfile();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { displayName: me.data?.displayName ?? "" } });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const { user } = await update.mutateAsync(values);
      reset({ displayName: user.displayName });
      toast.success("Perfil actualizado");
    } catch (err) {
      setServerError(applyServerErrors<ProfileValues>(err, setError, ["displayName"]));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil</CardTitle>
        <CardDescription>Tu correo es tu identificador de acceso y no se puede cambiar desde aquí.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-4">
          <FormError message={serverError} />
          <TextField label="Correo electrónico" value={me.data?.email ?? ""} readOnly disabled />
          <TextField label="Nombre" autoComplete="name" maxLength={120} error={errors.displayName?.message} {...register("displayName")} />
          <div>
            <Button type="submit" loading={update.isPending} disabled={!isDirty}>
              Guardar cambios
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const change = useChangePassword();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await change.mutateAsync({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      reset();
      toast.success("Contraseña cambiada. Se han cerrado tus otras sesiones.");
    } catch (err) {
      setServerError(applyServerErrors<ChangePasswordValues>(err, setError, ["currentPassword", "newPassword"]));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contraseña</CardTitle>
        <CardDescription>Al cambiarla se cerrarán las sesiones abiertas en otros dispositivos.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-4">
          <FormError message={serverError} />
          <PasswordField label="Contraseña actual" autoComplete="current-password" error={errors.currentPassword?.message} {...register("currentPassword")} />
          <PasswordField
            label="Nueva contraseña"
            autoComplete="new-password"
            hint={`Mínimo ${PASSWORD_MIN} caracteres.`}
            error={errors.newPassword?.message}
            {...register("newPassword")}
          />
          <PasswordField label="Repite la nueva contraseña" autoComplete="new-password" error={errors.confirmPassword?.message} {...register("confirmPassword")} />
          <div>
            <Button type="submit" loading={change.isPending}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const others = (sessions.data ?? []).filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sesiones activas</CardTitle>
        <CardDescription>Dispositivos con la sesión abierta. Cierra los que no reconozcas.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {sessions.isPending ? (
          <Skeleton className="h-16" />
        ) : sessions.isError ? (
          <QueryError error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {sessions.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Laptop className="size-5 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {describeUserAgent(s.userAgent)}
                      {s.current && <Badge variant="default">Esta sesión</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground" title={formatDateTime(s.createdAt)}>
                      Iniciada {formatRelative(s.createdAt)} · último uso {formatRelative(s.lastUsedAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={revoke.isPending && revoke.variables === s.id}
                      onClick={() =>
                        revoke.mutate(s.id, {
                          onSuccess: () => toast.success("Sesión cerrada"),
                          onError: (err) => toast.error(describeError(err)),
                        })
                      }
                    >
                      Cerrar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {others > 0 && (
              <div>
                <Button
                  variant="outline"
                  loading={revokeOthers.isPending}
                  onClick={() =>
                    revokeOthers.mutate(undefined, {
                      onSuccess: () => toast.success("Se han cerrado las demás sesiones"),
                      onError: (err) => toast.error(describeError(err)),
                    })
                  }
                >
                  <LogOut aria-hidden="true" /> Cerrar las demás sesiones
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const { dark, toggle } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Apariencia</CardTitle>
        <CardDescription>Se guarda solo en este navegador.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={toggle} aria-pressed={dark}>
          {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          {dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title="Ajustes" description="Tu perfil, tu seguridad y tus preferencias." />
      <ProfileCard />
      <LetterheadCard />
      <PasswordCard />
      <SessionsCard />
      <AppearanceCard />
    </div>
  );
}
