const profilePattern = /^https:\/\/(?:www\.)?xiaohongshu\.com\/user\/profile\/([^?/#]+)/i;

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replaceAll("\\u002F", "/");
  }
}

function extractJsonStrings(html, key) {
  const expression = new RegExp(`"${key}":"((?:\\\\.|[^"\\\\])*)"`, "g");
  return [...html.matchAll(expression)].map((match) => decodeJsonString(match[1])).filter(Boolean);
}

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function topicSummary(titles) {
  const topics = [
    ["实景落地", /实景|完工|落地|还原|入住/],
    ["老房改造", /老房|旧改|翻新|改造/],
    ["报价与避坑", /报价|增项|预算|清单|避坑|省钱/],
    ["施工与工地", /施工|工地|开工|巡检|监理|工艺/],
    ["设计方案", /设计|户型|布局|方案|空间|收纳/],
    ["团队与服务", /团队|设计师|服务|签约|客户/],
    ["免费设计获客", /免费|无偿|报名|接单|量房/],
    ["装修知识分享", /装修|干货|知识|攻略|注意/],
  ];
  const ranked = topics
    .map(([label, pattern]) => ({ label, score: titles.filter((title) => pattern.test(title)).length }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.label);

  const emojiCount = titles.filter((title) => /[\p{Extended_Pictographic}]/u.test(title)).length;
  const numberCount = titles.filter((title) => /\d/.test(title)).length;
  const questionCount = titles.filter((title) => /[？?！!]|为什么|怎么|必看/.test(title)).length;
  const titleStyle = [
    emojiCount >= titles.length * 0.25 ? "Emoji 强提示" : "",
    numberCount >= titles.length * 0.25 ? "数字化标题" : "",
    questionCount >= titles.length * 0.25 ? "问题/避坑型标题" : "",
  ].filter(Boolean)[0] || "案例型标题";

  return `${ranked.length ? ranked.join("、") : "案例展示、专业知识、互动引导"}；${titleStyle}`;
}

export function normalizeXhsProfileUrl(value) {
  const input = String(value || "").trim();
  const match = input.match(profilePattern);
  if (!match) throw new Error("请粘贴完整的小红书用户主页链接");
  return {
    userId: match[1],
    fetchUrl: input,
    profileUrl: `https://www.xiaohongshu.com/user/profile/${match[1]}`,
  };
}

export function parseXhsProfileHtml(html, profileUrl) {
  const titles = [...new Set(extractJsonStrings(html, "displayTitle"))].filter((title) => title.trim());
  const nicknames = [
    ...extractJsonStrings(html, "nickName"),
    ...extractJsonStrings(html, "nickname"),
  ].filter((name) => name.trim());
  const avatars = extractJsonStrings(html, "avatar").filter((url) => /^https?:\/\//.test(url));
  const hasMore = /"hasMore":true/.test(html);
  const visibleCount = Math.min(titles.length, 30);

  if (!titles.length) {
    if (/安全验证|访问频繁|验证后继续/.test(html)) {
      throw new Error("小红书要求安全验证，请稍后重试");
    }
    throw new Error("没有读取到公开笔记，请确认主页可公开访问后重试");
  }

  return {
    name: mostFrequent(nicknames) || "小红书竞品账号",
    avatarUrl: mostFrequent(avatars),
    profileUrl,
    noteCount: visibleCount,
    hasMore,
    noteCountLabel: hasMore || titles.length > 30
      ? `已同步 ${visibleCount}+ 篇公开笔记`
      : `已同步 ${visibleCount} 篇公开笔记`,
    feature: topicSummary(titles.slice(0, 30)),
    cadence: visibleCount >= 30 ? "持续更新" : visibleCount >= 12 ? "稳定更新" : "样本较少",
    confidence: Math.min(98, 68 + visibleCount),
    status: "已同步",
    sampleTitles: titles.slice(0, 6),
    analyzedAt: new Date().toISOString(),
  };
}

export async function analyzeXhsCompetitor(value) {
  const startedAt = Date.now();
  const { fetchUrl, profileUrl } = normalizeXhsProfileUrl(value);
  const response = await fetch(fetchUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`公开主页读取失败（${response.status}）`);
  const html = await response.text();
  const competitor = parseXhsProfileHtml(html, profileUrl);
  return { ...competitor, durationMs: Date.now() - startedAt };
}
