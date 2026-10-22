import { Toaster as Sonner } from "sonner";

/** Notificaciones. Lee el tema de la clase `dark` del <html> que gestiona ThemeProvider. */
export function Toaster({ dark }: { dark: boolean }) {
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="bottom-right"
      closeButton
      toastOptions={{ classNames: { toast: "!bg-card !text-card-foreground !border-border" } }}
    />
  );
}
