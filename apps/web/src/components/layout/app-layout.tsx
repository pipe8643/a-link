import { FileDown, LayoutDashboard, LogOut, Menu, Moon, Network, Settings, Sun, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Brand } from "@/components/brand";
import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLogout, useMe } from "@/features/auth/queries";
import { useDashboard } from "@/features/library/queries";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

const NAV = [
  { to: "/", label: "Panel", icon: LayoutDashboard, end: true },
  { to: "/graphs", label: "Grafos", icon: Network, end: false },
  { to: "/exports", label: "Exportaciones", icon: FileDown, end: false },
  { to: "/trash", label: "Papelera", icon: Trash2, end: false },
  { to: "/settings", label: "Ajustes", icon: Settings, end: false },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const dashboard = useDashboard();
  const trashed = dashboard.data?.counts.trashedGraphs ?? 0;
  return (
    <nav aria-label="Principal" className="grid gap-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="flex-1">{label}</span>
          {to === "/trash" && trashed > 0 && <Badge>{trashed}</Badge>}
        </NavLink>
      ))}
    </nav>
  );
}

function UserMenu() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();
  const user = me.data;
  if (!user) return null;
  const shownName = user.displayName || user.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2" aria-label="Menú de usuario">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {shownName.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden max-w-40 truncate text-sm sm:inline">{shownName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{user.displayName || "Mi cuenta"}</span>
          <span className="truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <UserRound aria-hidden="true" /> Perfil y seguridad
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggle}>
          {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          {dark ? "Tema claro" : "Tema oscuro"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) })}
        >
          <LogOut aria-hidden="true" /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Al cambiar de ruta el menú móvil se cierra y el foco vuelve al contenido principal.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-sidebar p-4 lg:flex">
        <Brand className="px-2 pt-1" />
        <NavList />
        <p className="mt-auto px-2 text-xs text-muted-foreground">Fase 3 · gestión de grafos</p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur lg:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle>Menú de navegación</SheetTitle>
              <SheetDescription>Secciones de la aplicación</SheetDescription>
              <Brand className="mb-4 px-2" />
              <NavList onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <Brand className="text-base lg:hidden [&>svg]:size-6" />
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>

        <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 p-4 outline-hidden sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
