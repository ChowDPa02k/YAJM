# Yet Another Jellyfin Migrator

[English](README.md)

## 项目适用范围

YAJM 是一个面向 Jellyfin **逻辑迁移与媒体库重建**的工具，适用于以下工况（满足任意一项即可）：

- 跨 Jellyfin 版本迁移；
- 跨 CPU 架构迁移；
- 丢弃原数据库，但保留全部媒体文件并重建 Jellyfin 服务器；
- 部分媒体文件的上层目录发生变化，但媒体文件本身完全不变。

如果迁移不涉及上述情况，请优先使用 Jellyfin 官方的 **Built-in Backup**。YAJM 不是官方完整备份功能的替代品；它解决的是数据库和内部路径无法原样复用时，如何通过 Jellyfin API、逻辑媒体匹配和可移植快照恢复用户、设置、观看数据、媒体元数据及图片。

### 媒体类型限制

YAJM 目前只支持：

- 电影（Movie）；
- 电视剧，包括 Series、Season 和 Episode。

YAJM **不支持**音乐、电子书、图库，以及这些媒体类型对应的元数据、用户数据和图片迁移。

## 项目概览

这是一个使用 Node.js 和 TypeScript 编写的命令行工具，用于迁移 Jellyfin 用户、用户设置、显示偏好、电影和剧集观看数据。

## 命令

CLI 只提供两个命令：

```bash
pnpm yajm export
pnpm yajm import --dry-run
pnpm yajm import
```

## 导出

`export` 会启动交互式向导，首先询问导出范围：

- 仅用户和设置；
- 用户、设置和观看历史。

用户/设置和观看历史可以使用不同的数据源，因此可以采用高效的混合导出方式，例如：

- 从在线 Jellyfin API 导出用户和设置；
- 从静态 `jellyfin.db` 导出观看历史。

每个阶段均可从以下来源读取：

- 使用管理员 API Key 访问在线 Jellyfin 服务器；
- 使用静态 `jellyfin.db` SQLite 文件作为回退来源。

## 逻辑媒体库备份

每次导出还会把电影和电视剧媒体库的逻辑备份写入 `library.jsonl`。当新 Jellyfin 服务器在不同的上层路径下重新扫描相同媒体文件并生成新的 item GUID 时，这份逻辑备份用于重建映射。导入会生成 `oldItemId -> newItemId` 映射，写入 `reports/item-map.json` 和 `reports/library-diff.json`，并在通过 Jellyfin 的 `POST /Items/{itemId}` API 写回元数据前询问用户。

### 图片

当逻辑媒体库来源为在线 API 时，导出还可以归档 Movie、Series、Season 和 Episode 当前使用的图片。原始图片通过 Jellyfin 下载，在 `images/` 下按 SHA-256 去重，并由 `images.jsonl` 建立索引；整个过程不需要直接访问媒体目录，也不需要解析 Docker 路径映射。导入可以通过 Jellyfin 图片 API 替换匹配条目的对应图片类型。同一条目的多张图片会按顺序恢复，以保留 Backdrop 顺序；不同条目则使用配置的写入并发处理。

### 媒体匹配

逻辑媒体匹配把 Movie 和 Episode 的文件名作为权威依据，并结合上层目录、Provider ID、季/集编号以及推导出的 Series/Season 关系提高匹配置信度。用户设置和观看历史使用同一份 GUID 映射，因此其中引用的旧媒体库 item ID 也可以在 API 写入前转换为新 ID。

## 导入

`import` 会启动交互式向导并执行以下操作：

- 选择本地快照；
- 连接目标 Jellyfin 服务器；
- 将旧用户映射到目标用户，并按需创建缺失用户；
- 恢复用户设置和显示偏好；
- 在完成逻辑媒体匹配后，可选恢复归档图片；
- 通过 Jellyfin API 恢复电影和剧集观看数据。

## 本地数据

本地状态写入 `data/`，其中包括保存明文 API Key 的 `data/config.json`，以及位于 `data/exports/<name>/` 的快照。导入仍兼容旧版隐藏快照目录 `.yajm/exports/<name>/`，也兼容早期实验版本的 `.jfmigrate/exports/<name>/`。

## 开发

```bash
pnpm install
pnpm build
pnpm test
node dist/cli.js --help
```

SQLite 回退功能要求系统安装支持 `-json` 参数的 `sqlite3` 命令行工具。
