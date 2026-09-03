"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileStack,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  Library,
  LoaderCircle,
  PencilLine,
  Plus,
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
  const [batchRoleByAsset, setBatchRoleByAsset] = useState<Record<string, AssetRole>>({});
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
  const [exportingProject, setExportingProject] = useState<"" | "zip" | "folder">("");
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
  const mainCount = data.assets.filter((asset) => asset.defaultRole === "main").length;
  const secondaryCount = data.assets.filter((asset) => asset.defaultRole === "secondary").length;
  const hasActiveProject = Boolean(projectId || projectTitle || projectAssetIds.length);

  async function uploadFiles(fileList: FileList | null) {
    const files = Array.from(fileList || []).filter((file) => /^image\/(png|jpeg|webp|gif)$/i.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name));
    if (!files.length) { showToast("请选择 PNG、JPG、WEBP 或 GIF 图片"); return; }
    setUploadState({ active: true, done: 0, total: files.length });
    let cursor = 0;
    let done = 0;
    let duplicates = 0;
    let failed = 0;
    const uploadedIds: string[] = [];
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
          else if (result.asset?.id) uploadedIds.push(result.asset.id);
        } catch { failed += 1; }
        finally { done += 1; setUploadState({ active: true, done, total: files.length }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
    setUploadState({ active: false, done, total: files.length });
    if (uploadInputRef.current) uploadInputRef.current.value = "";
    await loadLibrary();
    setTab("untagged");
    if (uploadedIds.length) {
      setSelectedIds(uploadedIds);
      setBatchTagIds([]);
      setBatchRole("keep");
      setBatchRoleByAsset(Object.fromEntries(uploadedIds.map((id) => [id, "unspecified"])));
      setTagDialogOpen(true);
    }
    showToast(`上传完成：新增 ${uploadedIds.length} 张${duplicates ? `，跳过 ${duplicates} 张重复图` : ""}${failed ? `，${failed} 张失败` : ""}`);
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

  function openBatchTagging() {
    if (!selectedIds.length) return;
    setBatchTagIds([]);
    setBatchRole("keep");
    setBatchRoleByAsset(Object.fromEntries(selectedIds.map((id) => [id, assetById.get(id)?.defaultRole || "unspecified"])));
    setTagDialogOpen(true);
  }

  async function saveBatchLabels() {
    setSavingLabels(true);
    try {
      const result = await requestJson("/api/library/assets/update", { method: "POST", body: JSON.stringify({ ids: selectedIds, addTagIds: batchTagIds, roleByAsset: batchRoleByAsset }) });
      showToast(result.message || "图片标签已保存");
      setTagDialogOpen(false); setSelectedIds([]); setBatchTagIds([]); setBatchRole("keep"); setBatchRoleByAsset({});
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

  function startNewProject(initialAssetIds: string[] = []) {
    setProjectId(""); setProjectTitle(""); setProjectAssetIds([...new Set(initialAssetIds)]); setProjectStatus("draft"); setSelectedIds([]); setTab("projects");
  }

  function openProject(project: ContentProject) {
    setProjectId(project.id); setProjectTitle(project.title); setProjectAssetIds(project.items.map((item) => item.assetId)); setProjectStatus(project.status); setTab("projects");
  }

  function addToProject(ids: string[]) {
    const available = ids.filter((id) => assetById.has(id));
    if (!available.length) return;
    if (!hasActiveProject) {
      startNewProject(available);
      showToast(`已选择 ${available.length} 张图片，请填写标题并调整顺序`);
      return;
    }
    const nextCount = new Set([...projectAssetIds, ...available]).size;
    setProjectAssetIds((current) => [...new Set([...current, ...available])]);
    setSelectedIds([]); setTab("projects"); showToast(`已加入当前内容，共 ${nextCount} 张`);
  }

  function toggleProjectAsset(assetId: string) {
    setProjectAssetIds((current) => current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]);
  }

  function reorderProject(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setProjectAssetIds((current) => {
      const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next;
    });
  }

  async function saveProject(silent = false) {
    if (!projectTitle.trim()) { showToast("请先填写内容标题"); return ""; }
    if (!projectAssetIds.length) { showToast("请至少选择一张图片"); return ""; }
    setSavingProject(true);
    try {
      const result = await requestJson("/api/library/projects", { method: "POST", body: JSON.stringify({ id: projectId || undefined, title: projectTitle, status: projectStatus, assetIds: projectAssetIds, business }) });
      setProjectId(result.project.id); await loadLibrary(); if (!silent) showToast("内容已保存，素材使用记录已更新");
      return result.project.id as string;
    } catch (error) { showToast(error instanceof Error ? error.message : "内容保存失败"); return ""; }
    finally { setSavingProject(false); }
  }

  async function exportProject(format: "zip" | "folder") {
    const savedProjectId = await saveProject(true);
    if (!savedProjectId) return;
    setExportingProject(format);
    try {
      const result = await requestJson(`/api/library/projects/${savedProjectId}/export`, { method: "POST", body: JSON.stringify({ format }) });
      if (format === "zip") {
        const anchor = document.createElement("a");
        anchor.href = `${runnerUrl}${result.downloadUrl}`; anchor.download = result.zipName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      }
      showToast(result.message || (format === "folder" ? "文件夹已生成" : "ZIP 图片包已导出"));
    } catch (error) { showToast(error instanceof Error ? error.message : "导出失败"); }
    finally { setExportingProject(""); }
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
        <div><span className="assetlib-eyebrow">XIAOHONGSHU MATERIAL WORKSPACE</span><h1>小红书素材工作台</h1><p>成品图永久留在素材库；创建内容时选图、排序，再导出一套可直接使用的图片包。</p><small>本地原件 {formatBytes(data.storage.usedBytes)} · 已复用 {usedCount} 张</small></div>
        <div className="assetlib-header-actions"><button className="secondary-button" onClick={() => startNewProject()}><FileStack size={15} />新建一篇内容</button><button className="primary-button" disabled={uploadState.active} onClick={() => uploadInputRef.current?.click()}>{uploadState.active ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{uploadState.active ? `上传中 ${uploadState.done}/${uploadState.total}` : "上传成品图"}</button></div>
      </header>

      <div className="assetlib-workflow" aria-label="素材工作流程">
        <button onClick={() => uploadInputRef.current?.click()}><strong>1</strong><span><b>上传成品图</b><small>支持同时上传主图和次图</small></span></button>
        <button className={untaggedCount ? "attention" : ""} onClick={() => setTab("untagged")}><strong>2</strong><span><b>标记图位与标签</b><small>{untaggedCount ? `${untaggedCount} 张图片待处理` : "所有图片已完成整理"}</small></span></button>
        <button onClick={() => startNewProject()}><strong>3</strong><span><b>创建内容并导出</b><small>选图 → 排序 → ZIP 或文件夹</small></span></button>
      </div>

      <div className="assetlib-stat-grid">
        <article><ImageIcon size={18} /><div><strong>{data.assets.length}</strong><span>全部图片</span></div></article>
        <article><ImageIcon size={18} /><div><strong>{mainCount}</strong><span>主图素材</span></div></article>
        <article><ImageIcon size={18} /><div><strong>{secondaryCount}</strong><span>次图素材</span></div></article>
        <article><Clock3 size={18} /><div><strong>{untaggedCount}</strong><span>待打标</span></div></article>
        <article><FileStack size={18} /><div><strong>{currentProjects.length}</strong><span>内容包</span></div></article>
      </div>

      <nav className="assetlib-tabs" aria-label="素材库功能">
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library size={14} />素材库</button>
        <button className={tab === "untagged" ? "active" : ""} onClick={() => setTab("untagged")}><Clock3 size={14} />待打标 {untaggedCount > 0 && <em>{untaggedCount}</em>}</button>
        <button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}><FileStack size={14} />创建内容 {projectAssetIds.length > 0 && <em>{projectAssetIds.length}</em>}</button>
        <button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}><Tags size={14} />标签设置</button>
      </nav>

      {(tab === "library" || tab === "untagged") && <>
        <div className="assetlib-filters"><label className="assetlib-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名、备注或来源" /></label><select aria-label="图片用途" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}><option value="all">全部用途</option><option value="main">主图素材</option><option value="secondary">次图素材</option><option value="unspecified">未分类</option></select><select aria-label="使用状态" value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as typeof usageFilter)}><option value="all">全部状态</option><option value="unused">未使用</option><option value="used">已使用</option></select><button className="assetlib-mode-button" onClick={() => setTagMode((current) => current === "all" ? "any" : "all")}>{tagMode === "all" ? "满足全部标签" : "满足任意标签"}</button></div>

        {activeTags.length > 0 && <div className="assetlib-tag-filter">{data.tagGroups.map((group) => { const tags = activeTags.filter((tag) => tag.groupId === group.id); if (!tags.length) return null; return <div key={group.id}><span style={{ color: group.color }}>{group.name}</span><div>{tags.map((tag) => <button key={tag.id} className={activeTagIds.includes(tag.id) ? "active" : ""} onClick={() => setActiveTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>#{tag.name}<small>{tag.assetCount}</small></button>)}</div></div>; })}{activeTagIds.length > 0 && <button className="assetlib-clear-filter" onClick={() => setActiveTagIds([])}><X size={12} />清空标签筛选</button>}</div>}

        <div className={`assetlib-selection ${selectedIds.length ? "visible" : ""}`}><button onClick={toggleVisibleSelection}><span className={`assetlib-check ${allVisibleSelected ? "checked" : ""}`}>{allVisibleSelected && <Check size={11} />}</span>{allVisibleSelected ? "取消全选" : "全选当前结果"}</button><span>已选 <strong>{selectedIds.length}</strong> 张</span>{selectedIds.length > 0 && <><button onClick={() => setSelectedIds([])}><X size={12} />清空</button><button onClick={openBatchTagging}><Tags size={13} />设置图位和标签</button><button disabled={exportingAssets} onClick={() => void exportSelectedAssets()}>{exportingAssets ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}{exportingAssets ? "正在打包" : "直接导出"}</button><button className="primary" onClick={() => startNewProject(selectedIds)}><FileStack size={13} />用所选创建内容</button></>}</div>

        {loading ? <div className="assetlib-empty"><LoaderCircle className="spin" size={24} /><strong>正在读取素材库…</strong></div> : visibleAssets.length === 0 ? <div className="assetlib-empty"><Upload size={26} /><strong>{data.assets.length ? "没有符合条件的图片" : "素材库还是空的"}</strong><span>{data.assets.length ? "调整筛选条件，或清空标签筛选。" : "上传第一批图片，系统会自动查重并进入打标流程。"}</span>{!data.assets.length && <button className="primary-button" onClick={() => uploadInputRef.current?.click()}><Upload size={14} />上传第一批素材</button>}</div> : <div className="assetlib-grid">{visibleAssets.map((asset) => { const selected = selectedIds.includes(asset.id); return <article className={`assetlib-card ${selected ? "selected" : ""}`} key={asset.id}><button className={`assetlib-card-check ${selected ? "selected" : ""}`} aria-label={selected ? `取消选择 ${asset.name}` : `选择 ${asset.name}`} onClick={() => toggleSelection(asset.id)}>{selected && <Check size={13} />}</button><button className="assetlib-preview" onClick={() => setDetailId(asset.id)}><img src={`${runnerUrl}/api/library/assets/${asset.id}/thumbnail`} alt={asset.name} loading="lazy" /><span className={`assetlib-role ${asset.defaultRole}`}>{roleLabel(asset.defaultRole)}</span>{asset.usageCount > 0 && <span className="assetlib-used"><CheckCircle2 size={11} />用过 {asset.usageCount} 次</span>}</button><div className="assetlib-card-copy"><strong title={asset.name}>{asset.name}</strong><span>{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}{formatBytes(asset.size)}</span></div><div className="assetlib-card-tags">{asset.tagIds.slice(0, 3).map((tagId) => tagById.get(tagId)).filter(Boolean).map((tag) => <span key={tag!.id}>#{tag!.name}</span>)}{asset.tagIds.length > 3 && <small>+{asset.tagIds.length - 3}</small>}{!asset.tagIds.length && <em>尚未打标签</em>}</div><div className="assetlib-card-actions"><button onClick={() => setDetailId(asset.id)}>查看 / 打标</button><button onClick={() => addToProject([asset.id])}><Plus size={12} />{hasActiveProject ? "加入当前内容" : "用于新内容"}</button></div></article>; })}</div>}

        {projectAssetIds.length > 0 && <div className="assetlib-assembly-dock"><div><FileStack size={17} /><span>当前内容已有 <strong>{projectAssetIds.length}</strong> 张图片</span></div><button onClick={() => setTab("projects")}>继续选图和排序</button></div>}
      </>}

      {tab === "tags" && <div className="assetlib-tag-admin"><div className="assetlib-tag-create"><div><h3>创建标签组</h3><p>标签组用于区分主题、空间、风格等维度。</p><label><input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="例如：装修阶段" /><button disabled={!newGroupName.trim()} onClick={() => void createGroup()}><Plus size={13} />新增</button></label></div><div><h3>创建标签</h3><p>创建后即可用于单张或批量图片打标。</p><label><select value={effectiveTagGroupId} onChange={(event) => setNewTagGroupId(event.target.value)}>{data.tagGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="例如：客厅" /><button disabled={!newTagName.trim() || !effectiveTagGroupId} onClick={() => void createTag()}><Plus size={13} />新增</button></label></div></div><div className="assetlib-group-grid">{data.tagGroups.map((group) => { const groupTags = data.tags.filter((tag) => tag.groupId === group.id && tag.active !== false); const busy = busyGroupId === group.id; return <article key={group.id}><header><i style={{ background: group.color }} /><div className="assetlib-group-copy"><strong>{group.name}</strong><span>{groupTags.length} 个标签</span></div><div className="assetlib-group-actions"><button aria-label={`编辑分组 ${group.name}`} title="编辑分组名称" disabled={busy} onClick={() => void renameGroup(group)}><PencilLine size={13} /></button><button className="delete" aria-label={`删除分组 ${group.name}`} title="删除分组" disabled={busy} onClick={() => void deleteGroup(group)}>{busy ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}</button></div></header>{groupTags.length ? <div>{groupTags.map((tag) => <button key={tag.id} onClick={() => void renameTag(tag)}><span>#{tag.name}</span><small>{tag.assetCount} 张 · 点击改名</small></button>)}</div> : <p>这个标签组还没有标签</p>}</article>; })}</div></div>}

      {tab === "projects" && (
        <div className="assetlib-project-layout">
          <aside className="assetlib-project-list">
            <header>
              <div><strong>我的内容包</strong><span>{currentProjects.length} 篇已保存内容</span></div>
              <button aria-label="新建一篇内容" onClick={() => startNewProject()}><Plus size={15} /></button>
            </header>
            <button className="assetlib-new-project" onClick={() => startNewProject()}><Plus size={13} />新建一篇内容</button>
            {currentProjects.length === 0 && <p>保存后的内容会显示在这里，可再次打开、换图和导出。</p>}
            {currentProjects.map((project) => <button className={project.id === projectId ? "active" : ""} key={project.id} onClick={() => openProject(project)}><div><strong>{project.title}</strong><span>{project.items.length} 张图片 · {project.status === "completed" ? "已完成" : "草稿"}</span></div><small>{formatDate(project.updatedAt)}</small></button>)}
          </aside>

          <main className="assetlib-builder">
            <header>
              <div><span>步骤 1 · 给这篇内容起一个标题</span><input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="例如：客厅装修最容易踩的 5 个坑" maxLength={80} /></div>
              <div><select aria-label="内容状态" value={projectStatus} onChange={(event) => setProjectStatus(event.target.value as typeof projectStatus)}><option value="draft">草稿</option><option value="completed">已完成</option></select><button className="secondary-button" disabled={savingProject || !projectTitle.trim() || !projectAssetIds.length} onClick={() => void saveProject()}>{savingProject ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}保存内容</button></div>
            </header>

            <div className="assetlib-builder-steps"><span className={projectTitle.trim() ? "done" : "active"}><b>1</b>填写标题</span><span className={projectAssetIds.length ? "done" : "active"}><b>2</b>选择素材</span><span className={projectAssetIds.length > 1 ? "active" : ""}><b>3</b>排序并导出</span></div>

            <section className="assetlib-selected-assets">
              <header><div><h3>已选图片与顺序</h3><p>第 1 张固定按主图导出，其余按次图导出；拖动卡片或点击箭头调整顺序。</p></div><strong>{projectAssetIds.length} 张</strong></header>
              {projectAssetIds.length === 0 ? <div className="assetlib-selected-empty"><ImageIcon size={23} /><span>从下方素材库点击图片，即可加入这篇内容。</span></div> : <div className="assetlib-builder-grid">{projectAssetIds.map((assetId, index) => { const asset = assetById.get(assetId); if (!asset) return null; return <article key={assetId} draggable onDragStart={() => setDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex !== null) reorderProject(dragIndex, index); setDragIndex(null); }}><div className="assetlib-builder-index"><GripVertical size={14} /><strong>{String(index + 1).padStart(2, "0")}</strong><span>{index === 0 ? "主图" : "次图"}</span></div><img src={`${runnerUrl}/api/library/assets/${asset.id}/thumbnail`} alt={asset.name} /><div><strong title={asset.name}>{asset.name}</strong><span>{asset.tagIds.map((id) => tagById.get(id)?.name).filter(Boolean).slice(0, 3).join(" · ") || "未打标签"}</span></div><div className="assetlib-order-actions"><button aria-label={`上移 ${asset.name}`} disabled={index === 0} onClick={() => reorderProject(index, index - 1)}><ArrowUp size={13} /></button><button aria-label={`下移 ${asset.name}`} disabled={index === projectAssetIds.length - 1} onClick={() => reorderProject(index, index + 1)}><ArrowDown size={13} /></button><button aria-label={`从内容中移除 ${asset.name}`} onClick={() => setProjectAssetIds((current) => current.filter((id) => id !== assetId))}><X size={13} /></button></div></article>; })}</div>}
              {projectAssetIds.length > 0 && assetById.get(projectAssetIds[0])?.defaultRole === "secondary" && <p className="assetlib-order-warning">当前第 1 张原本标记为次图，导出时仍会作为主图。建议把一张主图素材移动到第 1 位。</p>}
            </section>

            <section className="assetlib-project-picker">
              <header><div><h3>从素材库选图</h3><p>可以同时使用主图和次图，已加入的图片会显示勾选状态。</p></div><button className="secondary-button" onClick={() => uploadInputRef.current?.click()}><Upload size={13} />上传新素材</button></header>
              <div className="assetlib-filters"><label className="assetlib-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材名称、备注或来源" /></label><select aria-label="按主图次图筛选" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}><option value="all">全部图位</option><option value="main">只看主图</option><option value="secondary">只看次图</option><option value="unspecified">待设置图位</option></select><select aria-label="按使用状态筛选" value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as typeof usageFilter)}><option value="all">全部素材</option><option value="unused">未使用过</option><option value="used">已使用过</option></select><button className="assetlib-mode-button" onClick={() => setTagMode((current) => current === "all" ? "any" : "all")}>{tagMode === "all" ? "同时满足标签" : "满足任一标签"}</button></div>
              {activeTags.length > 0 && <div className="assetlib-tag-filter compact">{data.tagGroups.map((group) => { const tags = activeTags.filter((tag) => tag.groupId === group.id); if (!tags.length) return null; return <div key={group.id}><span style={{ color: group.color }}>{group.name}</span><div>{tags.map((tag) => <button key={tag.id} className={activeTagIds.includes(tag.id) ? "active" : ""} onClick={() => setActiveTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>#{tag.name}</button>)}</div></div>; })}{activeTagIds.length > 0 && <button className="assetlib-clear-filter" onClick={() => setActiveTagIds([])}><X size={12} />清空筛选</button>}</div>}
              {visibleAssets.length === 0 ? <div className="assetlib-picker-empty"><Search size={20} /><span>没有符合筛选条件的素材</span></div> : <div className="assetlib-project-picker-grid">{visibleAssets.map((asset) => { const chosen = projectAssetIds.includes(asset.id); return <button className={chosen ? "chosen" : ""} key={asset.id} aria-label={chosen ? `从内容中移除 ${asset.name}` : `将 ${asset.name} 加入内容`} onClick={() => toggleProjectAsset(asset.id)}><div><img src={`${runnerUrl}/api/library/assets/${asset.id}/thumbnail`} alt={asset.name} /><span className={`assetlib-role ${asset.defaultRole}`}>{roleLabel(asset.defaultRole)}</span><i>{chosen && <Check size={13} />}</i></div><strong>{asset.name}</strong><small>{asset.tagIds.map((id) => tagById.get(id)?.name).filter(Boolean).slice(0, 2).join(" · ") || "未打标签"}</small></button>; })}</div>}
            </section>

            <footer><div><CheckCircle2 size={14} /><span>保存或导出后，系统会记录每张素材在哪篇内容中使用过。</span></div><div className="assetlib-export-actions"><button className="secondary-button" disabled={Boolean(exportingProject) || !projectTitle.trim() || !projectAssetIds.length} onClick={() => void exportProject("folder")}>{exportingProject === "folder" ? <LoaderCircle className="spin" size={14} /> : <FolderOpen size={14} />}生成文件夹</button><button className="primary-button" disabled={Boolean(exportingProject) || !projectTitle.trim() || !projectAssetIds.length} onClick={() => void exportProject("zip")}>{exportingProject === "zip" ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}一键下载 ZIP</button></div></footer>
          </main>
        </div>
      )}

      {tagDialogOpen && <div className="assetlib-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !savingLabels && setTagDialogOpen(false)}><div className="assetlib-modal assetlib-label-modal" role="dialog" aria-modal="true" aria-labelledby="assetlib-tag-dialog-title"><header><div><span>上传后的第一步</span><h3 id="assetlib-tag-dialog-title">给 {selectedIds.length} 张图片设置图位和标签</h3></div><button aria-label="关闭" disabled={savingLabels} onClick={() => setTagDialogOpen(false)}><X size={15} /></button></header><section className="assetlib-batch-roles"><header><div><strong>逐张设置主图 / 次图</strong><span>同一批上传的图片可以分别设置，不会互相覆盖。</span></div><select aria-label="批量设置图片图位" value={batchRole} onChange={(event) => { const role = event.target.value as AssetRole | "keep"; setBatchRole(role); if (role !== "keep") setBatchRoleByAsset(Object.fromEntries(selectedIds.map((id) => [id, role]))); }}><option value="keep">不批量修改</option><option value="main">全部设为主图</option><option value="secondary">全部设为次图</option><option value="unspecified">全部稍后整理</option></select></header><div>{selectedIds.map((assetId) => { const asset = assetById.get(assetId); if (!asset) return null; const role = batchRoleByAsset[assetId] || asset.defaultRole; return <article key={assetId}><img src={`${runnerUrl}/api/library/assets/${asset.id}/thumbnail`} alt={asset.name} /><div><strong>{asset.name}</strong><span>{asset.tagIds.length ? `已有 ${asset.tagIds.length} 个标签` : "尚未打标签"}</span></div><div className="assetlib-batch-role-buttons">{(["main", "secondary", "unspecified"] as AssetRole[]).map((option) => <button className={role === option ? "active" : ""} key={option} onClick={() => { setBatchRole("keep"); setBatchRoleByAsset((current) => ({ ...current, [assetId]: option })); }}>{option === "main" ? "主图" : option === "secondary" ? "次图" : "稍后"}</button>)}</div></article>; })}</div></section><div className="assetlib-modal-tags"><div className="assetlib-modal-tags-title"><strong>给所选图片添加标签</strong><span>可跨多个标签组选择，保存后仍可单张修改。</span></div>{data.tagGroups.map((group) => { const tags = activeTags.filter((tag) => tag.groupId === group.id); if (!tags.length) return null; return <section key={group.id}><strong style={{ color: group.color }}>{group.name}</strong><div>{tags.map((tag) => { const checked = batchTagIds.includes(tag.id); return <button className={checked ? "selected" : ""} key={tag.id} onClick={() => setBatchTagIds((current) => checked ? current.filter((id) => id !== tag.id) : [...current, tag.id])}><span>{checked && <Check size={11} />}</span>#{tag.name}</button>; })}</div></section>; })}{!activeTags.length && <p>还没有标签。可先保存图位，再到“标签设置”创建标签。</p>}</div><footer><button className="secondary-button" disabled={savingLabels} onClick={() => setTagDialogOpen(false)}>稍后处理</button><button className="primary-button" disabled={savingLabels} onClick={() => void saveBatchLabels()}>{savingLabels ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}保存图位和标签</button></footer></div></div>}

      {detailAsset && <div className="assetlib-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDetailId("")}><div className="assetlib-detail" role="dialog" aria-modal="true" aria-labelledby="assetlib-detail-title"><header><div><span>素材详情、打标与复用记录</span><h3 id="assetlib-detail-title">{detailAsset.name}</h3></div><button aria-label="关闭" onClick={() => setDetailId("")}><X size={15} /></button></header><div className="assetlib-detail-body"><div className="assetlib-detail-preview"><img src={`${runnerUrl}/api/library/assets/${detailAsset.id}/file`} alt={detailAsset.name} /></div><aside><dl><div><dt>尺寸</dt><dd>{detailAsset.width && detailAsset.height ? `${detailAsset.width} × ${detailAsset.height}` : "未识别"}</dd></div><div><dt>大小</dt><dd>{formatBytes(detailAsset.size)}</dd></div><div><dt>上传时间</dt><dd>{formatDate(detailAsset.uploadedAt)}</dd></div><div><dt>来源</dt><dd>{detailAsset.source || "本地上传"}</dd></div></dl><section><strong>图片图位</strong><div className="assetlib-detail-roles">{(["main", "secondary", "unspecified"] as AssetRole[]).map((role) => <button className={detailAsset.defaultRole === role ? "active" : ""} key={role} onClick={() => void updateSingleAsset({ defaultRole: role })}>{roleLabel(role)}</button>)}</div></section><section><strong>图片标签</strong><div className="assetlib-detail-tags">{activeTags.map((tag) => { const checked = detailAsset.tagIds.includes(tag.id); return <button className={checked ? "active" : ""} key={tag.id} onClick={() => void updateSingleAsset(checked ? { removeTagIds: [tag.id] } : { addTagIds: [tag.id] })}>#{tag.name}</button>; })}{!activeTags.length && <span>请先在标签设置中创建标签</span>}</div></section><section><strong>复用记录 · {detailAsset.usageCount} 次</strong>{detailAsset.usages.length ? <div className="assetlib-usage-list">{detailAsset.usages.map((usage) => <button key={`${usage.projectId}-${usage.position}`} onClick={() => { const project = data.projects.find((item) => item.id === usage.projectId); if (project) { setDetailId(""); openProject(project); } }}><div><strong>{usage.title}</strong><span>第 {usage.position} 张 · {usage.role === "main" ? "主图" : "次图"}</span></div><small>{formatDate(usage.updatedAt)}</small></button>)}</div> : <p className="assetlib-no-usage">这张图片还没有被任何内容使用。</p>}</section><button className="primary-button assetlib-detail-add" onClick={() => { addToProject([detailAsset.id]); setDetailId(""); }}><Plus size={14} />{hasActiveProject ? "加入当前内容" : "用它创建内容"}</button></aside></div></div></div>}
    </section>
  );
}
