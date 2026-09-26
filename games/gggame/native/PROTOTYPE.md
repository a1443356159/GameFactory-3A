# GGgame · 低配人机试玩

浏览器文字卡片游戏：全员石头剪刀布，赢家各获得输家人数的步数。
有步数的玩家同时行动，每人有独立行动队列，执行时锁住自己，完成后立即执行下一项。
拿刀 / 穿裤子 1 秒，移动 2 秒，脱裤子 / 割 3 秒，到时才结算。
同时结算按拿刀 > 移动 > 穿裤子 > 脱裤子 > 割排序。
移动、穿裤子、脱裤子、拿刀、割各消耗 1 步；步数不能积攒。

## 运行

在仓库根目录，使用已有 Python 与 Node 20+：

```bash
python games/gggame/manage.py serve
```

首次运行通过 `ThreeClient` 安装仓库的 `@a3game/playable` 运行框架和 npm 依赖，输出浏览器地址。
端口冲突时加 `--port <空闲端口>`。无需模型权重、API key 或付费生成服务。

```bash
python games/gggame/manage.py test
python games/gggame/manage.py build
```

浏览器测试需要 Playwright Chromium。在 `native/` 中执行
`./node_modules/.bin/playwright install chromium`，保持试玩服务运行，然后在仓库根目录执行：

```bash
python games/gggame/manage.py browser-test
```

测试报告在 `native/.a3game/reports/`，实玩截图与 WebM 录屏在 `.tmp/browser/`。
测试工具通过公开 `ThreeClient.testing` 执行；`native/scripts/browser-tests.mjs`
将框架传入的 `--reporter json:<路径>` 转为 Playwright 支持的 JSON 输出环境变量。

## 操作

- 开局可选或输入电脑人数，未设固定人数上限；默认 3 位电脑。
- “慢热电脑”增加决策间隔，关闭后反应更快。两种模式均遵守相同的猜拳、步数、队列和动作耗时规则。
- 点击手势猜拳；点击玩家卡片选目标；点击某个家的“前往”移动。
- 右侧行动区操作穿裤子、拿刀、脱裤子和割；鼠标悬停不可用按钮可查看原因。
- 快捷键：1/2/3 出拳，W 穿、K 拿刀、D 脱、G 割，空格暂停。
- 切走标签页会自动暂停，回到页面后手动继续。打开玩法说明也会暂停。
- 被割后可观战电脑完成对局；暂停菜单允许重新设置，再开一局。

## 原型采用的默认约定

以下两项未由用户单独确认，保留为可调整的原型默认值：

1. 所有存活玩家用完本轮步数且动作全部结算后进入下一次猜拳。
2. 最后存活的一人获胜。

移动一开始即进入独立户外，途中不与任何人同地点。锁住自己期间仍可被偷袭。割结算时对方穿上裤子则无效，仍耗步数和时间。
零裤子仍存活，刀永久持有；同地点才能脱或割；不包含门、商店、技能等扩展。
详见 `RULES.md`。电脑随机选手势，不读取玩家未揭晓的选择。
URL 的 `?seed=<整数>` 可复现电脑随机序列，实际操作时序也会影响结果。

人数虽无固定上限，但设备性能与页面可读性有实际限制；人数增多时三种手势同时出现的概率也会上升，平局更常见。这一规则没有为了缩短对局而修改。

## 项目接入与文件分工

- `native/packages/gggame/src/rules.js`：不依赖界面的玩法状态、操作校验、行动队列、定时结算、淘汰与阶段切换。
- `bots.js`：仅使用公开状态和操作接口的电脑决策。
- `ui.js` / `style.css`：文字界面、输入、动画、战报；不复制玩法状态。
- `native/src/main.js`：用 `bootA3GameRuntime` 装配框架，使用框架固定时步驱动玩法及电脑。
- `mechanic_contract.json`：公开玩法接口；`context_used.json`：实际采用的项目参考。
- `manage.py`：通过 `ThreeClient` 安装、校验、构建、启动和测试。

本版交付的是 three.js 自身的浏览器运行页面，暂未生成独立 Browser Serving 网关或联网服务。
生成代码和验证证据各自保留；未把本地试玩声明为框架 benchmark 或不可变发布产物。

## 字体与素材

无外部图片、3D 模型、音频或 CG。图标为本游戏编写的 SVG，界面动画为 CSS / Web Animations。
中文字体来自 Google Fonts 分发的 Noto Sans SC，遵循 SIL Open Font License 1.1：

- 字体来源：https://github.com/google/fonts/tree/main/ofl/notosanssc
- 原始文件：`NotoSansSC[wght].ttf`，按游戏所用字符生成 WOFF2 子集。
- 随包许可证：`native/public/fonts/OFL.txt`。

字体随试玩页面本地加载，不依赖用户设备预装中文字体，也不请求第三方字体服务。
