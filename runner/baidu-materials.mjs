import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

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

export function createBaiduMaterialService({ runnerDir, port, getState, saveState, logEvent }) {
  const cacheDir = path.resolve(process.env.MATERIAL_CACHE_DIR || path.join(runnerDir, "data", "material-cache"));
  const cacheLimitGb = Math.max(1, Number(process.env.MATERIAL_CACHE_MAX_GB || 80));
  const appKey = process.env.BAIDU_PAN_APP_KEY || "";
  const appSecret = process.env.BAIDU_PAN_APP_SECRET || "";
  const redirectUri = process.env.BAIDU_PAN_REDIRECT_URI || `http://127.0.0.1:${port}/api/materials/baidu/callback`;
  const configuredRoot = normalizeRemotePath(process.env.BAIDU_PAN_ROOT_PATH || "/");
  const cacheJobs = new Set();
  let ffmpegAvailable = false;

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
    return state.materials;
  }

  async function ready() {
    await fs.mkdir(cacheDir, { recursive: true });
    materialState();
    await saveState();
    try {
      await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
      ffmpegAvailable = true;
    } catch {
      ffmpegAvailable = false;
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

  async function list(remoteDir = configuredRoot) {
    const accessToken = await ensureToken();
    const dir = normalizeRemotePath(remoteDir, configuredRoot);
    const listUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    listUrl.searchParams.set("method", "list");
    listUrl.searchParams.set("access_token", accessToken);
    listUrl.searchParams.set("dir", dir);
    listUrl.searchParams.set("start", "0");
    listUrl.searchParams.set("limit", "1000");
    listUrl.searchParams.set("order", "time");
    listUrl.searchParams.set("desc", "1");
    listUrl.searchParams.set("web", "1");
    const payload = await baiduJson(listUrl, "无法读取百度网盘素材目录");
    const cachedByFsId = new Map(materialState().cache.filter((item) => item.fsId).map((item) => [String(item.fsId), item]));
    const files = (payload.list || []).map((item) => {
      const fsId = String(item.fs_id || "");
      const mediaType = item.isdir ? "folder" : mediaTypeOf(item.server_filename, item.category);
      const cached = cachedByFsId.get(fsId);
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
      };
    });
    return { dir, files };
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
    if (!ffmpegAvailable) throw new Error("本机尚未安装 FFmpeg，暂时无法从视频截帧");
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("请输入有效的截帧时间");
    const frameId = crypto.randomUUID();
    const baseName = safeFileName(path.basename(record.name, path.extname(record.name)));
    const outputPath = path.join(cacheDir, `${record.fsId || record.id}-${baseName}-frame-${Math.round(seconds * 1000)}.jpg`);
    await execFileAsync("ffmpeg", [
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
    thumbnail,
    queueCache,
    removeCache,
    extractFrame,
    cachedFile,
  };
}
