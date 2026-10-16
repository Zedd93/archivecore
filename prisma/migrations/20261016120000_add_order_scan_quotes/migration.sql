CREATE TABLE "order_scan_quotes" (
    "orderId" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "priceListItemId" UUID NOT NULL,
    "serviceName" VARCHAR(255) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "itemPages" JSONB NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "order_scan_quotes_pkey" PRIMARY KEY ("orderId")
);

ALTER TABLE "order_scan_quotes" ADD CONSTRAINT "order_scan_quotes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_scan_quotes" ADD CONSTRAINT "order_scan_quotes_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_scan_quotes" ADD CONSTRAINT "order_scan_quotes_priceListItemId_fkey" FOREIGN KEY ("priceListItemId") REFERENCES "price_list_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_scan_quotes" ADD CONSTRAINT "order_scan_quotes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
