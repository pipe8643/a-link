/** Tipos de las respuestas de la API (ver apps/api). El servidor es la fuente de verdad. */

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Solo grafos activos (no cuenta los de la papelera). */
  graphCount?: number;
}

export interface GraphSummary {
  id: string;
  folderId: string | null;
  name: string;
  description: string;
  revision: number;
  graphDataVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  nodeCount: number;
  edgeCount: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DashboardData {
  counts: { graphs: number; trashedGraphs: number; folders: number; nodes: number; edges: number; exports: number };
  nodesByType: Record<string, number>;
  recentGraphs: Array<{
    id: string;
    name: string;
    folderId: string | null;
    updatedAt: string;
    nodeCount: number;
    edgeCount: number;
  }>;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
  current: boolean;
}

export type GraphSort = "updatedAt" | "createdAt" | "name" | "deletedAt";
export type FolderDeleteMode = "move_to_parent" | "trash";
