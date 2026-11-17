# dsh-pet for Claude Code

会话开始时自动拉起 [dsh-pet](https://github.com/alexz949/dsh-pet) 桌宠：用独立模式在后台启动，不需要开 DSH；DSH 里已经有桌宠在跑、或桌宠已经在跑时什么都不做，不会出现第二套。

**干活时开打**：Claude Code 调用工具时把「工作中」推给桌宠，结束时回空闲。只有追加过攻击 / 技能动作的干员会响应（右键「追加动作…」会自动打开它的 `workStatusEnabled`）：从思考到调用工具整段随机打攻击、放技能，技能一直循环到这一轮结束再收招。其他干员不联动，照旧按概率自己活动。

## 安装

```
/plugin install dsh-pet --marketplace alexz949/dsh-pet
```

或者分两步：

```
claude plugin marketplace add alexz949/dsh-pet
claude plugin install dsh-pet@dsh-pet
```

## 前提

- 本机装了 dsh-pet 插件包（任选其一）：DSH 里装过（自动在 `~/.dsh/profiles/*/node_modules/dsh-pet` 找到）；或全局装了包里的 `dsh-pet-standalone` 命令；或用环境变量 `DSH_PET_STANDALONE` 指向 `lib/standalone.js`。
- Node.js ≥ 22.12。首次启动桌面模式时，dsh-pet 会下载一次 Electron（约 110 MB，之后复用）。
- 宠物包放在 `~/.dsh/dsh-pet/pet/`（见 dsh-pet 的 CONFIG.md「额外宠物（pet pack）」）。

## 实现

SessionStart 拉起桌宠，UserPromptSubmit / PreToolUse / PostToolUse / PermissionRequest / Stop 等推送工作状态，全部异步（Claude Code 不等它们）。脚本不输出、失败也安静退出，不会卡住或打断 Claude Code。排查：`DSH_PET_HOOK_DEBUG=1` → `~/.dsh/dsh-pet/claude-hooks.log`。
