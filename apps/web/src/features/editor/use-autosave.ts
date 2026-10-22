import type { GraphSnapshot } from "@a-link/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { isApiError } from "@/lib/api";

/**
 * Autoguardado con concurrencia optimista.
 *
 *  - Guarda a los `debounceMs` de la última edición y, como mucho, cada `maxWaitMs` aunque se siga editando.
 *  - Nunca hay dos guardados a la vez; si se edita durante un guardado, se encadena otro al terminar.
 *  - `expectedRevision` es la revisión que el servidor devolvió en el último guardado/carga. Si otra ventana
 *    guardó antes, el servidor responde 409 y el autoguardado SE DETIENE (`conflict`): no se sobrescribe nada
 *    sin que el usuario lo decida.
 *  - Fallos de red o 5xx: se reintenta con espera creciente (`offline`). Otros errores (validación, tamaño…)
 *    no se reintentan solos (`error`); el usuario puede pulsar «Reintentar».
 *  - Al salir del editor (o ocultar la pestaña) se intenta guardar lo pendiente.
 */
export type SaveStatus = "saved" | "dirty" | "saving" | "offline" | "error" | "conflict";

export interface SaveResult {
  revision: number;
}

export interface AutosaveOptions {
  doc: GraphSnapshot;
  /** Contador que sube con cada cambio del documento (ver `editor-state`). */
  version: number;
  /** Revisión del servidor con la que se cargó el grafo. */
  initialRevision: number;
  save(doc: GraphSnapshot, expectedRevision: number): Promise<SaveResult>;
  debounceMs?: number;
  maxWaitMs?: number;
  /** Esperas entre reintentos tras un fallo de red (ms). La última se repite. */
  retryDelaysMs?: readonly number[];
}

export interface Autosave {
  status: SaveStatus;
  /** Mensaje legible cuando `status` es `error`. */
  errorMessage: string | null;
  /** Revisión vigente según el último guardado/carga. */
  revision: number;
  lastSavedAt: Date | null;
  /** Revisión que el servidor tiene ahora (solo en `conflict`). */
  serverRevision: number | null;
  saveNow(): Promise<void>;
  /**
   * Tras recargar el documento desde el servidor (`version` vuelve a 0) o decidir sobrescribir:
   * fija la revisión base y el estado «guardado» respecto a `version`.
   */
  adopt(revision: number, opts?: { version?: number; dirty?: boolean }): void;
}

const DEFAULT_RETRY_MS = [3000, 6000, 12000, 30000] as const;

