/**
 * Guarda un `Blob` en el equipo del usuario mediante un enlace temporal. La URL se revoca poco después para liberar
 * la memoria.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Descarga un fichero generado en el navegador, sin pasar por ningún servidor. */
export function downloadBytes(bytes: Uint8Array, mime: string, fileName: string): void {
  downloadBlob(new Blob([bytes as BlobPart], { type: mime }), fileName);
}
