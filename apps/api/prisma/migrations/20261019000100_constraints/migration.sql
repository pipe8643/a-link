-- Restricciones de integridad que Prisma no modela de forma nativa (MySQL >= 8.0.16 las aplica).
-- Prisma no gestiona CHECK constraints, por lo que no generan "drift" en `migrate dev`.

-- El correo se guarda normalizado en minúsculas. Se compara con collation binaria: la collation por
-- defecto (utf8mb4_unicode_ci) NO distingue mayúsculas y haría que este CHECK nunca fallase.
ALTER TABLE `users`
  ADD CONSTRAINT `users_email_lowercase_chk`
  CHECK (`email` COLLATE utf8mb4_bin = LOWER(`email`) COLLATE utf8mb4_bin);

-- Una carpeta no puede ser su propia carpeta padre (los ciclos más largos los evita la API).
ALTER TABLE `folders`
  ADD CONSTRAINT `folders_not_self_parent_chk` CHECK (`parentId` IS NULL OR `parentId` <> `id`);

-- Una relación conecta dos entidades distintas.
ALTER TABLE `graph_edges`
  ADD CONSTRAINT `graph_edges_no_self_loop_chk` CHECK (`sourceNodeId` <> `targetNodeId`);

-- Contadores y tamaños coherentes.
ALTER TABLE `graphs`
  ADD CONSTRAINT `graphs_revision_positive_chk` CHECK (`revision` >= 1),
  ADD CONSTRAINT `graphs_data_version_positive_chk` CHECK (`graphDataVersion` >= 1);

ALTER TABLE `export_files`
  ADD CONSTRAINT `export_files_size_positive_chk` CHECK (`fileSize` > 0);

-- metadata debe ser siempre un objeto JSON y tags un array.
ALTER TABLE `graph_nodes`
  ADD CONSTRAINT `graph_nodes_metadata_object_chk` CHECK (JSON_TYPE(`metadata`) = 'OBJECT'),
  ADD CONSTRAINT `graph_nodes_tags_array_chk` CHECK (JSON_TYPE(`tags`) = 'ARRAY');
ALTER TABLE `graph_edges`
  ADD CONSTRAINT `graph_edges_metadata_object_chk` CHECK (JSON_TYPE(`metadata`) = 'OBJECT');
