-- The first starter list is replaced; a business left with none gets the new one on its next visit
DELETE FROM "item_categories" c
WHERE c."name" IN ('Electronics', 'Grocery & Food', 'Clothing & Apparel', 'Health & Beauty', 'Medicines & Pharma', 'Home & Kitchen', 'Furniture', 'Hardware & Tools', 'Automotive', 'Stationery & Office', 'Toys & Sports', 'Services')
  AND NOT EXISTS (SELECT 1 FROM "items" i WHERE i."category_id" = c."id");
