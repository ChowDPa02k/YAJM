#!/usr/bin/env node
import { Command } from "commander";
import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import path from "node:path";
import { exportSnapshot, type ExportSource, type LibrarySource, type WatchSource } from "./exporters.js";
import { JellyfinClient } from "./jellyfin.js";
import { importSnapshot, type ImportDecision } from "./importer.js";
import { listSnapshots, readConfig, resolveSnapshotPath, snapshotPath, writeConfig } from "./paths.js";
import { readSnapshot } from "./snapshot.js";
import type { AppConfig, JellyfinUserDto, UserRecord } from "./types.js";
import { parseUserDecisionKey } from "./user-decision.js";
import { printLogo } from "./logo.js";

const program = new Command();

program
  .name("yajm")
  .description("Migrate Jellyfin users, settings, and Movie/Episode watch data")
  .version("0.1.0");

program
  .command("export")
  .description("Interactively export users and watch data from Jellyfin API or a static jellyfin.db")
  .action(async () => {
    await runExport();
  });

program
  .command("import")
  .description("Interactively import a snapshot into a target Jellyfin server")
  .option("--dry-run", "run mapping and media matching without writing to the target server")
  .action(async (options: { dryRun?: boolean }) => {
    await runImport(Boolean(options.dryRun));
  });

