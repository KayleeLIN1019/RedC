"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Eye,
  FileStack,
  FilePenLine,
  HeartHandshake,
  HardDrive,
  Image as ImageIcon,
  Layers3,
  LogIn,
  MessageSquareWarning,
  PauseCircle,
  Paintbrush,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Send,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Wifi,
  WifiOff,
  XCircle,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import ImageEditor from "./image-editor";
import MaterialCenter from "./material-center";

type BusinessId = "feed" | "ip";
type PageId =
  | "accounts"
  | "materials"
  | "designer"
  | "library"
  | "draft"
  | "review"
  | "schedule"
  | "messages"
  | "analytics"
  | "competitors"
  | "rules";

type Account = {
  id: string;
  name: string;
  platformName?: string;
  xhsId?: string;
  business: BusinessId;
  loginStatus: "connected" | "disconnected" | "awaiting_login" | "blocked";
  health: string;
  lastChecked?: string;
};

type CreatorNote = {
  key: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  collects: number;
  shares: number;
  status: string;
};

type CommentSignal = {
  id: string;
  accountId: string;
  accountName: string;
  noteKey: string;
  noteTitle: string;
  publishedAt: string;
  commentCount: number;
  acknowledgedCount: number;
  newCount: number;
  source: string;
};

type CreatorSnapshot = {
  accountId: string;
  business: BusinessId;
  accountName: string;
  profile: {
    name: string;
    following: number | null;
    followers: number | null;
    likesAndCollects: number | null;
    xhsId: string;
  };
  period: string;
  metrics: {
    exposure: number | null;
    views: number | null;
    clickRate: string;
    completionRate: string;
    likes: number | null;
    comments: number | null;
    collects: number | null;
    shares: number | null;
    followerGrowth: number | null;
    profileVisitors: number | null;
  };
  totalNotes: number;
  collectedNotes: number;
  notes: CreatorNote[];
  commentSignals: CommentSignal[];
  privateMessages: { status: string; reason: string };
  source: string;
  syncedAt: string;
};

type ContentItem = {
  id: string;
  business: BusinessId;
  title: string;
  account: string;
  type: string;
  images: number;
  status: "待审查" | "需修改" | "已通过";
  summary: string;
  ruleHits: string[];
  isSample?: boolean;
};

type Draft = {
  id: string;
  business: BusinessId;
  accountId: string;
  title: string;
  content: string;
  images: string;
  scheduledAt: string;
  updatedAt: string;
};

type Competitor = {
  name: string;
  type: string;
  feature: string;
  cadence: string;
  confidence: number;
  status: string;
  profileUrl?: string;
  avatarUrl?: string;
  noteCountLabel?: string;
  isSample?: boolean;
  analyzedAt?: string;
};

const verifiedIpProfiles: Record<string, Competitor> = {
  yanwu: {
    name: "上海设计师言午",
    type: "个人 IP",
    feature: "上海装修、透明报价、原创全案、自有施工团队与工地巡检",
    cadence: "持续更新",
    confidence: 100,
    status: "已同步",
    profileUrl: "https://www.xiaohongshu.com/user/profile/58b974b282ec394e27f0cd13",
    avatarUrl: "https://sns-avatar-qc.xhscdn.com/avatar/66b334a1f73b142ac1ef130c.jpg",
    noteCountLabel: "已同步 30+ 篇公开笔记",
    isSample: false,
  },
  xingzhou: {
    name: "上海设计师行舟",
    type: "个人 IP",
    feature: "上海全案设计、老房改造、实景落地、团队背书与设计师日常",
    cadence: "持续更新",
    confidence: 100,
    status: "已同步",
    profileUrl: "https://www.xiaohongshu.com/user/profile/64df14020000000001005641",
    avatarUrl: "https://sns-avatar-qc.xhscdn.com/avatar/1040g2jo3166lditn0u6g5p6v2g108li19mgh8d8",
    noteCountLabel: "已同步 30+ 篇公开笔记",
    isSample: false,
  },
};

type PublishTask = {
  id: string;
  accountId: string;
  business: BusinessId;
  title: string;
  scheduledAt?: string;
  createdAt: string;
  status: "queued" | "scheduled" | "publishing" | "published" | "paused" | "failed";
  error?: string;
};

const RUNNER_URL =
  process.env.NEXT_PUBLIC_XHS_RUNNER_URL || "http://localhost:3100";

const menuItems: Array<{
  id: PageId;
  label: string;
  icon: typeof LogIn;
  ipOnly?: boolean;
}> = [
  { id: "accounts", label: "账号与登录", icon: LogIn },
  { id: "materials", label: "素材中心", icon: HardDrive },
  { id: "designer", label: "图片设计", icon: Paintbrush },
  { id: "library", label: "内容库", icon: FileStack },
  { id: "draft", label: "发布草稿台", icon: FilePenLine },
  { id: "review", label: "内容审查", icon: ClipboardCheck },
  { id: "schedule", label: "发布计划", icon: CalendarDays },
  { id: "messages", label: "待处理消息", icon: MessageSquareWarning },
  { id: "analytics", label: "数据分析", icon: BarChart3 },
  { id: "competitors", label: "竞品观测", icon: Radar },
  { id: "rules", label: "个人 IP 规则包", icon: BookOpenCheck, ipOnly: true },
];

const seedAccounts: Account[] = [
  {
    id: "feed-a",
    name: "信息流账号 A",
    business: "feed",
    loginStatus: "disconnected",
    health: "等待登录",
  },
  {
    id: "feed-b",
    name: "信息流账号 B",
    business: "feed",
    loginStatus: "disconnected",
    health: "等待登录",
  },
  {
    id: "ip-yintang",
    name: "印堂设计师 IP",
    business: "ip",
    loginStatus: "disconnected",
    health: "等待登录",
  },
  {
    id: "ip-founder",
    name: "主理人账号",
    business: "ip",
    loginStatus: "disconnected",
    health: "等待登录",
  },
];

const seedContentItems: ContentItem[] = [
  {
    id: "IF-0821",
    business: "feed",
    title: "免费出图｜89㎡三室两厅这样改",
    account: "信息流账号 A",
    type: "3:4 图文 · 7 张",
    images: 7,
    status: "待审查",
    summary: "虚拟户型示例，重点展示横厅动线、玄关收纳和阳台利用。",
    ruleHits: ["已标记虚拟案例", "图片比例 3:4", "CTA 完整"],
    isSample: true,
  },
  {
    id: "IF-0822",
    business: "feed",
    title: "无偿设计｜小户型多出一间房",
    account: "信息流账号 B",
    type: "3:4 图文 · 6 张",
    images: 6,
    status: "需修改",
    summary: "封面通过，图片数量不足，建议补充一张改造前后对照图。",
    ruleHits: ["图片少于 7 张", "标题重复可接受", "缺少改造对比"],
    isSample: true,
  },
  {
    id: "IP-0318",
    business: "ip",
    title: "上海老房装修，报价为什么一定要做清单",
    account: "印堂设计师 IP",
    type: "实景图文 · 8 张",
    images: 8,
    status: "待审查",
    summary: "以实景案例解释清单式透明报价、先施工后付款与个性化定制。",
    ruleHits: ["未出现具体路名", "使用个性化清单式报价", "线下量房优先"],
    isSample: true,
  },
  {
    id: "IP-0319",
    business: "ip",
    title: "5000 定金可以开工，但这三类项目我们不接",
    account: "主理人账号",
    type: "口播图文 · 7 张",
    images: 7,
    status: "已通过",
    summary: "明确业务边界：不做局改、不做精装，可选半包、全包或个性化定制。",
    ruleHits: ["业务边界准确", "没有一口价/套餐价", "已配置竣工回访"],
    isSample: true,
  },
];

