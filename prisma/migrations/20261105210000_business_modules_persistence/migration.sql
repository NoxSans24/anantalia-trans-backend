CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "bookingCode" VARCHAR(20) NOT NULL,
    "customerName" VARCHAR(150) NOT NULL,
    "whatsappPhone" VARCHAR(20) NOT NULL,
    "categoryId" VARCHAR(100) NOT NULL,
    "modelId" VARCHAR(100) NOT NULL,
    "rentalType" VARCHAR(20) NOT NULL,
    "startsOn" VARCHAR(10) NOT NULL,
    "endsOn" VARCHAR(10) NOT NULL,
    "pickupLocation" VARCHAR(500) NOT NULL,
    "additionalNotes" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'waiting_confirmation',
    "statusLabel" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Booking_rentalType_check" CHECK ("rentalType" IN ('self_drive', 'with_driver')),
    CONSTRAINT "Booking_status_check" CHECK ("status" IN ('waiting_confirmation', 'under_verification', 'confirmed', 'rejected', 'cancelled', 'completed')),
    CONSTRAINT "Booking_dates_check" CHECK ("startsOn" <= "endsOn")
);

CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Customer_name_check" CHECK (btrim("name") <> '')
);

CREATE TABLE "PricingRule" (
    "id" UUID NOT NULL,
    "modelId" VARCHAR(100) NOT NULL,
    "rentalType" VARCHAR(20) NOT NULL,
    "baseRate" DOUBLE PRECISION NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'IDR',
    "billingUnit" VARCHAR(30) NOT NULL DEFAULT 'day',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PricingRule_baseRate_check" CHECK ("baseRate" >= 0)
);

CREATE TABLE "FinanceTransaction" (
    "id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "category" VARCHAR(100) NOT NULL DEFAULT 'general',
    "description" TEXT,
    "bookingId" VARCHAR(100),
    "date" VARCHAR(10) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'recorded',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinanceTransaction_type_check" CHECK ("type" IN ('income', 'expense')),
    CONSTRAINT "FinanceTransaction_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "InboxMessage" (
    "id" UUID NOT NULL,
    "senderName" VARCHAR(150) NOT NULL,
    "senderEmail" VARCHAR(254),
    "subject" VARCHAR(250),
    "content" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'unread',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InboxMessage_status_check" CHECK ("status" IN ('unread', 'read', 'archived', 'replied'))
);

CREATE TABLE "InboxMessageNote" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "authorId" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxMessageNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InboxMessageNote_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "InboxMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ContentItem" (
    "id" UUID NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "slug" VARCHAR(150),
    "contentKey" VARCHAR(150),
    "body" TEXT NOT NULL DEFAULT '',
    "section" VARCHAR(100) NOT NULL DEFAULT 'general',
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentItem_title_check" CHECK (btrim("title") <> ''),
    CONSTRAINT "ContentItem_status_check" CHECK ("status" IN ('draft', 'published', 'archived'))
);

CREATE TABLE "SystemSetting" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "Booking_bookingCode_key" ON "Booking"("bookingCode");
CREATE INDEX "Booking_status_createdAt_idx" ON "Booking"("status", "createdAt");
CREATE INDEX "Booking_whatsappPhone_status_idx" ON "Booking"("whatsappPhone", "status");
CREATE INDEX "Booking_categoryId_modelId_rentalType_idx" ON "Booking"("categoryId", "modelId", "rentalType");

CREATE INDEX "Customer_isActive_createdAt_idx" ON "Customer"("isActive", "createdAt");
CREATE INDEX "Customer_name_idx" ON "Customer"("name");
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

CREATE INDEX "PricingRule_modelId_rentalType_isActive_idx" ON "PricingRule"("modelId", "rentalType", "isActive");
CREATE INDEX "PricingRule_createdAt_idx" ON "PricingRule"("createdAt");

CREATE INDEX "FinanceTransaction_type_date_idx" ON "FinanceTransaction"("type", "date");
CREATE INDEX "FinanceTransaction_category_idx" ON "FinanceTransaction"("category");
CREATE INDEX "FinanceTransaction_createdAt_idx" ON "FinanceTransaction"("createdAt");

CREATE INDEX "InboxMessage_status_createdAt_idx" ON "InboxMessage"("status", "createdAt");
CREATE INDEX "InboxMessageNote_messageId_createdAt_idx" ON "InboxMessageNote"("messageId", "createdAt");

CREATE UNIQUE INDEX "ContentItem_slug_key" ON "ContentItem"("slug");
CREATE UNIQUE INDEX "ContentItem_contentKey_key" ON "ContentItem"("contentKey");
CREATE INDEX "ContentItem_status_section_createdAt_idx" ON "ContentItem"("status", "section", "createdAt");
