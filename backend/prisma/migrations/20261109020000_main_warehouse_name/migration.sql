-- The product now says warehouse, not godown
UPDATE "stock_locations" SET "name" = 'Main warehouse' WHERE "name" = 'Main godown';
