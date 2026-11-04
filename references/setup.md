# 配置与环境变量参考

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REWARDS_PROFILE` | `<skill目录>/.edge-rewards-profile` | Edge 专用配置目录, 存放登录 cookie。与日常浏览器完全隔离, 删除该目录等于登出 |
| `REWARDS_EDGE` | 自动探测 | 浏览器可执行文件完整路径。探测顺序: 环境变量 → Windows Edge/Chrome → macOS `/Applications` 下 Edge/Chrome。两个平台均支持, 但登录用的必须是微软账号 |
| `REWARDS_PORT` | `9333` | CDP 远程调试端口。若与其他工具冲突可换 |
| `REWARDS_INTERVAL` | `30` | 每次搜索间隔秒数。可被 `run` 子命令的数字参数覆盖, 如 `run 45` |
| `REWARDS_HEADLESS` | `1` | 是否无头静默运行。默认 `1` 不弹窗; 设为 `0` 显示浏览器窗口(便于观察调试)。`login` 模式始终显示窗口 |

## 无头模式说明

- 默认以 `--headless=new` 启动 Edge, 整个打卡过程后台完成, 不弹出任何窗口
- 无头浏览器默认 UA 含 `HeadlessChrome`/`HeadlessEdg` 标识, 属明显机器人特征; 脚本会通过 CDP `Network.setUserAgentOverride` 自动把 UA 清洗为正常 Edge 标识后再发起请求
- 无头模式下浏览器进程在脚本结束后仍驻留(方便下次复用); 如需彻底关闭, 结束对应的 msedge.exe 进程即可

## 子命令一览

```
node rewards_search.mjs login          # 打开专用 Edge 窗口手动登录(首次必须)
node rewards_search.mjs status         # 只查看积分进度, 不执行搜索
node rewards_search.mjs run [秒]       # 正式打卡: 搜索直到 PC 搜索积分完成
node rewards_search.mjs test <次数>    # 试跑 N 次搜索不计积分, 验证流程
```

退出码约定(便于定时任务判断):

- `0` — 今日 PC 搜索积分已完成
- `2` — 未完全完成(可能触发风控或需要人工验证), 进度以 `status` 复核为准
- `1` — 运行错误(未登录、找不到 Edge 等)

## 工作原理

1. 启动(或复用)一个带专用 `--user-data-dir` 和 `--remote-debugging-port` 的 Edge 实例
2. 通过 Node 原生 `fetch` + `WebSocket` 连接 CDP(`http://127.0.0.1:<port>/json/version` → webSocketDebuggerUrl)
3. 打开新标签页, 用 `Page.navigate` 依次访问必应搜索页, 每次搜索后通过 `Network.responseReceived` 拦截 `rewards.bing.com/api/getuserinfo` 响应体读取积分进度
4. 积分接口偶发返回 HTML(风控/重定向), 脚本会自动重试最多 3 次; 打卡循环中允许跳过单次核对

## 定时任务示例(crontab 风格)

```
0 2 * * *  node /path/to/rewards_search.mjs run >> rewards.log 2>&1
```

在 WorkBuddy 中建议直接创建每日定时任务(如凌晨 2 点), prompt 只写命令与汇报要求, 不要写死 Node 完整路径。

## 跨平台说明

脚本仅使用 Node 原生能力(`child_process` / `fetch` / `WebSocket`), 无平台专有 API, Windows 与 macOS 行为一致:

| 项目 | Windows | macOS |
|------|---------|-------|
| 浏览器探测 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` 等 | `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` 等 |
| 默认 profile | `<skill目录>\.edge-rewards-profile` | `<skill目录>/.edge-rewards-profile` |
| 无头参数 | `--headless=new` | `--headless=new` |
| 定时任务 | Windows 计划任务 / WorkBuddy 定时任务 | crontab / launchd / WorkBuddy 定时任务 |
| 首次登录 | `node rewards_search.mjs login` | 同左 |

Linux 亦可运行(探测路径需用 `REWARDS_EDGE` 手动指定 chrome/chromium 路径)。

## 隐私与安全说明

- 专用配置目录中只保存浏览器 cookie 与本地缓存, 不含明文密码
- 脚本不向任何第三方发送数据, 仅访问 bing.com 与 rewards.bing.com
- 仅供个人账号日常搜索自动化, 不支持也不鼓励多账号批量操作