const competitorSeeds: Record<BusinessId, Competitor[]> = {
  feed: Array.from({ length: 20 }, (_, index) => ({
    name: [
      "户型改造研究所",
      "收纳设计手账",
      "小宅变形计划",
      "空间布局指南",
      "理想家设计室",
    ][index % 5] + (index > 4 ? ` ${index + 1}` : ""),
    type: "信息流",
    feature: [
      "大字封面、免费出图、高频复用",
      "前后对比、户型痛点、评论区报名",
      "小户型扩容、暖色手绘、晚间发布",
      "尺寸标注、清单结构、高收藏导向",
    ][index % 4],
    cadence: index % 2 ? "日更 1 篇" : "日更 2-3 篇",
    confidence: 76 + (index % 5) * 4,
    status: index === 7 ? "待重试" : "已更新",
    isSample: true,
  })),
  ip: [
    verifiedIpProfiles.yanwu,
    verifiedIpProfiles.xingzhou,
    ...Array.from({ length: 18 }, (_, index) => ({
    name: [
      "禧佳装饰设计",
      "设计师工作日记",
      "旧改主理人",
    ][index % 3] + (index > 2 ? ` ${index + 1}` : ""),
    type: "个人 IP",
    feature: [
      "利益点封面、实景案例、线下转化",
      "专业拆解、真人叙事、案例复盘",
      "报价清单、设计图纸、签约现场",
      "施工过程、观点表达、本人回复",
    ][index % 4],
    cadence: index % 3 ? "每周 4-5 篇" : "日更 1 篇",
    confidence: 78 + (index % 5) * 3,
    status: index === 12 ? "分析中" : "已更新",
    isSample: true,
  })),
  ],
};

const businessMeta = {
  feed: {
    name: "信息流矩阵",
    eyebrow: "批量获客业务",
    icon: Layers3,
    accent: "blue",
  },
  ip: {
    name: "个人 IP 运营",
    eyebrow: "长期品牌业务",
    icon: UserRound,
    accent: "violet",
  },
} as const;

function normalizeCompetitorData(value: Record<BusinessId, Competitor[]>): Record<BusinessId, Competitor[]> {
  const normalizeItem = (item: Competitor) => {
    const identity = `${item.name} ${item.profileUrl || ""}`;
    if (identity.includes("58b974b282ec394e27f0cd13") || item.name === "上海设计师言午") {
      return { ...item, ...verifiedIpProfiles.yanwu };
    }
    if (identity.includes("64df14020000000001005641") || item.name === "上海设计师行舟") {
      return { ...item, ...verifiedIpProfiles.xingzhou };
    }
    return { ...item, isSample: item.isSample ?? item.confidence > 0 };
  };

  const normalizedIp = value.ip.map(normalizeItem).filter((item, index, list) => {
    if (!item.profileUrl) return true;
    return list.findIndex((candidate) => candidate.profileUrl === item.profileUrl) === index;
  });

  return {
    feed: value.feed.map(normalizeItem),
    ip: normalizedIp,
  };
}

function newDraft(business: BusinessId): Draft {
  return {
    id: crypto.randomUUID(),
    business,
    accountId: business === "feed" ? "feed-a" : "ip-yintang",
    title: "",
    content: "",
    images: "",
    scheduledAt: "",
    updatedAt: new Date().toISOString(),
  };
}

function statusLabel(status: Account["loginStatus"]) {
  if (status === "connected") return "已连接";
  if (status === "awaiting_login") return "等待扫码/验证";
  if (status === "blocked") return "账号异常";
  return "未登录";
}

async function runnerRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${RUNNER_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "本地执行器请求失败");
  return data;
}

