# Yet Another Jellyfin Migrator

[简体中文](README_ZH.md)

## Project Scope

YAJM is a Jellyfin **logical migration and media-library reconstruction** tool. It is intended for any of the following scenarios:

- migrating across Jellyfin versions;
- migrating across CPU architectures;
- discarding the original database while keeping all media files and rebuilding the Jellyfin server;
- moving or renaming parent directories while the media files themselves remain unchanged.

If your migration does not involve any of these scenarios, prefer Jellyfin's official **Built-in Backup**. YAJM is not a replacement for the official full-backup feature. It is designed for cases where the original database and internal paths cannot be reused as-is, restoring users, settings, watch data, media metadata, and artwork through Jellyfin APIs, logical media matching, and portable snapshots.

### Supported Media Types

YAJM currently supports:

- movies;
- TV shows, including Series, Season, and Episode items.

YAJM **does not support** music, ebooks, photo libraries, or the metadata, user data, and artwork associated with those media types.

## Overview

Node/TypeScript CLI for migrating Jellyfin users, user settings, display preferences, and Movie/Episode watch data.

## Commands

The CLI intentionally exposes only two commands:

```bash
pnpm yajm export
pnpm yajm import --dry-run
pnpm yajm import
```

## Export

`export` starts an interactive wizard. It first asks whether to export:

- users and settings only
- users, settings, and watch history

Users/settings and watch history can then use different sources. This supports fast hybrid runs such as:

- users/settings from live Jellyfin API
- watch history from a static `jellyfin.db`

Each stage can read from either:

- a live Jellyfin server through an administrator API key
- a static `jellyfin.db` SQLite file as a fallback

## Logical Library Backup

Every export also captures a logical Movies+TV library backup into `library.jsonl`.
This is used when a new Jellyfin server rescans the same media files under
different parent paths and therefore assigns new item GUIDs. Import builds an
`oldItemId -> newItemId` map, writes `reports/item-map.json` and
`reports/library-diff.json`, then asks before writing metadata back with
Jellyfin's `POST /Items/{itemId}` API.

### Artwork

When the logical library source is the live API, export can also archive the
server's current Movie/Series/Season/Episode artwork. Original image bytes are
downloaded through Jellyfin, SHA-256 deduplicated under `images/`, and indexed
in `images.jsonl`; no direct access to media folders or Docker path mapping is
required. Import can replace the matching target image types through Jellyfin's
image API. Images belonging to one item are restored sequentially so multiple
backdrops retain their source order, while different items are processed with
the configured write concurrency.

### Media Matching

Logical library matching treats Movie/Episode filenames as authoritative and
uses parent folders, provider IDs, season/episode numbers, and derived
Series/Season relationships to raise confidence. User settings and watch history
restore use the same GUID map, so references to old library item IDs can be
rewritten before API writes.

## Import

`import` starts an interactive wizard that:

- selects a local snapshot
- connects to the target Jellyfin server
- maps old users to target users, creates missing users when requested
- restores user settings and display preferences
- optionally restores archived artwork after logical media matching
- restores Movie/Episode watch data through Jellyfin APIs

## Local Data

Local state is written under `data/`, including plaintext API keys in `data/config.json` and snapshots in `data/exports/<name>/`.
Legacy hidden snapshots under `.yajm/exports/<name>/` are still readable for import, and earlier experimental `.jfmigrate/exports/<name>/` snapshots are also still accepted.

## Development

```bash
pnpm install
pnpm build
pnpm test
node dist/cli.js --help
```

The SQLite fallback requires the `sqlite3` command-line tool with `-json` support.
