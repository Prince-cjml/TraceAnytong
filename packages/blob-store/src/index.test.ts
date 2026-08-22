import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBlobStore } from "./index.ts";

test("memory blob store only returns URLs for registered immutable object IDs", async () => {
  const store = new MemoryBlobStore();
  assert.equal(await store.createUploadUrl(), "memory://upload/1");
  assert.equal(await store.getDownloadUrl("source-1"), null);
  store.register("source-1");
  assert.equal(await store.getDownloadUrl("source-1"), "memory://download/source-1");
  await store.delete("source-1");
  assert.equal(await store.getDownloadUrl("source-1"), null);
});
