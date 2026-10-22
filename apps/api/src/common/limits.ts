/**
 * Límites por usuario. Evitan que una cuenta (o un cliente defectuoso) agote la base de datos y
 * acotan el coste de las operaciones que recorren el árbol de carpetas.
 */
export const MAX_FOLDERS_PER_USER = 1000;
/** Profundidad máxima del árbol: una carpeta en la raíz tiene profundidad 1. */
export const MAX_FOLDER_DEPTH = 8;
export const MAX_GRAPHS_PER_USER = 2000;
export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 2000;
/** Exportaciones guardadas por usuario (el espacio total lo limita EXPORT_QUOTA_MB_PER_USER). */
export const MAX_EXPORTS_PER_USER = 500;
