-- Console v3 pricing (option A): Free + Standard + Professional + Enterprise, extra users only.
-- Only the Free plan's modules are free-tier, and every paid plan includes them, so no client
-- sees a "basic" and a "full" version of a module. The new plans and prices are added by the
-- seed (catalog sync); this migration only retires the old plans and fixes the module flags.

UPDATE "modules" SET "is_free_tier" = ("key" IN ('crm', 'catalog', 'billing', 'tasks'));

-- Plans sold before Console v3 stay for the clients on them, but are no longer offered
UPDATE "plans" SET "is_public" = false WHERE "key" IN ('starter', 'growth', 'business_pro');

-- Trial now runs 14 days on Professional: drop stored overrides that point at the old trial plan
DELETE FROM "config_values" WHERE "scope" = 'platform' AND "key" = 'trial.plan_key' AND "value" #>> '{}' IN ('growth', 'starter', 'business_pro');
DELETE FROM "config_values" WHERE "scope" = 'platform' AND "key" = 'trial.limits';
