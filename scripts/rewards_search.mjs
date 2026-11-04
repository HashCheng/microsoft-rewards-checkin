// Microsoft Rewards 每日搜索积分自动化 (可移植版)
// 用法:
//   node rewards_search.mjs status            — 只查看当前积分进度
//   node rewards_search.mjs run [间隔秒数]     — 执行搜索直到完成当日积分(默认每次间隔30秒)
//   node rewards_search.mjs test <次数>        — 不计积分地试跑几次, 用于验证搜索流程是否正常
//   node rewards_search.mjs login             — 打开专用 Edge 窗口, 手动登录微软账号(首次使用必须执行一次)
// 原理: 启动/复用带专用配置目录(存放登录cookie)的 Edge, 通过 CDP 协议驱动
//
// 可用环境变量:
//   REWARDS_PROFILE  — Edge 专用配置目录(默认: 本脚本所在目录/.edge-rewards-profile)
//   REWARDS_EDGE     — Edge 可执行文件路径(默认自动探测常见安装位置)
//   REWARDS_PORT     — CDP 调试端口(默认 9333)
//   REWARDS_INTERVAL — 每次搜索间隔秒数(默认 30, 可被 run 子命令的数字参数覆盖)
//   REWARDS_HEADLESS — 设为 0 则显示浏览器窗口(默认 1 = 无头静默后台运行, 不弹窗)
// 要求: Node.js >= 22 (依赖原生 fetch/WebSocket)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const BASE_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.REWARDS_PORT || 9333);

// 浏览器路径探测: 环境变量 > Edge 常见安装位置 > Chrome 常见安装位置(Chromium 内核参数通用)
const EDGE_CANDIDATES = [
  process.env.REWARDS_EDGE,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const EDGE = EDGE_CANDIDATES.find(p => existsSync(p));

// Edge 专用配置目录: 存登录 cookie, 与日常浏览器隔离
const PROFILE = process.env.REWARDS_PROFILE || join(BASE_DIR, ".edge-rewards-profile");

const argv = process.argv.slice(2);
const mode = argv[0] ?? "run";
const numArg = (i) => { const v = argv.slice(i).find(a => /^\d+$/.test(a)); return v ? Number(v) : null; };

// 搜索间隔(秒): 命令行参数 > 环境变量 REWARDS_INTERVAL > 默认30秒
// 防风控: 间隔太短(如3秒)容易被判定为机器人, 30秒以上更接近真人节奏
const intervalSec = (mode === "run" ? numArg(1) : null) ?? Number(process.env.REWARDS_INTERVAL || 30);
const SEARCH_INTERVAL_MS = intervalSec * 1000;
// 无头模式: 默认开启(后台静默, 不弹窗不影响使用电脑); login 模式始终显示窗口
let HEADLESS = process.env.REWARDS_HEADLESS !== "0";
const MAX_SEARCHES = 45;         // 安全上限, 防止死循环
const BASE = `http://127.0.0.1:${PORT}`;

// 随机抖动: 在设定间隔基础上浮动 ±25%, 避免等长时间间隔的机器感
const jitter = (ms) => ms * (0.75 + Math.random() * 0.5);

const QUERIES = [
  "天气预报","今日新闻","股票行情","汇率换算","火车票查询","快递单号查询","世界杯赛程","健康饮食","健身计划","旅游攻略",
  "电影推荐","音乐排行榜","手机评测","笔记本电脑","游戏攻略","编程教程","人工智能","量子计算","太空探索","历史故事",
  "菜谱大全","养生知识","瑜伽入门","跑步技巧","篮球比分","足球新闻","汽车报价","房价走势","教育政策","考研资料",
  "英语学习","日语入门","数学题解","物理实验","化学反应","生物科普","地理知识","名画欣赏","古典音乐","摄影技巧",
  "宠物养护","花卉种植","钓鱼技巧","露营装备","滑雪场","温泉度假","美食街","夜市小吃","咖啡文化","茶道入门",
];

// ---------- CDP 客户端 ----------
async function cdpConnect() {
  const res = await fetch(`${BASE}/json/version`);
  const info = await res.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let msgId = 0;
  const pending = new Map();
  const eventListeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of eventListeners) fn(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ws, send, onEvent: (fn) => eventListeners.push(fn) };
}

// 打开一个新标签页并返回 sessionId
async function newPage(cdp, url = "about:blank") {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  // 无头模式下清洗 UA: 去掉 HeadlessChrome/HeadlessEdg 标识, 降低风控识别概率
  if (HEADLESS) {
    const ua = await evalJs(cdp, sessionId, "navigator.userAgent");
    if (typeof ua === "string" && ua.includes("Headless")) {
      await cdp.send("Network.enable", {}, sessionId);
      await cdp.send("Network.setUserAgentOverride", {
        userAgent: ua.replace(/HeadlessEdg/g, "Edg").replace(/HeadlessChrome/g, "Chrome"),
      }, sessionId);
    }
  }
  return { targetId, sessionId };
}

