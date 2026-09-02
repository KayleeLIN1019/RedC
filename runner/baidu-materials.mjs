import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import bundledFfmpeg from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);
const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".mpeg", ".mpg"]);

function extensionOf(fileName = "") {
  return path.extname(fileName).toLowerCase();
}

function mediaTypeOf(fileName = "", category) {
  const extension = extensionOf(fileName);
  if (imageExtensions.has(extension) || Number(category) === 3) return "image";
  if (videoExtensions.has(extension) || Number(category) === 1) return "video";
  return "other";
}

function contentTypeOf(fileName = "") {
  const extension = extensionOf(fileName);
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
  };
  return types[extension] || "application/octet-stream";
}

function safeFileName(value = "material") {
  const normalized = path.basename(String(value)).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-").trim();
  return normalized || "material";
}

function baiduErrorMessage(payload, fallback = "百度网盘请求失败") {
  if (!payload || (!payload.errno && !payload.error)) return "";
  const code = Number(payload.errno ?? 0);
  const messages = {
    2: "百度网盘参数错误，请检查素材目录设置",
    [-6]: "百度网盘授权已失效，请重新连接",
    [-7]: "当前百度网盘账号没有访问该文件的权限",
    [-9]: "百度网盘中的文件或目录不存在",
    111: "百度网盘授权已过期，请重新连接",
    31034: "百度网盘请求过于频繁，请稍后再试",
  };
  return messages[code] || payload.error_description || payload.error_msg || payload.errmsg || `${fallback}（${payload.errno ?? payload.error}）`;
}

function normalizeRemotePath(value, fallback = "/") {
  const input = String(value || fallback).trim();
  const normalized = path.posix.normalize(input.startsWith("/") ? input : `/${input}`);
  return normalized === "." ? "/" : normalized;
}

function uniqueStrings(values, maxLength = 40, maxItems = 30) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

