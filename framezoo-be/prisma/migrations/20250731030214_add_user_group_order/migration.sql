-- CreateTable
CREATE TABLE "user_group_order" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "group_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "user_group_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_group_order_user_id_unique" ON "user_group_order"("user_id");
