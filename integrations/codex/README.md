# dsh-pet for Codex

让 [dsh-pet](https://github.com/alexz949/dsh-pet) 桌宠跟着 Codex 干活，和 Claude Code 版行为一致：

| Codex | 桌宠 |
|---|---|
| 会话开始 | 桌宠没在跑就在后台拉起（独立模式，不需要开 DSH） |
| 你发消息 | 思考 |
| 调用工具 | 干活 |
| 等你批准（`PermissionRequest`） | 坐下来一直等，批准后站起来接着干 |
| 一轮结束 | 完成 |
| 中断 / 会话结束 | 回到空闲 |

## 安装

```sh
codex plugin marketplace add alexz949/dsh-pet   # 或本地路径
codex plugin add dsh-pet@dsh-pet
```

**装完要信任一次 hooks**（Codex 的安全机制，安装本身不会信任）：CLI 启动时的提示里选「Review hooks / Trust」，或在 CLI 里用 `/hooks`，桌面应用在 设置 → Hooks。插件更新后要重新信任。

## 前提

与 Claude Code 版相同：本机装了 dsh-pet 插件包（DSH 里装过、或 `dsh-pet-standalone` 在 PATH 上、或 `DSH_PET_STANDALONE` 指向 `lib/standalone.js`），Node.js ≥ 22.12，宠物包在 `~/.dsh/dsh-pet/pet/`。DSH 里桌宠已经在跑时，直接把状态推给它，不拉起第二套。

## 实现

`hooks/hooks.json` 里的命令用 `$PLUGIN_ROOT` 定位脚本（Codex 在会话目录下用 `$SHELL -lc` 执行 hook）。除 `Interrupt` / `SessionEnd`（Codex 强制同步，给 3 秒）外都是异步的。脚本与 Claude Code 版同一份逻辑：不输出、每次最多约 1.5 秒、失败也退出 0。排查：`DSH_PET_HOOK_DEBUG=1` → `~/.dsh/dsh-pet/codex-hooks.log`。
