# 示例干员

三个做好的宠物包，**插件第一次启动时会自动放进 `~/.dsh/dsh-pet/pet/`**：阿米娅直接显示，另外两个先隐藏（点菜单栏的 🐾 图标勾选就能叫出来）。已经有自己宠物包的用户不会被放入。

| 干员                               | 内容                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| 维什戴尔·绝对主角（`op-791acf0d`） | 基建动作 + 战斗动作：出场、攻击B、技能1、技能2·过载、技能3；Claude Code / Codex / DSH 干活时会开打 |
| 阿米娅（`op-b32d35e6`）            | 基建动作：待机、走路、互动、坐着、睡觉、特别动作；默认显示                                         |
| 逻各斯·辉煌的静谧（`op-dc41fbe3`） | 基建动作：待机、走路、互动、坐着、睡觉、特别动作                                                   |

## 手动安装

已经装过插件、想补上示例：把想要的干员的 `<id>-config.json` 和 `<id>-animation/` 一起复制到 `~/.dsh/dsh-pet/pet/`，然后右键任意桌宠 →「更多」→「重载配置」（或重启桌宠）。复制过去的配置里 `display` 是 `none` 的需要在托盘里勾选才会显示。

```sh
cp -R dsh-pet/samples/op-791acf0d-* ~/.dsh/dsh-pet/pet/
```

## 版权

**本目录不适用仓库的 MIT 许可证。**

本目录中的《明日方舟》干员模型与动画素材版权归上海鹰角网络科技有限公司所有，仅供个人学习与非商业交流使用；这里只做了格式转换（对齐、裁剪、重新编码），不主张任何权利。

All Arknights character models and animation assets in this directory are property of Hypergryph / Studio Montagne. They are provided for non-commercial, personal use only and are not covered by this repository's MIT license.

请勿用于售卖、商业用途或冒充官方应用。如权利方要求，会立即删除；请通过 [Issues](https://github.com/alexz949/dsh-pet/issues) 联系。
