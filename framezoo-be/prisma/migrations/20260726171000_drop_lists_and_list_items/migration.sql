-- DropForeignKey
ALTER TABLE IF EXISTS "list_items" DROP CONSTRAINT IF EXISTS "list_items_list_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "list_items";

-- DropTable
DROP TABLE IF EXISTS "lists";
