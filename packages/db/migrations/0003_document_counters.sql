CREATE TABLE "document_counters" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "document_counters_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
-- Nạp bộ đếm từ mã đã có (dự án nâng từ 1.3.x có phiếu mã PR-YYYY-NNNNNN): số mới tiếp nối, không trùng mã cũ.
-- Dự án đã gỡ module mẫu thì không có bảng phiếu: bỏ qua.
DO $$
BEGIN
  IF to_regclass('public.purchase_requests') IS NOT NULL THEN
    INSERT INTO "document_counters" ("prefix", "year", "last")
    SELECT 'PR', split_part("code", '-', 2)::int, max(split_part("code", '-', 3)::int)
    FROM "purchase_requests" WHERE "code" ~ '^PR-[0-9]{4}-[0-9]+$'
    GROUP BY 2
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
-- Sequence cũ "pr_code_seq" (nếu có) GIỮ LẠI: rollback image về 1.3.x vẫn lập phiếu được. Xóa ở một migration contract
-- của bản sau, khi chắc không quay về 1.3.x: DROP SEQUENCE IF EXISTS "public"."pr_code_seq";
