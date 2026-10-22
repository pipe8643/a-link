/// <reference types="@dvsl/zoomcharts" />

// `@dvsl/zoomcharts` publica sus tipos como un módulo GLOBAL (`declare module ZoomCharts`), no como un módulo
// ES. En tiempo de ejecución, `import("@dvsl/zoomcharts")` devuelve ese mismo objeto (CommonJS).
declare module "@dvsl/zoomcharts" {
  const zc: typeof ZoomCharts;
  export = zc;
}
