# Yet Another Jellyfin Migrator

## 项目适用范围

YAJM 是一个面向 Jellyfin **逻辑迁移与媒体库重建**的工具，适用于以下工况（满足任意一项即可）：

- 跨 Jellyfin 版本迁移；
- 跨 CPU 架构迁移；
- 丢弃原数据库，但保留全部媒体文件并重建 Jellyfin 服务器；
- 部分媒体文件的上层目录发生变化，但媒体文件本身完全不变。

如果迁移不涉及上述情况，请优先使用 Jellyfin 官方的 **Built-in Backup**。YAJM
不是官方完整备份功能的替代品；它解决的是数据库和内部路径无法原样复用时，如何通过
Jellyfin API、逻辑媒体匹配和可移植快照恢复用户、设置、观看数据、媒体元数据及图片。

### 媒体类型限制

YAJM 目前只支持：

- 电影（Movie）；
- 电视剧，包括 Series、Season 和 Episode。

YAJM **不支持**音乐、电子书、图库，以及这些媒体类型对应的元数据、用户数据和图片迁移。

Node/TypeScript CLI for migrating Jellyfin users, user settings, display preferences, and Movie/Episode watch data.

The CLI intentionally exposes only two commands:

```bash
pnpm yajm export
pnpm yajm import --dry-run
pnpm yajm import
```

`export` starts an interactive wizard. It first asks whether to export:

- users and settings only
- users, settings, and watch history

Users/settings and watch history can then use different sources. This supports fast hybrid runs such as:

- users/settings from live Jellyfin API
- watch history from a static `jellyfin.db`

Each stage can read from either:

- a live Jellyfin server through an administrator API key
- a static `jellyfin.db` SQLite file as a fallback

Every export also captures a logical Movies+TV library backup into `library.jsonl`.
This is used when a new Jellyfin server rescans the same media files under
different parent paths and therefore assigns new item GUIDs. Import builds an
`oldItemId -> newItemId` map, writes `reports/item-map.json` and
`reports/library-diff.json`, then asks before writing metadata back with
Jellyfin's `POST /Items/{itemId}` API.

When the logical library source is the live API, export can also archive the
server's current Movie/Series/Season/Episode artwork. Original image bytes are
downloaded through Jellyfin, SHA-256 deduplicated under `images/`, and indexed
in `images.jsonl`; no direct access to media folders or Docker path mapping is
required. Import can replace the matching target image types through Jellyfin's
image API. Images belonging to one item are restored sequentially so multiple
backdrops retain their source order, while different items are processed with
the configured write concurrency.

Logical library matching treats Movie/Episode filenames as authoritative and
uses parent folders, provider IDs, season/episode numbers, and derived
Series/Season relationships to raise confidence. User settings and watch history
restore use the same GUID map, so references to old library item IDs can be
rewritten before API writes.

`import` starts an interactive wizard that:

- selects a local snapshot
- connects to the target Jellyfin server
- maps old users to target users, creates missing users when requested
- restores user settings and display preferences
- optionally restores archived artwork after logical media matching
- restores Movie/Episode watch data through Jellyfin APIs

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