async function navigate(cdp, sessionId, url, timeoutMs = 30000) {
  const loadDone = new Promise((ok) => {
    const h = (msg) => {
      if (msg.method === "Page.loadEventFired" && msg.sessionId === sessionId) {
        ok();
      }
    };
    cdp.onEvent(h);
    setTimeout(ok, timeoutMs); // 超时兜底, 不无限等
  });
  await cdp.send("Page.navigate", { url }, sessionId);
  await loadDone;
}

async function evalJs(cdp, sessionId, expression) {
  const r = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true },
    sessionId
  );
  return r?.result?.value;
}

// ---------- Edge 启动 ----------
function launchEdge(extraArgs = []) {
  if (!EDGE) throw new Error("未找到 Edge 浏览器, 可用环境变量 REWARDS_EDGE 指定 msedge.exe 路径");
  const child = spawn(EDGE, [
    "--user-data-dir=" + PROFILE,
    `--remote-debugging-port=${PORT}`,
    "--no-first-run", "--no-default-browser-check", "--disable-features=msSmartScreen",
    "--window-size=1100,800",
    ...(HEADLESS ? ["--headless=new"] : []),
    ...extraArgs,
  ], { detached: true, stdio: "ignore" });
  child.unref();
  return child;
}

async function ensureEdge() {
  try {
    await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(1500) });
    console.log("[edge] 已有实例在运行, 直接复用");
    return;
  } catch { /* 需要启动 */ }
  console.log("[edge] 启动 Edge (专用配置目录)...");
  launchEdge(["about:blank"]);
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(1500) });
      console.log("[edge] 启动成功");
      return;
    } catch { /* 继续等 */ }
  }
  throw new Error("Edge 启动超时");
}

// login 模式: 打开专用配置的 Edge 让用户手动登录, 不做任何自动化
async function loginMode() {
  HEADLESS = false; // 登录必须显示窗口
  console.log("正在打开 Edge 专用窗口, 请在窗口中登录你的微软账号(rewards.bing.com 或 bing.com)...");
  console.log(`登录配置保存在: ${PROFILE}`);
  console.log("登录完成后直接关闭该窗口即可, 之后即可运行 run/status 模式");
  launchEdge(["https://rewards.bing.com"]);
}

// ---------- Rewards 进度 ----------
async function getProgressOnce(cdp, page) {
  // 通过 Network 域抓取原始响应体, 不依赖页面渲染
  const bodyPromise = new Promise((ok) => {
    let reqId = null;
    const h = async (msg) => {
      if (msg.sessionId !== page.sessionId) return;
      if (msg.method === "Network.responseReceived" &&
          msg.params.response.url.includes("getuserinfo")) {
        reqId = msg.params.requestId;
      }
      if (msg.method === "Network.loadingFinished" && reqId && msg.params.requestId === reqId) {
        try {
          const r = await cdp.send("Network.getResponseBody", { requestId: reqId }, page.sessionId);
          ok(r.body);
        } catch (e) { ok(null); }
      }
    };
    cdp.onEvent(h);
    setTimeout(() => ok(null), 25000);
  });
  await cdp.send("Network.enable", {}, page.sessionId);
  await navigate(cdp, page.sessionId, "https://rewards.bing.com/api/getuserinfo?type=1", 20000);
  const text = await bodyPromise;
  if (!text) throw new Error("未捕获到积分接口响应(可能未登录)");
  let data;
  try { data = JSON.parse(text); }
  catch {
    // 接口偶发返回 HTML 页面(风控/重定向/登录跳转), 属瞬时故障, 交给上层重试
    const e = new Error("积分接口返回非 JSON: " + String(text).slice(0, 150));
    e.transient = /^\s*</.test(String(text));
    throw e;
  }
  if (!data?.dashboard) throw new Error("积分接口无 dashboard 字段: " + String(text).slice(0, 150));
  const counters = data?.dashboard?.userStatus?.counters ?? {};
  const pick = (name) => (counters[name] ?? []).reduce((a, e) => ({
    p: a.p + (e.pointProgress ?? 0), m: a.m + (e.pointProgressMax ?? 0),
  }), { p: 0, m: 0 });
  const pc = pick("pcSearch");
  const mobile = pick("mobileSearch");
  const daily = data?.dashboard?.userStatus?.dailySetPromotions ?? [];
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const undoneDaily = daily.filter(d =>
    (d.attributes ?? []).includes("banner") === false &&
    d.complete === false && (d.promo?.attributes ?? []).includes("isRewardable")
  ).length;
  return { pc, mobile, undoneDaily, nickname: data?.bingUserInfo?.userInfo?.nickname ?? "?" , raw: data };
}

