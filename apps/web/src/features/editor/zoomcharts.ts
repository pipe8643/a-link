import { getRuntimeConfig } from "@/lib/runtime-config";

export type ZoomChartsRuntime = typeof ZoomCharts;
export type ZcNode = ZoomCharts.Configuration.ItemsChartNode;
/**
 * Propiedades que existen en tiempo de ejecución en los nodos (el propio SDK las usa en sus formas
 * integradas) pero que `zoomcharts.d.ts` 1.21.21 no declara. Solo se leen dentro de `customShape`.
 */
export interface ZcNodeRuntime extends ZcNode {
  x: number;
  y: number;
  renderHwidth: number;
  renderHheight: number;
}
export type ZcLink = ZoomCharts.Configuration.ItemsChartLink;
export type ZcNodeData = ZoomCharts.Configuration.NetChartDataObjectNode;
export type ZcLinkData = ZoomCharts.Configuration.NetChartDataObjectLink;
export type ZcNetChart = ZoomCharts.NetChart;
export type ZcSettings = ZoomCharts.Configuration.NetChartSettings;

let loading: Promise<ZoomChartsRuntime> | null = null;

/**
 * Carga ZoomCharts bajo demanda (~1,6 MB): solo se descarga al abrir un editor, no en el resto de la app.
 * La licencia se toma de la configuración de tiempo de ejecución y se fija ANTES de evaluar la librería.
 */
export function loadZoomCharts(): Promise<ZoomChartsRuntime> {
  loading ??= (async () => {
    const cfg = getRuntimeConfig();
    window.ZoomChartsLicense = cfg.zoomChartsLicense;
    window.ZoomChartsLicenseKey = cfg.zoomChartsLicenseKey;
    const mod = (await import("@dvsl/zoomcharts")) as unknown as ZoomChartsRuntime & { default?: ZoomChartsRuntime };
    const runtime = mod.NetChart ? mod : mod.default;
    if (!runtime?.NetChart) throw new Error("No se pudo inicializar ZoomCharts.");
    return runtime;
  })().catch((err: unknown) => {
    loading = null; // permite reintentar tras un fallo de red
    throw err;
  });
  return loading;
}
