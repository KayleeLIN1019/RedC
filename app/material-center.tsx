"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileStack,
  GripVertical,
  Image as ImageIcon,
  Library,
  LoaderCircle,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BusinessId = "feed" | "ip";
type AssetRole = "main" | "secondary" | "unspecified";
type MaterialTab = "library" | "untagged" | "tags" | "projects";

type AssetUsage = {
  projectId: string;
  title: string;
  position: number;
  role: "main" | "secondary";
  updatedAt: string;
};

type LibraryAsset = {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  defaultRole: AssetRole;
  tagIds: string[];
  note: string;
  source: string;
  uploadedAt: string;
  updatedAt: string;
  usageCount: number;
  usages: AssetUsage[];
};

type TagGroup = { id: string; name: string; color: string; createdAt: string };
type MaterialTag = { id: string; name: string; groupId: string; active: boolean; assetCount: number; createdAt: string };
type ContentProject = {
  id: string;
  title: string;
  business?: BusinessId;
  status: "draft" | "completed";
  items: Array<{ assetId: string; role: "main" | "secondary" }>;
  createdAt: string;
  updatedAt: string;
};

type LibraryData = {
  storage: { mode: "local" | "online"; libraryDir: string; usedBytes: number };
  tagGroups: TagGroup[];
  tags: MaterialTag[];
  assets: LibraryAsset[];
  projects: ContentProject[];
};

type MaterialCenterProps = {
  business: BusinessId;
  runnerOnline: boolean;
  runnerUrl: string;
  onUseImage: (localPath: string) => void;
  onEditImage: (sourceUrl: string, name: string) => void;
  onOpenDraft: () => void;
  showToast: (message: string) => void;
};

const emptyData: LibraryData = {
  storage: { mode: "local", libraryDir: "", usedBytes: 0 },
  tagGroups: [], tags: [], assets: [], projects: [],
};

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function roleLabel(role: AssetRole) {
  if (role === "main") return "主图素材";
  if (role === "secondary") return "次图素材";
  return "未分类";
}