// 带重试的进度读取: 接口瞬时返回 HTML 时自动重试, 避免整轮任务中断
async function getProgress(cdp, page, { retries = 3, tolerant = false } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await getProgressOnce(cdp, page);
    } catch (e) {
      lastErr = e;
      if (!e.transient) break;
      console.warn(`[progress] 接口瞬时异常(第 ${i + 1} 次), 25 秒后重试: ${e.message.slice(0, 80)}`);
      await sleep(25000);
    }
  }
  if (tolerant && lastErr?.transient) return null; // 循环内允许跳过本次核对
  throw lastErr;
}

async function doSearch(cdp, page, idx) {
  const q = QUERIES[(idx * 7 + Math.floor(Math.random() * 13)) % QUERIES.length]
    + " " + Math.floor(Math.random() * 10000);
  await navigate(cdp, page.sessionId, `https://www.bing.com/search?q=${encodeURIComponent(q)}&form=QBLH`);
  // 模拟真人: 停留一段时间后随机向下滚动一点, 再看一会儿
  await sleep(jitter(SEARCH_INTERVAL_MS * 0.4));
  await evalJs(cdp, page.sessionId, `window.scrollBy({top: ${100 + Math.floor(Math.random() * 300)}, behavior: "smooth"})`);
  await sleep(jitter(SEARCH_INTERVAL_MS * 0.6));
}

// ---------- 主流程 ----------
if (mode === "login") {
  await loginMode();
  process.exit(0);
}

await ensureEdge();
const cdp = await cdpConnect();
const page = await newPage(cdp);

try {
  const p0 = await getProgress(cdp, page);
  console.log(`[progress] 账号: ${p0.nickname} | 必应搜索 ${p0.pc.p}/${p0.pc.m} | 移动搜索 ${p0.mobile.p}/${p0.mobile.m}`);

  if (mode === "status") process.exit(0);

  // test 模式: 试跑若干次搜索(不计积分, 用于验证流程/计时是否正常)
  if (mode === "test") {
    const n = numArg(1) ?? 2;
    console.log(`[test] 试跑 ${n} 次搜索, 每次约 ${intervalSec} 秒(含±25%随机抖动)`);
    for (let i = 0; i < n; i++) {
      const t = Date.now();
      await doSearch(cdp, page, i);
      console.log(`[test #${i + 1}] 耗时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
    }
    console.log("✅ 试跑完成");
    process.exit(0);
  }

  let done = 0;
  while (p0.pc.p + done < p0.pc.m && done < MAX_SEARCHES) {
    await doSearch(cdp, page, done);
    done++;
    const p = await getProgress(cdp, page, { tolerant: true });
    console.log(`[search #${done}] 必应搜索 ${p ? `${p.pc.p}/${p.pc.m}` : "接口暂时不可用, 跳过核对"}`);
    if (p && p.pc.p >= p0.pc.m) break;
    await sleep(jitter(3000)); // 搜索之间的额外短暂停顿
  }
  const pf = await getProgress(cdp, page, { tolerant: true });
  if (!pf) {
    console.log(`⚠️ 收尾核对时接口仍不可用, 已搜 ${done} 次(进度以 status 模式复核为准)`);
    process.exit(2);
  }
  const ok = pf.pc.p >= pf.pc.m;
  console.log(ok
    ? `✅ 今日搜索积分已完成: ${pf.pc.p}/${pf.pc.m}`
    : `⚠️ 未完全完成: ${pf.pc.p}/${pf.pc.m} (已搜 ${done} 次, 可能被风控或需要人工验证)`);
  if (pf.mobile.m > pf.mobile.p)
    console.log(`ℹ️ 移动端搜索还有 ${pf.mobile.m - pf.mobile.p} 分未完成(需手机UA, 本次未处理)`);
  process.exit(ok ? 0 : 2);
} catch (e) {
  console.error("❌ 出错:", e.message);
  if (/未登录|非 JSON|无 dashboard/.test(e.message))
    console.error("提示: 可能未登录或 cookie 过期。先运行 node rewards_search.mjs login 重新登录, 再重试");
  else
    console.error("提示: 检查 Edge 是否已安装, 或用环境变量 REWARDS_EDGE 指定 msedge.exe 路径");
  process.exit(1);
} finally {
  try { await cdp.send("Target.closeTarget", { targetId: page.targetId }); } catch {}
}