program.parseAsync().catch((error: unknown) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function runExport(): Promise<void> {
  printLogo();
  p.intro("YAJM export");
  const config = await readConfig();
  const exportScope = await promptValue<string>(
    p.select({
      message: "What do you want to export?",
      options: [
        { value: "users", label: "Users and settings only", hint: "fast; no watch history" },
        { value: "users-watch", label: "Users, settings, and watch history", hint: "allows API/SQLite mixed sources" }
      ]
    })
  );
  const userSourceType = await promptValue<string>(
    p.select({
      message: "Choose source for users and settings",
      options: [
        { value: "api", label: "Jellyfin API", hint: "best for live user preferences" },
        { value: "sqlite", label: "Static jellyfin.db", hint: "fallback when source server is offline" }
      ]
    })
  );
  const watchSourceType =
    exportScope === "users-watch"
      ? await promptValue<string>(
          p.select({
            message: "Choose source for watch history",
            options: [
              { value: "sqlite", label: "Static jellyfin.db", hint: "recommended: faster and reliable for large history" },
              { value: "api", label: "Jellyfin API", hint: "works when source server is online" }
            ]
          })
        )
      : "none";
  const defaultLibrarySourceType = watchSourceType === "none" ? userSourceType : watchSourceType;
  const librarySourceType = await promptValue<string>(
    p.select({
      message: "Choose source for logical Movie/TV library backup",
      initialValue: defaultLibrarySourceType,
      options: [
        { value: "sqlite", label: "Static jellyfin.db", hint: defaultLibrarySourceType === "sqlite" ? "default" : "fast fallback" },
        { value: "api", label: "Jellyfin API", hint: defaultLibrarySourceType === "api" ? "default" : "live metadata" }
      ]
    })
  );
  const exportArtwork =
    librarySourceType === "api"
      ? await promptValue<boolean>(
          p.confirm({ message: "Archive current artwork through the Jellyfin API?", initialValue: true })
        )
      : false;
  const imageConcurrency = exportArtwork
    ? Number(
        await promptValue<string>(
          p.text({ message: "Artwork download concurrency", initialValue: "16", validate: validatePositiveInteger })
        )
      )
    : 16;
  const snapshotName = sanitizeSnapshotName(
    await promptValue<string>(
      p.text({
        message: "Snapshot name",
        placeholder: `jellyfin-${new Date().toISOString().slice(0, 10)}`,
        validate: validateRequired
      })
    )
  );

  let nextConfig = config;
  const userSource = await promptExportSource(userSourceType, config, "users/settings");
  nextConfig = rememberExportSource(nextConfig, userSource);
  const watchSource: WatchSource =
    watchSourceType === "none"
      ? { type: "none" }
      : watchSourceType === userSource.type
        ? userSource
        : await promptExportSource(watchSourceType, nextConfig, "watch history");
  if (watchSource.type !== "none") {
    nextConfig = rememberExportSource(nextConfig, watchSource);
  }
  const librarySource: LibrarySource =
    librarySourceType === userSource.type
      ? userSource
      : watchSource.type !== "none" && librarySourceType === watchSource.type
        ? watchSource
        : await promptExportSource(librarySourceType, nextConfig, "logical Movie/TV library");
  nextConfig = rememberExportSource(nextConfig, librarySource);
  await saveRecentConfig(nextConfig);

  const spinner = p.spinner();
  spinner.start("⠋ export: starting...");
  try {
    const manifest = await exportSnapshot({
      snapshotName,
      userSource,
      watchSource,
      librarySource,
      displayPreferenceProfiles: config.displayPreferenceProfiles,
      exportImages: exportArtwork,
      imageConcurrency,
      onProgress: (message) => spinner.message(message)
    });
    spinner.stop(`Exported ${manifest.stats.users} users, ${manifest.stats.userData} user data rows, and ${manifest.stats.images} images`);
    p.note(snapshotPath(snapshotName), "Snapshot saved");
    p.outro("Export complete");
  } catch (error) {
    spinner.stop("Export failed");
    throw error;
  }
}

async function runImport(dryRun: boolean): Promise<void> {
  printLogo();
  p.intro(dryRun ? "YAJM import (dry-run)" : "YAJM import");
  const config = await readConfig();
  const snapshots = await listSnapshots();
  if (snapshots.length === 0) {
    throw new Error("No snapshots found. Run `yajm export` first.");
  }
  const snapshotName = await promptValue<string>(
    p.select({
      message: "Choose snapshot",
      options: snapshots.map((snapshot) => ({ value: snapshot, label: snapshot }))
    })
  );
  const serverUrl = trimServerUrl(
    await promptValue<string>(
      p.text({
        message: "Target Jellyfin server URL",
        initialValue: config.target.serverUrl,
        placeholder: "http://localhost:8096",
        validate: validateRequired
      })
    )
  );
  const apiKey = await promptValue<string>(
    p.password({
      message: "Target administrator API key",
      validate: validateRequired
    })
  );
  const initialPassword = dryRun
    ? "dry-run-placeholder"
    : await promptValue<string>(
        p.password({
          message: "Initial password for newly created users",
          validate: validateRequired
        })
      );
  const readConcurrency = Number(
    await promptValue<string>(
      p.text({
        message: "Read/match concurrency",
        initialValue: "8",
        validate: validatePositiveInteger
      })
    )
  );
  const writeConcurrency = Number(
    await promptValue<string>(
      p.text({
        message: "Write concurrency",
        initialValue: "4",
        validate: validatePositiveInteger
      })
    )
  );
  const restoreMetadata = dryRun
    ? false
    : await promptValue<boolean>(
        p.confirm({
          message: "After generating library DIFF, write matched metadata back to the target server?",
          initialValue: false
        })
      );
  const selectedSnapshot = await readSnapshot(snapshotName);
  const restoreImages =
    selectedSnapshot.manifest.stats.images > 0
      ? await promptValue<boolean>(
          p.confirm({
            message: `Restore ${selectedSnapshot.manifest.stats.images} archived artwork images?`,
            initialValue: true
          })
        )
      : false;
  await saveRecentConfig({ ...config, target: { ...config.target, serverUrl, apiKey } });

  const spinner = p.spinner();
  const client = new JellyfinClient(serverUrl, apiKey);
  spinner.start("Testing target API...");
  const targetUsers = await client.getUsers();
  spinner.stop(`Target has ${targetUsers.length} users`);

  const importSpinner = p.spinner();
  let importSpinnerActive = false;
  const onImportProgress = (message: string): void => {
    if (!importSpinnerActive) {
      if (message.includes("import users:")) return;
      importSpinner.start(message);
      importSpinnerActive = true;
      return;
    }
    importSpinner.message(message);
  };

  const decisions = new Map<string, ImportDecision>();
  const decideUser = async (user: UserRecord, latestTargetUsers: JellyfinUserDto[]): Promise<ImportDecision> => {
    const existing = decisions.get(user.id);
    if (existing) return existing;
    if (importSpinnerActive) {
      importSpinner.stop("Ready for user decisions");
      importSpinnerActive = false;
    }
    const choiceKey = await promptValue<"c" | "m" | "s">(
      p.selectKey({
        message: `No same-name target user for "${user.name}". [C] Create / [M] Merge / [S] Skip`,
        options: [
          { value: "c", label: "Create" },
          { value: "m", label: "Merge" },
          { value: "s", label: "Skip" }
        ]
      })
    );
    const choice = parseUserDecisionKey(choiceKey)!;
    let decision: ImportDecision;
    if (choice === "map") {
      const targetUserId = await promptValue<string>(
        p.select({
          message: `Map "${user.name}" to target user`,
          options: latestTargetUsers.map((target) => ({
            value: target.Id,
            label: target.Name ?? target.Id,
            hint: target.Id
          }))
        })
      );
      decision = { action: "map", targetUserId };
    } else if (choice === "skip") {
      decision = { action: "skip", reason: "skipped interactively" };
    } else {
      decision = { action: "create" };
    }
    decisions.set(user.id, decision);
    return decision;
  };

  importSpinner.start(dryRun ? "Running dry-run import..." : "Importing snapshot...");
  importSpinnerActive = true;
  try {
    const result = await importSnapshot({
      snapshotName,
      serverUrl,
      apiKey,
      initialPassword,
      dryRun,
      restoreMetadata,
      restoreImages,
      readConcurrency,
      writeConcurrency,
      decideUser,
      onProgress: onImportProgress
    });
    const reportsPath = await resolveSnapshotPath(snapshotName, "reports");
    const libraryDiffPath = await resolveSnapshotPath(snapshotName, "reports", "library-diff.json");
    if (importSpinnerActive) {
      importSpinner.stop(dryRun ? "Dry-run complete" : "Import complete");
      importSpinnerActive = false;
    }
    p.note(
      [
        `Users mapped/created/skipped: ${result.mappings.filter((item) => item.action !== "skip").length}/${result.mappings.filter((item) => item.action === "skip").length}`,
        `Written UserData rows: ${result.mediaReport.matched}`,
        `Dry-run planned writes: ${result.mediaReport.dryRunPlannedWrites}`,
        `Missing media: ${result.mediaReport.missing.length}`,
        `Ambiguous media: ${result.mediaReport.ambiguous.length}`,
        `Written artwork: ${result.imageReport.written}/${result.imageReport.planned}`,
        `Artwork failures: ${result.imageReport.failed.length}`,
        `Library DIFF: ${libraryDiffPath}`,
        `Reports: ${reportsPath}`
      ].join("\n"),
      "Import summary"
    );
    p.outro(dryRun ? "Dry-run finished" : "Import finished");
  } catch (error) {
    if (importSpinnerActive) importSpinner.stop("Import failed", 2);
    throw error;
  }
}

async function promptValue<T>(promise: Promise<T | symbol>): Promise<T> {
  const value = await promise;
  if (p.isCancel(value)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return value as T;
}

function validateRequired(value: string): string | undefined {
  return value.trim().length > 0 ? undefined : "Required";
}

function validatePositiveInteger(value: string): string | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? undefined : "Enter a positive integer";
}

function trimServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function sanitizeSnapshotName(value: string): string {
  return (value.trim() || `jellyfin-${new Date().toISOString().slice(0, 10)}`).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function promptExportSource(sourceType: string, config: AppConfig, label: string): Promise<ExportSource> {
  if (sourceType === "api") {
    const serverUrl = trimServerUrl(
      await promptValue<string>(
        p.text({
          message: `Source Jellyfin server URL for ${label}`,
          initialValue: config.source.serverUrl,
          placeholder: "http://localhost:8096",
          validate: validateRequired
        })
      )
    );
    const apiKey = await promptValue<string>(
      p.password({
        message: `Source administrator API key for ${label}`,
        validate: validateRequired
      })
    );
    return { type: "api", serverUrl, apiKey };
  }

  const dbPath = path.resolve(
    await promptValue<string>(
      p.text({
        message: `Path to source jellyfin.db for ${label}`,
        initialValue: config.source.sqlitePath,
        placeholder: "sample/jellyfin.db",
        validate: (value) => {
          if (!value.trim()) return "Required";
          return existsSync(path.resolve(value)) ? undefined : "File does not exist";
        }
      })
    )
  );
  return { type: "sqlite", dbPath };
}

function rememberExportSource(config: AppConfig, source: ExportSource): AppConfig {
  if (source.type === "api") {
    return { ...config, source: { ...config.source, serverUrl: source.serverUrl, apiKey: source.apiKey } };
  }
  return { ...config, source: { ...config.source, sqlitePath: source.dbPath } };
}

async function saveRecentConfig(config: AppConfig): Promise<void> {
  await writeConfig(config);
}
