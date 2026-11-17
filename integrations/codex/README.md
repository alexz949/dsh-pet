# dsh-pet for Codex

会话开始时自动拉起 [dsh-pet](https://github.com/alexz949/dsh-pet) 桌宠，和 Claude Code 版一致：用独立模式在后台启动，不需要开 DSH；桌宠已经在跑（独立模式或 DSH 里）时什么都不做。桌宠只按宠物包设定的概率自己活动，不跟工作状态联动。

## 安装

```sh
codex plugin marketplace add alexz949/dsh-pet   # 或本地路径
codex plugin add dsh-pet@dsh-pet
```

**装完要信任一次 hooks**（Codex 的安全机制，安装本身不会信任）：CLI 启动时的提示里选 Review / Trust，或在 CLI 里用 `/hooks`，桌面应用在 设置 → Hooks。插件更新后要重新信任。

## 前提

与 Claude Code 版相同：本机装了 dsh-pet 插件包，Node.js ≥ 22.12，宠物包在 `~/.dsh/dsh-pet/pet/`。

## 实现

只有一个异步的 `SessionStart` hook，命令用 `$PLUGIN_ROOT` 定位脚本（Codex 在会话目录下用 `$SHELL -lc` 执行 hook）。脚本不输出、失败也安静退出。排查：`DSH_PET_HOOK_DEBUG=1` → `~/.dsh/dsh-pet/codex-hooks.log`。
