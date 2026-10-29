-- Console v3 pricing: the Free plan is 2 users with CRM, products, billing (100 invoices a
-- month) and tasks. Existing plan rows are not overwritten by the seed, so update it here.
UPDATE "plans"
SET "limits" = jsonb_set("limits", '{users}', '2'),
    "tagline" = 'CRM, products, billing and tasks — free forever'
WHERE "key" = 'free';
