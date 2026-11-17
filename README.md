# dsh-pet（改进版 fork）🐾

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面宠物插件。基于 **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT，保留原作者版权与许可证），做了一轮减负与流畅度改进。

**本 fork 不内置任何角色**：原作者那只 AI 生成的默认角色（动画、表情包、参考图、预览图）已全部移除。宠物由你自己的**宠物包**（pet pack：一份配置 + 一组透明动画）提供，放进 `$DSH_HOME/dsh-pet/pet/` 即可。最省事的是右键桌宠 →「导入干员…」（见下面[导入干员](#导入干员一键做宠物包)）；自己做素材见 [MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md) 与 [CONFIG.md](CONFIG.md) 的「额外宠物（pet pack）」。

## 相对原版的改动

- **安静**：新增 `speechEnabled`（默认关）——头上不弹任何文字气泡，不自动碎碎念（不调模型、不花 token），没有对话窗；宠物只演动画
- **换段不闪**：去掉 0.18s 交叉淡化、新段首帧出画后硬切、后台视频保持在合成层里、提前预载下一段（不再停在末帧）
- **循环状态** `animations.states`：「进入 → 循环若干遍 → 退出」（坐下坐一会儿再起来）；写进工作状态时「保持」到状态变化（等确认时一直坐着）
- **漫游范围** `moves.default.wanderRange`：在「家」附近来回溜达，走远 / 撞边就转身
- **没人理自己睡** `pets[].autoSleepMinutes`，DSH 再干活时自己醒
- **精简右键菜单**：常用项一层，其余收进「更多」；动作少的宠物不分组、去重，走法合并成一项
- **导入干员**：右键 →「导入干员…」，选基建小人的透明 webm 就自动生成宠物包（不需要 ffmpeg）
- **复制 / 隐藏 / 删除**：右键直接多开一只同样的干员（共用动画）、先藏起来（菜单栏托盘里勾选叫回）、或删掉（先确认；最后一只连动画移到废纸篓）
- **追加动作（攻击 / 技能 / 出场）**：右键 →「追加动作…」，选战斗小人的 webm（`Attack`、`Skill_1`、`Skill_3_Begin/Loop/Idle/End`、`Start`…）。分段技能自动组成「起手 → 约 20 秒攻击 / 架势交替 → 收招」；`Start` 变成出场动作（宠物出现时先播一次）；Claude Code / Codex / DSH 干活时（思考、调用工具、整理结果）这个干员会一直开打
- **重载不挪位**：导入、重载配置、改显示位置之后宠物留在原处，不再全部跳回角落
- 点击不再 Q 弹、默认不出声；macOS 桌面端优先用 HEVC 透明 `.mov` 硬件解码（约省 30% CPU）

## 配合 Claude Code / Codex 使用

装上插件后，Claude Code / Codex 会话一开始就自动拉起桌宠（不开 DSH 也行，用独立模式；已经有桌宠在跑就不再拉起）：

```
/plugin install dsh-pet --marketplace alexz949/dsh-pet          # Claude Code
codex plugin marketplace add alexz949/dsh-pet && codex plugin add dsh-pet@dsh-pet   # Codex（装完需信任一次 hooks）
```

详见 [integrations/claude-code](integrations/claude-code/README.md) 与 [integrations/codex](integrations/codex/README.md)。

## 安装（下载发布包）

1. 到 [Releases](https://github.com/alexz949/dsh-pet/releases) 下载最新的 `dsh-pet-<版本>.tgz`。
2. 装进 DeepSeek Harness（桌面应用；dsh web 用户把 `desktop` 换成 `web`），装完**重开 DSH**：

   ```sh
   dsh plugin --profile desktop add ~/Downloads/dsh-pet-<版本>.tgz
   ```

   macOS 桌面应用自带的 `dsh` 在 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`。

3. 不用 DSH 也行（独立模式，Node.js ≥ 22.12）：`npm install -g ~/Downloads/dsh-pet-<版本>.tgz`，然后运行 `dsh-pet-standalone`。首次启动会下载一次 Electron（约 110 MB）。
4. 本插件**不带任何角色**：右键桌宠 →「导入干员…」导入你自己的基建小人 webm（见下面[导入干员](#导入干员一键做宠物包)），或把宠物包放进 `~/.dsh/dsh-pet/pet/`。

## 安装（从源码）

```sh
git clone https://github.com/alexz949/dsh-pet.git
cd dsh-pet/dsh-pet
pnpm install --frozen-lockfile
npm run build
pnpm pack --pack-destination ../release --ignore-scripts
# 桌面应用（Electron 版）；dsh web 用户把 desktop 换成 web
dsh plugin --profile desktop add ../release/dsh-pet-<版本>.tgz
```

装完**重开 DSH** 才生效。macOS 桌面应用自带的 `dsh` 在 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`。然后把宠物包放进 `$DSH_HOME/dsh-pet/pet/`（默认 `~/.dsh/dsh-pet/pet/`）。

> 与原版 `dsh-pet` 共用插件 id 与数据目录，二者不能同时安装。

## 插件功能

只做桌宠本身，不碰 DSH 内核；能力就下面这些。

- **自带角色：无**。本 fork 不内置任何角色，所有表现都来自你放进来的宠物包（pet pack）里的透明视频动画，按权重首尾相接。
- **多开与种类**：同时养多只，各自大小与位置；也能自定义宠物种类（pet pack），一类一套动画与素材。
- **三种运行形态**：DSH web 的浏览器 overlay、DSH 桌面应用的透明置顶窗、完全不依赖 DSH 的独立模式。
- **交互与物理**：点击回应、拖拽甩抛、双击弹弓、宠物互撞，同一套物理与 Q 弹挤压手感，参数可调。
- **手机与触屏**：触屏直接拖拽甩抛，与鼠标共用同一套物理与挤压手感；手机浏览器上还能倾斜手机改变重力方向、摇一摇把宠物甩出去、碰撞时震动反馈——三项可在设置页「移动端效果」里分别关闭。传感器只在 HTTPS 或 localhost 下可用（iOS 还需点一次授权），iOS 与桌面端没有振动 API，会自动跳过。
- **碎碎念与对话**（默认关闭，见 `speechEnabled`）：按周期自动说一句，也能随时聊；记忆持久化、可配图、可念出来。
- **语音（说与听）**：对话回复与手动碎碎念会念出来，音色、音量与总开关可配；按住对话窗的话筒说一句，录音转成文字直接填进输入框。
- **余额展示**：内置常见服务商的余额 / 额度查询，按剩余额度分档播动画并弹气泡；也可以登记自己的服务商。
- **天气与位置**：右键「查询天气」查一次当前城市与天气（按出口 IP 粗定位 + Open-Meteo，免 key、免配置），气泡里给气温、体感、湿度、风速和对应天气图标；这份环境也会作为背景交给对话。
- **工作状态联动**：跟随 DSH 会话状态切档位动画，并在头顶常驻一句话。
- **待办事项**：一句话加可选到期时间，清单挂在宠物头顶；越临近到期提醒越密，由宠物说出来。
- **睡觉**：右键「睡觉」让它睡下，点一下或右键「起来」叫醒；睡着时完全安静——随机动作、碎碎念、余额、待办与工作状态都不打扰，还会按周期说梦话；睡姿可用 `animations.sleep` 配多套（蹲着睡、趴着睡…）。
- **系统通知**：任务完成或需要确认时弹系统通知，点一下回到对应会话。
- **右键菜单**：换动画、开聊、回到原位、打开 DSH / 网站、重载配置。
- **其他**：点击音效、系统托盘与每只宠物的显示位置。

各项能力的详细说明见 **[FEATURES.md](FEATURES.md)**；配置（大小 / 位置 / 多开 / 物理 / 模型 / 人设 / 宠物种类）见 **[CONFIG.md](CONFIG.md)**。

## 🔌 对外接口（供其他插件调用）

桌宠不只自己玩，也**对外开放两条调用通道**，让别的插件或脚本能驱动它、读它的状态。

- **能做什么**：让它说一句指定的话、播一段指定动画、与它对话；读它当前说的话、工作状态、系统通知、余额，以及所在城市与当前天气
- **为什么开放**：桌宠不该只是个摆设——比如一个「女仆」插件巡检验完想说句话，就能让桌宠当它的「实体」开口；也方便任何人基于它做二次开发
- **通道一 · HTTP**：挂在 DSH 自己的 Web 服务上（前缀 `/dsh-pet-7340`，只监听本机、无鉴权），跨进程、脚本可直接调。动作类接口只回 `{ok}`，数据统一从 `GET /state` 读
- **通道二 · Cordis 服务**：客户端半侧在 DSH web 页面内注册，同页客户端插件用 `ctx.get('petApi7340')` 直接取，零网络、零端口；只在该页面实例内有效，方法与返回见 [`CORDIS.md`](CORDIS.md)

相关文件（HTTP 与 Cordis 各一套）：

- [`API.md`](API.md) —— HTTP 接口一览（每个接口一句话，功能预览）
- [`openapi.yaml`](openapi.yaml) —— 完整契约（OpenAPI 3.1，可直接导入 Swagger UI / Postman）
- [`CORDIS-API.md`](CORDIS-API.md) —— Cordis 服务一览（每个成员一句话，功能预览）
- [`CORDIS.md`](CORDIS.md) —— 对外 Cordis 服务（客户端半侧，页面内 `ctx.get('petApi7340')`，不走网络）
- [`tools/api-tester.html`](tools/api-tester.html) —— HTTP 侧示例：桌宠控制台，扮演第三方消费方，可直观试用（`node tools/api-tester.cjs` 启动）
- [`tools/cordis-probe`](tools/cordis-probe/README.md) —— Cordis 侧示例：扮演同页客户端插件，用 `ctx.get()` 消费服务

## 兼容性

- **操作系统**：Windows / Linux / macOS 三端均可运行——浏览器 overlay 与桌面模式（Electron 透明置顶窗）行为完全一致；Electron 按平台自动探测/下载（`electron.exe` / `Electron.app` / linux 单文件），无需手动安装
- **无头 / 无桌面环境**：支持 Linux headless 等无图形会话——桌面模式自动检测显示环境（Linux 无 `DISPLAY` / `WAYLAND_DISPLAY` 时判定无显示、跳过桌面窗口，仅日志告警），浏览器 overlay 不受影响
- **浏览器**：浏览器 overlay 兼容 **Chromium 内核（Chrome / Edge 等）与 Firefox**——透明动画依赖 VP9-Alpha webm，三者均已实测透明确认；**不支持 Safari**（macOS 不认 webm alpha，透明渲染为黑底）——macOS 用 `.mov` 素材（GitHub Release `assets-mov`），下载放入即可（见「②.5 Safari/HEVC 兼容素材」）
- **多显示器**：支持多屏环境——跨屏漫游/抛掷以各屏工作区为界，异构缩放（各屏 DPI 不同）、任务栏条带、屏幕之间空洞均正确判定（横屏 / 竖屏 / 上下叠放皆可）；设置页「锁定在当前屏幕」可让宠物（抛掷与漫游）只在当前所在那块屏内活动

## 导入干员（一键做宠物包）

右键桌宠 →「**导入干员…**」，选明日方舟基建小人的透明 webm（可以多选文件，也可以直接选放它们的文件夹）→「导入」。屏幕中间会出一个进度面板，大约一分钟做完，桌宠自动重载，新干员出现在屏幕右上方。

- **素材**：从 PRTS 下载的基建小人 webm，文件名原样即可（如 `乌尔比安-注目深渊-基建-Relax-x1.webm`），也认 `Relax.webm` 这种短名。动作按文件名里的 `Relax`（待机，必需）/ `Move` / `Interact` / `Sit` / `Sleep` / `Special` 认，Special 有几个加几个，缺哪个就少哪段。**只收本身带透明背景的 webm**，gif 和不透明的视频不行（不会自动抠图）。素材需要你自己准备，本仓库不附带。
- **自动做的事**：从透明通道量出身高、脚底与坐下 / 睡觉的地面线并对齐、翻转朝向、按 30fps 重新编码；生成待机、转身、三种长度的走路、互动、坐着、睡觉、特别动作；走路速度从脚步自动测（脚不打滑）；动作概率用空弦 / 乌尔比安调好的默认值。
- **不需要 ffmpeg**：解码、对齐、编码都在插件自带的 Electron 里做（WebCodecs；彩色与透明各编一路 VP9，再拼成透明 webm）。
- **结果**：写在 `$DSH_HOME/dsh-pet/pet/<id>-config.json` 与 `<id>-animation/`。名字取自文件名（「乌尔比安·注目深渊」），中文名的 id 是 `op-` 加一串短哈希。同一个干员再导入一次就是覆盖更新，大小、位置等设置保留。想微调（大小、权重、走路距离…）直接改那份配置，字段见 [CONFIG.md](CONFIG.md)「额外宠物（pet pack）」。
- **限制**：只出 webm，macOS 上没有省电的 HEVC `.mov`（CPU 略高）；文件比 ffmpeg 编出来的大一些（一个干员约 5–20 MB）。

## 从零生成你自己的宠物

AI 提示词 → 绿幕视频 → 透明动画 → 插件，换角色、换动作、换风格，全流程可复现。

完整步骤见 **[MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md)**（素材要求、素材链、Safari 兼容、发布）。

## 项目结构

只列代码与发布相关目录；素材链的 video / scripts / step / pr 见 [MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md) 的 ② 章节（gitignore 的本地目录不列）：

```
├── README.md  INSTALL.md  FEATURES.md  MAKE-YOUR-OWN-PET.md  CONFIG.md  API.md  CORDIS.md  openapi.yaml   # 说明 / 安装 / 功能详解 / 宠物制作指南 / 配置 / HTTP 接口 / Cordis 服务 / OpenAPI 规范
├── tools/             # 开发工具：API 调试页、cordis-probe mock 服务商、DPI 探针
├── .github/workflows/ # CI：Safari/HEVC 转码流水线（macOS runner，手动触发 → 发布 assets-mov Release）
├── dsh-pet/           # ③ 插件（可独立 npm 发布）
│   ├── src/
│   │   ├── host/       # 宿主半侧：配置 / 路由 / 余额 / 工作状态
│   │   ├── client/     # 浏览器半侧：宠物渲染 / 动画链 / 设置页
│   │   ├── shared/     # 双端共用纯逻辑（物理 / 菜单 / 取数）
│   │   └── standalone/ # 独立模式 CLI（不依赖 DSH 直接跑桌宠）
│   ├── lib/            # 构建产物（npm run build 生成，不入库）
│   ├── runtime/        # 桌面模式运行壳（Electron 透明窗）
│   ├── assets/         # 字体 / 图标 / 音效 / config.jsonc 默认配置（不内置角色动画）
│   └── scripts/        # 构建、发布与开发脚本
└── LICENSE             # MIT
```

## 相关项目

- **[aipets](https://github.com/kallen-noelle/aipets)** —— Windows 11 桌面宠物，五个角色可多开，透明置顶、点击穿透、甩动带惯性。特色在**动作由大模型决定**：每轮对话后模型结合时间、天气、电量与好感度挑动作，无人说话时还能排出接近一整天的编排，模型不可用时回退内置规则。聊天接任意 OpenAI 兼容接口，带长期记忆、贴纸、画图与工具调用（联网搜索 / Home Assistant / MCP），支持语音朗读与语音输入；同一套代码既有单文件 `aipets.exe` 桌面版，也有浏览器里的整页舞台版。

## 💬 反馈与发版节奏

欢迎提 [issue](https://github.com/PC2005-cloud/dsh-pet/issues) 与 PR——bug、体验问题随时反馈。**新功能请先开 issue** 说明使用场景，确认后再动手，不要在确认前直接提交实现 PR。这个插件专注桌宠与 DSH 本身，偏离太远的需求一般不会做。动手前也请先翻一眼 [提交记录](https://github.com/PC2005-cloud/dsh-pet/commits/main)，确认不是已经修掉的同款问题（有些问题可能已经在 `main` 上修好了，只是还没发版）。

- **小修不单独发版**：不影响使用的小 bug 与优化会**累计**到下一个版本一起发，避免版本更迭过于频繁。所以「`main` 上已经修了」不等于「你装的这版已经包含」——`latest` 没更新时，以 `main` 的提交记录为准。
- **想立刻用上未发布的修复**：按 [INSTALL.md](INSTALL.md) 的「从源码安装」把插件指向本地仓库即可；注意**宿主半侧**的代码改动要**重开 DSH** 才生效（浏览器半侧刷新页面即可）。
- **报 bug 时请带上**：插件版本、`dsh` 版本、操作系统、复现步骤（有日志或截图更好）。

## 许可

- 代码：MIT
- 素材（动画/提示词/源视频）：允许开源使用，具体授权参考角色原型的形象授权（见下方「形象授权」）
- **二次创作（二创）约定**：基于本项目的衍生 / 改版 / 换皮作品，在 **GitHub 仓库、产品官网等公开渠道**上须附上原作者 GitHub 地址：<https://github.com/PC2005-cloud/dsh-pet>
- **形象出处**：宠物形象为社区二创的 DeepSeek「大肥鱼」（鲸鱼娘），**非 DeepSeek 官方形象**；原型「溟月」出自 B 站 [@上善无形](https://space.bilibili.com/4456176)，DeepSeek 版（女仆鲸鱼娘）设计出自 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)
- **形象授权**：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)（署名 · 非商业 · 相同方式共享），[声明原文](https://www.bilibili.com/opus/1247156596114456581)：「大肥鱼是遵守CC BY-NC-SA 4.0协议的形象，不可以以任何形式商业化。若您非常喜爱该形象，希望其拥有实体，您可以自行定制。」
