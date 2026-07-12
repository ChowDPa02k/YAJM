# Yet Another Jellyfin Migrator

> **⚠ 须知**
>
> 本项目 100% 由 Codex + GPT-5.5 / GPT-5.6 Sol 完成
>
> 作者本人完全不懂 Node.js 代码，使用此服务/软件产生的风险由用户自行承担

[English](README.md)

![](https://github.com/user-attachments/assets/c4fcab9a-f6ab-46cf-b845-2fc5d9d9e382)

这是一个使用 Node.js 和 TypeScript 编写的命令行工具，用于迁移 Jellyfin 用户、用户设置、用户观看记录、电影和剧集元数据。

## 项目适用范围

YAJM 是一个面向 Jellyfin **逻辑迁移与媒体库重建**的工具，适用于以下工况：

- 跨 Jellyfin 版本迁移；
- 跨 CPU 架构迁移；
- 丢弃原数据库，但保留全部媒体文件并重建 Jellyfin 服务器；
- 部分媒体文件的上层目录发生变化重整，但媒体文件本身完全不变。

如果迁移不涉及上述情况，请优先使用 Jellyfin 官方的 **[内置备份功能](https://jellyfin.org/docs/general/administration/backup-and-restore/)**。YAJM 不是官方完整备份功能的替代品；它解决的是数据库和内部路径无法原样复用时，如何通过 Jellyfin API、逻辑媒体匹配和可移植快照恢复用户、设置、观看数据、媒体元数据及图片。

## 特性

### 逻辑导出

为应对跨版本、跨架构、重构服务器底层数据库，本项目将 Jellyfin 服务器的相关数据抽取为 JSONL ，并在导入时解析为 API 请求写入目标数据库。

### 数据库解析

本项目可以直接解析 Jellyfin 服务器数据目录下的 sqlite 数据库文件生成 JSONL 以提升导出性能。

### 内部 GUID 映射

为了解决迁移 Jellyfin 服务器时媒体路径变化导致影视文件被重新生成 GUID 、已刮削数据和观看记录不匹配的问题，本项目通过一个基于置信度的可靠匹配算法创建新旧服务器的媒体文件 GUID 映射，并自动将映射后的数据迁入目标服务器。

### 图像同步

> 注：图像迁移范围只包含 Movie, Series, Season, Episode，不会导出演员、工作室等对象的图像

Jellyfin 的 NFO Saver 在文件中写入的图像信息是绝对路径，导致在目录有变化的迁移过程中可能会丢弃已保存的图像，转而使用 TMDB 等内置刮削源获取的默认图片。YAJM 在内部 GUID 映射能力的基础上，实现了元数据图像文件的迁移，并且在并发加持下，下载速度非常快。

## 媒体库限制

YAJM 目前只支持：

- 电影（Movie）；
- 电视剧，包括 Series、Season 和 Episode。

YAJM **不支持**音乐、电子书、图库，以及这些媒体类型对应的元数据、用户数据和图片迁移。如果有这类媒体库的迁移需求，欢迎贡献PR。

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

## 导入

`import` 会启动交互式向导并执行以下操作：

- 选择本地快照；
- 连接目标 Jellyfin 服务器；
- 将旧用户映射到目标用户，并按需创建缺失用户；
- 恢复用户设置和显示偏好；
- 在完成逻辑媒体匹配后，可选恢复归档图片；
- 通过 Jellyfin API 恢复电影和剧集观看数据。

## 本地数据

本地状态写入 `data/`，其中包括保存明文 API Key 的 `data/config.json`，以及位于 `data/exports/<name>/` 的快照。

## 开发

```bash
pnpm install
pnpm build
pnpm test
node dist/cli.js --help
```

SQLite 功能要求系统安装支持 `-json` 参数的 `sqlite3` 命令行工具。
