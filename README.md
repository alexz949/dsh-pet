# dsh-pet（改进版）🐾

把明日方舟的基建小人放到桌面上当桌宠：右键一键导入，自己走路、坐着、睡觉；追加战斗动作后，**Claude Code / Codex / DeepSeek Harness 干活的时候它会在旁边放技能**。

基于 **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT）改进，是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的桌面宠物插件，也能不开 DSH 单独运行。

> **装上就有三个示例干员**：阿米娅直接出现在桌面上，维什戴尔（带战斗动作）和逻各斯先藏着，点菜单栏的 🐾 图标勾选就能叫出来。其它干员的动画（webm）需要你自己准备，再用「导入干员」导入。本项目是非官方的同人工具，与上海鹰角网络科技有限公司无关；《明日方舟》素材版权归鹰角网络所有，见文末[版权声明](#版权声明)。

## 快速开始

1. 到 [Releases](https://github.com/alexz949/dsh-pet/releases) 下载最新的 `dsh-pet-<版本>.tgz`。
2. 选一种方式装上：

   | 方式                     | 命令                                                                       | 说明                                                                                                                                             |
   | ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
   | 装进 DSH 桌面应用        | `dsh plugin --profile desktop add ~/Downloads/dsh-pet-<版本>.tgz`          | 装完重开 DSH。macOS 的 `dsh` 在 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`；dsh web 用户把 `desktop` 换成 `web` |
   | 不用 DSH（独立模式）     | `npm install -g ~/Downloads/dsh-pet-<版本>.tgz`，然后 `dsh-pet-standalone` | 需要 Node.js ≥ 22.12；首次启动会下载一次 Electron（约 110 MB）                                                                                   |
   | 配合 Claude Code / Codex | 见下面[配合 Claude Code / Codex](#配合-claude-code--codex)                 | 会话开始时自动拉起桌宠，干活时联动                                                                                                               |

3. 第一次启动会自动放入三个[示例干员](dsh-pet/samples/)：**阿米娅**直接出现在桌面上；**维什戴尔**（带攻击、技能、出场动作）和**逻各斯**先藏着，点菜单栏（Windows 是任务栏通知区）的 🐾 图标勾选就能叫出来。已经有自己干员的老用户不会被塞进示例。
4. 想加别的干员：在 PRTS 的干员页面下载**基建小人**的透明 webm（`Relax` / `Move` / `Sit` / `Sleep` / `Interact` / `Special`），右键任意桌宠（或点 🐾 图标）→「**导入干员…**」。
5. 想要战斗动作：再下载**战斗小人**的 webm（`Attack` / `Skill_x` / `Start`…），右键这个干员 →「**追加动作…**」。

## 干员

右键桌宠，第一层就是这些操作，都只影响这一只，其它宠物不闪、不重载。

### 导入干员

选基建小人的透明 webm（可以多选文件，也可以选它们所在的文件夹），大约一分钟做完，屏幕中间有进度面板，新干员出现在屏幕右上方。

- **文件名原样即可**：`乌尔比安-注目深渊-基建-Relax-x1.webm`，也认 `Relax.webm` 这种短名。`Relax`（待机）必需，其余缺哪个就少哪段；`Special` 有几个加几个。
- **自动完成**：从透明通道量出身高、脚底和坐下 / 睡觉的地面线并对齐，生成待机、转身、三种长度的走路、互动、坐着、睡觉、特别动作；走路速度按脚步自动测，脚不打滑。
- **不需要 ffmpeg**：解码、对齐、编码都在插件自带的 Electron 里完成。
- **只收本身透明的 webm**：gif 和不透明的视频不行（不会自动抠图）。
- 同一个干员再导入一次就是覆盖更新，大小、位置等设置保留。

### 追加动作（攻击 / 技能 / 出场）

给已有的干员加战斗小人的动作：

- **单个动作**：`Attack`、`Attack_B`、`Skill_1`… 显示成「攻击」「攻击B」「技能1」。
- **分段技能**：同一个技能有 `Begin` + `Loop`/`Idle` + `End` 的，自动组成「起手 → 攻击 / 架势交替约 20 秒 → 收招」。
- **出场动作**：`Start` 在干员出现在桌面上时先播一次（启动、复制、托盘叫回）。
- **干活时开打**：Claude Code / Codex / DSH 思考、调用工具、整理结果的整段时间里，它会一直轮流放技能和攻击，这一轮结束再收招。没追加过战斗动作的干员不联动。
- 平时随机放技能的概率很低（1%），右键「动作」菜单里可以随时点播。

### 复制 / 隐藏 / 删除

- **复制一只**：多开一只同样的干员，共用动画、不占额外空间，新的一只排在旁边。同一个干员开了 N 只时，每只的特别动作和技能概率按 1/N 算，满屏不会更吵。
- **隐藏**：先不显示，配置和动画都留着；点菜单栏的桌宠图标勾选就叫回来。隐藏的宠物不占 CPU 和内存。
- **删除…**：先确认；还有别的分身就只删这一只，最后一只连动画移到废纸篓。

## 平时会做什么

- **自己活动**：待机、走路、坐一会儿、偶尔做个特别动作，按权重随机；只在「家」附近溜达，走远或撞到屏幕边就转身。
- **没人理就睡**：一段时间不碰电脑就自己睡下，有动静再醒。也可以右键「睡觉」。
- **安静**：默认不弹文字气泡、不自动说话、不调用大模型、不花 token，只演动画。
- **换动作不闪**：动作之间直接切换，不留空白帧、不叠重影；重载后宠物留在原处。
- **拖拽甩抛**：可以把它拎起来扔出去，多只宠物之间会互相碰撞。

原插件的其它能力都还在，只是默认关着或收在「更多」里：碎碎念与对话、语音、余额、天气、待办、系统通知等，详见 [FEATURES.md](FEATURES.md)。

## 配合 Claude Code / Codex

```sh
# Claude Code
/plugin install dsh-pet --marketplace alexz949/dsh-pet

# Codex（装完需要信任一次 hooks：CLI 里 /hooks，或桌面应用 设置 → Hooks）
codex plugin marketplace add alexz949/dsh-pet
codex plugin add dsh-pet@dsh-pet
```

- **会话开始时自动拉起桌宠**：用独立模式在后台启动，不需要开 DSH；已经有桌宠在跑就不再拉起。
- **干活时联动**：把工作状态推给桌宠，追加过战斗动作的干员会开打。
- 前提：本机装了这个插件包（DSH 里装过，或 `npm install -g` 过）。

详见 [integrations/claude-code](integrations/claude-code/README.md) 与 [integrations/codex](integrations/codex/README.md)。

## 配置

每个干员一份配置：`~/.dsh/dsh-pet/pet/<id>-config.json`，动画在旁边的 `<id>-animation/`。常改的几项：

| 想调什么                         | 改哪里                                 |
| -------------------------------- | -------------------------------------- |
| 大小                             | `pets[].size`（默认 360）              |
| 走路 / 待机 / 转身的比例         | `animationWeights`                     |
| 坐着、互动、特别动作、技能的比例 | `animations.categories[].weight`       |
| 多久没人理就睡                   | `pets[].autoSleepMinutes`              |
| 溜达范围                         | `animations.moves.default.wanderRange` |

完整字段见 **[CONFIG.md](CONFIG.md)**；从零制作非明日方舟的宠物见 [MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md)。

## 兼容性

- **系统**：macOS / Windows / Linux；Electron 按平台自动下载。
- **浏览器 overlay（DSH web）**：Chrome / Edge / Firefox。Safari 不支持透明 webm，导入的干员在 Safari 里会是黑底。
- **多显示器**：跨屏走动和甩抛以各屏工作区为界，可在设置页锁定在当前屏幕。
- 与原版 `dsh-pet` 共用插件 id 和数据目录，二者不能同时安装。

## 对外接口

别的插件或脚本可以通过本机 HTTP 接口（前缀 `/dsh-pet-7340`）或 Cordis 服务驱动桌宠、读取状态：播动画、说一句话、推送工作状态等。见 [API.md](API.md)、[openapi.yaml](openapi.yaml)、[CORDIS.md](CORDIS.md)。

## 从源码构建

```sh
git clone https://github.com/alexz949/dsh-pet.git
cd dsh-pet/dsh-pet
pnpm install --frozen-lockfile
npm run build
pnpm pack --pack-destination ../release --ignore-scripts
dsh plugin --profile desktop add ../release/dsh-pet-<版本>.tgz
```

```
├── dsh-pet/                 # 插件本体（npm test / 打包都在这里）
│   ├── src/                 # TypeScript：host 宿主 / client 浏览器端 / shared 共用 / standalone 独立模式
│   ├── runtime/electron-helper/
│   │   ├── importer/        # 导入干员、追加动作：解码 / 对齐 / 编码，透明 webm 封装
│   │   ├── main/            # Electron 主进程：窗口、导入、复制隐藏删除、位置记录
│   │   └── sprite/          # 每只宠物的播放、动作与右键菜单
│   ├── samples/             # 示例干员（首次运行自动放入；素材版权归鹰角网络，不适用 MIT）
│   └── lib/                 # 构建产物（npm run build 生成）
├── integrations/            # Claude Code / Codex 插件
├── .claude-plugin/  .agents/plugins/   # 两个插件市场的清单
└── CONFIG.md  FEATURES.md  API.md  MAKE-YOUR-OWN-PET.md
```

## 反馈

欢迎在 [Issues](https://github.com/alexz949/dsh-pet/issues) 反馈问题或建议。报 bug 时请附上插件版本、系统、复现步骤，最好带上 `~/.dsh/dsh-pet/logs.txt` 里相关的几行。

## 许可与致谢

- **代码**：MIT（见 [LICENSE](LICENSE)），只覆盖本仓库的代码与文档，**不覆盖任何游戏素材**（包括 [dsh-pet/samples/](dsh-pet/samples/) 里的示例干员）。
- **原作者**：基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，原作者的版权与许可证保留；按原项目的二创约定，衍生作品须在公开渠道注明原作者地址 <https://github.com/PC2005-cloud/dsh-pet>。

## 版权声明

本项目所涉及的《明日方舟》干员模型与动画素材版权归上海鹰角网络科技有限公司所有，仅供个人学习与非商业交流使用。

All Arknights character models and animation assets are property of Hypergryph / Studio Montagne. This project is an unofficial fan tool for non-commercial, personal use only.

- 仓库的 [dsh-pet/samples/](dsh-pet/samples/) 和 Releases 里的发布包带了三个示例干员（阿米娅、维什戴尔、逻各斯，已转换格式的动画），不适用 MIT 许可证；其它素材由使用者自行获取。
- 本工具**不会自动从 PRTS 或任何网站下载素材**，只处理你本地选中的文件。手动下载时请适度，不要批量抓取 PRTS 等社区 Wiki 的媒体资源。
- 请勿用于售卖、商业用途或冒充官方应用。如权利方认为本项目有不妥之处，请通过 [Issues](https://github.com/alexz949/dsh-pet/issues) 联系，会立即删除相关素材。
