# Yet Another Jellyfin Migrator

> **⚠ NOTICE**
>
> This project was created entirely with Codex + GPT-5.5 / GPT-5.6 Sol.
>
> The author does not know Node.js. You use this service/software entirely at your own risk.

[简体中文](README_ZH.md)

![](https://github.com/user-attachments/assets/c4fcab9a-f6ab-46cf-b845-2fc5d9d9e382)

A Node.js and TypeScript CLI for migrating Jellyfin users, user settings, watch history, and Movie/TV metadata.

## Project Scope

YAJM is a Jellyfin **logical migration and media-library reconstruction** tool intended for the following scenarios:

- migrating across Jellyfin versions;
- migrating across CPU architectures;
- discarding the original database while keeping all media files and rebuilding the Jellyfin server;
- reorganizing parent directories while the media files themselves remain unchanged.

If your migration does not involve any of these scenarios, prefer Jellyfin's official **[Built-in Backup](https://jellyfin.org/docs/general/administration/backup-and-restore/)**. YAJM is not a replacement for the official full-backup feature. It is designed for cases where the original database and internal paths cannot be reused as-is, restoring users, settings, watch data, media metadata, and artwork through Jellyfin APIs, logical media matching, and portable snapshots.

## Features

### Logical Export

To support cross-version and cross-architecture migrations or reconstruction of the server database, YAJM extracts relevant Jellyfin server data into JSONL and converts it into API requests when importing into the target database.

### Database Parsing

YAJM can parse the SQLite database in a Jellyfin server's data directory directly and generate JSONL to improve export performance.

### Internal GUID Mapping

When media paths change during migration, Jellyfin may assign new GUIDs to media files, causing scraped metadata and watch history to stop matching. YAJM uses a confidence-based matching algorithm to build a reliable media GUID mapping between the old and new servers, then automatically migrates the remapped data to the target server.

### Artwork Synchronization

> Note: artwork migration includes only Movie, Series, Season, and Episode items. Images for people, studios, and other objects are not exported.

Jellyfin's NFO Saver writes absolute image paths into NFO files. When directories change during migration, Jellyfin may discard previously saved images and use default artwork from built-in providers such as TMDB instead. Building on its internal GUID mapping, YAJM migrates metadata artwork files as well, with high download throughput provided by concurrent transfers.

## Media Library Limitations

YAJM currently supports:

- movies;
- TV shows, including Series, Season, and Episode items.

YAJM **does not support** music, ebooks, photo libraries, or the metadata, user data, and artwork associated with those media types. Contributions adding support for these libraries are welcome.

## Commands

The CLI exposes two commands:

```bash
pnpm yajm export
pnpm yajm import --dry-run
pnpm yajm import
```

## Export

`export` starts an interactive wizard. It first asks whether to export:

- users and settings only;
- users, settings, and watch history.

Users/settings and watch history can use different sources, enabling efficient hybrid exports such as:

- users/settings from the live Jellyfin API;
- watch history from a static `jellyfin.db`.

Each stage can read from either:

- a live Jellyfin server through an administrator API key;
- a static `jellyfin.db` SQLite file as a fallback.

## Import

`import` starts an interactive wizard that:

- selects a local snapshot;
- connects to the target Jellyfin server;
- maps old users to target users and creates missing users when requested;
- restores user settings and display preferences;
- optionally restores archived artwork after logical media matching;
- restores Movie/Episode watch data through Jellyfin APIs.

## Local Data

Local state is written under `data/`, including plaintext API keys in `data/config.json` and snapshots in `data/exports/<name>/`.

## Development

```bash
pnpm install
pnpm build
pnpm test
node dist/cli.js --help
```

SQLite functionality requires the `sqlite3` command-line tool with `-json` support.