export function createBaiduMaterialService({ runnerDir, port, getState, saveState, logEvent }) {
  const cacheDir = path.resolve(process.env.MATERIAL_CACHE_DIR || path.join(runnerDir, "data", "material-cache"));
  const cacheLimitGb = Math.max(1, Number(process.env.MATERIAL_CACHE_MAX_GB || 80));
  const appKey = process.env.BAIDU_PAN_APP_KEY || "";
  const appSecret = process.env.BAIDU_PAN_APP_SECRET || "";
  const redirectUri = process.env.BAIDU_PAN_REDIRECT_URI || `http://127.0.0.1:${port}/api/materials/baidu/callback`;
  const configuredRoot = normalizeRemotePath(process.env.BAIDU_PAN_ROOT_PATH || "/");
  const cacheJobs = new Set();
  const folderImportJobs = new Set();
  let ffmpegAvailable = false;
  let ffmpegExecutable = "";

  function materialState() {
    const state = getState();
    state.materials ||= {};
    state.materials.baidu ||= {
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
      userName: "",
      avatarUrl: "",
      connectedAt: "",
    };
    state.materials.cache ||= [];
    state.materials.organizer ||= {
      folders: [
        { id: "inbox", name: "待整理", color: "#78889e", parentId: "", createdAt: new Date().toISOString() },
        { id: "cover", name: "封面候选", color: "#9b745f", parentId: "", createdAt: new Date().toISOString() },
        { id: "featured", name: "精选素材", color: "#5f876f", parentId: "", createdAt: new Date().toISOString() },
      ],
      items: [],
      moveHistory: [],
      folderImports: [],
    };
    state.materials.organizer.folders ||= [];
    state.materials.organizer.items ||= [];
    state.materials.organizer.moveHistory ||= [];
    state.materials.organizer.folderImports ||= [];
    for (const folder of state.materials.organizer.folders) folder.parentId ||= "";
    return state.materials;
  }

  function organizerState() {
    return materialState().organizer;
  }

  function isInsideConfiguredRoot(remotePath) {
    const normalized = normalizeRemotePath(remotePath);
    return configuredRoot === "/" || normalized === configuredRoot || normalized.startsWith(`${configuredRoot}/`);
  }

  function publicOrganizer() {
    const organizer = organizerState();
    return {
      folders: organizer.folders,
      items: organizer.items,
      tags: [...new Set(organizer.items.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b, "zh-CN")),
      moveHistory: organizer.moveHistory.slice(0, 30),
      folderImports: organizer.folderImports.slice(0, 20),
    };
  }

  async function ready() {
    await fs.mkdir(cacheDir, { recursive: true });
    materialState();
    await saveState();
    const candidates = [...new Set([process.env.FFMPEG_PATH, bundledFfmpeg, "ffmpeg"].filter(Boolean))];
    ffmpegAvailable = false;
    ffmpegExecutable = "";
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate, ["-version"], { timeout: 5000 });
        ffmpegExecutable = candidate;
        ffmpegAvailable = true;
        break;
      } catch {
        // Continue to the next source: explicit path, bundled binary, then system PATH.
      }
    }
    for (const job of organizerState().folderImports.filter((item) => ["queued", "running"].includes(item.status))) {
      job.status = "queued";
      void runFolderImport(job);
    }
  }

  function isConfigured() {
    return Boolean(appKey && appSecret);
  }

  async function requestToken(parameters) {
    const tokenUrl = new URL("https://openapi.baidu.com/oauth/2.0/token");
    for (const [key, value] of Object.entries(parameters)) tokenUrl.searchParams.set(key, value);
    const response = await fetch(tokenUrl, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({}));
    const error = baiduErrorMessage(payload, "百度网盘授权失败");
    if (!response.ok || error || !payload.access_token) throw new Error(error || "百度网盘授权失败");
    return payload;
  }

  async function applyToken(payload) {
    const baidu = materialState().baidu;
    Object.assign(baidu, {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || baidu.refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 2_592_000) - 120) * 1000,
      connectedAt: baidu.connectedAt || new Date().toISOString(),
    });
    await saveState();
    return baidu.accessToken;
  }

  async function ensureToken() {
    if (!isConfigured()) throw new Error("请先配置百度网盘开放平台的 App Key 和 Secret Key");
    const baidu = materialState().baidu;
    if (!baidu.accessToken) throw new Error("请先连接百度网盘");
    if (baidu.expiresAt > Date.now()) return baidu.accessToken;
    if (!baidu.refreshToken) throw new Error("百度网盘授权已过期，请重新连接");
    const payload = await requestToken({
      grant_type: "refresh_token",
      refresh_token: baidu.refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    });
    return applyToken(payload);
  }

  async function baiduJson(url, fallback) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "pan.baidu.com" },
    });
    const payload = await response.json().catch(() => ({}));
    const error = baiduErrorMessage(payload, fallback);
    if (!response.ok || error) throw new Error(error || fallback);
    return payload;
  }

  async function baiduForm(url, form, fallback, allowedErrnos = []) {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "pan.baidu.com",
      },
      body: new URLSearchParams(form),
    });
    const payload = await response.json().catch(() => ({}));
    const code = Number(payload.errno ?? 0);
    if (response.ok && allowedErrnos.includes(code)) return payload;
    const error = baiduErrorMessage(payload, fallback);
    if (!response.ok || error) throw new Error(error || fallback);
    return payload;
  }

  async function refreshProfile() {
    const accessToken = await ensureToken();
    const profileUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/nas");
    profileUrl.searchParams.set("method", "uinfo");
    profileUrl.searchParams.set("access_token", accessToken);
    const profile = await baiduJson(profileUrl, "无法读取百度网盘账号信息");
    const baidu = materialState().baidu;
    baidu.userName = profile.baidu_name || profile.netdisk_name || profile.username || "百度网盘";
    baidu.avatarUrl = profile.avatar_url || "";
    await saveState();
    return baidu;
  }

  function authUrl() {
    if (!isConfigured()) throw new Error("请先在 app/.env.local 中配置百度网盘 App Key、Secret Key 和回调地址");
    const url = new URL("https://openapi.baidu.com/oauth/2.0/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", appKey);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "basic,netdisk");
    url.searchParams.set("display", "popup");
    return url.toString();
  }

  async function completeOAuth(code) {
    if (!code) throw new Error("百度网盘没有返回授权码");
    const payload = await requestToken({
      grant_type: "authorization_code",
      code,
      client_id: appKey,
      client_secret: appSecret,
      redirect_uri: redirectUri,
    });
    await applyToken(payload);
    await refreshProfile();
    await logEvent("baidu-connected", "百度网盘素材库已连接", { userName: materialState().baidu.userName });
  }

  async function disconnect() {
    materialState().baidu = {
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
      userName: "",
      avatarUrl: "",
      connectedAt: "",
    };
    await saveState();
    await logEvent("baidu-disconnected", "百度网盘素材库已断开；本机缓存保留");
  }

  async function cacheUsage() {
    const cache = materialState().cache;
    let usedBytes = 0;
    for (const item of cache) {
      if (item.status !== "cached" || !item.localPath) continue;
      const info = await fs.stat(item.localPath).catch(() => null);
      if (info?.isFile()) usedBytes += info.size;
    }
    const disk = await fs.statfs(cacheDir).catch(() => null);
    return {
      usedBytes,
      limitBytes: Math.round(cacheLimitGb * 1024 ** 3),
      diskAvailableBytes: disk ? Number(disk.bavail) * Number(disk.bsize) : null,
    };
  }

  async function status() {
    const materials = materialState();
    const connected = Boolean(materials.baidu.accessToken || materials.baidu.refreshToken);
    return {
      configured: isConfigured(),
      connected,
      userName: connected ? materials.baidu.userName : "",
      avatarUrl: connected ? materials.baidu.avatarUrl : "",
      tokenExpiresAt: connected ? materials.baidu.expiresAt : 0,
      rootPath: configuredRoot,
      cacheDir,
      cache: materials.cache.map(({ localPath, ...item }) => ({ ...item, localPath: item.status === "cached" ? localPath : "" })),
      cacheUsage: await cacheUsage(),
      ffmpegAvailable,
    };
  }

  async function remoteDirectoryPage(remoteDir, accessToken, start = 0) {
    const dir = normalizeRemotePath(remoteDir, configuredRoot);
    if (configuredRoot !== "/" && dir !== configuredRoot && !dir.startsWith(`${configuredRoot}/`)) {
      throw new Error("只能浏览已配置的百度网盘素材根目录");
    }
    const listUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    listUrl.searchParams.set("method", "list");
    listUrl.searchParams.set("access_token", accessToken);
    listUrl.searchParams.set("dir", dir);
    listUrl.searchParams.set("start", String(start));
    listUrl.searchParams.set("limit", "1000");
    listUrl.searchParams.set("order", "time");
    listUrl.searchParams.set("desc", "1");
    listUrl.searchParams.set("web", "1");
    return { dir, payload: await baiduJson(listUrl, "无法读取百度网盘素材目录") };
  }

  async function list(remoteDir = configuredRoot) {
    const accessToken = await ensureToken();
    const { dir, payload } = await remoteDirectoryPage(remoteDir, accessToken);
    const cachedByFsId = new Map(materialState().cache.filter((item) => item.fsId).map((item) => [String(item.fsId), item]));
    const organizedByFsId = new Map(organizerState().items.map((item) => [String(item.fsId), item]));
    const files = (payload.list || []).map((item) => {
      const fsId = String(item.fs_id || "");
      const mediaType = item.isdir ? "folder" : mediaTypeOf(item.server_filename, item.category);
      const cached = cachedByFsId.get(fsId);
      const organized = organizedByFsId.get(fsId);
      return {
        fsId,
        name: item.server_filename,
        path: item.path,
        isDir: Boolean(item.isdir),
        size: Number(item.size || 0),
        modifiedAt: Number(item.server_mtime || item.local_mtime || 0) * 1000,
        mediaType,
        category: Number(item.category || 0),
        cacheId: cached?.id || "",
        cacheStatus: cached?.status || "",
        localPath: cached?.status === "cached" ? cached.localPath : "",
        folderIds: organized?.folderIds || [],
        tags: organized?.tags || [],
      };
    });
    return { dir, files };
  }

  async function organizer() {
    return publicOrganizer();
  }

  async function createVirtualFolder(folderName, parentFolderId = "") {
    const name = String(folderName || "").trim();
    if (!name) throw new Error("请输入素材夹名称");
    if (name.length > 40) throw new Error("素材夹名称不能超过 40 个字");
    const organizer = organizerState();
    const parentId = String(parentFolderId || "");
    if (parentId) {
      const parent = organizer.folders.find((folder) => folder.id === parentId);
      if (!parent) throw new Error("上级虚拟素材夹不存在");
      if (parent.parentId) throw new Error("目前最多支持两级虚拟素材夹");
    }
    if (organizer.folders.some((folder) => folder.parentId === parentId && folder.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("同一级中已经有同名的虚拟素材夹");
    }
    const colors = ["#657a91", "#8a6f91", "#9b745f", "#5f876f", "#9a8558"];
    const folder = {
      id: crypto.randomUUID(),
      name,
      color: colors[organizer.folders.length % colors.length],
      parentId,
      createdAt: new Date().toISOString(),
    };
    organizer.folders.push(folder);
    await saveState();
    await logEvent("material-folder-created", `已创建虚拟素材夹：${name}`, { folderId: folder.id, parentId });
    return folder;
  }

  async function organize(items, folderIds, tags) {
    if (!Array.isArray(items) || items.length === 0) throw new Error("请先勾选要归类的素材");
    if (items.length > 200) throw new Error("单次最多归类 200 个素材");
    const organizer = organizerState();
    const validFolderIds = new Set(organizer.folders.map((folder) => folder.id));
    const normalizedFolderIds = uniqueStrings(folderIds, 80, 30).filter((id) => validFolderIds.has(id));
    const normalizedTags = uniqueStrings(tags, 20, 20);
    if (normalizedFolderIds.length === 0 && normalizedTags.length === 0) throw new Error("请选择虚拟素材夹或添加标签");
    const now = new Date().toISOString();
    const changed = [];
    for (const payload of items) {
      const fsId = String(payload.fsId || "");
      if (!/^\d+$/.test(fsId) || payload.isDir) continue;
      const remotePath = normalizeRemotePath(payload.path);
      if (!isInsideConfiguredRoot(remotePath)) throw new Error("只能归类已配置素材根目录中的文件");
      const mediaType = mediaTypeOf(payload.name, payload.category);
      if (!["image", "video"].includes(mediaType)) continue;
      let record = organizer.items.find((item) => String(item.fsId) === fsId);
      if (!record) {
        record = {
          fsId,
          name: safeFileName(payload.name),
          path: remotePath,
          isDir: false,
          size: Number(payload.size || 0),
          modifiedAt: Number(payload.modifiedAt || 0),
          mediaType,
          category: Number(payload.category || 0),
          folderIds: [],
          tags: [],
          addedAt: now,
          updatedAt: now,
        };
        organizer.items.unshift(record);
      }
      record.name = safeFileName(payload.name || record.name);
      record.path = remotePath;
      record.size = Number(payload.size || record.size || 0);
      record.modifiedAt = Number(payload.modifiedAt || record.modifiedAt || 0);
      record.mediaType = mediaType;
      record.category = Number(payload.category || record.category || 0);
      record.folderIds = uniqueStrings([...(record.folderIds || []), ...normalizedFolderIds], 80, 30);
      record.tags = uniqueStrings([...(record.tags || []), ...normalizedTags], 20, 20);
      record.updatedAt = now;
      changed.push(record);
    }
    if (changed.length === 0) throw new Error("勾选内容中没有可归类的图片或视频");
    await saveState();
    await logEvent("materials-organized", `已归类 ${changed.length} 个素材`, {
      fsIds: changed.map((item) => item.fsId),
      folderIds: normalizedFolderIds,
      tags: normalizedTags,
      remoteKept: true,
    });
    return { items: changed, organizer: publicOrganizer() };
  }

  async function runFolderImport(job) {
    if (folderImportJobs.has(job.id)) return;
    folderImportJobs.add(job.id);
    job.status = "running";
    job.error = "";
    job.updatedAt = new Date().toISOString();
    await saveState();
    try {
      const accessToken = await ensureToken();
      const pendingDirectories = [job.sourcePath];
      const visited = new Set();
      let batch = [];
      while (pendingDirectories.length) {
        const currentDir = pendingDirectories.shift();
        if (visited.has(currentDir)) continue;
        visited.add(currentDir);
        if (visited.size > 5000) throw new Error("文件夹层级或数量过多，已停止继续扫描");
        let start = 0;
        while (true) {
          const { payload } = await remoteDirectoryPage(currentDir, accessToken, start);
          const entries = Array.isArray(payload.list) ? payload.list : [];
          for (const entry of entries) {
            if (entry.isdir) {
              pendingDirectories.push(normalizeRemotePath(entry.path));
              continue;
            }
            const mediaType = mediaTypeOf(entry.server_filename, entry.category);
            if (!["image", "video"].includes(mediaType)) continue;
            job.discovered += 1;
            if (job.discovered > 50_000) throw new Error("单个文件夹最多自动归类 50,000 个图片或视频");
            batch.push({
              fsId: String(entry.fs_id || ""),
              name: entry.server_filename,
              path: entry.path,
              isDir: false,
              size: Number(entry.size || 0),
              modifiedAt: Number(entry.server_mtime || entry.local_mtime || 0) * 1000,
              mediaType,
              category: Number(entry.category || 0),
            });
            if (batch.length === 200) {
              const result = await organize(batch, [job.targetFolderId], []);
              job.added += result.items.length;
              batch = [];
              job.updatedAt = new Date().toISOString();
            }
          }
          if (entries.length < 1000 || payload.has_more === 0 || payload.has_more === false) break;
          start += entries.length;
        }
        job.foldersScanned = visited.size;
        job.updatedAt = new Date().toISOString();
        await saveState();
      }
      if (batch.length) {
        const result = await organize(batch, [job.targetFolderId], []);
        job.added += result.items.length;
      }
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      await logEvent("material-folder-imported", `已从百度网盘文件夹归类 ${job.added} 个素材`, {
        jobId: job.id,
        sourcePath: job.sourcePath,
        targetFolderId: job.targetFolderId,
        remoteKept: true,
      });
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.updatedAt = new Date().toISOString();
      await logEvent("material-folder-import-failed", `百度网盘文件夹归类未完成：${job.error}`, {
        jobId: job.id,
        sourcePath: job.sourcePath,
        targetFolderId: job.targetFolderId,
        added: job.added,
      });
    } finally {
      folderImportJobs.delete(job.id);
      await saveState();
    }
  }

  async function queueFolderImport(sourcePathInput, sourceNameInput, targetFolderIdInput) {
    const sourcePath = normalizeRemotePath(sourcePathInput);
    if (!isInsideConfiguredRoot(sourcePath)) throw new Error("只能拖入已配置素材根目录中的百度网盘文件夹");
    const targetFolderId = String(targetFolderIdInput || "");
    const organizer = organizerState();
    const targetFolder = organizer.folders.find((folder) => folder.id === targetFolderId);
    if (!targetFolder) throw new Error("目标虚拟素材夹不存在");
    if (organizer.folderImports.some((item) => item.sourcePath === sourcePath && item.targetFolderId === targetFolderId && ["queued", "running"].includes(item.status))) {
      throw new Error("这个百度网盘文件夹正在归类到该素材夹");
    }
    await ensureToken();
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID(),
      sourcePath,
      sourceName: safeFileName(sourceNameInput || path.posix.basename(sourcePath)),
      targetFolderId,
      targetFolderName: targetFolder.name,
      status: "queued",
      discovered: 0,
      added: 0,
      foldersScanned: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: "",
      error: "",
    };
    organizer.folderImports.unshift(job);
    organizer.folderImports = organizer.folderImports.slice(0, 100);
    await saveState();
    await logEvent("material-folder-import-queued", `开始整理百度网盘文件夹：${job.sourceName}`, {
      jobId: job.id,
      sourcePath,
      targetFolderId,
      remoteKept: true,
    });
    void runFolderImport(job);
    return job;
  }

  async function createRemoteFolder(destination, accessToken) {
    const createUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    createUrl.searchParams.set("method", "create");
    createUrl.searchParams.set("access_token", accessToken);
    return baiduForm(createUrl, {
      path: destination,
      size: "0",
      isdir: "1",
      rtype: "1",
      block_list: "[]",
    }, "无法创建百度网盘目标文件夹", [-8]);
  }

  async function moveRemoteItems(items, destinationInput, confirmed = false) {
    if (!confirmed) throw new Error("移动百度网盘原件前需要再次确认");
    if (!Array.isArray(items) || items.length === 0) throw new Error("请先勾选要移动的素材");
    if (items.length > 50) throw new Error("为保证安全，单次最多移动 50 个百度网盘原件");
    const destination = normalizeRemotePath(destinationInput);
    if (!isInsideConfiguredRoot(destination)) throw new Error("目标文件夹必须位于已配置的百度网盘素材根目录内");
    const moveItems = items.map((item) => {
      const sourcePath = normalizeRemotePath(item.path);
      if (!/^\d+$/.test(String(item.fsId || "")) || item.isDir) throw new Error("只能移动已勾选的图片或视频原件");
      if (!isInsideConfiguredRoot(sourcePath)) throw new Error("只能移动已配置素材根目录中的文件");
      const mediaType = mediaTypeOf(item.name, item.category);
      if (!["image", "video"].includes(mediaType)) throw new Error("只能移动图片或视频素材");
      return {
        fsId: String(item.fsId),
        name: safeFileName(item.name || path.posix.basename(sourcePath)),
        sourcePath,
      };
    });
    if (moveItems.some((item) => path.posix.dirname(item.sourcePath) === destination)) {
      throw new Error("部分素材已经在目标文件夹中，请更换目标文件夹");
    }
    const accessToken = await ensureToken();
    await createRemoteFolder(destination, accessToken);
    const moveUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    moveUrl.searchParams.set("method", "filemanager");
    moveUrl.searchParams.set("access_token", accessToken);
    moveUrl.searchParams.set("opera", "move");
    const payload = await baiduForm(moveUrl, {
      async: "0",
      ondup: "fail",
      filelist: JSON.stringify(moveItems.map((item) => ({
        path: item.sourcePath,
        dest: destination,
        newname: item.name,
      }))),
    }, "移动百度网盘原件失败");
    const movedAt = new Date().toISOString();
    const organizer = organizerState();
    const moved = moveItems.map((item) => {
      const destinationPath = normalizeRemotePath(path.posix.join(destination, item.name));
      const record = organizer.items.find((candidate) => String(candidate.fsId) === item.fsId);
      if (record) {
        record.path = destinationPath;
        record.updatedAt = movedAt;
      }
      const cached = materialState().cache.find((candidate) => String(candidate.fsId) === item.fsId);
      if (cached) cached.remotePath = destinationPath;
      return { ...item, destinationPath };
    });
    const history = {
      id: crypto.randomUUID(),
      destination,
      count: moved.length,
      items: moved,
      movedAt,
      requestId: payload.request_id || "",
    };
    organizer.moveHistory.unshift(history);
    organizer.moveHistory = organizer.moveHistory.slice(0, 100);
    await saveState();
    await logEvent("baidu-materials-moved", `已移动 ${moved.length} 个百度网盘原件`, {
      destination,
      fsIds: moved.map((item) => item.fsId),
      overwrite: false,
    });
    return { moved, history, organizer: publicOrganizer() };
  }

  async function fileMeta(fsId, { dlink = false, thumb = false } = {}) {
    if (!/^\d+$/.test(String(fsId))) throw new Error("素材编号无效");
    const accessToken = await ensureToken();
    const metaUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/multimedia");
    metaUrl.searchParams.set("method", "filemetas");
    metaUrl.searchParams.set("access_token", accessToken);
    metaUrl.searchParams.set("fsids", JSON.stringify([Number(fsId)]));
    metaUrl.searchParams.set("dlink", dlink ? "1" : "0");
    metaUrl.searchParams.set("thumb", thumb ? "1" : "0");
    metaUrl.searchParams.set("extra", "1");
    metaUrl.searchParams.set("needmedia", "1");
    const payload = await baiduJson(metaUrl, "无法读取素材详情");
    const item = payload.list?.[0];
    if (!item) throw new Error("百度网盘中没有找到该素材");
    return { item, accessToken };
  }

  async function thumbnail(fsId) {
    const { item } = await fileMeta(fsId, { thumb: true });
    const source = item.thumbs?.url3 || item.thumbs?.url2 || item.thumbs?.url1 || item.thumbs?.icon;
    if (!source) throw new Error("该素材没有可用缩略图");
    const response = await fetch(source, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "pan.baidu.com" },
    });
    if (!response.ok) throw new Error("缩略图读取失败");
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "image/jpeg",
    };
  }

  function cacheRecordById(id) {
    return materialState().cache.find((item) => item.id === id);
  }

  async function downloadRecord(record) {
    const partialPath = `${record.localPath}.part`;
    try {
      const usage = await cacheUsage();
      if (usage.usedBytes + Number(record.size || 0) > usage.limitBytes) {
        throw new Error("本机素材缓存空间不足，请先清理缓存或调大缓存上限");
      }
      if (usage.diskAvailableBytes !== null && Number(record.size || 0) + 1024 ** 3 > usage.diskAvailableBytes) {
        throw new Error("本机磁盘剩余空间不足，已停止下载素材");
      }

      const { item, accessToken } = await fileMeta(record.fsId, { dlink: true });
      if (!item.dlink) throw new Error("百度网盘没有返回素材下载地址");
      const downloadUrl = new URL(item.dlink);
      if (!downloadUrl.searchParams.has("access_token")) downloadUrl.searchParams.set("access_token", accessToken);
      const partialInfo = await fs.stat(partialPath).catch(() => null);
      const startAt = partialInfo?.isFile() ? partialInfo.size : 0;
      const headers = { "User-Agent": "pan.baidu.com" };
      if (startAt > 0) headers.Range = `bytes=${startAt}-`;
      const response = await fetch(downloadUrl, { headers, signal: AbortSignal.timeout(30 * 60_000) });
      if (!response.ok && response.status !== 206) throw new Error(`百度网盘素材下载失败（${response.status}）`);
      if (!response.body) throw new Error("百度网盘没有返回素材内容");
      const append = startAt > 0 && response.status === 206;
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath, { flags: append ? "a" : "w" }));
      await fs.rename(partialPath, record.localPath);
      const finalInfo = await fs.stat(record.localPath);
      record.size = finalInfo.size;
      record.status = "cached";
      record.cachedAt = new Date().toISOString();
      record.error = "";
      await logEvent("material-cached", `素材已缓存：${record.name}`, { cacheId: record.id, fsId: record.fsId });
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      await logEvent("material-cache-failed", record.error, { cacheId: record.id, fsId: record.fsId });
    } finally {
      cacheJobs.delete(record.id);
      await saveState();
    }
  }

  async function queueCache(payload) {
    const fsId = String(payload.fsId || "");
    if (!/^\d+$/.test(fsId)) throw new Error("请选择有效的百度网盘素材");
    const mediaType = mediaTypeOf(payload.name, payload.category);
    if (!['image', 'video'].includes(mediaType)) throw new Error("当前只支持缓存图片和视频素材");
    let record = materialState().cache.find((item) => String(item.fsId) === fsId);
    if (!record) {
      const id = crypto.randomUUID();
      const fileName = `${fsId}-${safeFileName(payload.name)}`;
      record = {
        id,
        fsId,
        remotePath: normalizeRemotePath(payload.path),
        name: safeFileName(payload.name),
        mediaType,
        size: Number(payload.size || 0),
        status: "queued",
        localPath: path.join(cacheDir, fileName),
        createdAt: new Date().toISOString(),
        cachedAt: "",
        error: "",
        source: "baidu",
      };
      materialState().cache.unshift(record);
    }
    const existing = await fs.stat(record.localPath).catch(() => null);
    if (existing?.isFile()) {
      record.status = "cached";
      record.size = existing.size;
      record.cachedAt ||= new Date().toISOString();
      record.error = "";
      await saveState();
      return record;
    }
    if (!cacheJobs.has(record.id)) {
      record.status = "downloading";
      record.error = "";
      cacheJobs.add(record.id);
      await saveState();
      void downloadRecord(record);
    }
    return record;
  }

  async function removeCache(id) {
    const record = cacheRecordById(id);
    if (!record) throw new Error("本机缓存记录不存在");
    if (cacheJobs.has(id)) throw new Error("素材正在下载，请完成后再清理");
    await fs.unlink(record.localPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await fs.unlink(`${record.localPath}.part`).catch(() => {});
    materialState().cache = materialState().cache.filter((item) => item.id !== id);
    await saveState();
    await logEvent("material-cache-removed", `已清理本机缓存：${record.name}`, { cacheId: id, remoteKept: true });
  }

  async function extractFrame(id, timestamp, business = "shared") {
    const record = cacheRecordById(id);
    if (!record || record.status !== "cached") throw new Error("请先把视频缓存到本机");
    if (record.mediaType !== "video") throw new Error("只有视频素材可以截帧");
    if (!ffmpegAvailable || !ffmpegExecutable) throw new Error("FFmpeg 视频处理组件不可用，暂时无法从视频截帧");
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("请输入有效的截帧时间");
    const frameId = crypto.randomUUID();
    const baseName = safeFileName(path.basename(record.name, path.extname(record.name)));
    const outputPath = path.join(cacheDir, `${record.fsId || record.id}-${baseName}-frame-${Math.round(seconds * 1000)}.jpg`);
    await execFileAsync(ffmpegExecutable, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seconds),
      "-i",
      record.localPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-y",
      outputPath,
    ], { timeout: 120_000 });
    const info = await fs.stat(outputPath);
    const frame = {
      id: frameId,
      fsId: "",
      remotePath: record.remotePath,
      name: `${baseName} · ${seconds.toFixed(1)}秒截帧.jpg`,
      mediaType: "image",
      size: info.size,
      status: "cached",
      localPath: outputPath,
      createdAt: new Date().toISOString(),
      cachedAt: new Date().toISOString(),
      error: "",
      source: "frame",
      parentId: record.id,
      timestamp: seconds,
      business: ["feed", "ip"].includes(business) ? business : "shared",
    };
    materialState().cache.unshift(frame);
    await saveState();
    await logEvent("material-frame-created", `已从视频截取画面：${frame.name}`, { cacheId: frame.id, parentId: record.id });
    return frame;
  }

  async function cachedFile(id) {
    const record = cacheRecordById(id);
    if (!record || record.status !== "cached") throw new Error("本机缓存文件不存在");
    const info = await fs.stat(record.localPath).catch(() => null);
    if (!info?.isFile()) throw new Error("本机缓存文件已被移动或删除");
    return {
      stream: createReadStream(record.localPath),
      contentType: contentTypeOf(record.localPath),
      size: info.size,
      name: record.name,
    };
  }

  return {
    ready,
    status,
    authUrl,
    completeOAuth,
    disconnect,
    list,
    organizer,
    createVirtualFolder,
    organize,
    queueFolderImport,
    moveRemoteItems,
    thumbnail,
    queueCache,
    removeCache,
    extractFrame,
    cachedFile,
  };
}