export default function Home() {
  const [business, setBusiness] = useState<BusinessId>("feed");
  const [page, setPage] = useState<PageId>("accounts");
  const [expanded, setExpanded] = useState<Record<BusinessId, boolean>>({
    feed: true,
    ip: true,
  });
  const [runnerOnline, setRunnerOnline] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>(seedAccounts);
  const [publishTasks, setPublishTasks] = useState<PublishTask[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>(seedContentItems);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftEditor, setDraftEditor] = useState<Draft>(() => newDraft("feed"));
  const [designerSeed, setDesignerSeed] = useState<{ src: string; name: string } | null>(null);
  const [selectedContentId, setSelectedContentId] = useState("IF-0821");
  const [reviewState, setReviewState] = useState<Record<string, ContentItem["status"]>>({});
  const [competitors, setCompetitors] = useState(() => normalizeCompetitorData(competitorSeeds));
  const [competitorQuery, setCompetitorQuery] = useState("");
  const [syncingProfiles, setSyncingProfiles] = useState<string[]>([]);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [creatorSnapshots, setCreatorSnapshots] = useState<CreatorSnapshot[]>([]);
  const [syncingCreatorData, setSyncingCreatorData] = useState(false);
  const [toast, setToast] = useState("");
  const [busyAccount, setBusyAccount] = useState("");
  const [publishForm, setPublishForm] = useState({
    accountId: "feed-a",
    title: "免费出图｜89㎡三室两厅这样改",
    content:
      "本期是虚拟户型设计示例，重点优化玄关收纳、客餐厅动线和阳台利用。\n\n需要户型规划可以留言。\n\n#户型设计 #户型改造 #装修灵感",
    images: "",
    scheduledAt: "",
  });

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const refreshRunner = useCallback(async () => {
    try {
      await runnerRequest("/health");
      setRunnerOnline(true);
      const data = await runnerRequest("/api/accounts");
      if (Array.isArray(data.accounts)) {
        setAccounts((current) =>
          current.map((account) => {
            const live = data.accounts.find((item: Account) => item.id === account.id);
            return live ? { ...account, ...live } : account;
          }),
        );
      }
      const taskData = await runnerRequest("/api/tasks");
      if (Array.isArray(taskData.tasks)) setPublishTasks(taskData.tasks);
    } catch {
      setRunnerOnline(false);
    }
  }, []);

  const loadCreatorData = useCallback(async (targetBusiness: BusinessId) => {
    try {
      const data = await runnerRequest(`/api/creator-data?business=${targetBusiness}`);
      if (Array.isArray(data.snapshots)) setCreatorSnapshots(data.snapshots);
      if (Array.isArray(data.accounts)) {
        setAccounts((current) => current.map((account) => {
          const live = data.accounts.find((item: Account) => item.id === account.id);
          return live ? { ...account, ...live } : account;
        }));
      }
    } catch {
      // The page will show the runner connection state instead of fabricated metrics.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(refreshRunner, 0);
    const timer = window.setInterval(refreshRunner, 8000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshRunner]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem("rednote-drafts");
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setDrafts(parsed);
      } catch {
        window.localStorage.removeItem("rednote-drafts");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedContent = window.localStorage.getItem("rednote-content-items");
      const savedCompetitors = window.localStorage.getItem("rednote-competitors");
      try {
        if (savedContent) {
          const parsedContent = JSON.parse(savedContent);
          if (Array.isArray(parsedContent)) setContentItems(parsedContent);
        }
        if (savedCompetitors) {
          const parsedCompetitors = JSON.parse(savedCompetitors);
          if (parsedCompetitors?.feed && parsedCompetitors?.ip) {
            setCompetitors(normalizeCompetitorData(parsedCompetitors));
          }
        }
      } catch {
        showToast("部分本地数据无法读取，已使用默认内容");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [showToast]);

  useEffect(() => {
    window.localStorage.setItem("rednote-drafts", JSON.stringify(drafts));
  }, [drafts]);

  useEffect(() => {
    window.localStorage.setItem("rednote-content-items", JSON.stringify(contentItems));
  }, [contentItems]);

  useEffect(() => {
    window.localStorage.setItem("rednote-competitors", JSON.stringify(competitors));
  }, [competitors]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const first = contentItems.find((item) => item.business === business);
      if (first) setSelectedContentId(first.id);
      setPublishForm((current) => ({
        ...current,
        accountId: business === "feed" ? "feed-a" : "ip-yintang",
      }));
      setDraftEditor((current) => current.business === business ? current : newDraft(business));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [business, contentItems]);

  useEffect(() => {
    if (!runnerOnline || !["messages", "analytics"].includes(page)) return;
    const timer = window.setTimeout(() => void loadCreatorData(business), 0);
    return () => window.clearTimeout(timer);
  }, [business, loadCreatorData, page, runnerOnline]);

  const currentAccounts = accounts.filter((item) => item.business === business);
  const currentContent = contentItems.filter((item) => item.business === business);
  const selectedContent =
    currentContent.find((item) => item.id === selectedContentId) || currentContent[0];
  const visibleCompetitors = useMemo(() => {
    const query = competitorQuery.trim().toLowerCase();
    return competitors[business].filter((item) =>
      `${item.name}${item.feature}${item.type}`.toLowerCase().includes(query),
    );
  }, [business, competitorQuery, competitors]);

  function selectBusiness(next: BusinessId, nextPage: PageId = "accounts") {
    setBusiness(next);
    setPage(nextPage);
    setExpanded((current) => ({ ...current, [next]: true }));
  }

  async function loginAccount(accountId: string) {
    setBusyAccount(accountId);
    try {
      const result = await runnerRequest(`/api/accounts/${accountId}/login`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      showToast(result.message || "登录窗口已打开，请在 Chrome 中完成扫码或验证");
      setAccounts((current) =>
        current.map((item) =>
          item.id === accountId
            ? { ...item, loginStatus: "awaiting_login", health: "等待人工验证" }
            : item,
        ),
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法打开登录窗口");
    } finally {
      setBusyAccount("");
    }
  }

  async function checkAccount(accountId: string) {
    setBusyAccount(accountId);
    try {
      const result = await runnerRequest(`/api/accounts/${accountId}/check`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      showToast(result.message || "账号状态已更新");
      await refreshRunner();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "检查失败");
    } finally {
      setBusyAccount("");
    }
  }

  async function syncCreatorData() {
    setSyncingCreatorData(true);
    try {
      const data = await runnerRequest("/api/creator-data/sync", {
        method: "POST",
        body: JSON.stringify({ business }),
      });
      if (Array.isArray(data.snapshots)) setCreatorSnapshots(data.snapshots);
      if (Array.isArray(data.accounts)) {
        setAccounts((current) => current.map((account) => {
          const live = data.accounts.find((item: Account) => item.id === account.id);
          return live ? { ...account, ...live } : account;
        }));
      }
      const succeeded = Array.isArray(data.results) ? data.results.filter((item: { ok: boolean }) => item.ok).length : 0;
      const failed = Array.isArray(data.results) ? data.results.length - succeeded : 0;
      showToast(`真实后台同步完成：${succeeded} 个成功${failed ? `，${failed} 个未连接` : ""}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "小红书后台同步失败");
    } finally {
      setSyncingCreatorData(false);
    }
  }

  async function openNoteManager(accountId: string) {
    try {
      const result = await runnerRequest(`/api/accounts/${accountId}/open-note-manager`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      showToast(result.message || "已打开小红书笔记管理");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法打开笔记管理");
    }
  }

  async function acknowledgeComment(signal: CommentSignal) {
    try {
      await runnerRequest("/api/creator-data/messages/ack", {
        method: "POST",
        body: JSON.stringify({ accountId: signal.accountId, noteKey: signal.noteKey, commentCount: signal.commentCount }),
      });
      setCreatorSnapshots((current) => current.map((snapshot) => snapshot.accountId === signal.accountId
        ? { ...snapshot, commentSignals: snapshot.commentSignals.filter((item) => item.id !== signal.id) }
        : snapshot));
      showToast("已标记为已处理；有新增评论时会再次提醒");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "标记失败");
    }
  }

  async function submitPublish() {
    const imagePaths = publishForm.images
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!imagePaths.length) {
      showToast("请填写至少一张本地图片的绝对路径");
      return;
    }
    if (!window.confirm("确认将这条内容加入真实小红书发布队列？")) return;
    try {
      const result = await runnerRequest("/api/publish", {
        method: "POST",
        body: JSON.stringify({
          ...publishForm,
          imagePaths,
          business,
          confirmed: true,
        }),
      });
      showToast(result.message || "已加入发布队列");
      await refreshRunner();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "加入队列失败");
    }
  }

  function addMaterialToDraft(localPath: string) {
    setDraftEditor((current) => {
      const paths = current.images.split("\n").map((item) => item.trim()).filter(Boolean);
      if (paths.includes(localPath)) return current;
      return {
        ...current,
        images: [...paths, localPath].join("\n"),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async function pauseTask(taskId: string) {
    try {
      const result = await runnerRequest(`/api/tasks/${taskId}/pause`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      showToast(result.message || "任务已暂停");
      await refreshRunner();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "暂停任务失败");
    }
  }

  const analyzeCompetitor = useCallback(async (profileUrl: string, targetBusiness: BusinessId, silent = false) => {
    setSyncingProfiles((current) => current.includes(profileUrl) ? current : [...current, profileUrl]);
    setCompetitors((current) => ({
      ...current,
      [targetBusiness]: current[targetBusiness].map((item) => item.profileUrl === profileUrl
        ? { ...item, status: "采集中", cadence: "正在读取" }
        : item),
    }));
    try {
      const result = await runnerRequest("/api/competitors/analyze", {
        method: "POST",
        body: JSON.stringify({ profileUrl }),
      });
      const analysis = result.competitor as Partial<Competitor> & { durationMs?: number };
      setCompetitors((current) => ({
        ...current,
        [targetBusiness]: current[targetBusiness].map((item) => item.profileUrl === profileUrl
          ? { ...item, ...analysis, profileUrl: analysis.profileUrl || item.profileUrl, isSample: false }
          : item),
      }));
      if (!silent) showToast(`分析完成，用时 ${Math.max(1, Math.round((analysis.durationMs || 0) / 1000))} 秒`);
      return true;
    } catch (error) {
      setCompetitors((current) => ({
        ...current,
        [targetBusiness]: current[targetBusiness].map((item) => item.profileUrl === profileUrl
          ? { ...item, status: "待重试", cadence: "同步失败", confidence: 0, feature: item.name === "待同步账号" ? "公开资料暂时无法读取，请点击右侧重试" : item.feature }
          : item),
      }));
      if (!silent) showToast(error instanceof Error ? error.message : "竞品分析失败，请稍后重试");
      return false;
    } finally {
      setSyncingProfiles((current) => current.filter((item) => item !== profileUrl));
    }
  }, [showToast]);

  useEffect(() => {
    if (page !== "competitors" || !runnerOnline) return;
    const pending = competitors[business].find((item) =>
      item.profileUrl && !item.isSample && item.status === "分析中" && !syncingProfiles.includes(item.profileUrl),
    );
    if (!pending?.profileUrl) return;
    const timer = window.setTimeout(() => void analyzeCompetitor(pending.profileUrl!, business), 0);
    return () => window.clearTimeout(timer);
  }, [analyzeCompetitor, business, competitors, page, runnerOnline, syncingProfiles]);

  async function syncAllCompetitors() {
    const targetBusiness = business;
    const targets = competitors[targetBusiness].filter((item) => item.profileUrl && !item.isSample);
    if (!targets.length) {
      showToast("当前没有可同步的小红书竞品主页");
      return;
    }
    setSyncProgress({ done: 0, total: targets.length });
    let cursor = 0;
    let completed = 0;
    let succeeded = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const target = targets[cursor];
        cursor += 1;
        if (target.profileUrl && await analyzeCompetitor(target.profileUrl, targetBusiness, true)) succeeded += 1;
        completed += 1;
        setSyncProgress({ done: completed, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
    setSyncProgress(null);
    showToast(`公开数据同步完成：${succeeded}/${targets.length} 个账号成功`);
  }

  async function addCompetitor() {
    const input = window.prompt("输入竞品账号名称或小红书主页链接");
    if (!input?.trim()) return;
    const value = input.trim();
    const profileId = value.match(/xiaohongshu\.com\/user\/profile\/([^?/#]+)/)?.[1];
    const knownProfile = profileId === "58b974b282ec394e27f0cd13"
      ? verifiedIpProfiles.yanwu
      : profileId === "64df14020000000001005641"
        ? verifiedIpProfiles.xingzhou
        : undefined;
    const competitor: Competitor = knownProfile || {
      name: profileId ? "待同步账号" : value,
      type: business === "feed" ? "信息流" : "个人 IP",
      feature: "等待 AI 分析账号定位、封面、标题、节奏与 CTA",
      cadence: "等待同步",
      confidence: 0,
      status: "分析中",
      profileUrl: profileId
        ? `https://www.xiaohongshu.com/user/profile/${profileId}`
        : undefined,
      noteCountLabel: profileId ? "等待同步公开笔记" : "尚未绑定主页",
      isSample: false,
    };
    setCompetitors((current) => ({
      ...current,
      [business]: [
        competitor,
        ...current[business].filter((item) => !competitor.profileUrl || item.profileUrl !== competitor.profileUrl),
      ],
    }));
    if (competitor.profileUrl) {
      showToast("竞品已加入，正在进行快速分析");
      await analyzeCompetitor(competitor.profileUrl, business);
    } else {
      showToast("竞品已加入；绑定完整主页链接后才能自动分析");
    }
  }

  function deleteCompetitor(index: number) {
    const item = competitors[business][index];
    if (!item || !window.confirm(`确认删除竞品“${item.name}”？`)) return;
    setCompetitors((current) => ({
      ...current,
      [business]: current[business].filter((_, itemIndex) => itemIndex !== index),
    }));
    showToast("竞品已删除");
  }

  function deleteContent(contentId: string) {
    const item = contentItems.find((content) => content.id === contentId);
    if (!item || !window.confirm(`确认删除“${item.title}”？`)) return;
    setContentItems((current) => current.filter((content) => content.id !== contentId));
    setReviewState((current) => {
      const next = { ...current };
      delete next[contentId];
      return next;
    });
    showToast("内容已删除");
  }

  function loadContentIntoDraft(item: ContentItem) {
    setDraftEditor({
      id: crypto.randomUUID(),
      business: item.business,
      accountId: accounts.find((account) => account.name === item.account)?.id || (item.business === "feed" ? "feed-a" : "ip-yintang"),
      title: item.title,
      content: `${item.summary}\n\n需要进一步了解可以在评论区留言。\n\n#小红书运营 #装修设计`,
      images: "",
      scheduledAt: "",
      updatedAt: new Date().toISOString(),
    });
    setBusiness(item.business);
    setPage("draft");
    showToast(item.isSample ? "已载入样例副本，原样例不会被修改" : "内容已载入草稿台");
  }

  function saveDraft() {
    if (!draftEditor.title.trim() || !draftEditor.content.trim()) {
      showToast("请先填写标题和正文");
      return;
    }
    const next = { ...draftEditor, updatedAt: new Date().toISOString() };
    setDraftEditor(next);
    setDrafts((current) => [next, ...current.filter((draft) => draft.id !== next.id)]);
    showToast("草稿已保存在当前浏览器");
  }

  function deleteDraft(draftId: string) {
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft || !window.confirm(`确认删除草稿“${draft.title || "未命名草稿"}”？`)) return;
    setDrafts((current) => current.filter((item) => item.id !== draftId));
    if (draftEditor.id === draftId) setDraftEditor(newDraft(business));
    showToast("草稿已删除");
  }

  function moveDraftToSchedule() {
    if (!draftEditor.title.trim() || !draftEditor.content.trim()) {
      showToast("请先填写标题和正文");
      return;
    }
    setPublishForm({
      accountId: draftEditor.accountId,
      title: draftEditor.title,
      content: draftEditor.content,
      images: draftEditor.images,
      scheduledAt: draftEditor.scheduledAt,
    });
    setPage("schedule");
    showToast("草稿已带入发布计划，请核对后确认");
  }

  function downloadCreatorReport() {
    const currentSnapshots = creatorSnapshots.filter((snapshot) => snapshot.business === business);
    const rows = [
      ["账号", "标题", "发布时间", "观看", "点赞", "评论", "收藏", "分享", "状态"],
      ...currentSnapshots.flatMap((snapshot) => snapshot.notes.map((note) => [snapshot.accountName, note.title, note.publishedAt, note.views, note.likes, note.comments, note.collects, note.shares, note.status])),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${businessMeta[business].name}-小红书真实数据.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("真实笔记数据已导出");
  }

  const activeMeta = businessMeta[business];
  const currentTasks = publishTasks.filter((task) => task.business === business);
  const currentDrafts = drafts.filter((draft) => draft.business === business);
  const draftImagePaths = draftEditor.images.split("\n").map((item) => item.trim()).filter(Boolean);
  const currentSnapshots = creatorSnapshots.filter((snapshot) => snapshot.business === business);
  const currentCreatorNotes = currentSnapshots.flatMap((snapshot) => snapshot.notes.map((note) => ({ ...note, accountId: snapshot.accountId, accountName: snapshot.accountName }))).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const currentCommentSignals = currentSnapshots.flatMap((snapshot) => snapshot.commentSignals);
  const disconnectedAccounts = currentAccounts.filter((account) => account.loginStatus !== "connected");
  const currentMessageCount = currentCommentSignals.length + disconnectedAccounts.length;
  const creatorTotals = currentSnapshots.reduce((totals, snapshot) => ({
    notes: totals.notes + snapshot.totalNotes,
    exposure: totals.exposure + Number(snapshot.metrics.exposure || 0),
    views: totals.views + Number(snapshot.metrics.views || 0),
    interactions: totals.interactions + Number(snapshot.metrics.likes || 0) + Number(snapshot.metrics.comments || 0) + Number(snapshot.metrics.collects || 0) + Number(snapshot.metrics.shares || 0),
  }), { notes: 0, exposure: 0, views: 0, interactions: 0 });
  const messageCountByBusiness = (["feed", "ip"] as BusinessId[]).reduce<Record<BusinessId, number>>((counts, businessId) => {
    const accountAlerts = accounts.filter((account) => account.business === businessId && account.loginStatus !== "connected").length;
    const commentAlerts = creatorSnapshots
      .filter((snapshot) => snapshot.business === businessId)
      .reduce((total, snapshot) => total + snapshot.commentSignals.length, 0);
    counts[businessId] = accountAlerts + commentAlerts;
    return counts;
  }, { feed: 0, ip: 0 });

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={17} /></div>
          <div><strong>红序</strong><span>内容运营系统</span></div>
        </div>

        <div className="nav-label">业务与功能</div>
        <nav className="business-nav" aria-label="业务与功能菜单">
          {(["feed", "ip"] as BusinessId[]).map((businessId) => {
            const meta = businessMeta[businessId];
            const BusinessIcon = meta.icon;
            const isExpanded = expanded[businessId];
            return (
              <div className={`business-group ${business === businessId ? "active" : ""}`} key={businessId}>
                <button
                  className="business-level-one"
                  onClick={() => {
                    setExpanded((current) => ({ ...current, [businessId]: !current[businessId] }));
                    if (business !== businessId) selectBusiness(businessId);
                  }}
                  aria-expanded={isExpanded}
                >
                  <span className={`business-icon ${meta.accent}`}><BusinessIcon size={16} /></span>
                  <span className="business-name"><strong>{meta.name}</strong><small>{meta.eyebrow}</small></span>
                  {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                {isExpanded && (
                  <div className="business-level-two">
                    {menuItems
                      .filter((item) => !item.ipOnly || businessId === "ip")
                      .map((item) => {
                        const Icon = item.icon;
                        const active = business === businessId && page === item.id;
                        return (
                          <button
                            className={active ? "active" : ""}
                            key={item.id}
                            onClick={() => selectBusiness(businessId, item.id)}
                          >
                            <Icon size={15} />
                            <span>{item.label}</span>
                            {item.id === "messages" && messageCountByBusiness[businessId] > 0 && <em>{messageCountByBusiness[businessId]}</em>}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className={`runner-card ${runnerOnline ? "online" : "offline"}`}>
          <div>{runnerOnline ? <Wifi size={15} /> : <WifiOff size={15} />}<strong>本地发布执行器</strong></div>
          <span>{runnerOnline ? "已连接，可登录和发布" : "未连接，请启动 runner"}</span>
        </div>
        <div className="user-chip"><CircleUserRound size={19} /><div><strong>运营管理员</strong><span>全部业务权限</span></div><Settings2 size={15} /></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>{activeMeta.name}</span><ChevronRight size={14} /><strong>{menuItems.find((item) => item.id === page)?.label}</strong></div>
          <div className="top-actions"><button className="icon-button" title="刷新" onClick={refreshRunner}><RefreshCw size={16} /></button><button className="secondary-button" onClick={() => { setPage("accounts"); showToast(runnerOnline ? "前端与本地发布执行器均正常" : "前端正常，本地发布执行器未连接"); }}><Activity size={15} />系统状态</button></div>
        </header>

        <div className="content-area">
          {page === "accounts" && (
            <section>
              <PageHeader title="账号与登录" subtitle="真实登录在独立 Chrome 会话中完成；系统不会在后台自动打开或跳转页面。" action={<span className="header-note">当前业务固定配置 2 个账号位</span>} />
              <div className={`connection-banner ${runnerOnline ? "ok" : "warn"}`}>
                <div>{runnerOnline ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}<div><strong>{runnerOnline ? "本地执行器运行正常" : "本地执行器尚未连接"}</strong><span>{runnerOnline ? "点击“发起登录”会打开独立 Chrome 会话，完成扫码后返回此处检查状态。" : "网页界面已运行，但真实登录和自动发布必须由本机 runner 执行。"}</span></div></div>
                <code>{RUNNER_URL}</code>
              </div>
              <div className="account-grid">
                {currentAccounts.map((account) => (
                  <article className="account-card" key={account.id}>
                    <div className="account-card-head"><div className="account-avatar">{(account.platformName || account.name).slice(-1)}</div><span className={`status-pill ${account.loginStatus}`}>{statusLabel(account.loginStatus)}</span></div>
                    <h3>{account.platformName || account.name}</h3>
                    <p>{account.platformName ? `${account.name} · 小红书号 ${account.xhsId || "读取中"}` : account.id}</p>
                    <dl><div><dt>账号健康</dt><dd>{account.health}</dd></div><div><dt>最近检查</dt><dd>{account.lastChecked || "尚未检查"}</dd></div><div><dt>自动发布</dt><dd>{account.loginStatus === "connected" ? "可开启" : "已暂停"}</dd></div></dl>
                    <div className="card-actions">
                      <button className="primary-button small" disabled={!runnerOnline || busyAccount === account.id} onClick={() => loginAccount(account.id)}><LogIn size={14} />{account.loginStatus === "connected" ? "重新登录" : "发起登录"}</button>
                      <button className="secondary-button small" disabled={!runnerOnline || busyAccount === account.id} onClick={() => checkAccount(account.id)}><RefreshCw size={14} />检查状态</button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="security-note"><ShieldCheck size={17} /><div><strong>登录与风控边界</strong><p>扫码、短信、设备验证、验证码、申诉和解封均由你人工完成；账号异常时系统自动暂停队列。</p></div></div>
            </section>
          )}

          {page === "materials" && (
            <MaterialCenter
              business={business}
              runnerOnline={runnerOnline}
              runnerUrl={RUNNER_URL}
              onUseImage={addMaterialToDraft}
              onEditImage={(src, name) => { setDesignerSeed({ src, name }); setPage("designer"); }}
              onOpenDraft={() => setPage("draft")}
              showToast={showToast}
            />
          )}

          {page === "designer" && (
            <ImageEditor
              business={business}
              runnerOnline={runnerOnline}
              runnerUrl={RUNNER_URL}
              seedImage={designerSeed}
              onSeedConsumed={() => setDesignerSeed(null)}
              onUseImage={addMaterialToDraft}
              onOpenDraft={() => setPage("draft")}
              showToast={showToast}
            />
          )}

          {page === "library" && (
            <section>
              <PageHeader title="内容库" subtitle={business === "feed" ? "批量管理 3:4 虚拟户型内容包，允许模板复用。" : "按人设、案例类型和规则包管理个人 IP 内容。"} action={<button className="primary-button" onClick={() => { setDraftEditor(newDraft(business)); setPage("draft"); }}><Plus size={15} />新建内容</button>} />
              <div className="sample-notice"><SampleBadge/><span>当前内容库中的预置内容均为演示样例，可以编辑副本或直接删除。</span></div>
              <div className="filter-row"><label><Search size={15} /><input placeholder="搜索标题、编号或标签" /></label><button onClick={() => showToast("当前仅展示全部状态")}>全部状态 <ChevronDown size={14} /></button><button onClick={() => showToast("当前仅展示当前业务账号")}>全部账号 <ChevronDown size={14} /></button></div>
              <div className="content-table">
                <div className="table-head"><span>内容</span><span>规格</span><span>目标账号</span><span>状态</span><span>更新时间</span><span>操作</span></div>
                {currentContent.length === 0 && <div className="table-empty">内容库为空，可点击“新建内容”进入草稿台。</div>}
                {currentContent.map((item) => <div className="table-row" key={item.id}><div><div className="title-with-badge"><strong>{item.title}</strong>{item.isSample && <SampleBadge/>}</div><small>{item.id} · {item.summary}</small></div><span>{item.type}</span><span>{item.account}</span><StatusTag value={reviewState[item.id] || item.status} /><span>今天 09:{item.id.slice(-2)}</span><div className="row-actions"><button className="icon-button" title="编辑副本" onClick={() => loadContentIntoDraft(item)}><FilePenLine size={14}/></button><button className="icon-button danger-icon" title="删除" onClick={() => deleteContent(item.id)}><Trash2 size={14}/></button></div></div>)}
              </div>
            </section>
          )}

          {page === "draft" && (
            <section>
              <PageHeader title="发布草稿台" subtitle="编辑标题、正文和图片顺序，右侧实时预览小红书图文笔记。" action={<div className="draft-header-actions"><button className="secondary-button" onClick={() => setPage("designer")}><Paintbrush size={15}/>去作图</button><button className="secondary-button" onClick={() => setDraftEditor(newDraft(business))}><Plus size={15}/>新建空白</button><button className="primary-button" onClick={saveDraft}><Save size={15}/>保存草稿</button></div>} />
              <div className="draft-workbench">
                <aside className="draft-list-panel">
                  <div className="panel-title"><div><strong>我的草稿</strong><span>{currentDrafts.length} 条</span></div></div>
                  {currentDrafts.length === 0 && <div className="draft-empty"><FilePenLine size={20}/><strong>还没有草稿</strong><span>保存后会出现在这里</span></div>}
                  {currentDrafts.map((draft) => <div className={`draft-list-item ${draftEditor.id === draft.id ? "active" : ""}`} key={draft.id}><button onClick={() => setDraftEditor(draft)}><strong>{draft.title || "未命名草稿"}</strong><span>{formatTaskTime(draft.updatedAt)} · {accounts.find((account) => account.id === draft.accountId)?.name}</span></button><button className="icon-button danger-icon" title="删除草稿" onClick={() => deleteDraft(draft.id)}><Trash2 size={14}/></button></div>)}
                </aside>
                <div className="draft-editor-panel">
                  <div className="panel-title"><div><strong>编辑内容</strong><span>自动统计标题和正文长度</span></div><StatusTag value="本地草稿"/></div>
                  <div className="draft-form">
                    <label><span>发布账号</span><select value={draftEditor.accountId} onChange={(event) => setDraftEditor((current) => ({...current, accountId:event.target.value}))}>{currentAccounts.map((account)=><option key={account.id} value={account.id}>{account.platformName || account.name}</option>)}</select></label>
                    <label><span>计划发布时间</span><input type="datetime-local" value={draftEditor.scheduledAt} onChange={(event) => setDraftEditor((current) => ({...current, scheduledAt:event.target.value}))}/></label>
                    <label className="full"><span>笔记标题 <em>{draftEditor.title.length}/20</em></span><input maxLength={20} placeholder="输入有明确利益点的标题" value={draftEditor.title} onChange={(event) => setDraftEditor((current) => ({...current, title:event.target.value}))}/></label>
                    <label className="full"><span>正文 <em>{draftEditor.content.length} 字</em></span><textarea rows={10} placeholder="输入正文、CTA 和话题标签" value={draftEditor.content} onChange={(event) => setDraftEditor((current) => ({...current, content:event.target.value}))}/></label>
                    <label className="full"><span>图片绝对路径 <em>{draftImagePaths.length} 张</em></span><textarea rows={5} placeholder="每行一张图片路径，第一张作为封面" value={draftEditor.images} onChange={(event) => setDraftEditor((current) => ({...current, images:event.target.value}))}/></label>
                  </div>
                  <div className="draft-footer"><span><ShieldCheck size={15}/>保存草稿不会发布到小红书</span><button className="secondary-button" onClick={saveDraft}><Save size={15}/>仅保存</button><button className="primary-button" onClick={moveDraftToSchedule}><Send size={15}/>进入发布计划</button></div>
                </div>
                <aside className="note-preview-panel">
                  <div className="panel-title"><div><strong>笔记预览</strong><span>3:4 图文样式</span></div><Eye size={16}/></div>
                  <div className="phone-preview">
                    <div className="preview-image-area">
                      {draftImagePaths.length ? <><ImageIcon size={30}/><strong>{draftImagePaths[0].split("/").pop()}</strong><span>封面 · 共 {draftImagePaths.length} 张</span></> : <><ImageIcon size={30}/><strong>添加封面图片</strong><span>建议尺寸 1080 × 1440</span></>}
                    </div>
                    <div className="preview-note-copy"><h3>{draftEditor.title || "你的笔记标题会显示在这里"}</h3><p>{draftEditor.content || "正文内容、话题标签和行动引导会实时显示在这里。"}</p><div className="preview-author"><span>{accounts.find((account)=>account.id===draftEditor.accountId)?.name?.slice(0,1) || "账"}</span><strong>{accounts.find((account)=>account.id===draftEditor.accountId)?.name || "请选择账号"}</strong></div></div>
                  </div>
                  <div className="preview-checklist"><div className={draftEditor.title ? "done" : ""}><CheckCircle2 size={14}/>标题</div><div className={draftEditor.content ? "done" : ""}><CheckCircle2 size={14}/>正文</div><div className={draftImagePaths.length ? "done" : ""}><CheckCircle2 size={14}/>图片</div></div>
                </aside>
              </div>
            </section>
          )}

          {page === "review" && !selectedContent && (
            <section><PageHeader title="内容审查" subtitle="只有通过审查的内容才能进入真实发布队列。"/><div className="large-empty"><ClipboardCheck size={28}/><h3>没有待审内容</h3><p>可以从发布草稿台新建内容。</p><button className="primary-button" onClick={() => setPage("draft")}><Plus size={15}/>进入草稿台</button></div></section>
          )}

          {page === "review" && selectedContent && (
            <section>
              <PageHeader title="内容审查" subtitle="只有通过审查的内容才能进入真实发布队列。" action={<div className="header-counter"><span>待审 {currentContent.filter((item) => (reviewState[item.id] || item.status) !== "已通过").length}</span><strong>{currentContent.findIndex((item) => item.id === selectedContent.id) + 1} / {currentContent.length}</strong></div>} />
              <div className="review-layout">
                <div className="review-list">
                  {currentContent.map((item) => <button key={item.id} className={selectedContent.id === item.id ? "active" : ""} onClick={() => setSelectedContentId(item.id)}><div className="content-thumb"><span>{item.images}</span></div><div><strong>{item.title}</strong><span>{item.id} · {item.type}</span></div><StatusTag value={reviewState[item.id] || item.status} /></button>)}
                </div>
                <article className="review-panel">
                  <div className="review-preview"><div className="preview-card"><span>3:4</span><strong>{selectedContent.title}</strong><p>{business === "feed" ? "虚拟户型示例 · 免费设计" : "实景案例 · 专业设计观点"}</p><div className="fake-plan"><i /><i /><i /><i /></div></div><div className="preview-pages">{Array.from({ length: Math.min(selectedContent.images, 8) }, (_, index) => <span className={index === 0 ? "active" : ""} key={index}>{index + 1}</span>)}</div></div>
                  <div className="review-copy">
                    <div className="panel-heading"><div><span>{selectedContent.id} {selectedContent.isSample && "· 样例"}</span><h3>{selectedContent.title}</h3></div><div className="row-actions"><button className="icon-button" title="在草稿台编辑副本" onClick={() => loadContentIntoDraft(selectedContent)}><FilePenLine size={15}/></button><button className="icon-button danger-icon" title="删除内容" onClick={() => deleteContent(selectedContent.id)}><Trash2 size={15}/></button></div></div>
                    <p className="body-copy">{selectedContent.summary}</p>
                    <div className="rule-checks"><h4>自动规则检查</h4>{selectedContent.ruleHits.map((hit) => <div key={hit} className={hit.includes("不足") || hit.includes("缺少") ? "failed" : "passed"}>{hit.includes("不足") || hit.includes("缺少") ? <XCircle size={15} /> : <CheckCircle2 size={15} />}<span>{hit}</span></div>)}</div>
                    {business === "ip" && <div className="manual-rules"><h4>印堂规则包 v1.0</h4><ul><li>地址统一使用小区名/项目名，不写具体路名</li><li>报价使用“个性化清单式报价”，禁用套餐价/一口价</li><li>突出线下量房、实景案例与原创设计</li><li>不做局改、不做精装；半包/全包/个性化定制</li><li>售后表达统一为“竣工回访”</li></ul></div>}
                    <div className="review-actions"><button className="danger-button" onClick={() => setReviewState((current) => ({ ...current, [selectedContent.id]: "需修改" }))}>退回修改</button><button className="primary-button" onClick={() => { setReviewState((current) => ({ ...current, [selectedContent.id]: "已通过" })); showToast("内容已通过审查，可进入发布计划"); }}><CheckCircle2 size={15} />通过审查</button></div>
                  </div>
                </article>
              </div>
            </section>
          )}

          {page === "schedule" && (
            <section>
              <PageHeader title="发布计划" subtitle="将已审核内容加入本机真实发布队列；到点后由对应账号的 Chrome 会话执行。" action={<button className="secondary-button" onClick={() => showToast("当前队列已按计划时间排序") }><CalendarDays size={15} />按时间排序</button>} />
              <div className="publish-composer">
                <div className="composer-head"><div><Send size={18} /><div><strong>创建真实发布任务</strong><span>发布前会再次确认；图片必须填写本机绝对路径。</span></div></div><span className="live-badge">LOCAL RUNNER</span></div>
                <div className="form-grid">
                  <label><span>发布账号</span><select value={publishForm.accountId} onChange={(event) => setPublishForm((current) => ({ ...current, accountId: event.target.value }))}>{currentAccounts.map((item) => <option value={item.id} key={item.id}>{item.platformName || item.name}</option>)}</select></label>
                  <label><span>计划时间（留空立即执行）</span><input type="datetime-local" value={publishForm.scheduledAt} onChange={(event) => setPublishForm((current) => ({ ...current, scheduledAt: event.target.value }))} /></label>
                  <label className="full"><span>笔记标题</span><input value={publishForm.title} maxLength={20} onChange={(event) => setPublishForm((current) => ({ ...current, title: event.target.value }))} /></label>
                  <label className="full"><span>正文</span><textarea rows={5} value={publishForm.content} onChange={(event) => setPublishForm((current) => ({ ...current, content: event.target.value }))} /></label>
                  <label className="full"><span>图片绝对路径（每行一张）</span><textarea rows={3} placeholder="/Users/你的名字/Pictures/xhs/cover.png" value={publishForm.images} onChange={(event) => setPublishForm((current) => ({ ...current, images: event.target.value }))} /></label>
                </div>
                <div className="composer-footer"><div><ShieldCheck size={15} />未登录、账号异常或内容未确认时不会发布</div><button className="primary-button" disabled={!runnerOnline} onClick={submitPublish}><Send size={15} />确认并加入队列</button></div>
              </div>
              <div className="queue-section">
                <div className="section-title"><div><h3>真实发布队列</h3><span>由本地执行器按账号独立执行</span></div><button className="text-button" onClick={refreshRunner}>刷新状态</button></div>
                {currentTasks.length === 0 ? (
                  <div className="empty-queue"><Clock3 size={18}/><div><strong>还没有真实发布任务</strong><span>填写上方内容并确认后，任务会立即显示在这里。</span></div></div>
                ) : currentTasks.slice(0, 12).map((task) => {
                  const account = accounts.find((item) => item.id === task.accountId);
                  const time = task.scheduledAt || task.createdAt;
                  return <div className="queue-row" key={task.id}><span className={`queue-marker ${task.status === "paused" || task.status === "failed" ? "paused" : ""}`} /><div><strong>{task.title}</strong><small>{account?.name || task.accountId}{task.error ? ` · ${task.error}` : ""}</small></div><StatusTag value={taskStatusLabel(task.status)} /><span className="queue-time">{formatTaskTime(time)}</span><button className="icon-button" title="暂停任务" disabled={["published","failed","paused"].includes(task.status)} onClick={() => pauseTask(task.id)}><PauseCircle size={15} /></button></div>;
                })}
              </div>
            </section>
          )}

          {page === "messages" && (
            <section>
              <PageHeader title="待处理消息" subtitle="只显示真实数据；仅在你点击同步时访问小红书，不会自动跳转 Chrome。" action={<button className="secondary-button" disabled={!runnerOnline || syncingCreatorData} onClick={syncCreatorData}><RefreshCw className={syncingCreatorData ? "spin" : ""} size={15} />{syncingCreatorData ? "正在同步" : "手动同步小红书"}</button>} />
              <div className="live-source-banner"><CheckCircle2 size={17}/><div><strong>数据来源：小红书创作服务平台</strong><span>{currentSnapshots.length ? `最近同步 ${formatSyncTime(currentSnapshots[0].syncedAt)}` : "尚未完成首次同步"}</span></div></div>
              <div className="inbox-tabs"><button className="active">全部 <span>{currentMessageCount}</span></button><button>评论提醒 <span>{currentCommentSignals.length}</span></button><button>账号连接 <span>{disconnectedAccounts.length}</span></button></div>
              <div className="message-list">
                {disconnectedAccounts.map((account) => <LiveMessageRow key={account.id} priority="P0" icon={<AlertTriangle size={17}/>} title={`${account.platformName || account.name} 尚未连接`} detail={`${account.health}；未登录时系统不会显示该账号的笔记数据或消息。`} source="本地账号连接状态" actions={<button className="secondary-button" onClick={() => setPage("accounts")}>去登录<ChevronRight size={14}/></button>}/>) }
                {currentCommentSignals.map((signal) => <LiveMessageRow key={signal.id} priority="P1" icon={<HeartHandshake size={17}/>} title={`${signal.accountName}：检测到 ${signal.newCount} 条待确认评论`} detail={`《${signal.noteTitle}》目前共 ${signal.commentCount} 条评论；请在笔记管理中确认是否已回复。`} source={signal.source} actions={<><button className="secondary-button" onClick={() => openNoteManager(signal.accountId)}>打开后台<ExternalLink size={13}/></button><button className="icon-button" title="标记已处理" onClick={() => acknowledgeComment(signal)}><CheckCircle2 size={15}/></button></>}/>) }
                {currentMessageCount === 0 && <div className="table-empty">当前没有从真实后台检测到待处理评论或账号异常。</div>}
              </div>
              <div className="access-limit-card"><MessageSquareWarning size={18}/><div><strong>私信正文尚未授权</strong><p>{currentSnapshots[0]?.privateMessages.reason || "小红书创作服务平台网页端不提供私信正文。连接账号后，当前页面仍只会展示可核验的后台数据。"}</p></div><StatusTag value="未授权"/></div>
            </section>
          )}

          {page === "analytics" && (
            <section>
              <PageHeader title="数据分析" subtitle="读取真实创作后台数据；只有你主动点击同步时才会访问小红书页面。" action={<div className="page-header-actions"><button className="secondary-button" disabled={!currentCreatorNotes.length} onClick={downloadCreatorReport}><Upload size={15}/>导出真实数据</button><button className="primary-button" disabled={!runnerOnline || syncingCreatorData} onClick={syncCreatorData}><RefreshCw className={syncingCreatorData ? "spin" : ""} size={15}/>{syncingCreatorData ? "正在读取后台" : "手动同步小红书"}</button></div>} />
              <div className="live-source-banner"><CheckCircle2 size={17}/><div><strong>数据来源：小红书创作服务平台</strong><span>{currentSnapshots.length ? `${currentSnapshots.map((snapshot) => snapshot.accountName).join("、")} · ${currentSnapshots[0].period || "后台实时数据"} · 最近同步 ${formatSyncTime(currentSnapshots[0].syncedAt)}` : "当前业务尚无已同步账号；请先登录并点击同步。"}</span></div></div>
              <div className="metric-grid"><Metric label="全部已发布笔记" value={formatMetric(creatorTotals.notes)} change={`${currentCreatorNotes.length} 篇已读取到明细`} /><Metric label="周期曝光" value={formatMetric(creatorTotals.exposure)} change={currentSnapshots[0]?.period || "等待同步"} /><Metric label="周期观看" value={formatMetric(creatorTotals.views)} change={`封面点击率 ${currentSnapshots[0]?.metrics.clickRate || "--"}`} /><Metric label="周期互动" value={formatMetric(creatorTotals.interactions)} change="点赞 + 评论 + 收藏 + 分享" /></div>
              <div className="account-data-strip">{currentAccounts.map((account) => { const snapshot = currentSnapshots.find((item) => item.accountId === account.id); return <article key={account.id} className={snapshot ? "connected" : ""}><span className={`status-dot ${snapshot ? "online" : ""}`}/><div><strong>{snapshot?.accountName || account.platformName || account.name}</strong><small>{snapshot ? `${snapshot.collectedNotes}/${snapshot.totalNotes} 篇明细 · 粉丝 ${formatMetric(snapshot.profile.followers)}` : `${account.health} · 暂无后台数据`}</small></div><StatusTag value={snapshot ? "已同步" : "未连接"}/></article>; })}</div>
              <div className="section-title"><div><h3>全部笔记明细</h3><span>{currentCreatorNotes.length ? `已读取 ${currentCreatorNotes.length} 篇；数据按发布时间从新到旧排列` : "登录账号并同步后显示真实笔记"}</span></div></div>
              <div className="live-note-table"><div className="live-note-head"><span>账号与笔记</span><span>发布时间</span><span>观看</span><span>点赞</span><span>评论</span><span>收藏</span><span>分享</span><span>状态</span></div>{currentCreatorNotes.map((note) => <div className="live-note-row" key={`${note.accountId}-${note.key}`}><div><strong>{note.title}</strong><small>{note.accountName}</small></div><span>{note.publishedAt}</span><span>{formatMetric(note.views)}</span><span>{formatMetric(note.likes)}</span><span className={note.comments > 0 ? "attention" : ""}>{formatMetric(note.comments)}</span><span>{formatMetric(note.collects)}</span><span>{formatMetric(note.shares)}</span><StatusTag value={note.status}/></div>)}{currentCreatorNotes.length === 0 && <div className="table-empty">没有用虚假数据填充。当前尚未读取到已连接账号的笔记明细。</div>}</div>
            </section>
          )}

          {page === "competitors" && (
            <section>
              <PageHeader title="竞品观测" subtitle="新增主页后自动快速分析公开资料与首批笔记；每个业务可独立维护至少 20 个竞品。" action={<button className="primary-button" onClick={addCompetitor}><Plus size={15} />添加竞品</button>} />
              <div className="sample-notice"><SampleBadge/><span>“上海设计师言午”和“上海设计师行舟”为已核验真实账号；其余预置竞品为演示数据，可逐条删除。</span></div>
              <div className="competitor-summary"><div><Radar size={20}/><div><strong>已观测 {competitors[business].length} 个账号</strong><span>{syncProgress ? `正在并发同步 ${syncProgress.done}/${syncProgress.total}` : "新增账号自动快分析；批量同步并发处理 4 个账号"}</span></div></div><button className="secondary-button" disabled={Boolean(syncProgress)} onClick={syncAllCompetitors}><RefreshCw className={syncProgress ? "spin" : ""} size={14}/>{syncProgress ? `同步中 ${syncProgress.done}/${syncProgress.total}` : "同步公开数据"}</button></div>
              <div className="filter-row"><label><Search size={15}/><input value={competitorQuery} onChange={(event)=>setCompetitorQuery(event.target.value)} placeholder="搜索账号或特点" /></label><button onClick={() => showToast("当前显示全部竞品类型")}>全部类型 <ChevronDown size={14}/></button><button onClick={() => showToast("当前显示全部分析状态")}>全部状态 <ChevronDown size={14}/></button></div>
              <div className="competitor-table"><div className="competitor-head"><span>竞品账号</span><span>自动特点摘要</span><span>发布节奏</span><span>置信度</span><span>状态</span><span>操作</span></div>{visibleCompetitors.map((item,index)=>{ const syncing = Boolean(item.profileUrl && syncingProfiles.includes(item.profileUrl)); return <div className="competitor-row" key={`${item.profileUrl || item.name}-${index}`}><CompetitorIdentity item={item}/><p>{item.feature}</p><span>{item.cadence}</span><span>{item.confidence ? `${item.confidence}%` : "--"}</span><StatusTag value={item.status}/><div className="competitor-actions">{item.profileUrl && !item.isSample && <button className="icon-button" disabled={syncing} title="重新分析公开数据" onClick={() => analyzeCompetitor(item.profileUrl!, business)}><RefreshCw className={syncing ? "spin" : ""} size={14}/></button>}<button className="icon-button danger-icon" title="删除竞品" onClick={() => deleteCompetitor(competitors[business].indexOf(item))}><Trash2 size={14}/></button></div></div>})}</div>
            </section>
          )}

          {page === "rules" && (
            <section>
              <PageHeader title="个人 IP 规则包" subtitle="规则来源：《印堂内容对接-LIN》，审查和 AI 生成时按版本强制执行。" action={<button className="secondary-button" onClick={() => showToast("当前版本 v1.0，更新时间 2026-08-05")}><BookOpenCheck size={15}/>版本记录</button>} />
              <div className="rule-hero"><div><span>当前版本</span><h2>印堂个人 IP 规则包 v1.0</h2><p>适用于装企介绍、报价、样板间征集、利益点实景案例和纯分享偏软内容。</p></div><div className="rule-score"><strong>12</strong><span>核心优势</span></div></div>
              <div className="rules-grid"><RuleCard title="内容表达" items={["封面和版式参考禧佳装饰设计、上海设计师言午、上海设计师行舟","地址统一改为小区名/项目名，不写具体路名","至少 7 张图片；部分参考 Demo 前 6 张复制结构","以线下量房和实景沟通为主"]}/><RuleCard title="报价与业务边界" items={["统一使用个性化清单式报价","禁用套餐价、一口价","半包 1000-1200 元/㎡；全包 1500-2000 元/㎡仅作参考","5000 定金可开工；不做局改、不做精装"]}/><RuleCard title="品牌优势" items={["先施工后付款，业主掌握主动权","清单透明报价，全程无恶意增项","5000㎡实景展厅、N+1 材料管家","原创设计、实景效果 1:1 还原","自有施工队、第三方监理、竣工回访"]}/><RuleCard title="推荐内容结构" items={["利益点 + 实景案例展示","报价清单 + 设计图纸 + 现场签约图","近三个月开工 + 免费设计利益点 + 实景图","样板间征集和纯分享偏软内容分开运营"]}/></div>
            </section>
          )}
        </div>
      </section>
      {toast && <div className="toast"><CheckCircle2 size={16}/>{toast}</div>}
    </main>
  );
}

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function StatusTag({ value }: { value: string }) {
  const tone = value.includes("通过") || value.includes("更新") || value.includes("正常") || value === "已同步" || value === "已发布" ? "success" : value.includes("修改") || value.includes("异常") || value.includes("重试") || value.includes("未连接") ? "danger" : "neutral";
  return <span className={`tag ${tone}`}>{value}</span>;
}

function SampleBadge() {
  return <span className="sample-badge">样例</span>;
}

function CompetitorIdentity({ item }: { item: Competitor }) {
  const avatar = item.avatarUrl
    ? <img className="mini-avatar-image" src={item.avatarUrl} alt={`${item.name}头像`} />
    : <span className="mini-avatar">{item.name.slice(0, 1)}</span>;
  const details = <div><div className="title-with-badge"><strong>{item.name}</strong>{item.isSample && <SampleBadge/>}</div><small>{item.type} · {item.noteCountLabel || (item.isSample ? "样例数据" : "等待同步公开笔记")}</small></div>;

  if (item.profileUrl) {
    return <a className="competitor-profile-link" href={item.profileUrl} target="_blank" rel="noreferrer" title={`打开${item.name}的小红书主页`}>{avatar}{details}<ExternalLink size={13}/></a>;
  }

  return <div className="competitor-profile-static">{avatar}{details}</div>;
}

function taskStatusLabel(status: PublishTask["status"]) {
  return {
    queued: "等待执行",
    scheduled: "已定时",
    publishing: "发布中",
    published: "已发布",
    paused: "已暂停",
    failed: "发布失败",
  }[status];
}

function formatTaskTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

function formatSyncTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function LiveMessageRow({ priority, icon, title, detail, source, actions }: { priority: string; icon: React.ReactNode; title: string; detail: string; source: string; actions: React.ReactNode }) {
  return <article className="message-row"><span className={`priority ${priority.toLowerCase()}`}>{priority}</span><span className="message-icon">{icon}</span><div><strong>{title}</strong><p>{detail}</p><small>{source}</small></div><div className="row-actions">{actions}</div></article>;
}

function Metric({ label, value, change }: { label: string; value: string; change: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{change}</small></article>;
}

function RuleCard({ title, items }: { title: string; items: string[] }) {
  return <article className="rule-card"><h3>{title}</h3><ul>{items.map((item)=><li key={item}><CheckCircle2 size={14}/><span>{item}</span></li>)}</ul></article>;
}
