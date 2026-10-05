ALTER TABLE "roles" ADD COLUMN "default_key" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "synced_default_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_default_key_uq" ON "roles" USING btree ("default_key");