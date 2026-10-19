<h1 align="center">loop</h1>

<p align="center">中文 | <a href="README.md">English</a></p>

<p align="center">定时循环插件：/loop 命令 + loop 工具（模型自调节）+ 对话页活动状态条，支持多循环并行</p>

<p align="center">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license">
</p>

按固定间隔向当前 agent 重复投递 prompt——适合轮询、PR 看护、build-fix-test 循环。对齐 Claude Code 的 `/loop` 语义，**一个会话可同时跑多个循环**。形态：官方 **bundle 插件**（`dsh.bundle` + dshClient 通道），0 patch。

## 效果

![loop 状态条（真实运行截图：多循环折叠为计数条，展开后逐条列出）](https://cdn.jsdelivr.net/gh/vlln/dsh-loop@main/docs/preview/loop.png?v=3)

## 能力

**工具**（`defineTool` 注册，模型每轮可自调节）：

| 工具 | 说明 |
|---|---|
| `loop` | start（启动新循环）/ stop（停指定或全部）/ status / list（列出当前会话循环） |

**命令**（用户侧）：

| 命令 | 说明 |
|---|---|
| `/loop [间隔] <prompt>` | 启动新循环（间隔 `5m`/`30s`/`1h`/`2d` 或裸数字=分钟；裸 `/loop` 用内置维护 prompt） |
| `/loop list` | 列出当前会话全部循环（含 id） |
| `/loop stop <id>` / `/loop stop` | 停指定循环 / 停全部 |

`/loop` 的回执（命令面板里的标题/描述、`list` / 用法 / stop 输出）跟随**界面语言**：client half 把当前 locale 回传给插件，中英文按界面切换；没有客户端在场的 headless 运行保持英文。

**UI**（对话页输入框上方 dock 槽）：

| 功能 | 说明 |
|---|---|
| 活动状态条 | 单循环：`● ⟳ 循环中 · <prompt> · 5m · 下次 23s`；多循环折叠为计数条「N 个循环运行中 · 展开」，点击展开列表 |
| `/` 菜单行外观 | 在输入框敲 `/` 时，`/loop` 那一行左侧带 ⟳ 图标（与其他命令行同一位置、同一尺寸），标题显示本地化「循环」/「Loop」 |

## 设置

插件自带设置卡片，位于 **设置 → 插件 → 本插件包页**（官方 `plugins.bundle.config` 槽，key = bundle 包名 `@vlln/dsh-loop`；设置命名空间 = 声明 `Config` schema 的条目 id `dsh-loop`）。**每个工具一行独立的官方质感开关（Switch）**：

| 设置项 | 默认 | 效果 |
|---|---|---|
| 是否向模型**注入** `loop` 工具 | 开 | 关闭后本进程**不再注册** `loop` 工具：agent 的 `tools.schemas` 中没有 loop，模型看不到也调不动；`/loop` 命令（用户侧）与状态条不受影响 |

卡片字段由客户端 `LOOP_TOOL_FIELDS` 表驱动，Node half 的工具定义表与之一一对应——新增工具时在两端各加一条，设置页自动多出一行开关。

改动在**保存后立即生效**（schema 的叶标了 `.volatile()`：宿主原地提交、不重挂载条目，随后发 `loader/volatile-update`）——插件重读快照并按工具表动态注册/注销对应工具，新会话无需重启即可用上新设置。工具 schemas 在每次会话/每轮 prompt 组装时实时解析（架构上没有按 session 的快照）：存量会话的下一轮也会读到新工具集；关闭时对应工具会立即从 `tools.schemas` 消失，之前调用过它的模型下一轮起无法再调用（只能通过轮次记录对账）。`/loop` 命令（用户侧）与状态条不受影响。

## 安装

**推荐：git 源一行安装**（构建产物已入库，git 源不触发构建）：

```sh
dsh plugin --profile web add "github:vlln/dsh-loop#main"   # git 源一行（构建产物已入库）
# 或 npm 源：dsh plugin --profile web add @vlln/dsh-loop@0.4.3
```

或本地目录（有源码时）：`git clone` 后 `cd dsh-loop && dsh plugin --profile web add .`。

装完 **重启 web** 生效（bundle 挂载在启动时合成）；之后可在设置页「插件」面板停用/启用（运行时生效 + 持久化）。

## 兼容性

| dsh 版本 | 状态 |
|---|---|
| `0.2.0-rc.2` | ✅ 已验证（2026-10-03 按 0.2.0 迁移对齐；2026-10-15 复核命令面） |
| 其他版本 | ⚠️ 未验证——升级 dsh 后若 `/loop` 菜单行**少了图标与本地化标题**（命令本身仍可用），是上游改了客户端命令面的内部方法，插件会自动降级成官方回退外观 |

## 使用

```sh
# 用户侧
/loop 5m 检查 deploy 分支的 PR      # 每 5 分钟投递一次
/loop list                           # loop-1: every 5m — 检查 deploy 分支的 PR
/loop stop loop-1                    # 停指定
/loop stop                           # 停全部

# 模型侧（loop 工具）
loop action=start prompt="修 flaky test" interval="2m"
loop action=status
loop action=stop loop_id="loop-2"
```

循环活在当前 harness 进程，随进程退出消失（不跨重启持久化，与 Claude Code `/loop` 一致）。

## 开发

```sh
pnpm install
pnpm run build      # tsdown：Node half (lib/index.mjs) + client bundle (lib/client.js)
```

- Node half：`src/index.mjs`（命令/工具/loops 状态路由 `/plugins/dsh-loop/loops`）
- client：`src/client/index.tsx`（dock 槽状态条）

## 许可

MIT License（DSH 生态示例插件）。
