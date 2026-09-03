import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBaiduMaterialService } from "../runner/baidu-materials.mjs";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Rednote operations workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>红序｜小红书个人 IP 运营与素材系统<\/title>/i);
  assert.match(html, />红序</);
  assert.doesNotMatch(html, />信息流矩阵</);
  assert.match(html, />独立业务</);
  assert.match(html, />个人 IP 运营</);
  assert.match(html, />素材中心</);
  assert.match(html, />图片设计</);
  assert.match(html, />发布草稿台</);
  assert.doesNotMatch(html, /Your site is taking shape|Starter Project/);
});

test("wires the 3:4 image editor, custom fonts, and draft export", async () => {
  const [page, editor, materialCenter, runner] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/image-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/material-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../runner/server.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /id: "designer", label: "图片设计"/);
  assert.match(page, /<ImageEditor/);
  assert.match(editor, /1080 × 1440/);
  assert.match(editor, /上传自己的字体包/);
  assert.match(editor, /AI 自动抠图/);
  assert.match(editor, /已自动保存/);
  assert.match(editor, /人物爆款封面/);
  assert.match(editor, /电影感案例/);
  assert.match(editor, /上下拼接案例/);
  assert.match(editor, /方块圆角/);
  assert.match(editor, /图片透明度/);
  assert.match(editor, /@imgly\/background-removal/);
  assert.match(editor, /保存并加入草稿/);
  assert.match(editor, /applyTemplate\("grid"\)/);
  assert.match(materialCenter, /加入内容拼装台/);
  assert.match(runner, /\/api\/design\/fonts\/upload/);
  assert.match(runner, /\/api\/designs\/project/);
  assert.match(runner, /\/api\/designs\/assets\/upload/);
  assert.match(runner, /\/api\/designs\/save/);
});

test("wires the persistent image library while retaining the Baidu cache service", async () => {
  const [page, materialCenter, runner, materialService, readme, envExample] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/material-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../runner/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../runner/baidu-materials.mjs", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className={`standalone-feature/);
  assert.match(page, /上传、打标、拼装与导出/);
  assert.match(page, /\(\["ip"\] as BusinessId\[\]\)\.map/);
  assert.match(page, /<MaterialCenter/);
  assert.match(page, /addMaterialToDraft/);
  assert.match(materialCenter, /图片素材库/);
  assert.match(materialCenter, /上传图片/);
  assert.match(materialCenter, /批量打标/);
  assert.match(materialCenter, /一键导出 ZIP/);
  assert.match(materialCenter, /满足全部标签/);
  assert.match(materialCenter, /内容拼装/);
  assert.match(materialCenter, /导出排序图片包/);
  assert.match(materialCenter, /使用记录/);
  assert.match(runner, /\/api\/library\/upload/);
  assert.match(runner, /\/api\/library\/assets\/update/);
  assert.match(runner, /\/api\/library\/assets\/export/);
  assert.match(runner, /\/api\/library\/projects/);
  assert.match(runner, /\/api\/library\/exports/);
  assert.match(runner, /\/api\/materials\/baidu\/callback/);
  assert.match(runner, /\/api\/materials\/cache/);
  assert.match(runner, /\/api\/materials\/organize/);
  assert.match(runner, /\/api\/materials\/organizer\/import-folder/);
  assert.match(runner, /\/api\/materials\/baidu\/move/);
  assert.match(materialService, /openapi\.baidu\.com\/oauth\/2\.0\/authorize/);
  assert.match(materialService, /opera", "move"/);
  assert.match(materialService, /ondup: "fail"/);
  assert.match(materialService, /material-cache/);
  assert.match(materialService, /import bundledFfmpeg from "ffmpeg-static"/);
  assert.match(materialService, /execFileAsync\(ffmpegExecutable/);
  assert.match(readme, /连接百度网盘素材库/);
  assert.match(envExample, /BAIDU_PAN_APP_KEY=/);
  assert.doesNotMatch(envExample, /BAIDU_PAN_APP_KEY=\S+/);
});

test("persists virtual folders and multiple tags without moving cloud originals", async () => {
  const state = {};
  const events = [];
  const service = createBaiduMaterialService({
    runnerDir: new URL("../runner", import.meta.url).pathname,
    port: 3100,
    getState: () => state,
    saveState: async () => {},
    logEvent: async (type, message, meta) => events.push({ type, message, meta }),
  });

  const roomFolder = await service.createVirtualFolder("客厅灵感");
  const result = await service.organize([{
    fsId: "123456789",
    name: "暖色客厅.jpg",
    path: "/素材/暖色客厅.jpg",
    isDir: false,
    size: 2048,
    modifiedAt: 1_700_000_000_000,
    mediaType: "image",
    category: 3,
  }], [roomFolder.id, "cover"], ["客厅", "暖色", "封面"]);

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].folderIds.sort(), ["cover", roomFolder.id].sort());
  assert.deepEqual(result.items[0].tags, ["客厅", "暖色", "封面"]);
  assert.equal((await service.organizer()).items[0].path, "/素材/暖色客厅.jpg");
  assert.equal(events.at(-1).meta.remoteKept, true);
});

