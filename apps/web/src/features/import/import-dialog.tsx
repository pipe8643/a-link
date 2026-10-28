import { EXCEL_IMPORT_LIMITS, EXCEL_SHEETS, type ExcelIssue, type GraphSnapshot } from "@a-link/shared";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadBytes } from "../export/download";
import { ExcelFileError, buildExcelTemplate, excelTemplateFileName, excelTemplateMime, importExcelFile } from "./xlsx-workbook";

interface Props {
  open: boolean;
  onClose(): void;
  occupied: { nodes: number; edges: number };
  onImport(doc: GraphSnapshot): void;
}

function formatIssue(e: ExcelIssue): string {
  const where = e.row > 0 ? `${e.sheet} fila ${e.row}` : e.sheet;
  return `${where} (${e.field}): ${e.message}`;
}

export function ImportExcelDialog({ open, onClose, occupied, onImport }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">{open ? <ImportForm occupied={occupied} onClose={onClose} onImport={onImport} /> : null}</DialogContent>
    </Dialog>
  );
}

function ImportForm({ occupied, onClose, onImport }: Omit<Props, "open">) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"template" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ExcelIssue[]>([]);

  const downloadTemplate = async () => {
    setBusy("template");
    setError(null);
    try {
      const bytes = await buildExcelTemplate();
      downloadBytes(bytes, excelTemplateMime, excelTemplateFileName);
      toast.success("Plantilla descargada. Rellena las hojas Entidades y Relaciones.");
    } catch {
      setError("No se pudo generar la plantilla.");
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy("import");
    setError(null);
    setIssues([]);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await importExcelFile(file, bytes, occupied);
      if (!result.ok) {
        setIssues(result.errors);
        setError("El Excel no se pudo importar. Corrige las filas indicadas.");
        return;
      }
      onImport(result.value);
      toast.success(`Se grafican ${result.value.nodes.length} entidades y ${result.value.edges.length} relaciones.`);
      onClose();
    } catch (err) {
      setError(err instanceof ExcelFileError ? err.message : "No se pudo leer el Excel.");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Importar Excel</DialogTitle>
        <DialogDescription>
          Sube un .xlsx con las hojas «{EXCEL_SHEETS.entities}» y «{EXCEL_SHEETS.relations}». El lienzo se reorganiza
          solo. Máximo {Math.round(EXCEL_IMPORT_LIMITS.maxBytes / (1024 * 1024))} MB.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 text-sm">
        <p>
          Columnas de <strong>Entidades</strong>: <code className="text-xs">ref</code>, <code className="text-xs">tipo</code>,{" "}
          <code className="text-xs">nombre</code> (obligatorias). Opcionales: <code className="text-xs">descripcion</code>,{" "}
          <code className="text-xs">notas</code>, <code className="text-xs">etiquetas</code> y las claves de cada tipo (
          <code className="text-xs">fullName</code>, <code className="text-xs">number</code>, <code className="text-xs">plate</code>
          …).
        </p>
        <p>
          Columnas de <strong>Relaciones</strong>: <code className="text-xs">origen</code>, <code className="text-xs">destino</code>{" "}
          (las <code className="text-xs">ref</code> de las entidades), <code className="text-xs">tipo</code>. Opcionales:{" "}
          <code className="text-xs">etiqueta</code>, <code className="text-xs">naturaleza</code>, <code className="text-xs">direccion</code>,
          fechas, fuente y confianza.
        </p>
        <p className="text-muted-foreground">
          «tipo» admite el nombre en español (Persona, Contacto) o el identificador (person, contact). Sin fórmulas. La
          plantilla incluye filas de ejemplo y la hoja Instrucciones con todos los valores permitidos.
        </p>
      </div>

      <FormError message={error} />
      {issues.length > 0 && (
        <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm text-destructive" aria-label="Errores del Excel">
          {issues.map((e, i) => (
            <li key={`${e.sheet}-${e.row}-${e.field}-${i}`}>{formatIssue(e)}</li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        aria-label="Archivo Excel"
        onChange={(ev) => void onFile(ev.target.files?.[0])}
      />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => void downloadTemplate()} disabled={busy !== null}>
          {busy === "template" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />}
          Descargar plantilla
        </Button>
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
          {busy === "import" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />}
          Elegir Excel…
        </Button>
      </DialogFooter>
    </>
  );
}
