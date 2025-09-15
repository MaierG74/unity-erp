**Orders Master**

- **Scope:** Customer orders (sales orders) domain: schema, UI, storage, and links to Purchasing.
- **Audience:** Developers and operations.
- **Status:** Current implementation overview with cleanup guidance for test/dev.

**Core Tables**

- `orders`: Header containing `order_id`, `customer_id`, `order_date`, `status_id`, `order_number`, timestamps, optional `delivery_date`. See `schema.txt:114` (orders + statuses).
- `order_statuses`: Canonical order workflow names (e.g., New, In Progress, Completed, Cancelled).
- `order_details`: Lines: `order_detail_id`, `order_id`, `product_id`, `quantity`, `unit_price`.
- `order_attachments`: Attachment metadata (DB record) with `file_url`, `file_name`, `uploaded_at`. Storage files live in the Supabase Storage bucket (see below).
- `customers`: Linked via `customer_id`.

**Supabase Storage (Attachments)**

- Bucket: `qbutton` (lowercase in code).
- Upload path pattern: `Orders/Customer/<customer_id>/<filename>`.
- Public URL is stored in `order_attachments.file_url` after upload.
- UI pages for listing/uploading attachments: `app/orders/page.tsx:260` (UploadAttachmentDialog), listing via `listCustomerFiles` with prefix `Orders/Customer/<customerId>`.

**UI & Routes**

- Orders list: filters by status, search (order number, customer), shows sections, attachments count and upload dialog.
  - Page: `app/orders/page.tsx:1` (fetch/filter logic), `app/orders/page.tsx:260` (storage + attachments handling).
- Order detail/editor pages also reference order data; generation of POs occurs from the order page: `app/orders/[orderId]/page.tsx` (handles component requirements, creating purchase orders by supplier group and linking them).

**Link to Purchasing**

- There is no direct FK from `orders` to `purchase_orders`.
- When generating POs from an order, each supplier order line is linked via junction `supplier_order_customer_orders` containing:
  - `supplier_order_id` (SO), `order_id` (sales order), `component_id`, `quantity_for_order`, `quantity_for_stock`.
  - Schema: `sql/create_junction_table.sql`.

**Cleanup Considerations**

- If you delete orders, you should also:
  - Remove `supplier_order_customer_orders` rows referencing those orders (to avoid dangling links in Purchasing).
  - Delete `order_attachments` DB rows and delete the corresponding storage files under `qbutton/Orders/Customer/<customer_id>/`.
  - Delete `order_details` rows before deleting the `orders` headers.
  - Refresh component views if you use them to compute requirements: `SELECT refresh_component_views();`.
- Purchasing can be cleaned independently (see `docs/purchasing-reset-guide.md`). If you do not also delete POs, the POs and supplier orders remain but will no longer be linked to any order.

**Recommended Status Workflow**

- New → In Progress → Completed or Cancelled.
- Cancel instead of delete in production to preserve auditability. For test/dev, see `docs/orders-reset-guide.md` for a safe deletion path.

