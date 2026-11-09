-- Every business gets the standard categories, beside any of its own
INSERT INTO "item_categories" ("id", "tenant_id", "name")
SELECT gen_random_uuid(), t."id", c.name
FROM "tenants" t
CROSS JOIN (VALUES ('Sports & Fitness'), ('Food & Beverages'), ('Automotive & Tools'), ('Electronics & Technology'), ('Jewelry & Accessories'), ('Fruits & Vegetables'), ('Books & Stationery'), ('Home & Garden'), ('Health & Beauty'), ('Fashion & Apparel')) AS c(name)
ON CONFLICT ("tenant_id", "name") DO NOTHING;