export default function MaterialCenter({ business, runnerOnline, runnerUrl, showToast }: MaterialCenterProps) {
  const [data, setData] = useState<LibraryData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MaterialTab>("library");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AssetRole>("all");
  const [usageFilter, setUsageFilter] = useState<"all" | "used" | "unused">("all");
  const [tagMode, setTagMode] = useState<"all" | "any">("all");
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState("");
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [batchTagIds, setBatchTagIds] = useState<string[]>([]);
  const [batchRole, setBatchRole] = useState<AssetRole | "keep">("keep");
  const [savingLabels, setSavingLabels] = useState(false);
  const [uploadState, setUploadState] = useState({ active: false, done: 0, total: 0 });
  const [newGroupName, setNewGroupName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagGroupId, setNewTagGroupId] = useState("");
  const [busyGroupId, setBusyGroupId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [projectAssetIds, setProjectAssetIds] = useState<string[]>([]);
  const [projectStatus, setProjectStatus] = useState<"draft" | "completed">("draft");
  const [savingProject, setSavingProject] = useState(false);
  const [exportingAssets, setExportingAssets] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const requestJson = useCallback(async (pathname: string, init?: RequestInit) => {
    const response = await fetch(`${runnerUrl}${pathname}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "素材库请求失败");
    return result;
  }, [runnerUrl]);

  const loadLibrary = useCallback(async () => {
    if (!runnerOnline) { setLoading(false); return; }
    try {
      const result = await requestJson("/api/library");
      setData({ ...emptyData, ...result });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "素材库读取失败");
    } finally {
      setLoading(false);
    }
  }, [requestJson, runnerOnline, showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLibrary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLibrary]);

  const activeTags = useMemo(() => data.tags.filter((tag) => tag.active !== false), [data.tags]);
  const tagById = useMemo(() => new Map(data.tags.map((tag) => [tag.id, tag])), [data.tags]);
  const assetById = useMemo(() => new Map(data.assets.map((asset) => [asset.id, asset])), [data.assets]);
  const detailAsset = detailId ? assetById.get(detailId) : undefined;
  const currentProjects = useMemo(() => data.projects.filter((project) => !project.business || project.business === business), [business, data.projects]);
  const effectiveTagGroupId = newTagGroupId || data.tagGroups[0]?.id || "";

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.assets.filter((asset) => {
      if (tab === "untagged" && asset.tagIds.length > 0 && asset.defaultRole !== "unspecified") return false;
      if (normalized && !`${asset.name} ${asset.note || ""} ${asset.source || ""}`.toLowerCase().includes(normalized)) return false;
      if (roleFilter !== "all" && asset.defaultRole !== roleFilter) return false;
      if (usageFilter === "used" && asset.usageCount === 0) return false;
      if (usageFilter === "unused" && asset.usageCount > 0) return false;
      if (activeTagIds.length) {
        const matches = activeTagIds.map((tagId) => asset.tagIds.includes(tagId));
        if (tagMode === "all" ? !matches.every(Boolean) : !matches.some(Boolean)) return false;
      }
      return true;
    });
  }, [activeTagIds, data.assets, query, roleFilter, tab, tagMode, usageFilter]);

  const allVisibleSelected = visibleAssets.length > 0 && visibleAssets.every((asset) => selectedIds.includes(asset.id));
  const untaggedCount = data.assets.filter((asset) => !asset.tagIds.length || asset.defaultRole === "unspecified").length;
  const usedCount = data.assets.filter((asset) => asset.usageCount > 0).length;

  async function uploadFiles(fileList: FileList | null) {
    const files = Array.from(fileList || []).filter((file) => /^image\/(png|jpeg|webp|gif)$/i.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name));
    if (!files.length) { showToast("请选择 PNG、JPG、WEBP 或 GIF 图片"); return; }
    setUploadState({ active: true, done: 0, total: files.length });
    let cursor = 0;
    let done = 0;
    let duplicates = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const file = files[cursor];
        cursor += 1;
        try {
          const response = await fetch(`${runnerUrl}/api/library/upload?name=${encodeURIComponent(file.name)}`, {
            method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || "上传失败");
          if (result.duplicate) duplicates += 1;
        } catch { failed += 1; }
        finally { done += 1; setUploadState({ active: true, done, total: files.length }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
    setUploadState({ active: false, done, total: files.length });
    if (uploadInputRef.current) uploadInputRef.current.value = "";
    await loadLibrary();
    setTab("untagged");
    showToast(`上传完成：新增 ${files.length - duplicates - failed} 张${duplicates ? `，跳过 ${duplicates} 张重复图` : ""}${failed ? `，${failed} 张失败` : ""}`);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleVisibleSelection() {
    if (allVisibleSelected) {
      const visibleIds = new Set(visibleAssets.map((asset) => asset.id));
      setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
    } else setSelectedIds((current) => [...new Set([...current, ...visibleAssets.map((asset) => asset.id)])]);
  }

  async function saveBatchLabels() {
    setSavingLabels(true);
    try {
      const result = await requestJson("/api/library/assets/update", { method: "POST", body: JSON.stringify({ ids: selectedIds, addTagIds: batchTagIds, defaultRole: batchRole === "keep" ? undefined : batchRole }) });
      showToast(result.message || "图片标签已保存");
      setTagDialogOpen(false); setSelectedIds([]); setBatchTagIds([]); setBatchRole("keep");
      await loadLibrary();
    } catch (error) { showToast(error instanceof Error ? error.message : "标签保存失败"); }
    finally { setSavingLabels(false); }
  }

  async function updateSingleAsset(patch: Record<string, unknown>) {
    if (!detailAsset) return;
    try {
      await requestJson("/api/library/assets/update", { method: "POST", body: JSON.stringify({ ids: [detailAsset.id], ...patch }) });
      await loadLibrary();
    } catch (error) { showToast(error instanceof Error ? error.message : "图片更新失败"); }
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    try {
      const result = await requestJson("/api/library/tag-groups", { method: "POST", body: JSON.stringify({ name: newGroupName }) });
      setNewGroupName(""); setNewTagGroupId(result.group.id); await loadLibrary(); showToast("标签组已创建");
    } catch (error) { showToast(error instanceof Error ? error.message : "标签组创建失败"); }
  }

  async function createTag() {
    if (!newTagName.trim() || !effectiveTagGroupId) return;
    try {
      await requestJson("/api/library/tags", { method: "POST", body: JSON.stringify({ name: newTagName, groupId: effectiveTagGroupId }) });
      setNewTagName(""); await loadLibrary(); showToast("标签已创建，现在可以给图片打标");
    } catch (error) { showToast(error instanceof Error ? error.message : "标签创建失败"); }
  }

  async function renameGroup(group: TagGroup) {
    const name = window.prompt("新的标签组名称", group.name)?.trim();
    if (!name || name === group.name) return;
    setBusyGroupId(group.id);
    try {
      await requestJson(`/api/library/tag-groups/${group.id}/update`, { method: "POST", body: JSON.stringify({ name }) });
      await loadLibrary();
      showToast("标签组名称已更新");
    } catch (error) { showToast(error instanceof Error ? error.message : "标签组修改失败"); }
    finally { setBusyGroupId(""); }
  }

  async function deleteGroup(group: TagGroup) {
    const groupTagIds = data.tags.filter((tag) => tag.groupId === group.id).map((tag) => tag.id);
    const affectedAssets = data.assets.filter((asset) => asset.tagIds.some((id) => groupTagIds.includes(id))).length;
    const confirmed = window.confirm(`确定删除标签组“${group.name}”吗？\n\n将同时删除其中 ${groupTagIds.length} 个标签，并从 ${affectedAssets} 张图片移除这些标签；图片素材本身不会被删除。`);
    if (!confirmed) return;
    setBusyGroupId(group.id);
    try {
      const result = await requestJson(`/api/library/tag-groups/${group.id}/delete`, { method: "POST", body: JSON.stringify({}) });
      setActiveTagIds((current) => current.filter((id) => !groupTagIds.includes(id)));
      setBatchTagIds((current) => current.filter((id) => !groupTagIds.includes(id)));
      if (newTagGroupId === group.id) setNewTagGroupId(data.tagGroups.find((candidate) => candidate.id !== group.id)?.id || "");
      await loadLibrary();
      showToast(result.message || "标签组已删除，图片素材保持不变");
    } catch (error) { showToast(error instanceof Error ? error.message : "标签组删除失败"); }
    finally { setBusyGroupId(""); }
  }

  async function renameTag(tag: MaterialTag) {
    const name = window.prompt("新的标签名称", tag.name)?.trim();
    if (!name || name === tag.name) return;
    try {
      await requestJson(`/api/library/tags/${tag.id}/update`, { method: "POST", body: JSON.stringify({ name }) });
      await loadLibrary(); showToast("标签名称已更新");
    } catch (error) { showToast(error instanceof Error ? error.message : "标签修改失败"); }
  }

  function startNewProject() {
    setProjectId(""); setProjectTitle(""); setProjectAssetIds([]); setProjectStatus("draft"); setTab("projects");
  }

  function openProject(project: ContentProject) {
    setProjectId(project.id); setProjectTitle(project.title); setProjectAssetIds(project.items.map((item) => item.assetId)); setProjectStatus(project.status); setTab("projects");
  }

  function addToProject(ids: string[]) {
    const available = ids.filter((id) => assetById.has(id));
    if (!available.length) return;
    const nextCount = new Set([...projectAssetIds, ...available]).size;
    setProjectAssetIds((current) => [...new Set([...current, ...available])]);
    setSelectedIds([]); showToast(`已加入内容拼装台，共 ${nextCount} 张`);
  }

  function reorderProject(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setProjectAssetIds((current) => {
      const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next;
    });
  }

  async function saveProject() {
    setSavingProject(true);
    try {
      const result = await requestJson("/api/library/projects", { method: "POST", body: JSON.stringify({ id: projectId || undefined, title: projectTitle, status: projectStatus, assetIds: projectAssetIds, business }) });
      setProjectId(result.project.id); await loadLibrary(); showToast("内容项目已保存，图片使用记录已更新");
    } catch (error) { showToast(error instanceof Error ? error.message : "内容项目保存失败"); }
    finally { setSavingProject(false); }
  }

  async function exportProject() {
    if (!projectId) { showToast("请先保存内容项目，再导出图片包"); return; }
    try {
      const result = await requestJson(`/api/library/projects/${projectId}/export`, { method: "POST", body: JSON.stringify({}) });
      const anchor = document.createElement("a");
      anchor.href = `${runnerUrl}${result.downloadUrl}`; anchor.download = result.zipName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      showToast(result.message || "图片包已导出");
    } catch (error) { showToast(error instanceof Error ? error.message : "导出失败"); }
  }

  async function exportSelectedAssets() {
    if (!selectedIds.length) { showToast("请先勾选需要导出的图片"); return; }
    setExportingAssets(true);
    try {
      const result = await requestJson("/api/library/assets/export", {
        method: "POST",
        body: JSON.stringify({ ids: selectedIds }),
      });
      const anchor = document.createElement("a");
      anchor.href = `${runnerUrl}${result.downloadUrl}`;
      anchor.download = result.zipName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      showToast(result.message || `已导出 ${selectedIds.length} 张图片`);
    } catch (error) { showToast(error instanceof Error ? error.message : "批量导出失败"); }
    finally { setExportingAssets(false); }
  }

  if (!runnerOnline) {
    return <section className="assetlib-offline"><Library size={30} /><h2>素材库等待启动</h2><p>请先运行本地执行器，图片原件、标签和内容项目才能安全保存。</p><code>npm run runner</code></section>;
  }

  return (
    <section className="assetlib-page">
      <input ref={uploadInputRef} className="assetlib-hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => void uploadFiles(event.target.files)} />
      <header className="assetlib-header">
        <div><span className="assetlib-eyebrow">XIAOHONGSHU ASSET LIBRARY</span><h1>图片素材库</h1><p>上传、分类、复用，再把主图和次图整理成一套完整内容。</p></div>
        <div className="assetlib-header-actions"><button className="secondary-button" disabled={loading} onClick={() => void loadLibrary()}><RefreshCw className={loading ? "spin" : ""} size={15} />刷新</button><button className="primary-button" disabled={uploadState.active} onClick={() => uploadInputRef.current?.click()}>{uploadState.active ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{uploadState.active ? `上传中 ${uploadState.done}/${uploadState.total}` : "上传图片"}</button></div>
      </header>

      <div className="assetlib-stat-grid">
        <article><ImageIcon size={18} /><div><strong>{data.assets.length}</strong><span>全部图片</span></div></article>
        <article><Tags size={18} /><div><strong>{untaggedCount}</strong><span>待整理</span></div></article>
        <article><CheckCircle2 size={18} /><div><strong>{usedCount}</strong><span>已被内容使用</span></div></article>
        <article><FileStack size={18} /><div><strong>{currentProjects.length}</strong><span>内容项目</span></div></article>
        <article><Library size={18} /><div><strong>{formatBytes(data.storage.usedBytes)}</strong><span>本地原件占用</span></div></article>
      </div>

      <nav className="assetlib-tabs" aria-label="素材库功能">
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library size={14} />全部素材</button>
        <button className={tab === "untagged" ? "active" : ""} onClick={() => setTab("untagged")}><Clock3 size={14} />待整理 {untaggedCount > 0 && <em>{untaggedCount}</em>}</button>
        <button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}><Tags size={14} />标签管理</button>
        <button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}><FileStack size={14} />内容拼装</button>
      </nav>

      {(tab === "library" || tab === "untagged") && <>
        <div className="assetlib-filters"><label className="assetlib-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名、备注或来源" /></label><select aria-label="图片用途" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}><option value="all">全部用途</option><option value="main">主图素材</option><option value="secondary">次图素材</option><option value="unspecified">未分类</option></select><select aria-label="使用状态" value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as typeof usageFilter)}><option value="all">全部状态</option><option value="unused">未使用</option><option value="used">已使用</option></select><button className="assetlib-mode-button" onClick={() => setTagMode((current) => current === "all" ? "any" : "all")}>{tagMode === "all" ? "满足全部标签" : "满足任意标签"}</button></div>

        {activeTags.length > 0 && <div className="assetlib-tag-filter">{data.tagGroups.map((group) => { const tags = activeTags.filter((tag) => tag.groupId === group.id); if (!tags.length) return null; return <div key={group.id}><span style={{ color: group.color }}>{group.name}</span><div>{tags.map((tag) => <button key={tag.id} className={activeTagIds.includes(tag.id) ? "active" : ""} onClick={() => setActiveTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>#{tag.name}<small>{tag.assetCount}</small></button>)}</div></div>; })}{activeTagIds.length > 0 && <button className="assetlib-clear-filter" onClick={() => setActiveTagIds([])}><X size={12} />清空标签筛选</button>}</div>}

        <div className={`assetlib-selection ${selectedIds.length ? "visible" : ""}`}><button onClick={toggleVisibleSelection}><span className={`assetlib-check ${allVisibleSelected ? "checked" : ""}`}>{allVisibleSelected && <Check size={11} />}</span>{allVisibleSelected ? "取消全选" : "全选当前结果"}</button><span>已选 <strong>{selectedIds.length}</strong> 张</span>{selectedIds.length > 0 && <><button onClick={() => setSelectedIds([])}><X size={12} />清空</button><button onClick={() => { setBatchTagIds([]); setBatchRole("keep"); setTagDialogOpen(true); }}><Tags size={13} />批量打标</button><button disabled={exportingAssets} onClick={() => void exportSelectedAssets()}>{exportingAssets ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}{exportingAssets ? "正在打包" : "一键导出 ZIP"}</button><button className="primary" onClick={() => addToProject(selectedIds)}><Plus size={13} />加入内容</button></>}</div>

        {loading ? <div className="assetlib-empty"><LoaderCircle className="spin" size={24} /><strong>正在读取素材库…</strong></div> : visibleAssets.length === 0 ? <div className="assetlib-empty"><Upload size={26} /><strong>{data.assets.length ? "没有符合条件的图片" : "素材库还是空的"}</strong><span>{data.assets.length ? "调整筛选条件，或清空标签筛选。" : "上传第一批图片，系统会自动查重并放入待整理区。"}</span>{!data.assets.length && <button className="primary-button" onClick={() => uploadInputRef.current?.click()}><Upload size={14} />上传第一批素材</button>}</div> : <div className="assetlib-grid">{visibleAssets.map((asset) => { const selected = selectedIds.includes(asset.id); return <article className={`assetlib-card ${selected ? "selected" : ""}`} key={asset.id}><button className={`assetlib-card-check ${selected ? "selected" : ""}`} aria-label={selected ? `取消选择 ${asset.name}` : `选择 ${asset.name}`} onClick={() => toggleSelection(asset.id)}>{selected && <Check size={13} />}</button><button className="assetlib-preview" onClick={() => setDetailId(asset.id)}><img src={`${runnerUrl}/api/library/assets/${asset.id}/thumbnail`} alt={asset.name} loading="lazy" /><span className={`assetlib-role ${asset.defaultRole}`}>{roleLabel(asset.defaultRole)}</span>{asset.usageCount > 0 && <span className="assetlib-used"><CheckCircle2 size={11} />用过 {asset.usageCount} 次</span>}</button><div className="assetlib-card-copy"><strong title={asset.name}>{asset.name}</strong><span>{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}{formatBytes(asset.size)}</span></div><div className="assetlib-card-tags">{asset.tagIds.slice(0, 3).map((tagId) => tagById.get(tagId)).filter(Boolean).map((tag) => <span key={tag!.id}>#{tag!.name}</span>)}{asset.tagIds.length > 3 && <small>+{asset.tagIds.length - 3}</small>}{!asset.tagIds.length && <em>尚未打标签</em>}</div><div className="assetlib-card-actions"><button onClick={() => setDetailId(asset.id)}>详情</button><button onClick={() => addToProject([asset.id])}><Plus size={12} />加入内容</button></div></article>; })}</div>}

        {projectAssetIds.length > 0 && <div className="assetlib-assembly-dock"><div><FileStack size={17} /><span>拼装台已有 <strong>{projectAssetIds.length}</strong> 张图片</span></div><button onClick={() => setTab("projects")}>打开内容拼装台</button></div>}
      </>}

      {tab === "tags" && <div className="assetlib-tag-admin"><div className="assetlib-tag-create"><div><h3>创建标签组</h3><p>标签组用于区分主题、空间、风格等维度。</p><label><input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="例如：装修阶段" /><button disabled={!newGroupName.trim()} onClick={() => void createGroup()}><Plus size={13} />新增</button></label></div><div><h3>创建标签</h3><p>创建后即可用于单张或批量图片打标。</p><label><select value={effectiveTagGroupId} onChange={(event) => setNewTagGroupId(event.target.value)}>{data.tagGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="例如：客厅" /><button disabled={!newTagName.trim() || !effectiveTagGroupId} onClick={() => void createTag()}><Plus size={13} />新增</button></label></div></div><div className="assetlib-group-grid">{data.tagGroups.map((group) => { const groupTags = data.tags.filter((tag) => tag.groupId === group.id && tag.active !== false); const busy = busyGroupId === group.id; return <article key={group.id}><header><i style={{ background: group.color }} /><div className="assetlib-group-copy"><strong>{group.name}</strong><span>{groupTags.length} 个标签</span></div><div className="assetlib-group-actions"><button aria-label={`编辑分组 ${group.name}`} title="编辑分组名称" disabled={busy} onClick={() => void renameGroup(group)}><PencilLine size={13} /></button><button className="delete" aria-label={`删除分组 ${group.name}`} title="删除分组" disabled={busy} onClick={() => void deleteGroup(group)}>{busy ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}</button></div></header>{groupTags.length ? <div>{groupTags.map((tag) => <button key={tag.id} onClick={() => void renameTag(tag)}><span>#{tag.name}</span><small>{tag.assetCount} 张 · 点击改名</small></button>)}</div> : <p>这个标签组还没有标签</p>}</article>; })}</div></div>}

      {tab === "projects" && <div className="assetlib-project-layout"><aside className="assetlib-project-list"><header><div><strong>内容项目</strong><span>{currentProjects.length} 个已保存项目</span></div><button aria-label="新建内容项目" onClick={startNewProject}><Plus size={15} /></button></header>{currentProjects.length === 0 && <p>还没有保存的内容项目。</p>}{currentProjects.map((project) => <button className={project.id === projectId ? "active" : ""} key={project.id} onClick={() => openProject(project)}><div><strong>{project.title}</strong><span>{project.items.length} 张图片 · {project.status === "completed" ? "已完成" : "草稿"}</span></div><small>{formatDate(project.updatedAt)}</small></button>)}</aside><main className="assetlib-builder"><header><div><span>{projectId ? "编辑内容项目" : "新建内容项目"}</span><input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="输入小红书内容标题" maxLength={80} /></div><div><select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value as typeof projectStatus)}><option value="draft">草稿</option><option value="completed">已完成</option></select><button className="secondary-button" onClick={() => { setTab("library"); setSelectedIds([]); }}><Plus size={14} />继续选图</button><button className="primary-button" disabled={savingProject || !projectTitle.trim() || !projectAssetIds.length} onClick={() => void saveProject()}>{savingProject ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}保存项目</button></div></header><div className="assetlib-builder-note"><span>第 1 张自动作为主图，其余为次图。拖动卡片或使用箭头都可以重新排序。</span><strong>{projectAssetIds.length} 张</strong></div>{projectAssetIds.length === 0 ? <div className="assetlib-builder-empty"><ImageIcon size={28} /><strong>还没有选择图片</strong><span>返回素材库选择主图和次图，再加入拼装台。</span><button className="primary-button" onClick={() => setTab("library")}><Plus size={14} />去素材库选图</button></div> : <div className="assetlib-builder-grid">{projectAssetIds.map((assetId, index) => { const asset = assetById.get(assetId); if (!asset) return null; return <article key={assetId} draggable onDragStart={() => setDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex !== null) reorderProject(dragIndex, index); setDragIndex(null); }}><div className="assetlib-builder-index"><GripVertical size={14} /><strong>{String(index + 1).padStart(2, "0")}</strong><span>{index === 0 ? "主图" : "次图"}</span></div><img src={`${runnerUrl}/api/library/assets/${asset.id}/thumbnail`} alt={asset.name} /><div><strong title={asset.name}>{asset.name}</strong><span>{asset.tagIds.map((id) => tagById.get(id)?.name).filter(Boolean).slice(0, 3).join(" · ") || "未打标签"}</span></div><div className="assetlib-order-actions"><button aria-label={`上移 ${asset.name}`} disabled={index === 0} onClick={() => reorderProject(index, index - 1)}><ArrowUp size={13} /></button><button aria-label={`下移 ${asset.name}`} disabled={index === projectAssetIds.length - 1} onClick={() => reorderProject(index, index + 1)}><ArrowDown size={13} /></button><button aria-label={`从内容中移除 ${asset.name}`} onClick={() => setProjectAssetIds((current) => current.filter((id) => id !== assetId))}><X size={13} /></button></div></article>; })}</div>}<footer><div><CheckCircle2 size={14} /><span>保存后，每张图片的使用记录会自动更新。</span></div><button className="secondary-button" disabled={!projectId || !projectAssetIds.length} onClick={() => void exportProject()}><Download size={14} />导出排序图片包</button></footer></main></div>}

      {tagDialogOpen && <div className="assetlib-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !savingLabels && setTagDialogOpen(false)}><div className="assetlib-modal" role="dialog" aria-modal="true" aria-labelledby="assetlib-tag-dialog-title"><header><div><span>人工批量打标</span><h3 id="assetlib-tag-dialog-title">整理 {selectedIds.length} 张图片</h3></div><button aria-label="关闭" disabled={savingLabels} onClick={() => setTagDialogOpen(false)}><X size={15} /></button></header><label className="assetlib-role-field"><span>图片默认用途</span><select value={batchRole} onChange={(event) => setBatchRole(event.target.value as AssetRole | "keep")}><option value="keep">保持原用途</option><option value="unspecified">暂不确定</option><option value="main">主图素材</option><option value="secondary">次图素材</option></select></label><div className="assetlib-modal-tags">{data.tagGroups.map((group) => { const tags = activeTags.filter((tag) => tag.groupId === group.id); if (!tags.length) return null; return <section key={group.id}><strong style={{ color: group.color }}>{group.name}</strong><div>{tags.map((tag) => { const checked = batchTagIds.includes(tag.id); return <button className={checked ? "selected" : ""} key={tag.id} onClick={() => setBatchTagIds((current) => checked ? current.filter((id) => id !== tag.id) : [...current, tag.id])}><span>{checked && <Check size={11} />}</span>#{tag.name}</button>; })}</div></section>; })}{!activeTags.length && <p>还没有标签。请先前往“标签管理”创建标签。</p>}</div><footer><button className="secondary-button" disabled={savingLabels} onClick={() => setTagDialogOpen(false)}>取消</button><button className="primary-button" disabled={savingLabels} onClick={() => void saveBatchLabels()}>{savingLabels ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}保存标签</button></footer></div></div>}

      {detailAsset && <div className="assetlib-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDetailId("")}><div className="assetlib-detail" role="dialog" aria-modal="true" aria-labelledby="assetlib-detail-title"><header><div><span>图片详情与使用记录</span><h3 id="assetlib-detail-title">{detailAsset.name}</h3></div><button aria-label="关闭" onClick={() => setDetailId("")}><X size={15} /></button></header><div className="assetlib-detail-body"><div className="assetlib-detail-preview"><img src={`${runnerUrl}/api/library/assets/${detailAsset.id}/file`} alt={detailAsset.name} /></div><aside><dl><div><dt>尺寸</dt><dd>{detailAsset.width && detailAsset.height ? `${detailAsset.width} × ${detailAsset.height}` : "未识别"}</dd></div><div><dt>大小</dt><dd>{formatBytes(detailAsset.size)}</dd></div><div><dt>上传时间</dt><dd>{formatDate(detailAsset.uploadedAt)}</dd></div><div><dt>来源</dt><dd>{detailAsset.source || "本地上传"}</dd></div></dl><section><strong>默认用途</strong><div className="assetlib-detail-roles">{(["main", "secondary", "unspecified"] as AssetRole[]).map((role) => <button className={detailAsset.defaultRole === role ? "active" : ""} key={role} onClick={() => void updateSingleAsset({ defaultRole: role })}>{roleLabel(role)}</button>)}</div></section><section><strong>图片标签</strong><div className="assetlib-detail-tags">{activeTags.map((tag) => { const checked = detailAsset.tagIds.includes(tag.id); return <button className={checked ? "active" : ""} key={tag.id} onClick={() => void updateSingleAsset(checked ? { removeTagIds: [tag.id] } : { addTagIds: [tag.id] })}>#{tag.name}</button>; })}{!activeTags.length && <span>请先在标签管理中创建标签</span>}</div></section><section><strong>使用记录 · {detailAsset.usageCount} 次</strong>{detailAsset.usages.length ? <div className="assetlib-usage-list">{detailAsset.usages.map((usage) => <button key={`${usage.projectId}-${usage.position}`} onClick={() => { const project = data.projects.find((item) => item.id === usage.projectId); if (project) { setDetailId(""); openProject(project); } }}><div><strong>{usage.title}</strong><span>第 {usage.position} 张 · {usage.role === "main" ? "主图" : "次图"}</span></div><small>{formatDate(usage.updatedAt)}</small></button>)}</div> : <p className="assetlib-no-usage">这张图片还没有被内容项目使用。</p>}</section><button className="primary-button assetlib-detail-add" onClick={() => { addToProject([detailAsset.id]); setDetailId(""); }}><Plus size={14} />加入内容拼装台</button></aside></div></div></div>}
    </section>
  );
}
