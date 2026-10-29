-- Console v3: one-time login links. Whoever adds a client (or a Console user) sends the person a
-- link; they verify their mobile, set their own password and are signed in. Nobody else ever
-- sets or sees that password. Platform table (no RLS, no app_user grant).

CREATE TYPE "access_link_kind" AS ENUM ('client_owner', 'console_member');

CREATE TABLE "access_links" (
  "id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "kind" "access_link_kind" NOT NULL,
  "user_id" UUID NOT NULL,
  -- The client workspace the owner opens (client_owner only)
  "tenant_id" UUID,
  "created_by" UUID,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "opened_at" TIMESTAMPTZ,
  "used_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "access_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "access_links_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "access_links_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);
CREATE UNIQUE INDEX "access_links_token_hash_key" ON "access_links" ("token_hash");
CREATE INDEX "access_links_user_idx" ON "access_links" ("user_id");
CREATE INDEX "access_links_tenant_idx" ON "access_links" ("tenant_id");
