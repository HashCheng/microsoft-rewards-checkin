---
name: microsoft-rewards-checkin
display_name: 微软必应 Rewards 自动打卡
description: 自动完成 Microsoft Rewards 每日必应搜索积分打卡。当用户要求"必应打卡"、"微软奖励积分"、"Microsoft Rewards 签到"、"刷必应搜索积分"、"查询 Rewards 积分进度"或需要定时执行微软积分任务时使用本技能。通过 CDP 协议驱动 Edge 浏览器, 以接近真人的节奏自动搜索直到当日积分完成, 支持登录引导、进度查询、试跑验证和定时任务配置。
description_zh: 自动完成 Microsoft Rewards 每日必应搜索积分打卡: 登录引导、进度查询、自动搜索、定时任务配置与故障排查。
description_en: Automate daily Microsoft Rewards Bing search points check-in via Edge + CDP: login onboarding, progress query, automated searching with human-like pacing, and scheduled task setup.
version: 1.0.0
author: hash-process
category: automation
agent_created: true
license: MIT
tags:
  - Microsoft Rewards
  - 必应
  - Bing
  - 打卡
  - 浏览器自动化
  - CDP
---

# 微软必应 Rewards 自动打卡

自动化完成 Microsoft Rewards 每日必应搜索积分。核心脚本为 `scripts/rewards_search.mjs`, 基于 Node.js 22+ 原生能力(fetch / WebSocket)通过 CDP 协议驱动 Edge 浏览器, 不依赖任何第三方包。

## 环境要求

1. Windows + Edge 或 Chrome 浏览器(自动探测常见安装路径, 也可用环境变量 `REWARDS_EDGE` 指定浏览器可执行文件; 两者同为 Chromium 内核, 启动参数与无头模式通用)
2. Node.js >= 22(依赖原生 fetch 和 WebSocket)
3. 用户已拥有**微软账号**(Microsoft Rewards 是微软的积分体系, 谷歌账号无法登录)

## 首次使用流程

1. **登录引导**(必须先执行一次): 运行 `node <skill目录>/scripts/rewards_search.mjs login`, 会打开一个使用专用配置目录的 Edge 窗口, 提示用户在窗口中手动登录微软账号(rewards.bing.com)。登录 cookie 保存在专用配置目录(默认 `<skill目录>/.edge-rewards-profile`), 与日常浏览器隔离, 只需登录一次。
2. **验证进度**: 运行 `node scripts/rewards_search.mjs status`, 输出账号昵称与当前搜索积分进度。若报"未捕获到积分接口响应", 说明未登录成功, 重新执行第 1 步。
3. **试跑**: 运行 `node scripts/rewards_search.mjs test 2` 不计积分地搜索 2 次, 验证流程正常。
4. **正式执行**: 运行 `node scripts/rewards_search.mjs run`, 自动搜索直到当日 PC 搜索积分完成。退出码: 0=完成, 2=未完全完成(风控/需人工验证), 1=错误。

## 日常打卡流程

运行 `node scripts/rewards_search.mjs run` 并等待结束, 向用户汇报本次积分进度(如 `120/120`)。注意:

- **默认无头静默模式**: 不弹出浏览器窗口, 后台完成搜索, 不影响用户正常使用电脑。如需观察过程可设环境变量 `REWARDS_HEADLESS=0` 显示窗口
- 无头模式下脚本会自动清洗 UA(去掉 HeadlessChrome/HeadlessEdg 标识)以降低风控识别概率; `login` 模式始终显示真实窗口
- 脚本耗时较长(每次搜索间隔约 30 秒, 整轮可能 15-30 分钟), 必须用后台方式运行并分段等待, 不要前台单次等待超时
- 汇报时读取脚本最后一行的完成状态; 退出码 2 时提示用户可能触发风控, 建议稍后重试
- 移动端搜索积分需手机 UA, 脚本会提示剩余分数但不自动处理, 如实告知用户

## 配置定时任务

用户要求"每天自动打卡"时, 创建每日定时任务, prompt 要点:

1. 运行 `node <skill目录>/scripts/rewards_search.mjs run`(后台运行, 等待完成)
2. 完成后汇报积分与状态
3. 若输出提示未登录/cookie 过期, 提示用户重新执行 `login` 模式手动登录一次
4. 不要在 prompt 里写死 Node 可执行文件的完整路径; 若系统有多版本 Node, 先探测再执行

## 故障排查

| 现象 | 处理 |
|------|------|
| 未找到 Edge | 用环境变量 `REWARDS_EDGE` 指定 msedge.exe 完整路径 |
| 未捕获到积分接口响应 / 积分接口返回非 JSON | cookie 过期或未登录: 关闭脚本启动的 Edge 窗口, 重新运行 `login` 模式登录 |
| 搜索积分长时间不涨 | 触发风控: 检查是否把间隔调得过短(应 >= 30 秒), 当天放弃并次日重试 |
| Edge 启动超时 | 确认没有占用调试端口(默认 9333, 可用 `REWARDS_PORT` 换端口); 检查杀毒软件拦截 |
| 移动端积分未完成 | 脚本仅覆盖 PC 搜索, 移动端需在手机 Edge/必应 App 手动完成 |

更多环境变量与原理说明见 `references/setup.md`。

## 风控注意事项

- 默认 30 秒搜索间隔 + ±25% 随机抖动已按真人节奏设计, 不要为提速调低到 10 秒以下
- 脚本有 45 次搜索的安全上限, 防止死循环
- 该脚本仅自动化用户自己账号的日常搜索行为, 不用于批量多账号场景
