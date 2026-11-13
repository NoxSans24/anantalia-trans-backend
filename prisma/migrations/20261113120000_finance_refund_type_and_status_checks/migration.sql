-- Align PostgreSQL CHECK constraints with Finance, Inbox, and Content service domains
ALTER TABLE "FinanceTransaction"
  DROP CONSTRAINT IF EXISTS "FinanceTransaction_type_check",
  ADD CONSTRAINT "FinanceTransaction_type_check" CHECK ("type" IN ('income', 'expense', 'refund'));

ALTER TABLE "InboxMessage"
  DROP CONSTRAINT IF EXISTS "InboxMessage_status_check",
  ADD CONSTRAINT "InboxMessage_status_check" CHECK ("status" IN ('unread', 'read', 'in_progress', 'waiting_customer', 'replied', 'resolved', 'archived', 'spam'));

ALTER TABLE "ContentItem"
  DROP CONSTRAINT IF EXISTS "ContentItem_status_check",
  ADD CONSTRAINT "ContentItem_status_check" CHECK ("status" IN ('draft', 'scheduled', 'published', 'archived'));
