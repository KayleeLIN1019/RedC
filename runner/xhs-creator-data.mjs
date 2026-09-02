const creatorHomeUrl = "https://creator.xiaohongshu.com/new/home";
const noteManagerUrl = "https://creator.xiaohongshu.com/new/note-manager";

function linesOf(text) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function parseMetric(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "--") return null;
  const multiplier = text.includes("万") ? 10_000 : 1;
  const number = Number.parseFloat(text.replace(/[,%万秒]/g, ""));
  return Number.isFinite(number) ? Math.round(number * multiplier * 100) / 100 : null;
}

function valueAfter(lines, label, startAt = 0) {
  const index = lines.findIndex((line, lineIndex) => lineIndex >= startAt && line === label);
  return index >= 0 ? lines[index + 1] : undefined;
}

async function waitForBody(page, marker, timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    if (text.includes(marker)) return text;
    await page.waitForTimeout(350);
  }
  throw new Error(`小红书后台页面加载超时：${marker}`);
}

async function gotoCreator(page, url, marker) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForBody(page, marker);
  await page.waitForTimeout(1200);
  return page.locator("body").innerText({ timeout: 5000 });
}

export function parseCreatorHome(text) {
  const lines = linesOf(text);
  const profileMatch = text.match(/收起侧边栏\n([^\n]+)\n([\d.万]+)\n关注数\n([\d.万]+)\n粉丝数\n([\d.万]+)\n获赞与收藏/);
  const headerName = text.match(/创作服务平台\n([^\n]+)\n发布笔记/)?.[1]?.trim();
  const overviewStart = lines.findIndex((line) => line === "笔记数据总览");
  const overviewEnd = lines.findIndex((line, index) => index > overviewStart && line === "最新笔记");
  const overview = overviewStart >= 0 ? lines.slice(overviewStart, overviewEnd > overviewStart ? overviewEnd : undefined) : lines;
  const xhsId = text.match(/小红书账号:\s*(\d{5,})/)?.[1]?.trim() || "";
  const period = overview.join("\n").match(/统计周期\s*([^\n]+)/)?.[1]?.trim() || "";

  return {
    profile: {
      name: profileMatch?.[1] || headerName || "小红书账号",
      following: parseMetric(profileMatch?.[2]),
      followers: parseMetric(profileMatch?.[3]),
      likesAndCollects: parseMetric(profileMatch?.[4]),
      xhsId,
    },
    period,
    metrics: {
      exposure: parseMetric(valueAfter(overview, "曝光数")),
      views: parseMetric(valueAfter(overview, "观看数")),
      clickRate: valueAfter(overview, "封面点击率") || "--",
      completionRate: valueAfter(overview, "视频完播率") || "--",
      likes: parseMetric(valueAfter(overview, "点赞数")),
      comments: parseMetric(valueAfter(overview, "评论数")),
      collects: parseMetric(valueAfter(overview, "收藏数")),
      shares: parseMetric(valueAfter(overview, "分享数")),
      followerGrowth: parseMetric(valueAfter(overview, "净涨粉")),
      profileVisitors: parseMetric(valueAfter(overview, "主页访客")),
    },
  };
}

export function parseNoteManager(text) {
  const lines = linesOf(text);
  const total = Number.parseInt(lines.find((line) => /^全部\s+\d+$/.test(line))?.match(/\d+/)?.[0] || "0", 10);
  const start = lines.findIndex((line) => line === "置顶");
  const notes = [];

  for (let index = Math.max(start + 1, 0); index < lines.length; index += 1) {
    if (!/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(lines[index])) continue;
    const title = lines[index - 1];
    const rawMetrics = lines.slice(index + 1, index + 6);
    if (!title || rawMetrics.length < 5 || rawMetrics.some((value) => parseMetric(value) === null)) continue;
    const [views, likes, comments, collects, shares] = rawMetrics.map((value) => parseMetric(value) || 0);
    notes.push({
      key: `${lines[index]}-${title}`,
      title,
      publishedAt: lines[index],
      views,
      likes,
      comments,
      collects,
      shares,
      status: "已发布",
    });
  }

  return { total, notes };
}

async function collectAllNotes(page) {
  await gotoCreator(page, noteManagerUrl, "笔记管理");
  const collected = new Map();
  let total = 0;
  let stableRounds = 0;
  let previousSize = -1;

  for (let round = 0; round < 35; round += 1) {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const parsed = parseNoteManager(text);
    total = Math.max(total, parsed.total);
    for (const note of parsed.notes) collected.set(note.key, note);
    if (total > 0 && collected.size >= total) break;

    stableRounds = collected.size === previousSize ? stableRounds + 1 : 0;
    previousSize = collected.size;
    if (stableRounds >= 5) break;

    await page.evaluate(() => {
      const candidates = [document.scrollingElement, ...document.querySelectorAll("*")].filter(Boolean);
      const target = candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
      if (target) target.scrollTop = target.scrollHeight;
    });
    await page.waitForTimeout(550);
  }

  return {
    total,
    collected: collected.size,
    notes: [...collected.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  };
}

export async function collectCreatorSnapshot({ account, page, acknowledgements = {} }) {
  const homeText = await gotoCreator(page, creatorHomeUrl, "笔记数据总览");
  const home = parseCreatorHome(homeText);
  const noteData = await collectAllNotes(page);
  const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const commentSignals = noteData.notes
    .filter((note) => {
      const acknowledged = Number(acknowledgements[note.key] || 0);
      const hasBaseline = Object.prototype.hasOwnProperty.call(acknowledgements, note.key);
      const publishedAt = new Date(note.publishedAt.replace(" ", "T") + ":00+08:00").getTime();
      return note.comments > acknowledged && (hasBaseline || publishedAt >= recentThreshold);
    })
    .map((note) => ({
      id: `${account.id}:${note.key}`,
      accountId: account.id,
      accountName: home.profile.name,
      noteKey: note.key,
      noteTitle: note.title,
      publishedAt: note.publishedAt,
      commentCount: note.comments,
      acknowledgedCount: Number(acknowledgements[note.key] || 0),
      newCount: note.comments - Number(acknowledgements[note.key] || 0),
      source: "小红书创作服务平台·笔记管理",
    }));

  return {
    accountId: account.id,
    business: account.business,
    accountName: home.profile.name,
    profile: home.profile,
    period: home.period,
    metrics: home.metrics,
    totalNotes: noteData.total,
    collectedNotes: noteData.collected,
    notes: noteData.notes,
    commentSignals,
    privateMessages: {
      status: "unavailable",
      reason: "创作服务平台网页端未提供私信正文；需在同一账号的小红书客户端或社区网页另行登录授权。",
    },
    source: "小红书创作服务平台",
    syncedAt: new Date().toISOString(),
  };
}
