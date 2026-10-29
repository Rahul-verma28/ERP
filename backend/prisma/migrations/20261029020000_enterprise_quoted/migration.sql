-- Console v3 pricing: Enterprise has no list price — an Admin quotes it. End the old price rows
-- (kept for history) and bring the plan's description in line.
UPDATE "prices" SET "active_to" = now() WHERE "item_type" = 'plan' AND "item_ref" = 'enterprise' AND "active_to" IS NULL;
UPDATE "plans" SET "tagline" = 'Any users and branches, every module including AI — quoted by AHEAD' WHERE "key" = 'enterprise';
