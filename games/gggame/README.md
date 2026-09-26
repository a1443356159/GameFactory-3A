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
- `web/src/gggame/`、`web/index.html`：联机客户端、阶段界面、文字操作与 3D 装配；Vite 负责构建。
- `web/packages/gggame-3d/`：3D 小院、程序角色、动作动画与镜头；消费同一份服务端公开状态。
- `native/`、`manage.py`：原始 GameFactory Three.js 人机原型，规则与 AI 已改为引用 `shared/`。

当前 3D 小院使用 GameFactory 的运行框架和程序模型，消费权威房间状态并发送同样的操作。后续可以通过资产生成与导入流程替换人物、房屋和动画，规则及联机计时不需要复制到 3D 界面中。

## 本地联机试玩

Node >= 22.12 和 Python 3，无需 Cloudflare 账号或模型权重。3D 在浏览器 WebGL 中渲染，不能显示时自动回到文字视图。

```sh
cd games/gggame/web
python manage.py setup
npm run rooms:dev
```

另一个终端执行 `python manage.py serve`，打开 `http://127.0.0.1:4321/projects/GGgame`。
setup 通过公开 `ThreeClient` 安装本仓库的 A3GamePlayable 框架和 npm 依赖；框架副本不提交，干净 checkout 需先 setup。
用不同浏览器或无痕窗口加入同一房间；也可添加电脑。刷新页面会从 sessionStorage 恢复原身份。
两个开发服务分别使用 4321 和 8787 端口，Ctrl-C 停止。局域网或公网联机需要可访问的服务地址与匹配的来源白名单。

## 测试与构建

```sh
cd games/gggame/web
python manage.py test
python manage.py build
npx playwright install chromium
# 先启动上述本地网页和房间服务
python manage.py browser-test
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
python manage.py build
npm run export:homepage -- /path/to/homepage
```

导出器只更新 homepage 中 GGgame 的专属发布目录：`public/gggame/`、`gggame-release/` 和薄入口 `src/pages/projects/GGgame.astro`。
`gggame-release/source.json` 记录本仓库的源码提交及 HTML 哈希，便于追踪和回退。
默认拒绝导出未提交的源码。然后在 homepage 执行 `npm run build`、提交发布文件并通过生产分支触发 Vercel 部署。
改游戏请回本仓库，勿手改导出的压缩文件。导出不包含服务端源码或凭据。

## 界面与对局反馈

- 默认显示俯视 3D 小院。点房屋或地板前往，点小人选对手，右侧/下方安排动作；拖动旋转，镜头按钮缩放、找自己和全景。文字视图开关会保留。
- 五种动作与服务器计时同步；移动立即显示在独立户外，途中刷新通过公开 `active.from` 恢复轨迹。人物倒地、护甲和持刀都只在服务端结算后改变。
- 当前人物、房屋、植被为程序制作的可玩原型资产，未调用付费生成服务。细化范围及验收见 [3D-DESIGN.md](3D-DESIGN.md)。
- 出拳阶段独立占满视口；收齐出拳后切到结果页，有胜负展示 5 秒、平局展示 1 秒，列出所有人的步数。
- 赢、输、平局以及五种行动结算都有短音效；右上角可静音，设置会保留。首次点击后启用声音，刷新重连不会补播历史音效。
- 所有阶段都有“退出房间”：立即撤销身份，对局中视为出局并取消动作；意外断线仍保留重连宽限。
- 房主只能在大厅踢人，包括电脑；对局中界面不提供踢人，服务端也会拒绝。
- 连续输 7 次获得 3 步保底，随后重新累计；获胜清零，平局不累计也不中断。保底步数照常消耗，不能存到下一轮。

## 联机运行约定

低配玩法延续 [RULES.md](RULES.md)。另有以下联机默认值：

- 每 15 秒心跳；普通成员 75 秒没有消息即退出本局。房主断开后 15 秒未重连关闭整个房间；静默断网以最后心跳后 45 秒兜底。房主主动退出立即关房。宽限期内动作继续结算。
- 房主离开不再转交权限，按上述期限关闭房间；活跃对局不允许新身份中途加入。
- 30 分钟无客户端消息则删除房间；当前试玩服务每房间最多 64 人，是服务保护上限。
- 在线玩家没有自动出拳或强制行动期限。只有所有步数、动作与队列结束才进入下一轮。

原始单机原型的 ThreeClient 运行及验证说明见 [native/PROTOTYPE.md](native/PROTOTYPE.md)。
中文字体为 Noto Sans SC 的页面字符子集，遵循随附 OFL；用户名缺字时按需加载完整的常规字重后备字体（约 4.2 MB），后续使用浏览器缓存。

### 排行榜与房间清理

`gggame/leaderboard.js` 使用独立 SQLite Durable Object `Leaderboard`，通过 `LEADERBOARD` 绑定访问；Wrangler v2 migration 自动创建命名空间。页面只读 `GET /api/leaderboard?name=完整用户名`，没有公开写入接口。

每局由服务端生成唯一 match ID 和真人名单。结算时将房间快照与统计 outbox 原子写入同一房间存储，alarm 投递到全局榜。全局以 match ID 在 SQL 事务中去重，累计游玩、胜场、击杀及成功穿裤子次数；rematch 另建 ID。短暂投递故障会指数退避重试，最长间隔一小时。房间关闭立即结束连接与游戏计时，投递成功后 `deleteAll()` 清除房间数据及 alarm；全局战绩独立保留。

房主身份不自动转移。页面 `pagehide` 关闭 WebSocket，服务端从断开时开始 15 秒重连宽限，刷新恢复连接会取消该期限；新连接替代旧连接不会误关房。静默断网或从未连接以最后心跳后 45 秒兜底。浏览器强退后未发断开信号时走此兜底。
