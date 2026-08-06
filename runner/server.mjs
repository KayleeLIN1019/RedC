import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { analyzeXhsCompetitor } from "./xhs-competitor.mjs";
import { createBaiduMaterialService } from "./baidu-materials.mjs";

const runnerDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(runnerDir, "data");
const sessionsDir = path.join(runnerDir, ".sessions");
const statePath = path.join(dataDir, "state.json");
const port = Number(process.env.XHS_RUNNER_PORT || 3100);
const publishUrl =
  "https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch";
const loginUrl =
  "https://creator.xiaohongshu.com/login?lastUrl=%252Fnew%252Fhome&source=official";
const homeUrl = "https://creator.xiaohongshu.com/new/home";

const contexts = new Map();
const activeJobs = new Set();

const initialAccounts = [
  { id: "feed-a", name: "信息流账号 A", business: "feed" },
  { id: "feed-b", name: "信息流账号 B", business: "feed" },
  { id: "ip-yintang", name: "印堂设计师 IP", business: "ip" },
  { id: "ip-founder", name: "主理人账号", business: "ip" },
].map((item) => ({
  ...item,
  loginStatus: "disconnected",
  health: "等待登录",
  lastChecked: "",
}));

let state = {
  accounts: initialAccounts,
  publishTasks: [],
  events: [],
};

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(sessionsDir, { recursive: true });

try {
  state = { ...state, ...JSON.parse(await fs.readFile(statePath, "utf8")) };
  state.accounts = initialAccounts.map((base) => ({
    ...base,
    ...(state.accounts || []).find((item) => item.id === base.id),
  }));
} catch {
  await saveState();
}

const materialService = createBaiduMaterialService({
  runnerDir,
  port,
  getState: () => state,
  saveState,
  logEvent,
});
await materialService.ready();

async function saveState() {
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

async function logEvent(type, message, meta = {}) {
  state.events.unshift({
    id: crypto.randomUUID(),
    type,
    message,
    meta,
    createdAt: new Date().toISOString(),
  });
  state.events = state.events.slice(0, 500);
  await saveState();
}

function accountById(id) {
  return state.accounts.find((item) => item.id === id);
}

async function updateAccount(id, patch) {
  const account = accountById(id);
  if (!account) throw new Error("账号不存在");
  Object.assign(account, patch, { lastChecked: nowLabel() });
  await saveState();
  return account;
}

async function ensureContext(accountId) {
  if (contexts.has(accountId)) return contexts.get(accountId);
  const account = accountById(accountId);
  if (!account) throw new Error("账号不存在");

  const userDataDir = path.join(sessionsDir, accountId);
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: false,
    viewport: null,
    args: ["--start-maximized"],
  });

  context.on("close", async () => {
    contexts.delete(accountId);
    const current = accountById(accountId);
    if (current?.loginStatus === "awaiting_login") {
      await updateAccount(accountId, {
        loginStatus: "disconnected",
        health: "登录窗口已关闭",
      });
    }
  });
  contexts.set(accountId, context);
  return context;
}

async function primaryPage(accountId) {
  const context = await ensureContext(accountId);
  const pages = context.pages();
  return pages[0] || (await context.newPage());
}

async function pageSignals(page) {
  const url = page.url();
  let body = "";
  try {
    body = await page.locator("body").innerText({ timeout: 8000 });
  } catch {
    // A slow creator page alone is not enough to label an account blocked.
  }
  const blockedWords = ["账号封禁", "账号已被封禁", "账号异常", "限制使用", "账号冻结"];
  const verifyWords = ["安全验证", "设备验证", "短信验证", "验证码"];
  return {
    url,
    body,
    blocked: blockedWords.some((word) => body.includes(word)),
    needsVerification: verifyWords.some((word) => body.includes(word)),
    loginPage: url.includes("/login") || body.includes("扫码登录") || body.includes("验证码登录"),
  };
}

async function openLogin(accountId) {
  const page = await primaryPage(accountId);
  await page.bringToFront();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await updateAccount(accountId, {
    loginStatus: "awaiting_login",
    health: "等待扫码、短信或设备验证",
  });
  await logEvent("login", "已打开小红书创作服务平台登录页", { accountId });
  return page;
}

