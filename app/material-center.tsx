"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Download,
  Film,
  Folder,
  HardDrive,
  Image as ImageIcon,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Scissors,
  Search,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type BusinessId = "feed" | "ip";
type MaterialType = "folder" | "image" | "video" | "other";

type CloudMaterial = {
  fsId: string;
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
  mediaType: MaterialType;
  category: number;
  cacheId: string;
  cacheStatus: string;
  localPath: string;
};

type CachedMaterial = {
  id: string;
  fsId: string;
  remotePath: string;
  name: string;
  mediaType: "image" | "video";
  size: number;
  status: "queued" | "downloading" | "cached" | "failed";
  localPath: string;
  cachedAt?: string;
  error?: string;
  source: "baidu" | "frame";
  timestamp?: number;
};

type MaterialStatus = {
  configured: boolean;
  connected: boolean;
  userName: string;
  avatarUrl: string;
  rootPath: string;
  cacheDir: string;
  cache: CachedMaterial[];
  cacheUsage: {
    usedBytes: number;
    limitBytes: number;
    diskAvailableBytes: number | null;
  };
  ffmpegAvailable: boolean;
};

type MaterialCenterProps = {
  business: BusinessId;
  runnerOnline: boolean;
  runnerUrl: string;
  onUseImage: (localPath: string) => void;
  onOpenDraft: () => void;
  showToast: (message: string) => void;
};

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function parentPath(remotePath: string) {
  if (!remotePath || remotePath === "/") return "/";
  const parts = remotePath.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function cacheStatusLabel(status: CachedMaterial["status"]) {
  if (status === "downloading") return "正在缓存";
  if (status === "queued") return "等待缓存";
  if (status === "failed") return "缓存失败";
  return "本机可用";
}

export default function MaterialCenter({
  business,
  runnerOnline,
  runnerUrl,
  onUseImage,
  onOpenDraft,
  showToast,
}: MaterialCenterProps) {
  const [status, setStatus] = useState<MaterialStatus | null>(null);
  const [files, setFiles] = useState<CloudMaterial[]>([]);
  const [remotePath, setRemotePath] = useState("/");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [frameTarget, setFrameTarget] = useState<CachedMaterial | null>(null);
  const [frameSecond, setFrameSecond] = useState("0");

  const request = useCallback(async (pathname: string, init?: RequestInit) => {
    const response = await fetch(`${runnerUrl}${pathname}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "素材服务请求失败");
    return data;
  }, [runnerUrl]);

  const loadStatus = useCallback(async () => {
    if (!runnerOnline) return;
    try {
      const data = await request("/api/materials/status");
      setStatus(data);
      setRemotePath((current) => current === "/" && data.rootPath ? data.rootPath : current);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法读取素材服务状态");
    }
  }, [request, runnerOnline, showToast]);

  const loadFiles = useCallback(async (targetPath: string) => {
    if (!runnerOnline || !status?.connected) return;
    setLoadingFiles(true);
    try {
      const data = await request(`/api/materials/files?dir=${encodeURIComponent(targetPath)}`);
      setFiles(Array.isArray(data.files) ? data.files : []);
      setRemotePath(data.dir || targetPath);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法读取百度网盘素材");
    } finally {
      setLoadingFiles(false);
    }
  }, [request, runnerOnline, showToast, status?.connected]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.connected) return;
    void loadFiles(remotePath || status.rootPath || "/");
    // The first successful connection should immediately show its root directory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected]);

  useEffect(() => {
    if (!status?.cache.some((item) => ["queued", "downloading"].includes(item.status))) return;
    const timer = window.setInterval(() => void loadStatus(), 2500);
    return () => window.clearInterval(timer);
  }, [loadStatus, status?.cache]);

  const cachedByFsId = useMemo(
    () => new Map((status?.cache || []).filter((item) => item.fsId).map((item) => [item.fsId, item])),
    [status?.cache],
  );

  const visibleFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return files.filter((item) => {
      if (!item.isDir && !["image", "video"].includes(item.mediaType)) return false;
      if (typeFilter !== "all" && !item.isDir && item.mediaType !== typeFilter) return false;
      return !normalizedQuery || item.name.toLowerCase().includes(normalizedQuery);
    });
  }, [files, query, typeFilter]);

  async function connectBaidu() {
    try {
      const data = await request("/api/materials/baidu/auth-url", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const popup = window.open(data.authUrl, "baidu-pan-auth", "width=560,height=720");
      if (!popup) throw new Error("浏览器阻止了授权窗口，请允许弹窗后重试");
      showToast("请在新窗口中完成百度网盘授权");
      const timer = window.setInterval(async () => {
        if (popup.closed) {
          window.clearInterval(timer);
          await loadStatus();
        }
      }, 1000);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法发起百度网盘授权");
    }
  }

  async function disconnectBaidu() {
    if (!window.confirm("确认断开百度网盘？本机缓存和百度网盘原件都不会删除。")) return;
    try {
      const data = await request("/api/materials/baidu/disconnect", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setFiles([]);
      await loadStatus();
      showToast(data.message || "百度网盘已断开");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法断开百度网盘");
    }
  }

  async function cacheMaterial(item: CloudMaterial) {
    setBusyId(item.fsId);
    try {
      const data = await request("/api/materials/cache", {
        method: "POST",
        body: JSON.stringify(item),
      });
      await loadStatus();
      showToast(data.message || "已加入本机缓存队列");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "素材缓存失败");
    } finally {
      setBusyId("");
    }
  }

  async function removeCache(item: CachedMaterial) {
    if (!window.confirm(`确认清理“${item.name}”的本机缓存？百度网盘原件不会删除。`)) return;
    setBusyId(item.id);
    try {
      const data = await request(`/api/materials/cache/${item.id}/remove`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadStatus();
      if (status?.connected) await loadFiles(remotePath);
      showToast(data.message || "本机缓存已清理");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "缓存清理失败");
    } finally {
      setBusyId("");
    }
  }

  async function extractFrame() {
    if (!frameTarget) return;
    setBusyId(frameTarget.id);
    try {
      const data = await request(`/api/materials/cache/${frameTarget.id}/frame`, {
        method: "POST",
        body: JSON.stringify({ timestamp: Number(frameSecond), business }),
      });
      await loadStatus();
      onUseImage(data.frame.localPath);
      setFrameTarget(null);
      showToast("视频画面已截取，并加入当前草稿");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "视频截帧失败");
    } finally {
      setBusyId("");
    }
  }

  if (!runnerOnline) {
    return (
      <section>
        <div className="page-header">
          <div><h1>素材中心</h1><p>百度网盘云端原件与本机发布缓存。</p></div>
        </div>
        <div className="large-empty material-offline">
          <WifiOff size={30} />
          <h3>本地素材服务尚未启动</h3>
          <p>启动红序本地执行器后，才能连接百度网盘、缓存视频并完成截帧。</p>
        </div>
      </section>
    );
  }

  if (!status) {
    return <section className="material-loading"><LoaderCircle className="spin" size={24} />正在读取素材中心…</section>;
  }

  const usagePercent = Math.min(100, status.cacheUsage.limitBytes
    ? (status.cacheUsage.usedBytes / status.cacheUsage.limitBytes) * 100
    : 0);
  const cachedItems = status.cache.filter((item) => item.status !== "failed" || item.error);

  return (
    <section>
      <div className="page-header">
        <div><h1>素材中心</h1><p>百度网盘保存云端原件，本机只缓存正在制作和发布的素材。</p></div>
        <div className="page-header-actions">
          <button className="secondary-button" onClick={onOpenDraft}>查看当前草稿</button>
          {status.connected
            ? <button className="secondary-button" onClick={disconnectBaidu}><LogOut size={15} />断开网盘</button>
            : <button className="primary-button" disabled={!status.configured} onClick={connectBaidu}><Cloud size={15} />连接百度网盘</button>}
        </div>
      </div>

      <div className="material-status-grid">
        <article className={`material-status-card ${status.connected ? "connected" : ""}`}>
          <div className="material-status-icon"><Cloud size={20} /></div>
          <div>
            <span>云端素材主库</span>
            <strong>{status.connected ? status.userName || "百度网盘已连接" : status.configured ? "等待连接百度网盘" : "等待配置百度开放平台"}</strong>
            <small>{status.connected ? `当前目录 ${status.rootPath}` : "云端原件不会因清理本机缓存而删除"}</small>
          </div>
          <i className={status.connected ? "online" : ""} />
        </article>
        <article className="material-status-card">
          <div className="material-status-icon"><HardDrive size={20} /></div>
          <div>
            <span>本机智能缓存</span>
            <strong>{formatBytes(status.cacheUsage.usedBytes)} / {formatBytes(status.cacheUsage.limitBytes)}</strong>
            <div className="cache-meter"><span style={{ width: `${usagePercent}%` }} /></div>
            <small title={status.cacheDir}>缓存位置：{status.cacheDir.split("/").slice(-2).join("/")}</small>
          </div>
        </article>
        <article className="material-status-card">
          <div className="material-status-icon"><Scissors size={20} /></div>
          <div>
            <span>视频处理</span>
            <strong>{status.ffmpegAvailable ? "可以截取视频画面" : "等待安装视频处理组件"}</strong>
            <small>截帧图片会保存到缓存并保留来源关系</small>
          </div>
          {status.ffmpegAvailable && <CheckCircle2 className="material-ready" size={18} />}
        </article>
      </div>

      {!status.configured && (
        <div className="material-setup-card">
          <Cloud size={22} />
          <div><strong>还差一步即可连接百度网盘</strong><p>在百度网盘开放平台创建应用，然后把 App Key、Secret Key 和回调地址填入红序的本地配置。配置说明已经写入项目使用指南。</p></div>
        </div>
      )}

      {status.connected && (
        <div className="material-workspace">
          <div className="cloud-library-panel">
            <div className="material-toolbar">
              <div className="search-box"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前文件夹中的图片或视频" /></div>
              <div className="material-filter-tabs">
                {([['all', '全部'], ['image', '图片'], ['video', '视频']] as const).map(([value, label]) => (
                  <button key={value} className={typeFilter === value ? "active" : ""} onClick={() => setTypeFilter(value)}>{label}</button>
                ))}
              </div>
              <button className="icon-button" title="刷新百度网盘目录" onClick={() => loadFiles(remotePath)}><RefreshCw className={loadingFiles ? "spin" : ""} size={15} /></button>
            </div>

            <div className="material-path-row">
              <button disabled={remotePath === status.rootPath || remotePath === "/"} onClick={() => loadFiles(parentPath(remotePath))}><ArrowLeft size={14} />返回上级</button>
              <span>百度网盘 {remotePath}</span>
              <small>{visibleFiles.length} 项</small>
            </div>

            {loadingFiles ? (
              <div className="material-grid-empty"><LoaderCircle className="spin" size={22} />正在读取云端素材…</div>
            ) : visibleFiles.length === 0 ? (
              <div className="material-grid-empty"><Folder size={24} /><strong>当前目录没有匹配的素材</strong><span>可以返回上级目录或调整搜索条件。</span></div>
            ) : (
              <div className="material-grid">
                {visibleFiles.map((item) => {
                  const cached = cachedByFsId.get(item.fsId);
                  const isCached = cached?.status === "cached";
                  return (
                    <article className={`material-card ${item.isDir ? "folder" : ""}`} key={item.fsId || item.path}>
                      <button className="material-preview" onClick={() => item.isDir && loadFiles(item.path)} aria-label={item.isDir ? `打开文件夹 ${item.name}` : item.name}>
                        {item.isDir ? <Folder size={38} /> : item.mediaType === "image" ? (
                          <img src={`${runnerUrl}/api/materials/thumbnail?fsId=${encodeURIComponent(item.fsId)}`} alt="" loading="lazy" />
                        ) : <Film size={34} />}
                        {item.mediaType === "video" && <span className="material-type-badge">视频</span>}
                        {isCached && <span className="material-cached-badge"><CheckCircle2 size={12} />本机可用</span>}
                      </button>
                      <div className="material-card-copy">
                        <strong title={item.name}>{item.name}</strong>
                        <span>{item.isDir ? "文件夹" : `${formatBytes(item.size)} · ${new Date(item.modifiedAt).toLocaleDateString("zh-CN")}`}</span>
                      </div>
                      {!item.isDir && (
                        <div className="material-card-actions">
                          {!cached || cached.status === "failed" ? (
                            <button disabled={busyId === item.fsId} onClick={() => cacheMaterial(item)}><Download size={13} />{cached?.status === "failed" ? "重试" : "缓存"}</button>
                          ) : cached.status !== "cached" ? (
                            <button disabled><LoaderCircle className="spin" size={13} />缓存中</button>
                          ) : cached.mediaType === "image" ? (
                            <button onClick={() => { onUseImage(cached.localPath); showToast("图片已加入当前草稿"); }}><ImageIcon size={13} />加入草稿</button>
                          ) : (
                            <button onClick={() => { setFrameTarget(cached); setFrameSecond("0"); }}><Scissors size={13} />截取画面</button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="cache-panel">
            <div className="panel-title"><div><strong>本机缓存</strong><span>{cachedItems.length} 个素材</span></div><HardDrive size={16} /></div>
            <p className="cache-note">只清理本机副本，不会影响百度网盘原件。</p>
            <div className="cache-list">
              {cachedItems.length === 0 && <div className="cache-empty"><Download size={20} /><span>从左侧选择素材缓存</span></div>}
              {cachedItems.slice(0, 12).map((item) => (
                <div className="cache-row" key={item.id}>
                  <div className={`cache-thumb ${item.mediaType}`}>
                    {item.mediaType === "image" && item.status === "cached"
                      ? <img src={`${runnerUrl}/api/materials/cache/${item.id}/file`} alt="" loading="lazy" />
                      : item.mediaType === "video" ? <Film size={16} /> : <ImageIcon size={16} />}
                  </div>
                  <div><strong title={item.name}>{item.name}</strong><span className={item.status === "failed" ? "failed" : ""}>{cacheStatusLabel(item.status)} · {formatBytes(item.size)}</span></div>
                  {item.status === "cached" && item.mediaType === "image" && <button className="icon-button" title="加入草稿" onClick={() => { onUseImage(item.localPath); showToast("图片已加入当前草稿"); }}><ImageIcon size={14} /></button>}
                  {item.status === "cached" && item.mediaType === "video" && <button className="icon-button" title="截取画面" onClick={() => { setFrameTarget(item); setFrameSecond("0"); }}><Scissors size={14} /></button>}
                  <button className="icon-button danger-icon" disabled={busyId === item.id || item.status === "downloading"} title="清理本机缓存" onClick={() => removeCache(item)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {frameTarget && (
        <div className="frame-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFrameTarget(null)}>
          <div className="frame-dialog" role="dialog" aria-modal="true" aria-labelledby="frame-dialog-title">
            <div className="frame-dialog-head"><div><span>视频截帧</span><h3 id="frame-dialog-title">{frameTarget.name}</h3></div><button className="icon-button" aria-label="关闭" onClick={() => setFrameTarget(null)}>×</button></div>
            <video controls preload="metadata" src={`${runnerUrl}/api/materials/cache/${frameTarget.id}/file`} />
            <label><span>截取时间（秒）</span><input type="number" min="0" step="0.1" value={frameSecond} onChange={(event) => setFrameSecond(event.target.value)} /></label>
            <p>在视频中找到需要的画面，把播放器显示的时间填在这里。截取后会自动加入当前业务草稿。</p>
            <div className="frame-dialog-actions"><button className="secondary-button" onClick={() => setFrameTarget(null)}>取消</button><button className="primary-button" disabled={busyId === frameTarget.id} onClick={extractFrame}>{busyId === frameTarget.id ? <LoaderCircle className="spin" size={14} /> : <Scissors size={14} />}截取并加入草稿</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
