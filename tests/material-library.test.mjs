import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMaterialLibrary } from "../runner/material-library.mjs";

const pixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("uploads, deduplicates, labels, assembles, tracks usage, and exports images", async (context) => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "rednote-library-test-"));
  context.after(async () => fs.rm(testDir, { recursive: true, force: true }));
  const fixedNow = new Date("2026-09-03T08:00:00.000Z");
  const library = createMaterialLibrary({ runnerDir: testDir, libraryDir: path.join(testDir, "library"), now: () => fixedNow });
  await library.ready();

  const first = await library.upload("客厅主图.png", pixelPng, "main");
  const duplicate = await library.upload("重复图片.png", pixelPng, "secondary");
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.asset.id, duplicate.asset.id);

  const group = await library.createTagGroup("测试空间", "#72917f");
  const tag = await library.createTag("客厅", group.id);
  await library.updateAssets({ ids: [first.asset.id], addTagIds: [tag.id], defaultRole: "main" });
  const project = await library.upsertProject({ title: "客厅避坑测试内容", business: "feed", status: "completed", assetIds: [first.asset.id] });

  const data = await library.data();
  assert.equal(data.assets.length, 1);
  assert.deepEqual(data.assets[0].tagIds, [tag.id]);
  assert.equal(data.assets[0].defaultRole, "main");
  assert.equal(data.assets[0].usageCount, 1);
  assert.equal(data.assets[0].usages[0].title, "客厅避坑测试内容");
  assert.equal(data.assets[0].usages[0].role, "main");

  const exported = await library.exportProject(project.id);
  assert.equal(exported.count, 1);
  const zip = await library.exportFile(exported.zipName);
  assert.ok(zip.size > 0);
  assert.match(zip.name, /客厅避坑测试内容/);
});
