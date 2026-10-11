# 这个 fork 是什么

[obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) 的个人 fork，
在保留上游全部插件的前提下，增加 Typora 缺失的 **D2 图表渲染**。

上游只跟不动，自己的改动全部在 `dev` 分支上。

## 相对上游的改动

| 文件 | 改动 |
|------|------|
| `plugin/d2/` | 新增：D2 渲染插件 |
| `plugin/global/settings/settings.default.toml` | 新增 `[d2]` 配置段；组件插件菜单里登记 `d2` |
| `plugin/global/locales/{en,zh-CN,zh-TW}.json` | 新增 `d2` 文案 |
| `plugin/preferences/schemas.js` | 新增 `schema_d2` 配置面板 |
| `develop/test/d2.test.js` | 新增测试 |
| `docs/adr/` | 决策记录 |

## D2 插件

两种用法，共用同一个渲染内核（调本机 `d2` 可执行文件，stdin 进、stdout 出，
不联网、不依赖 WASM，结果与 d2 命令行一致）：

1. **Markdown 里的 ```d2 代码块** —— 在 `.md` 中直接出图
2. **独立的 `.d2` 文件** —— 双击即在 Typora 里打开，源码 + 实时预览左右分栏，
   可编辑、Ctrl+S 存回原文件

渲染内核在 `plugin/d2/renderer.js`，被 `fence.js`（代码块）和 `file-view.js`
（整文件）共用。

代码块内可用 `// ==BlockCodeConfig==` 覆盖参数：

```d2
// ==BlockCodeConfig==
// @theme    3
// @layout   elk
// @sketch   true
// @pad      20
// ==/BlockCodeConfig==

client -> gateway: HTTPS
gateway -> user-service
```

默认参数与可执行文件路径在 `settings.user.toml` 的 `[d2]` 段配置，
或在 Typora 的「右键菜单 → 组件插件 → D2」里图形化修改。

`.d2` 文件视图可用 `ENABLE_FILE_VIEW` 单独关闭（它接管编辑区，风险高于代码块渲染，
所以留了独立开关）。默认视图、自动刷新、刷新延迟分别由 `FILE_VIEW_DEFAULT_MODE`、
`FILE_VIEW_AUTO_PREVIEW`、`FILE_VIEW_DELAY` 控制。

## 安装

前提：Typora ≥ 0.9.98，本机已安装 `d2`。

```powershell
# 管理员 PowerShell
cd <本仓库>\plugin\bin
.\install_fork_windows.ps1
```

脚本做两件事：把 `plugin` 目录部署到 Typora 的 `resources\` 下，
并把它替换成指向本仓库的目录联接（junction）——之后改仓库即生效，不需要再拷贝。

## 跟随上游

```bash
git fetch upstream
git checkout master
git merge --ff-only upstream/master   # master 永远等于上游
git push origin master
git checkout dev
git merge master                      # 冲突在 dev 上解
```

**不要用框架自带的 updater**（`[updater] ENABLE = false`）。它会整体替换
`plugin/` 并静默覆盖对上游文件的修改，绕过 git 历史。原因见
[ADR 0001](docs/adr/0001-fork-typora-plugin-and-develop-d2-on-it.md)。

## 已知风险

上游在积极增加图表插件，将来若新增 `plugin/d2/`，需要给我们的插件改名
（同时改 `settings.default.toml` 的段名、i18n key、`schemas.js` 的键）。
