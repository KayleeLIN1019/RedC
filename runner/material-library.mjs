import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";

const execFileAsync = promisify(execFile);

const defaultGroups = [
  { id: "usage", name: "图片用途", color: "#dc6a54", createdAt: new Date(0).toISOString() },
  { id: "topic", name: "内容主题", color: "#7287a6", createdAt: new Date(0).toISOString() },
  { id: "space", name: "空间类型", color: "#72917f", createdAt: new Date(0).toISOString() },
  { id: "style", name: "视觉风格", color: "#9b7d9c", createdAt: new Date(0).toISOString() },
];

function cleanName(value, fallback = "未命名") {
  return String(value || fallback).trim().replace(/[\u0000-\u001f]/g, "").slice(0, 80) || fallback;
}

function safeFileName(value, fallback = "image.jpg") {
  const fileName = path.basename(String(value || fallback)).replace(/[^\p{L}\p{N}._-]+/gu, "-");
  return fileName.slice(0, 120) || fallback;
}

function contentTypeOf(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

function freshState() {
  return {
    version: 1,
    tagGroups: defaultGroups.map((group) => ({ ...group })),
    tags: [],
    assets: [],
    projects: [],
  };
}

function normalizeState(value) {
  const base = freshState();
  if (!value || typeof value !== "object") return base;
  return {
    version: 1,
    tagGroups: Array.isArray(value.tagGroups) && value.tagGroups.length ? value.tagGroups : base.tagGroups,
    tags: Array.isArray(value.tags) ? value.tags : [],
    assets: Array.isArray(value.assets) ? value.assets : [],
    projects: Array.isArray(value.projects) ? value.projects.map((project) => ({
      ...project,
      items: Array.isArray(project.items)
        ? project.items
        : Array.isArray(project.assetIds)
          ? project.assetIds.map((assetId, index) => ({ assetId, role: index === 0 ? "main" : "secondary" }))
          : [],
    })) : [],
  };
}

export function createMaterialLibrary({ runnerDir, libraryDir: configuredLibraryDir, now = () => new Date() }) {
  const libraryDir = configuredLibraryDir || process.env.MATERIAL_LIBRARY_DIR || path.join(runnerDir, "data", "material-library");
  const originalsDir = path.join(libraryDir, "originals");
  const thumbnailsDir = path.join(libraryDir, "thumbnails");
  const exportsDir = path.join(libraryDir, "exports");
  const statePath = path.join(libraryDir, "library.json");
  let state = freshState();
  let mutationQueue = Promise.resolve();

  function mutate(task) {
    const result = mutationQueue.then(task);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function save() {
    const temporaryPath = `${statePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temporaryPath, statePath);
  }

  async function ready() {
    await Promise.all([
      fs.mkdir(originalsDir, { recursive: true }),
      fs.mkdir(thumbnailsDir, { recursive: true }),
      fs.mkdir(exportsDir, { recursive: true }),
    ]);
    try {
      state = normalizeState(JSON.parse(await fs.readFile(statePath, "utf8")));
    } catch {
      await save();
    }
    return publicData();
  }

  function assetUsage(assetId) {
    return state.projects.flatMap((project) => project.items
      .map((item, index) => item.assetId === assetId ? ({
        projectId: project.id,
        title: project.title,
        position: index + 1,
        role: index === 0 ? "main" : "secondary",
        updatedAt: project.updatedAt,
      }) : null)
      .filter(Boolean));
  }

  function publicData() {
    const assets = state.assets
      .filter((asset) => !asset.archivedAt)
      .map((asset) => {
        const usages = assetUsage(asset.id);
        return { ...asset, usages, usageCount: usages.length };
      })
      .sort((left, right) => String(right.uploadedAt).localeCompare(String(left.uploadedAt)));
    const tags = state.tags.map((tag) => ({
      ...tag,
      assetCount: assets.filter((asset) => (asset.tagIds || []).includes(tag.id)).length,
    }));
    const usedBytes = assets.reduce((total, asset) => total + Number(asset.size || 0), 0);
    return {
      storage: { mode: "local", libraryDir, usedBytes },
      tagGroups: state.tagGroups,
      tags,
      assets,
      projects: state.projects.slice().sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))),
    };
  }

  async function imageDimensions(filePath) {
    try {
      const { stdout } = await execFileAsync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath]);
      return {
        width: Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1] || 0),
        height: Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1] || 0),
      };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  async function createThumbnail(sourcePath, assetId) {
    const thumbnailName = `${assetId}.jpg`;
    const thumbnailPath = path.join(thumbnailsDir, thumbnailName);
    try {
      await execFileAsync("/usr/bin/sips", ["-Z", "560", "-s", "format", "jpeg", "-s", "formatOptions", "78", sourcePath, "--out", thumbnailPath]);
      return thumbnailName;
    } catch {
      return "";
    }
  }

  async function upload(requestedName, payload, defaultRole = "unspecified") {
    const name = safeFileName(requestedName);
    if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) throw new Error("仅支持 PNG、JPG、WEBP 或 GIF 图片");
    if (!Buffer.isBuffer(payload) || !payload.length) throw new Error("上传图片为空");
    const checksum = crypto.createHash("sha256").update(payload).digest("hex");
    const duplicate = state.assets.find((asset) => asset.checksum === checksum && !asset.archivedAt);
    if (duplicate) return { asset: { ...duplicate, usages: assetUsage(duplicate.id), usageCount: assetUsage(duplicate.id).length }, duplicate: true };

    const id = crypto.randomUUID();
    const extension = path.extname(name).toLowerCase() === ".jpeg" ? ".jpg" : path.extname(name).toLowerCase();
    const storedName = `${id}${extension}`;
    const storedPath = path.join(originalsDir, storedName);
    await fs.writeFile(storedPath, payload);
    const dimensions = await imageDimensions(storedPath);
    const thumbnailName = await createThumbnail(storedPath, id);
    const timestamp = now().toISOString();
    const asset = {
      id,
      name,
      storedName,
      thumbnailName,
      checksum,
      mimeType: contentTypeOf(name),
      size: payload.length,
      width: dimensions.width,
      height: dimensions.height,
      defaultRole: ["main", "secondary"].includes(defaultRole) ? defaultRole : "unspecified",
      tagIds: [],
      note: "",
      source: "本地上传",
      uploadedAt: timestamp,
      updatedAt: timestamp,
    };
    state.assets.unshift(asset);
    await save();
    return { asset: { ...asset, usages: [], usageCount: 0 }, duplicate: false };
  }

  async function fileForAsset(assetId, thumbnail = false) {
    if (!/^[a-f0-9-]+$/i.test(assetId)) throw new Error("素材编号不正确");
    const asset = state.assets.find((candidate) => candidate.id === assetId && !candidate.archivedAt);
    if (!asset) throw new Error("图片素材不存在");
    const useThumbnail = thumbnail && asset.thumbnailName;
    const filePath = useThumbnail ? path.join(thumbnailsDir, asset.thumbnailName) : path.join(originalsDir, asset.storedName);
    const stats = await fs.stat(filePath);
    return {
      name: useThumbnail ? `${path.parse(asset.name).name}-thumb.jpg` : asset.name,
      contentType: useThumbnail ? "image/jpeg" : asset.mimeType,
      size: stats.size,
      stream: createReadStream(filePath),
      path: filePath,
    };
  }

  async function createTagGroup(name, color = "#7287a6") {
    const normalized = cleanName(name, "");
    if (!normalized) throw new Error("标签组名称不能为空");
    if (state.tagGroups.some((group) => group.name === normalized)) throw new Error("已经存在同名标签组");
    const group = { id: crypto.randomUUID(), name: normalized, color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#7287a6", createdAt: now().toISOString() };
    state.tagGroups.push(group);
    await save();
    return group;
  }

  async function createTag(name, groupId) {
    const normalized = cleanName(name, "");
    if (!normalized) throw new Error("标签名称不能为空");
    if (!state.tagGroups.some((group) => group.id === groupId)) throw new Error("标签组不存在");
    if (state.tags.some((tag) => tag.name === normalized && tag.groupId === groupId && tag.active !== false)) throw new Error("标签组中已经存在同名标签");
    const tag = { id: crypto.randomUUID(), name: normalized, groupId, active: true, createdAt: now().toISOString() };
    state.tags.push(tag);
    await save();
    return tag;
  }

  async function updateTag(tagId, patch) {
    const tag = state.tags.find((candidate) => candidate.id === tagId);
    if (!tag) throw new Error("标签不存在");
    if (patch.name !== undefined) {
      const normalized = cleanName(patch.name, "");
      if (!normalized) throw new Error("标签名称不能为空");
      if (state.tags.some((candidate) => candidate.id !== tagId && candidate.groupId === tag.groupId && candidate.name === normalized && candidate.active !== false)) throw new Error("标签组中已经存在同名标签");
      tag.name = normalized;
    }
    if (patch.active !== undefined) tag.active = Boolean(patch.active);
    if (patch.mergeIntoId) {
      const target = state.tags.find((candidate) => candidate.id === patch.mergeIntoId && candidate.id !== tagId);
      if (!target) throw new Error("合并目标标签不存在");
      for (const asset of state.assets) {
        if (!(asset.tagIds || []).includes(tagId)) continue;
        asset.tagIds = [...new Set(asset.tagIds.map((id) => id === tagId ? target.id : id))];
      }
      tag.active = false;
    }
    await save();
    return tag;
  }

  async function updateAssets(payload) {
    const ids = [...new Set(Array.isArray(payload.ids) ? payload.ids : [])];
    if (!ids.length) throw new Error("请至少选择一张图片");
    const addTagIds = (Array.isArray(payload.addTagIds) ? payload.addTagIds : []).filter((id) => state.tags.some((tag) => tag.id === id && tag.active !== false));
    const removeTagIds = new Set(Array.isArray(payload.removeTagIds) ? payload.removeTagIds : []);
    const changed = [];
    for (const asset of state.assets) {
      if (!ids.includes(asset.id) || asset.archivedAt) continue;
      asset.tagIds = [...new Set([...(asset.tagIds || []).filter((id) => !removeTagIds.has(id)), ...addTagIds])];
      if (["main", "secondary", "unspecified"].includes(payload.defaultRole)) asset.defaultRole = payload.defaultRole;
      if (payload.note !== undefined && ids.length === 1) asset.note = cleanName(payload.note, "").slice(0, 300);
      if (payload.source !== undefined && ids.length === 1) asset.source = cleanName(payload.source, "本地上传");
      asset.updatedAt = now().toISOString();
      changed.push(asset.id);
    }
    if (!changed.length) throw new Error("没有找到可以更新的图片");
    await save();
    return changed;
  }

  async function upsertProject(payload) {
    const title = cleanName(payload.title, "");
    if (!title) throw new Error("内容标题不能为空");
    const assetIds = [...new Set(Array.isArray(payload.assetIds) ? payload.assetIds : [])]
      .filter((id) => state.assets.some((asset) => asset.id === id && !asset.archivedAt));
    if (!assetIds.length) throw new Error("请至少选择一张图片");
    const timestamp = now().toISOString();
    let project = payload.id ? state.projects.find((candidate) => candidate.id === payload.id) : null;
    if (!project) {
      project = { id: crypto.randomUUID(), title, business: payload.business === "ip" ? "ip" : "feed", status: "draft", items: [], createdAt: timestamp, updatedAt: timestamp };
      state.projects.unshift(project);
    }
    project.title = title;
    project.business = payload.business === "ip" ? "ip" : project.business || "feed";
    project.status = payload.status === "completed" ? "completed" : "draft";
    project.items = assetIds.map((assetId, index) => ({ assetId, role: index === 0 ? "main" : "secondary" }));
    project.updatedAt = timestamp;
    await save();
    return project;
  }

  async function exportProject(projectId) {
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("内容项目不存在");
    const timestamp = now().toISOString().replace(/[:.]/g, "-");
    const folderName = `${safeFileName(project.title, "小红书内容").replace(/\.[^.]+$/, "")}-${timestamp}`;
    const targetDir = path.join(exportsDir, folderName);
    await fs.mkdir(targetDir, { recursive: true });
    const copied = [];
    for (let index = 0; index < project.items.length; index += 1) {
      const relation = project.items[index];
      const asset = state.assets.find((candidate) => candidate.id === relation.assetId && !candidate.archivedAt);
      if (!asset) continue;
      const extension = path.extname(asset.storedName).toLowerCase() || ".jpg";
      const roleName = index === 0 ? "主图" : "次图";
      const outputName = `${String(index + 1).padStart(2, "0")}-${roleName}${extension}`;
      await fs.copyFile(path.join(originalsDir, asset.storedName), path.join(targetDir, outputName));
      copied.push(outputName);
    }
    if (!copied.length) throw new Error("内容项目中没有可导出的图片");
    const zipName = `${folderName}.zip`;
    const zipPath = path.join(exportsDir, zipName);
    await execFileAsync("/usr/bin/zip", ["-q", "-j", zipPath, ...copied.map((name) => path.join(targetDir, name))]);
    return { zipName, folderPath: targetDir, count: copied.length };
  }

  async function exportFile(fileName) {
    const safeName = path.basename(fileName);
    if (safeName !== fileName || !safeName.endsWith(".zip")) throw new Error("导出文件不存在");
    const filePath = path.join(exportsDir, safeName);
    const stats = await fs.stat(filePath);
    return { name: safeName, contentType: "application/zip", size: stats.size, stream: createReadStream(filePath), path: filePath };
  }

  return {
    ready,
    data: async () => publicData(),
    upload: (...args) => mutate(() => upload(...args)),
    fileForAsset,
    createTagGroup: (...args) => mutate(() => createTagGroup(...args)),
    createTag: (...args) => mutate(() => createTag(...args)),
    updateTag: (...args) => mutate(() => updateTag(...args)),
    updateAssets: (...args) => mutate(() => updateAssets(...args)),
    upsertProject: (...args) => mutate(() => upsertProject(...args)),
    exportProject,
    exportFile,
  };
}
