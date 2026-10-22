import type { StorageConfig } from "../config/app-config.js";
import { LocalDiskStorage } from "./local-disk-storage.js";
import { S3Storage } from "./s3-storage.js";
import type { StorageService } from "./storage.service.js";

export function createStorage(config: StorageConfig): StorageService {
  return config.driver === "s3" ? new S3Storage(config) : new LocalDiskStorage(config.localDir);
}
