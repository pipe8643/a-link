import type { GraphSnapshot } from "@a-link/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { type AutosaveOptions, useAutosave } from "./use-autosave";

const DOC: GraphSnapshot = { nodes: [], edges: [] };
const doc = (n: number): GraphSnapshot => ({ ...DOC, edges: [], nodes: Array.from({ length: n }, () => ({}) as never) });

const conflict = (current = 7) => new ApiError(409, "REVISION_CONFLICT", "conflicto", undefined, [], undefined, { currentRevision: current });

function setup(save: AutosaveOptions["save"], extra: Partial<AutosaveOptions> = {}) {
  const hook = renderHook((p: { version: number; doc: GraphSnapshot }) => useAutosave({ doc: p.doc, version: p.version, initialRevision: 1, save, ...extra }), {
    initialProps: { version: 0, doc: DOC },
  });
  const edit = (version: number) => hook.rerender({ version, doc: doc(version) });
  return { ...hook, edit };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("useAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("no guarda nada mientras no haya cambios", async () => {
    const save = vi.fn();
    const { result } = setup(save);
    await advance(60_000);
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("saved");
  });

  it("guarda tras el retardo con la revisión inicial, y usa la revisión devuelta en el siguiente", async () => {
    const save = vi.fn().mockResolvedValueOnce({ revision: 2 }).mockResolvedValueOnce({ revision: 3 });
    const { result, edit } = setup(save);

    edit(1);
    expect(result.current.status).toBe("dirty");
    await advance(1499);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1]).toBe(1);
    expect(result.current.status).toBe("saved");
    expect(result.current.revision).toBe(2);
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);

    edit(2);
    await advance(1500);
    expect(save.mock.calls[1]![1]).toBe(2);
    expect(result.current.revision).toBe(3);
  });

  it("varias ediciones seguidas se agrupan en un solo guardado con el documento más reciente", async () => {
    const save = vi.fn().mockResolvedValue({ revision: 2 });
    const { edit } = setup(save);
    for (let v = 1; v <= 5; v++) {
      edit(v);
      await advance(500);
    }
    await advance(1500);
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0]![0] as GraphSnapshot).nodes).toHaveLength(5);
  });

  it("aunque se siga editando sin parar, guarda como mucho cada maxWait", async () => {
    const save = vi.fn().mockResolvedValue({ revision: 2 });
    const { edit } = setup(save, { maxWaitMs: 5000 });
    for (let v = 1; v <= 12; v++) {
      edit(v);
      await advance(1000); // nunca llega a 1500 ms de calma
    }
    expect(save).toHaveBeenCalled();
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("nunca hay dos guardados a la vez y lo editado durante un guardado se guarda después", async () => {
    let release!: (v: { revision: number }) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockResolvedValueOnce({ revision: 3 });
    const { result, edit } = setup(save);

    edit(1);
    await advance(1500);
    expect(result.current.status).toBe("saving");
    edit(2); // se edita mientras el primero sigue en vuelo
    await advance(5000);
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => release({ revision: 2 }));
    await advance(10);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toBe(2);
    expect((save.mock.calls[1]![0] as GraphSnapshot).nodes).toHaveLength(2);
    expect(result.current.status).toBe("saved");
  });

  it("pedir guardar (o salir/ocultar la pestaña) con un guardado en vuelo NO lanza un segundo guardado simultáneo", async () => {
    let release!: (v: { revision: number }) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise((r) => (release = r)));
    const { result, edit } = setup(save);
    edit(1);
    await advance(1500);
    expect(save).toHaveBeenCalledTimes(1);

    let again!: Promise<void>;
    act(() => {
      again = result.current.saveNow();
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => release({ revision: 2 }));
    await act(async () => void (await again));
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("saved");
  });

  it("deshacer hasta el estado guardado deja de estar «sin guardar»", async () => {
    const save = vi.fn().mockResolvedValue({ revision: 2 });
    const { result, edit } = setup(save);
    edit(1);
    await advance(1500); // guardado con version 1
    edit(2);
    expect(result.current.status).toBe("dirty");
    edit(1); // volver al contenido guardado
    expect(result.current.status).toBe("saved");
    await advance(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  describe("conflicto (409)", () => {
    it("se detiene: no reintenta ni guarda solo con nuevas ediciones, y expone la revisión del servidor", async () => {
      const save = vi.fn().mockRejectedValue(conflict(7));
      const { result, edit } = setup(save);
      edit(1);
      await advance(1500);
      expect(result.current.status).toBe("conflict");
      expect(result.current.serverRevision).toBe(7);

      edit(2);
      await advance(120_000);
      expect(save).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("conflict");
    });

    it("en conflicto tampoco se guarda al ocultar la pestaña, al pedirlo ni al salir", async () => {
      const save = vi.fn().mockRejectedValue(conflict(7));
      const { result, edit, unmount } = setup(save);
      edit(1);
      await advance(1500);
      expect(result.current.status).toBe("conflict");

      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      await act(() => result.current.saveNow());
      unmount();
      await advance(10);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("sobrescribir: adopta la revisión del servidor y guarda la versión local sobre ella", async () => {
      const save = vi.fn().mockRejectedValueOnce(conflict(7)).mockResolvedValueOnce({ revision: 8 });
      const { result, edit } = setup(save);
      edit(1);
      await advance(1500);
      expect(result.current.status).toBe("conflict");

      act(() => result.current.adopt(7, { dirty: true }));
      await advance(10);
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1]![1]).toBe(7);
      expect(result.current.status).toBe("saved");
      expect(result.current.revision).toBe(8);
    });

    it("cargar la del servidor: el documento vuelve a la versión 0 y queda «guardado», sin guardar nada", async () => {
      const save = vi.fn().mockRejectedValueOnce(conflict(7));
      const { result, edit } = setup(save);
      edit(3);
      await advance(1500);
      act(() => {
        result.current.adopt(7, { version: 0 });
        edit(0); // el editor recargó el documento
      });
      expect(result.current.status).toBe("saved");
      await advance(60_000);
      expect(save).toHaveBeenCalledTimes(1);

      save.mockResolvedValueOnce({ revision: 8 });
      edit(1);
      await advance(1500);
      expect(save.mock.calls[1]![1]).toBe(7); // parte de la revisión adoptada
    });
  });

  describe("fallos", () => {
    it("sin red: reintenta con espera creciente y acaba guardando", async () => {
      const net = new ApiError(0, "NETWORK_ERROR", "sin red");
      const save = vi.fn().mockRejectedValueOnce(net).mockRejectedValueOnce(net).mockResolvedValueOnce({ revision: 2 });
      const { result, edit } = setup(save, { retryDelaysMs: [1000, 2000] });
      edit(1);
      await advance(1500);
      expect(result.current.status).toBe("offline");
      await advance(999);
      expect(save).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(save).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe("offline");
      await advance(1999);
      expect(save).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(save).toHaveBeenCalledTimes(3);
      expect(result.current.status).toBe("saved");
      expect(save.mock.calls.every((c) => c[1] === 1)).toBe(true); // misma revisión base en todos los intentos
    });

    it("un 500 también se reintenta", async () => {
      const save = vi.fn().mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x")).mockResolvedValueOnce({ revision: 2 });
      const { result, edit } = setup(save, { retryDelaysMs: [500] });
      edit(1);
      await advance(2100);
      expect(result.current.status).toBe("saved");
    });

    it("un error de validación NO se reintenta solo; «Reintentar» (saveNow) sí lo intenta", async () => {
      const save = vi.fn().mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "Los datos no son válidos")).mockResolvedValueOnce({ revision: 2 });
      const { result, edit } = setup(save);
      edit(1);
      await advance(1500);
      expect(result.current.status).toBe("error");
      expect(result.current.errorMessage).toBe("Los datos no son válidos");
      await advance(120_000);
      expect(save).toHaveBeenCalledTimes(1);

      await act(() => result.current.saveNow());
      expect(save).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe("saved");
    });

    it("una edición nueva tras un error vuelve a intentar el guardado", async () => {
      const save = vi.fn().mockRejectedValueOnce(new ApiError(413, "PAYLOAD_TOO_LARGE", "grande")).mockResolvedValueOnce({ revision: 2 });
      const { result, edit } = setup(save);
      edit(1);
      await advance(1500);
      expect(result.current.status).toBe("error");
      edit(2);
      await advance(1500);
      expect(result.current.status).toBe("saved");
    });
  });

  it("al desmontar (salir del editor) intenta guardar lo pendiente sin esperar al retardo", async () => {
    const save = vi.fn().mockResolvedValue({ revision: 2 });
    const { edit, unmount } = setup(save);
    edit(1);
    expect(save).not.toHaveBeenCalled();
    unmount();
    await advance(0);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("al ocultar la pestaña guarda lo pendiente", async () => {
    const save = vi.fn().mockResolvedValue({ revision: 2 });
    const { edit } = setup(save);
    edit(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
