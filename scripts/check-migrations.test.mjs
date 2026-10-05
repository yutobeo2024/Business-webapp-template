// Chạy: node --test scripts/check-migrations.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnmarkedDestructive } from "./check-migrations.mjs";

test("thêm bảng, thêm cột nullable, thêm index là an toàn", () => {
  const sql = `CREATE TABLE "orders" ("id" uuid PRIMARY KEY);
ALTER TABLE "users" ADD COLUMN "phone" text;
CREATE INDEX IF NOT EXISTS "orders_idx" ON "orders" ("id");`;
  assert.deepEqual(findUnmarkedDestructive(sql), []);
});

test("xóa cột, đổi tên, NOT NULL, đổi kiểu bị bắt", () => {
  assert.deepEqual(findUnmarkedDestructive('ALTER TABLE "users" DROP COLUMN "phone";'), ["DROP COLUMN"]);
  assert.deepEqual(findUnmarkedDestructive('ALTER TABLE "users" RENAME COLUMN "a" TO "b";'), ["RENAME"]);
  assert.deepEqual(findUnmarkedDestructive('ALTER TABLE "users" ALTER COLUMN "a" SET NOT NULL;'), [
    "SET NOT NULL",
  ]);
  assert.deepEqual(findUnmarkedDestructive('ALTER TABLE "users" ALTER COLUMN "a" SET DATA TYPE bigint;'), [
    "ALTER COLUMN TYPE",
  ]);
  assert.deepEqual(findUnmarkedDestructive('DROP TABLE "old";'), ["DROP TABLE"]);
});

test("cột tên type, đổi tên index, block comment không bị bắt nhầm", () => {
  assert.deepEqual(findUnmarkedDestructive(`ALTER TABLE "t" ALTER COLUMN "type" SET DEFAULT 'a';`), []);
  assert.deepEqual(findUnmarkedDestructive(`ALTER TABLE "t" ALTER COLUMN "type" DROP NOT NULL;`), []);
  assert.deepEqual(findUnmarkedDestructive(`ALTER INDEX "a_idx" RENAME TO "b_idx";`), []);
  assert.deepEqual(findUnmarkedDestructive(`/* DROP TABLE x */ CREATE TABLE "y" ("id" int);`), []);
});

test("thêm cột NOT NULL không có DEFAULT, đổi tên/xóa không có chữ COLUMN, đổi giá trị enum bị bắt", () => {
  assert.deepEqual(findUnmarkedDestructive(`ALTER TABLE "t" ADD COLUMN "a" text NOT NULL;`), [
    "ADD COLUMN NOT NULL không có DEFAULT",
  ]);
  assert.deepEqual(findUnmarkedDestructive(`ALTER TABLE "t" ADD COLUMN "a" text DEFAULT 'x' NOT NULL;`), []);
  assert.deepEqual(findUnmarkedDestructive(`ALTER TABLE "t" RENAME "a" TO "b";`), ["RENAME"]);
  assert.deepEqual(findUnmarkedDestructive(`ALTER TABLE "t" DROP "a";`), ["DROP COLUMN"]);
  assert.deepEqual(findUnmarkedDestructive(`ALTER TYPE "role" RENAME VALUE 'A' TO 'B';`), ["RENAME"]);
  assert.deepEqual(findUnmarkedDestructive(`TRUNCATE "t";`), ["TRUNCATE"]);
});

test("đã đánh dấu contract thì cho qua", () => {
  const sql = `-- contract: v1.4.0 đã ngừng đọc cột phone\nALTER TABLE "users" DROP COLUMN "phone";`;
  assert.deepEqual(findUnmarkedDestructive(sql), []);
});

test("chữ trong chú thích hoặc dữ liệu không bị bắt nhầm", () => {
  const sql = `-- sau này sẽ DROP COLUMN phone\nINSERT INTO notes VALUES ('drop table users');`;
  assert.deepEqual(findUnmarkedDestructive(sql), []);
});

test("xóa sequence, view, function: bản cũ còn dùng sẽ lỗi khi rollback", () => {
  const label = ["DROP SEQUENCE/VIEW/FUNCTION"];
  assert.deepEqual(findUnmarkedDestructive(`DROP SEQUENCE "public"."pr_code_seq";`), label);
  assert.deepEqual(findUnmarkedDestructive("DROP VIEW IF EXISTS v_report;"), label);
  assert.deepEqual(findUnmarkedDestructive("DROP FUNCTION f();"), label);
  assert.deepEqual(findUnmarkedDestructive("-- contract: v1.5.0 đã ngừng dùng\nDROP SEQUENCE s;"), []);
});
