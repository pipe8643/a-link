import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExcelTemplate, excelTemplateFileName } from "../apps/web/src/features/import/xlsx-workbook.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = await buildExcelTemplate();
const downloads = join(homedir(), "Downloads");
mkdirSync(downloads, { recursive: true });
writeFileSync(join(downloads, excelTemplateFileName), bytes);
writeFileSync(join(root, "docs", excelTemplateFileName), bytes);
writeFileSync(join(root, "apps", "web", "public", excelTemplateFileName), bytes);
process.stdout.write(`Escrita ${excelTemplateFileName} (${bytes.length} bytes)\n`);
