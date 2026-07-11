import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigSchema, type AppConfig } from "./types.js";

export const MIGRATE_DIR = "data";
export const LEGACY_MIGRATE_DIR = ".yajm";
export const EXPERIMENTAL_MIGRATE_DIR = ".jfmigrate";
export const EXPORTS_DIR = "exports";

export function workspacePath(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}

export function migratePath(...segments: string[]): string {
  return workspacePath(MIGRATE_DIR, ...segments);
}

export function legacyMigratePath(...segments: string[]): string {
  return workspacePath(LEGACY_MIGRATE_DIR, ...segments);
}

export function experimentalMigratePath(...segments: string[]): string {
  return workspacePath(EXPERIMENTAL_MIGRATE_DIR, ...segments);
}

export function snapshotPath(name: string, ...segments: string[]): string {
  return migratePath(EXPORTS_DIR, name, ...segments);
}

export async function resolveSnapshotPath(name: string, ...segments: string[]): Promise<string> {
  const current = snapshotPath(name, ...segments);
  if (await pathExists(snapshotPath(name))) {
    return current;
  }
  const legacy = legacyMigratePath(EXPORTS_DIR, name, ...segments);
  if (await pathExists(legacyMigratePath(EXPORTS_DIR, name))) {
    return legacy;
  }
  const experimental = experimentalMigratePath(EXPORTS_DIR, name, ...segments);
  if (await pathExists(experimentalMigratePath(EXPORTS_DIR, name))) {
    return experimental;
  }
  return current;
}

export async function ensureMigrateDirs(): Promise<void> {
  await mkdir(migratePath(EXPORTS_DIR), { recursive: true });
}

export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(migratePath("config.json"), "utf8");
    return ConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        const raw = await readFile(legacyMigratePath("config.json"), "utf8");
        return ConfigSchema.parse(JSON.parse(raw));
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") {
          try {
            const raw = await readFile(experimentalMigratePath("config.json"), "utf8");
            return ConfigSchema.parse(JSON.parse(raw));
          } catch (experimentalError) {
            if ((experimentalError as NodeJS.ErrnoException).code === "ENOENT") {
              return ConfigSchema.parse({});
            }
            throw experimentalError;
          }
        }
        throw legacyError;
      }
    }
    throw error;
  }
}

export async function writeConfig(config: AppConfig): Promise<void> {
  await ensureMigrateDirs();
  await writeFile(migratePath("config.json"), `${JSON.stringify(ConfigSchema.parse(config), null, 2)}\n`);
}

export async function listSnapshots(): Promise<string[]> {
  await ensureMigrateDirs();
  const names = new Set<string>();
  for (const root of [migratePath(EXPORTS_DIR), legacyMigratePath(EXPORTS_DIR), experimentalMigratePath(EXPORTS_DIR)]) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) names.add(entry.name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [...names].sort();
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
