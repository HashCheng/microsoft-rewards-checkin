# 微软必应 Rewards 自动打卡

自动完成 [Microsoft Rewards](https://rewards.bing.com) 每日必应搜索积分的 WorkBuddy 技能。通过 CDP 协议驱动 Edge / Chrome，以接近真人的节奏后台静默搜索，不弹窗、不打扰。

## 特性

- **后台静默**：默认无头模式运行，全程不弹出浏览器窗口
- **拟人节奏**：30 秒基准间隔 + ±25% 随机抖动，搜索间随机滚动停留
- **风控处理**：自动清洗无头浏览器 UA 标识，积分接口异常时降级重试而非硬刷
- **零依赖**：仅用 Node.js 原生 `fetch` / `WebSocket`，无需安装任何 npm 包
- **可移植**：浏览器路径与配置目录自动探测，也可用环境变量覆盖
- **进度可见**：随时查询当日 PC / 移动搜索积分完成情况

## 环境要求

- Windows + Edge 或 Chrome（自动探测，也可用 `REWARDS_EDGE` 指定）
- Node.js >= 22
- **微软账号**（Microsoft Rewards 属微软积分体系，谷歌账号无法登录）

## 快速开始

```bash
# 1. 首次登录（必须执行一次，会弹出真实浏览器窗口供手动登录）
node scripts/rewards_search.mjs login

# 2. 查看积分进度
node scripts/rewards_search.mjs status

# 3. 正式打卡（无头静默，搜索直到当日积分完成）
node scripts/rewards_search.mjs run
```

## 子命令

| 命令 | 说明 |
|------|------|
| `login` | 打开专用浏览器窗口手动登录微软账号（首次必须） |
| `status` | 只查询积分进度，不执行搜索 |
| `run [秒]` | 正式打卡，可指定每次搜索间隔（默认 30 秒） |
| `test <次数>` | 不计积分试跑，验证流程是否正常 |

退出码：`0` 完成 / `2` 未完全完成（风控或需人工验证）/ `1` 运行错误。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REWARDS_PROFILE` | `./.edge-rewards-profile` | 浏览器专用配置目录，存放登录 cookie |
| `REWARDS_EDGE` | 自动探测 | 浏览器可执行文件完整路径 |
| `REWARDS_PORT` | `9333` | CDP 调试端口 |
| `REWARDS_INTERVAL` | `30` | 每次搜索间隔秒数 |
| `REWARDS_HEADLESS` | `1` | 设为 `0` 则显示浏览器窗口 |

## 定时任务

Windows 计划任务示例：

```bash
node D:/path/to/rewards_search.mjs run
```

在 WorkBuddy 中直接创建每日定时任务，prompt 写明「运行该脚本并汇报积分结果」即可。

## 工作原理

1. 启动（或复用）带专用 `--user-data-dir` 与 `--remote-debugging-port` 的浏览器实例
2. Node 原生 `fetch` + `WebSocket` 连接 CDP，创建标签页并清洗 UA
3. 依次访问必应搜索页，通过拦截 `rewards.bing.com/api/getuserinfo` 响应体读取积分
4. 达到当日上限或搜索 45 次（安全上限）后退出

## 风险提示

- 自动化搜索与 Microsoft Rewards 服务条款的字面精神存在冲突，**极端情况下可能导致积分清零或账号受限**，请自行评估并承担风险
- 不要把搜索间隔调至 10 秒以下，会显著提高被风控概率
- 本工具仅用于个人账号的日常搜索自动化，不支持多账号批量操作
- 移动端搜索积分需手机 UA，本脚本不处理

## 许可证

[MIT](LICENSE)

## 作为 WorkBuddy 技能使用

本仓库根目录即包含 `SKILL.md`，可直接在 WorkBuddy 中通过 GitHub 导入安装，或把整个文件夹放入 `~/.workbuddy/skills/` 目录后重启。
