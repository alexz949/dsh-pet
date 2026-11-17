# dsh-pet for Claude Code

让 [dsh-pet](https://github.com/alexz949/dsh-pet) 桌宠跟着 Claude Code 干活：

| Claude Code | 桌宠 |
|---|---|
| 会话开始 | 桌宠没在跑就在后台拉起（独立模式，不需要开 DSH） |
| 你发消息 | 思考 |
| 调用工具 | 干活 |
| 等你批准 | 坐下来一直等，批准后站起来接着干 |
| 一轮结束 | 完成 |
| 出错 | 出错 |
| 会话结束 | 回到空闲 |

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

- 本机装了 dsh-pet 插件包（任选其一）：
  - DSH 里装过 dsh-pet（插件会自动在 `~/.dsh/profiles/*/node_modules/dsh-pet` 找到它）；
  - 或全局装了包里的 `dsh-pet-standalone` 命令；
  - 或用环境变量 `DSH_PET_STANDALONE` 指向 `lib/standalone.js`。
- Node.js ≥ 22.12。首次启动桌面模式时，dsh-pet 会下载一次 Electron（约 110 MB，之后复用）。
- 宠物包放在 `~/.dsh/dsh-pet/pet/`（见 dsh-pet 的 CONFIG.md「额外宠物（pet pack）」）。

## 和 DSH 一起用

DSH 开着、桌宠已经在 DSH 里跑时，本插件不会再拉起第二套，而是把状态直接推给 DSH 里的桌宠。

## 实现

所有 hook 都是异步的（`"async": true`），Claude Code 不等它们；脚本 `scripts/pet.mjs` 每次最多约 1.5 秒、不输出、失败也安静退出，不会卡住或打断 Claude Code。