async function checkLogin(accountId) {
  const page = await primaryPage(accountId);
  await page.bringToFront();
  try {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch {
    // Continue with the visible page and evaluate its current status.
  }
  const signals = await pageSignals(page);

  if (signals.blocked) {
    await pauseAccountTasks(accountId, "检测到账号异常或封禁提示");
    return updateAccount(accountId, {
      loginStatus: "blocked",
      health: "账号异常，等待人工解封",
    });
  }

  if (signals.loginPage || signals.needsVerification) {
    return updateAccount(accountId, {
      loginStatus: "awaiting_login",
      health: signals.needsVerification ? "需要人工验证" : "等待登录",
    });
  }

  const cookies = await page.context().cookies([
    "https://www.xiaohongshu.com",
    "https://creator.xiaohongshu.com",
  ]);
  if (cookies.length > 0 && signals.url.includes("creator.xiaohongshu.com")) {
    return updateAccount(accountId, {
      loginStatus: "connected",
      health: "正常",
    });
  }

  return updateAccount(accountId, {
    loginStatus: "disconnected",
    health: "未检测到有效登录会话",
  });
}

async function pauseAccountTasks(accountId, reason) {
  for (const task of state.publishTasks) {
    if (task.accountId === accountId && ["queued", "scheduled"].includes(task.status)) {
      task.status = "paused";
      task.error = reason;
    }
  }
  await logEvent("account-paused", reason, { accountId });
  await saveState();
}

function validatePublish(payload) {
  if (!payload.confirmed) throw new Error("发布任务缺少人工确认");
  if (!accountById(payload.accountId)) throw new Error("发布账号不存在");
  if (!payload.title?.trim()) throw new Error("标题不能为空");
  if (!payload.content?.trim()) throw new Error("正文不能为空");
  if (!Array.isArray(payload.imagePaths) || payload.imagePaths.length === 0) {
    throw new Error("至少需要一张本地图片");
  }
  if (payload.imagePaths.length > 18) throw new Error("单篇图片不能超过 18 张");
}

async function assertFiles(imagePaths) {
  for (const imagePath of imagePaths) {
    const fullPath = path.resolve(imagePath);
    const info = await fs.stat(fullPath).catch(() => null);
    if (!info?.isFile()) throw new Error(`图片不存在：${fullPath}`);
  }
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function fillContent(page, task) {
  let uploadInput = page.locator('input[type="file"]');
  if ((await uploadInput.count()) === 0) {
    const imageTab = page.getByText("上传图文", { exact: false });
    if ((await imageTab.count()) > 0) {
      await imageTab.first().click().catch(() => {});
      await page.waitForTimeout(800);
      uploadInput = page.locator('input[type="file"]');
    }
  }
  if ((await uploadInput.count()) === 0) throw new Error("没有找到图片上传入口，平台页面可能已更新");
  await uploadInput.first().setInputFiles(task.imagePaths);

  await page.waitForTimeout(1200);
  const titleField = await firstVisible(page, [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[maxlength="20"]',
  ]);
  if (!titleField) throw new Error("没有找到标题输入框");
  await titleField.fill(task.title.slice(0, 20));

  const bodyField = await firstVisible(page, [
    'div[contenteditable="true"]',
    'textarea[placeholder*="正文"]',
    'textarea[placeholder*="描述"]',
  ]);
  if (!bodyField) throw new Error("没有找到正文输入框");
  await bodyField.fill(task.content);
}

async function findPublishButton(page) {
  const buttons = page.locator("button");
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const text = (await button.innerText().catch(() => "")).trim();
    if ((text === "发布" || text === "立即发布") && (await button.isVisible().catch(() => false))) {
      return button;
    }
  }
  return null;
}

async function executePublish(task) {
  if (activeJobs.has(task.id)) return;
  activeJobs.add(task.id);
  task.status = "publishing";
  task.startedAt = new Date().toISOString();
  await saveState();

  try {
    await assertFiles(task.imagePaths);
    const account = await checkLogin(task.accountId);
    if (account.loginStatus !== "connected") {
      task.status = "paused";
      task.error = account.health;
      await saveState();
      return;
    }

    const page = await primaryPage(task.accountId);
    await page.bringToFront();
    await page.goto(publishUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const beforeSignals = await pageSignals(page);
    if (beforeSignals.blocked || beforeSignals.needsVerification || beforeSignals.loginPage) {
      await pauseAccountTasks(task.accountId, "发布前需要人工验证或解封");
      task.status = "paused";
      task.error = "发布前需要人工验证或解封";
      await saveState();
      return;
    }

    await fillContent(page, task);
    const publishButton = await findPublishButton(page);
    if (!publishButton) throw new Error("没有找到发布按钮，内容已保留在页面中供人工检查");

    // Every task has already passed an explicit confirmation in the web UI.
    await publishButton.click();
    await page.waitForTimeout(3500);

    const afterSignals = await pageSignals(page);
    if (afterSignals.needsVerification || afterSignals.blocked) {
      await pauseAccountTasks(task.accountId, "发布后触发平台验证或账号异常");
      task.status = "paused";
      task.error = "平台要求人工验证";
    } else {
      task.status = "published";
      task.publishedAt = new Date().toISOString();
      task.resultUrl = page.url();
      task.error = "";
      await logEvent("published", "小红书笔记发布流程已执行", {
        accountId: task.accountId,
        taskId: task.id,
        resultUrl: task.resultUrl,
      });
    }
  } catch (error) {
    task.status = "failed";
    task.error = error instanceof Error ? error.message : String(error);
    await logEvent("publish-failed", task.error, {
      accountId: task.accountId,
      taskId: task.id,
    });
  } finally {
    activeJobs.delete(task.id);
    await saveState();
  }
}

async function processQueue() {
  const now = Date.now();
  for (const task of state.publishTasks) {
    if (!["queued", "scheduled"].includes(task.status)) continue;
    const dueAt = task.scheduledAt ? new Date(task.scheduledAt).getTime() : 0;
    if (!dueAt || dueAt <= now) executePublish(task);
  }
}

setInterval(processQueue, 12_000).unref();

function corsHeaders(origin = "") {
  const allowed = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(process.env.RUNNER_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean),
  ];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function send(res, status, payload, origin) {
  res.writeHead(status, {
    ...corsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function sendBuffer(res, status, payload, contentType, origin) {
  res.writeHead(status, {
    ...corsHeaders(origin),
    "Content-Type": contentType,
    "Content-Length": payload.length,
    "Cache-Control": "private, max-age=300",
  });
  res.end(payload);
}

function sendStream(res, status, file, origin) {
  res.writeHead(status, {
    ...corsHeaders(origin),
    "Content-Type": file.contentType,
    "Content-Length": file.size,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "Cache-Control": "private, max-age=300",
  });
  file.stream.on("error", () => res.destroy());
  file.stream.pipe(res);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) throw new Error("请求内容过大");
  }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true, runner: "xhs-local-runner", time: new Date().toISOString() }, origin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/accounts") {
      send(res, 200, { accounts: state.accounts }, origin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tasks") {
      send(res, 200, { tasks: state.publishTasks, events: state.events.slice(0, 50) }, origin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/materials/status") {
      send(res, 200, await materialService.status(), origin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/materials/baidu/auth-url") {
      await readJson(req);
      send(res, 200, { authUrl: materialService.authUrl() }, origin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/materials/baidu/callback") {
      if (url.searchParams.get("error")) {
        sendHtml(res, 400, "<!doctype html><meta charset=\"utf-8\"><title>百度网盘授权失败</title><body style=\"font-family:system-ui;padding:40px\"><h2>百度网盘授权未完成</h2><p>你可以关闭这个窗口，返回红序重新连接。</p></body>");
        return;
      }
      await materialService.completeOAuth(url.searchParams.get("code"));
      sendHtml(res, 200, "<!doctype html><meta charset=\"utf-8\"><title>百度网盘已连接</title><body style=\"font-family:system-ui;padding:40px\"><h2>百度网盘已连接</h2><p>可以关闭这个窗口，返回红序管理素材。</p><script>setTimeout(()=>window.close(),1600)</script></body>");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/materials/baidu/disconnect") {
      await readJson(req);
      await materialService.disconnect();
      send(res, 200, { ok: true, message: "已断开百度网盘；本机缓存与云端原件均未删除" }, origin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/materials/files") {
      const result = await materialService.list(url.searchParams.get("dir") || undefined);
      send(res, 200, result, origin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/materials/thumbnail") {
      const thumbnail = await materialService.thumbnail(url.searchParams.get("fsId"));
      sendBuffer(res, 200, thumbnail.buffer, thumbnail.contentType, origin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/materials/cache") {
      const payload = await readJson(req);
      const record = await materialService.queueCache(payload);
      send(res, 202, { ok: true, record, message: record.status === "cached" ? "素材已在本机缓存" : "素材已加入本机缓存队列" }, origin);
      return;
    }

    const cacheFileMatch = url.pathname.match(/^\/api\/materials\/cache\/([^/]+)\/file$/);
    if (req.method === "GET" && cacheFileMatch) {
      const file = await materialService.cachedFile(cacheFileMatch[1]);
      sendStream(res, 200, file, origin);
      return;
    }

    const removeCacheMatch = url.pathname.match(/^\/api\/materials\/cache\/([^/]+)\/remove$/);
    if (req.method === "POST" && removeCacheMatch) {
      await readJson(req);
      await materialService.removeCache(removeCacheMatch[1]);
      send(res, 200, { ok: true, message: "已清理本机缓存，百度网盘原件仍然保留" }, origin);
      return;
    }

    const frameMatch = url.pathname.match(/^\/api\/materials\/cache\/([^/]+)\/frame$/);
    if (req.method === "POST" && frameMatch) {
      const payload = await readJson(req);
      const frame = await materialService.extractFrame(frameMatch[1], payload.timestamp, payload.business);
      send(res, 201, { ok: true, frame, message: "截帧已生成并保存到本机缓存" }, origin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/competitors/analyze") {
      const payload = await readJson(req);
      const competitor = await analyzeXhsCompetitor(payload.profileUrl);
      await logEvent("competitor-analyzed", `已完成竞品分析：${competitor.name}`, {
        profileUrl: competitor.profileUrl,
        noteCount: competitor.noteCount,
        durationMs: competitor.durationMs,
      });
      send(res, 200, {
        ok: true,
        competitor,
        message: `已分析 ${competitor.noteCount}${competitor.hasMore ? "+" : ""} 篇公开笔记`,
      }, origin);
      return;
    }

    const pauseTaskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/pause$/);
    if (req.method === "POST" && pauseTaskMatch) {
      await readJson(req);
      const task = state.publishTasks.find((item) => item.id === pauseTaskMatch[1]);
      if (!task) throw new Error("发布任务不存在");
      if (["published", "failed"].includes(task.status)) throw new Error("该任务已结束，无法暂停");
      task.status = "paused";
      task.error = "由运营人员手动暂停";
      await logEvent("task-paused", "发布任务已手动暂停", { taskId: task.id, accountId: task.accountId });
      await saveState();
      send(res, 200, { ok: true, task, message: "发布任务已暂停" }, origin);
      return;
    }

    const loginMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/login$/);
    if (req.method === "POST" && loginMatch) {
      await readJson(req);
      await openLogin(loginMatch[1]);
      send(res, 200, { ok: true, message: "登录窗口已打开，请在 Chrome 中完成扫码或验证" }, origin);
      return;
    }

    const checkMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/check$/);
    if (req.method === "POST" && checkMatch) {
      await readJson(req);
      const account = await checkLogin(checkMatch[1]);
      send(res, 200, { ok: true, account, message: `账号状态：${account.health}` }, origin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/publish") {
      const payload = await readJson(req);
      validatePublish(payload);
      await assertFiles(payload.imagePaths);
      const task = {
        id: crypto.randomUUID(),
        accountId: payload.accountId,
        business: payload.business,
        title: payload.title.trim(),
        content: payload.content.trim(),
        imagePaths: payload.imagePaths.map((item) => path.resolve(item)),
        scheduledAt: payload.scheduledAt || "",
        confirmed: true,
        status: payload.scheduledAt ? "scheduled" : "queued",
        createdAt: new Date().toISOString(),
        error: "",
      };
      state.publishTasks.unshift(task);
      await logEvent("queued", "已加入真实小红书发布队列", {
        accountId: task.accountId,
        taskId: task.id,
      });
      await saveState();
      send(res, 201, {
        ok: true,
        task,
        message: task.scheduledAt ? "已加入定时发布队列" : "已加入队列，将立即执行",
      }, origin);
      if (!task.scheduledAt) executePublish(task);
      return;
    }

    send(res, 404, { error: "接口不存在" }, origin);
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : String(error) }, origin);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`XHS local runner: http://localhost:${port}`);
  console.log("Login and publishing use the official Xiaohongshu Creator Service Platform in Chrome.");
});

async function shutdown() {
  for (const context of contexts.values()) {
    await context.close().catch(() => {});
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
