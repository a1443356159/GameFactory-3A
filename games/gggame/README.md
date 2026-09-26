# GGgame

GGgame 在本仓库开发。网页仓库 `a1443356159/homepage` 只保存构建产物及 `/projects/GGgame` 入口，不维护第二份游戏源码。

- 游戏入口：https://www.yuanyiyan.com/projects/GGgame
- 房间服务：https://gggame-api.yuanyiyan.com
- 规则说明：[RULES.md](RULES.md)

## 源码结构与 3D 扩展

- `shared/rules.js`：纯游戏规则。处理猜拳、步数、护甲、刀、动作队列、计时与结算，无 DOM 和渲染依赖。
- `shared/bots.js`：只读取公开状态的电脑策略。
- `web/gggame/room.js`：权威多人房间，绑定会话身份、命令去重、断线宽限、持久化状态恢复。
- `web/gggame/worker.js`：Cloudflare HTTP/WebSocket 接口、Durable Objects 存储及结算 alarm。
- `web/src/gggame/`、`web/index.html`：当前文字交互界面；Vite 负责构建。
- `native/`、`manage.py`：原始 GameFactory Three.js 人机原型，规则与 AI 已改为引用 `shared/`。

之后制作 3D 时，使用 GameFactory 的引擎及资产生成功能实现场景、人物和动画，继续消费权威房间状态和发送同样的操作。规则及联机计时不需要复制到 3D 界面中。

## 本地联机试玩

Node >= 22.12，无需 Cloudflare 账号、模型权重或 GPU。

```sh
cd games/gggame/web
npm ci
npm run rooms:dev
```

另一个终端执行 `npm run dev`，打开 `http://127.0.0.1:4321/projects/GGgame`。
用不同浏览器或无痕窗口加入同一房间；也可添加电脑。刷新页面会从 sessionStorage 恢复原身份。
两个开发服务分别使用 4321 和 8787 端口，Ctrl-C 停止。局域网或公网联机需要可访问的服务地址与匹配的来源白名单。

## 测试与构建

```sh
cd games/gggame/web
npm test
npm run build
npx playwright install chromium
# 先启动上述本地网页和房间服务
npm run test:e2e
# 使用正式域名验证真实联机
GGGAME_WEB_URL=https://www.yuanyiyan.com GGGAME_ROOM_URL=https://gggame-api.yuanyiyan.com npm run test:e2e
```

规则与房间测试包含隐藏出拳、身份绑定、重复命令、同步结算、队列、独立户外、断线及持久化恢复。
浏览器测试用 3 个独立身份完成整局，并检查手机布局、刷新恢复和电脑对手。
测试机需要代理时可设置 `GGGAME_PROXY=http://127.0.0.1:7890`，只影响测试流量。
测试产物保存在 `web/.gggame-test-results/`，不提交到仓库。

## 部署房间服务

```sh
cd games/gggame/web
npx wrangler login
npm run rooms:deploy
```

网页在 Vercel，运算在 Cloudflare：每个房间由一个 SQLite Durable Object 统一处理，通过 WebSocket 同步。
已配置 Custom Domain `gggame-api.yuanyiyan.com`，不改变主页的 Vercel 托管。
`web/wrangler.jsonc` 管理域名、迁移及来源白名单；`web/gggame/deployment.json` 管理公开服务地址。
默认仅允许 www 与裸域两个正式网页来源。其他预览域名要显式加入白名单。
`PUBLIC_GGGAME_SERVER` 可覆盖网页连接地址；开发模式默认连接本地 Worker。
凭据仅保存在 Wrangler 用户配置中，不写入项目。免费额度及用量在 Cloudflare 控制台查看。

## 发布网页到 homepage

先提交本仓库的游戏改动，再构建与导出：

```sh
cd games/gggame/web
npm run build
npm run export:homepage -- /path/to/homepage
```

导出器只更新 homepage 中 GGgame 的专属发布目录：`public/gggame/`、`gggame-release/` 和薄入口 `src/pages/projects/GGgame.astro`。
`gggame-release/source.json` 记录本仓库的源码提交及 HTML 哈希，便于追踪和回退。
默认拒绝导出未提交的源码。然后在 homepage 执行 `npm run build`、提交发布文件并通过生产分支触发 Vercel 部署。
改游戏请回本仓库，勿手改导出的压缩文件。导出不包含服务端源码或凭据。

## 界面与对局反馈

- 出拳阶段独立占满视口；收齐出拳后切到结果页，服务端统一展示 5 秒，列出所有人的步数。
- 赢、输、平局以及五种行动结算都有短音效；右上角可静音，设置会保留。首次点击后启用声音，刷新重连不会补播历史音效。
- 所有阶段都有“退出房间”：立即撤销身份，对局中视为出局并取消动作；意外断线仍保留重连宽限。
- 房主只能在大厅踢人，包括电脑；对局中界面不提供踢人，服务端也会拒绝。
- 连续输 7 次获得 3 步保底，随后重新累计；获胜清零，平局不累计也不中断。保底步数照常消耗，不能存到下一轮。

## 联机运行约定

低配玩法延续 [RULES.md](RULES.md)。另有以下联机默认值：

- 每 15 秒心跳；75 秒没有消息即退出本局，宽限期内可重连，动作不会因断线暂停。
- 断线房主转交权限给仍在房间的人类玩家；活跃对局不允许新身份中途加入。
- 30 分钟无客户端消息则删除房间；当前试玩服务每房间最多 64 人，是服务保护上限。
- 在线玩家没有自动出拳或强制行动期限。只有所有步数、动作与队列结束才进入下一轮。

原始单机原型的 ThreeClient 运行及验证说明见 [native/PROTOTYPE.md](native/PROTOTYPE.md)。
中文字体为 Noto Sans SC 的页面字符子集，遵循随附 OFL，其他字符回退系统字体。