export function useAutosave(options: AutosaveOptions): Autosave {
  const { doc, version, initialRevision, debounceMs = 1500, maxWaitMs = 10_000, retryDelaysMs = DEFAULT_RETRY_MS } = options;

  const retryDelaysRef = useRef(retryDelaysMs);
  retryDelaysRef.current = retryDelaysMs;
  const saveRef = useRef(options.save);
  saveRef.current = options.save;
  const docRef = useRef(doc);
  docRef.current = doc;
  const versionRef = useRef(version);
  versionRef.current = version;

  const savedVersionRef = useRef(version); // al montar, el documento recién cargado está «guardado»
  const revisionRef = useRef(initialRevision);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstDirtyAtRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const conflictRef = useRef(false);
  const blockedRef = useRef(false); // error no reintentable: no se guarda solo hasta una nueva edición o «Reintentar»
  const unmountedRef = useRef(false);

  const [phase, setPhase] = useState<"idle" | "saving" | "offline" | "error" | "conflict">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverRevision, setServerRevision] = useState<number | null>(null);
  const [revision, setRevision] = useState(initialRevision);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savedVersion, setSavedVersion] = useState(version);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const run = useCallback(async (): Promise<void> => {
    if (conflictRef.current) return;
    if (inFlightRef.current) return inFlightRef.current;
    if (versionRef.current === savedVersionRef.current) return;

    const sentVersion = versionRef.current;
    const sentDoc = docRef.current;
    clearTimer();
    setPhase("saving");

    const task = (async () => {
      try {
        const res = await saveRef.current(sentDoc, revisionRef.current);
        revisionRef.current = res.revision;
        savedVersionRef.current = sentVersion;
        failuresRef.current = 0;
        blockedRef.current = false;
        if (unmountedRef.current) return;
        setRevision(res.revision);
        setSavedVersion(sentVersion);
        setLastSavedAt(new Date());
        setErrorMessage(null);
        setPhase("idle");
      } catch (err) {
        if (unmountedRef.current) return;
        if (isApiError(err) && err.status === 409 && err.code === "REVISION_CONFLICT") {
          conflictRef.current = true;
          const current = Number(err.details.currentRevision);
          setServerRevision(Number.isFinite(current) ? current : null);
          setPhase("conflict");
        } else if (!isApiError(err) || err.status === 0 || err.status >= 500 || err.status === 429) {
          failuresRef.current += 1;
          setPhase("offline");
          const delays = retryDelaysRef.current;
          const wait = delays[Math.min(failuresRef.current - 1, delays.length - 1)] ?? 30_000;
          clearTimer();
          timerRef.current = setTimeout(() => void run(), wait);
        } else {
          blockedRef.current = true;
          setErrorMessage(err.message);
          setPhase("error");
        }
      }
    })();

    inFlightRef.current = task;
    await task;
    inFlightRef.current = null;
    // Si se editó mientras se guardaba, se encadena otro guardado (salvo fallo, que ya programó su reintento).
    const pending = failuresRef.current === 0 && versionRef.current !== savedVersionRef.current;
    if (!unmountedRef.current && !conflictRef.current && !blockedRef.current && pending) {
      clearTimer();
      timerRef.current = setTimeout(() => void run(), 0);
    }
  }, []);

  // Planificación: cada cambio del documento (re)programa el guardado.
  useEffect(() => {
    if (version === savedVersionRef.current) {
      firstDirtyAtRef.current = null;
      return;
    }
    blockedRef.current = false; // una edición nueva reabre un posible error no reintentable
    if (conflictRef.current || inFlightRef.current) return;
    if (failuresRef.current > 0) return; // ya hay un reintento programado con espera creciente
    firstDirtyAtRef.current ??= Date.now();
    const sinceFirst = Date.now() - firstDirtyAtRef.current;
    const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - sinceFirst));
    clearTimer();
    timerRef.current = setTimeout(() => void run(), delay);
    return clearTimer;
  }, [version, debounceMs, maxWaitMs, run]);

  // Al ocultar la pestaña o cerrarla se intenta guardar lo pendiente.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void run();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush as () => void);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush as () => void);
    };
  }, [run]);

  // Al salir del editor (p. ej. «Volver») se intenta guardar lo pendiente; sin esperar la respuesta.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      void run();
      unmountedRef.current = true;
      clearTimer();
    };
  }, [run]);

  const saveNow = useCallback(async () => {
    failuresRef.current = 0;
    blockedRef.current = false;
    clearTimer();
    await run();
  }, [run]);

  const adopt = useCallback((rev: number, opts: { version?: number; dirty?: boolean } = {}) => {
    clearTimer();
    conflictRef.current = false;
    blockedRef.current = false;
    failuresRef.current = 0;
    revisionRef.current = rev;
    setRevision(rev);
    setServerRevision(null);
    setErrorMessage(null);
    setPhase("idle");
    const v = opts.version ?? versionRef.current;
    // `dirty`: el documento actual debe guardarse sobre la nueva revisión (sobrescribir).
    const saved = opts.dirty ? v - 1 : v;
    savedVersionRef.current = saved;
    setSavedVersion(saved);
    if (opts.dirty) timerRef.current = setTimeout(() => void run(), 0);
  }, [run]);

  const dirty = version !== savedVersion;
  const status: SaveStatus =
    phase === "conflict" ? "conflict" : phase === "saving" ? "saving" : phase === "offline" ? "offline" : phase === "error" ? "error" : dirty ? "dirty" : "saved";

  return { status, errorMessage, revision, lastSavedAt, serverRevision, saveNow, adopt };
}