test("creates second-level folders and recursively indexes a dragged Baidu folder", async () => {
  const originalFetch = globalThis.fetch;
  const originalAppKey = process.env.BAIDU_PAN_APP_KEY;
  const originalAppSecret = process.env.BAIDU_PAN_APP_SECRET;
  process.env.BAIDU_PAN_APP_KEY = "test-key";
  process.env.BAIDU_PAN_APP_SECRET = "test-secret";
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    const dir = requestUrl.searchParams.get("dir");
    if (dir === "/素材/整包") {
      return Response.json({ errno: 0, has_more: 0, list: [
        { fs_id: 100, server_filename: "子目录", path: "/素材/整包/子目录", isdir: 1 },
        { fs_id: 101, server_filename: "客厅.jpg", path: "/素材/整包/客厅.jpg", isdir: 0, size: 100, category: 3, server_mtime: 1 },
      ] });
    }
    return Response.json({ errno: 0, has_more: 0, list: [
      { fs_id: 102, server_filename: "讲解.mp4", path: "/素材/整包/子目录/讲解.mp4", isdir: 0, size: 200, category: 1, server_mtime: 2 },
    ] });
  };

  try {
    const state = {
      materials: {
        baidu: { accessToken: "test-token", refreshToken: "", expiresAt: Date.now() + 60_000 },
        cache: [],
        organizer: { folders: [], items: [], moveHistory: [], folderImports: [] },
      },
    };
    const events = [];
    const service = createBaiduMaterialService({
      runnerDir: new URL("../runner", import.meta.url).pathname,
      port: 3100,
      getState: () => state,
      saveState: async () => {},
      logEvent: async (type, message, meta) => events.push({ type, message, meta }),
    });
    const root = await service.createVirtualFolder("项目素材");
    const child = await service.createVirtualFolder("客厅", root.id);
    const job = await service.queueFolderImport("/素材/整包", "整包", child.id);
    for (let index = 0; index < 20 && ["queued", "running"].includes(job.status); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const data = await service.organizer();
    assert.equal(child.parentId, root.id);
    assert.equal(job.status, "completed");
    assert.equal(job.foldersScanned, 2);
    assert.equal(data.items.length, 2);
    assert.ok(data.items.every((item) => item.folderIds.includes(child.id)));
    assert.equal(events.at(-1).meta.remoteKept, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAppKey === undefined) delete process.env.BAIDU_PAN_APP_KEY;
    else process.env.BAIDU_PAN_APP_KEY = originalAppKey;
    if (originalAppSecret === undefined) delete process.env.BAIDU_PAN_APP_SECRET;
    else process.env.BAIDU_PAN_APP_SECRET = originalAppSecret;
  }
});

test("moves selected Baidu originals with confirmation and without overwriting", async () => {
  const originalFetch = globalThis.fetch;
  const originalAppKey = process.env.BAIDU_PAN_APP_KEY;
  const originalAppSecret = process.env.BAIDU_PAN_APP_SECRET;
  const requests = [];
  process.env.BAIDU_PAN_APP_KEY = "test-key";
  process.env.BAIDU_PAN_APP_SECRET = "test-secret";
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), body: String(init.body || "") });
    if (String(url).includes("method=create")) return Response.json({ errno: -8 });
    return Response.json({ errno: 0, request_id: "test-request" });
  };

  try {
    const state = {
      materials: {
        baidu: { accessToken: "test-token", refreshToken: "", expiresAt: Date.now() + 60_000 },
        cache: [],
        organizer: { folders: [], items: [], moveHistory: [] },
      },
    };
    const service = createBaiduMaterialService({
      runnerDir: new URL("../runner", import.meta.url).pathname,
      port: 3100,
      getState: () => state,
      saveState: async () => {},
      logEvent: async () => {},
    });
    const result = await service.moveRemoteItems([{
      fsId: "987654321",
      name: "客厅视频.mp4",
      path: "/素材/待整理/客厅视频.mp4",
      isDir: false,
      category: 1,
    }], "/素材/客厅", true);

    assert.equal(result.moved[0].destinationPath, "/素材/客厅/客厅视频.mp4");
    assert.match(requests[1].url, /method=filemanager/);
    assert.match(requests[1].url, /opera=move/);
    assert.match(requests[1].body, /ondup=fail/);
    assert.equal(state.materials.organizer.moveHistory[0].requestId, "test-request");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAppKey === undefined) delete process.env.BAIDU_PAN_APP_KEY;
    else process.env.BAIDU_PAN_APP_KEY = originalAppKey;
    if (originalAppSecret === undefined) delete process.env.BAIDU_PAN_APP_SECRET;
    else process.env.BAIDU_PAN_APP_SECRET = originalAppSecret;
  }
});
