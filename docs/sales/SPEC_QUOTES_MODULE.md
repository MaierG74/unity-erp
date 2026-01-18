# Quoting & Proposals Module - Project Specification

**Module Price:** R3,000

---

## Executive Summary

The Quoting & Proposals Module enables professional quote creation, pricing management, and customer communication. It supports complex multi-line quotes with clustering, automatic costing from products and components, PDF generation, email delivery, and seamless conversion to sales orders.

---

## Module Features

### 1. Quote Management

#### Quote List & Dashboard
- View all quotes with filtering by status, customer, date range
- Search by quote number, customer name, or description
- Status indicators (Draft, Sent, Accepted, Rejected, Expired, Converted)
- Quick actions (View, Edit, Duplicate, Delete)
- Sort by date, amount, or customer

#### Quote Creation
- Customer selection with auto-population of details
- Quote reference number (auto-generated or manual)
- Quote date and validity period
- Terms and conditions
- Internal notes (not visible to customer)
- Customer-facing notes

### 2. Quote Line Items

#### Line Item Management
- Add products from catalog with automatic pricing
- Manual line items with custom descriptions
- Quantity and unit price fields
- Discount percentage or fixed amount
- Line-level markup calculations
- Drag-and-drop reordering
- Duplicate and delete actions

#### Pricing Fields per Line
- Unit cost (from supplier pricing or manual)
- Unit price (selling price)
- Quantity
- Discount (% or fixed)
- Markup (% calculated)
- Line total (calculated)
- Tax handling (if applicable)

### 3. Quote Clustering (Complex Quotes)

For complex quotes, line items can be grouped into clusters:

#### Cluster Structure
- **Cluster Header** - Name, description, total markup
- **Cluster Lines** - Three types:
  - **Labor Lines** - Hours × rate with description
  - **Material Lines** - Components with quantity and cost
  - **Manual Lines** - Freeform items with custom pricing

#### Cluster Calculations
- Subtotal per cluster
- Markup applied at cluster level
- Roll-up to quote total

### 4. Cutlist Integration

For material-intensive quotes:

#### Cutlist Features
- Board optimization for sheet materials
- Primary, backer, and edging slot assignment
- Visual cut layout preview
- Material waste calculation
- Automatic cost calculation from cutlist
- Cutlist snapshot saved with quote item

### 5. File Attachments

#### Attachment Management
- Upload files at quote level or item level
- Supported formats: PDF, images, documents
- File preview in modal viewer
- Download and delete actions
- Storage in Supabase (QButton bucket)

#### Scope Control
- **Quote-Level** - General documents, terms, specifications
- **Item-Level** - Technical drawings, product specs

### 6. Quote Versioning

#### Version History
- Save snapshots of quote at key moments
- Compare versions side-by-side
- Restore previous versions
- Version notes for context

#### Activity Tracking
- Quote created/modified timestamps
- User attribution
- Status change history

### 7. PDF Generation

#### Quote PDF Document
- Professional layout with company branding
- Customer details and address
- Quote reference and date
- Line items with descriptions and pricing
- Subtotals and totals
- Terms and conditions
- Notes section
- Optional: Line item images

#### Customization Options
- Company logo
- Header and footer text
- Terms and conditions
- Bank details (if required)

### 8. Email Delivery

#### Send Quote via Email
- Customer email pre-populated
- Customizable email subject and body
- Quote PDF automatically attached
- Additional file attachments option
- Email tracking (sent date/time)

#### Email Templates
- Default quote email template
- Customizable per-send

### 9. Quote-to-Order Conversion

#### Conversion Workflow
- One-click conversion to sales order
- All line items transferred
- Customer details copied
- Attachments linked
- Quote marked as "Converted"
- Link maintained between quote and order

---

## User Interface

### Quote List Page (`/quotes`)
- Filterable table with all quotes
- Status tabs (All, Draft, Sent, Accepted, etc.)
- Search and date range filters
- "New Quote" button
- Bulk actions (if multiple selected)

### Quote Editor Page (`/quotes/[id]`)
- Header section with customer and dates
- Line items table with inline editing
- Cluster management (expand/collapse)
- Totals sidebar
- Actions: Save, Send, Duplicate, Convert to Order, Delete
- Attachment upload area
- Notes sections (internal and customer-facing)

### New Quote Page (`/quotes/new`)
- Customer selection dropdown
- Quote details form
- Add first line item
- Save as draft or continue editing

---

## Workflow Examples

### Simple Quote Workflow
1. Create new quote, select customer
2. Add line items from product catalog
3. Adjust quantities and prices
4. Add notes and terms
5. Save and preview PDF
6. Send to customer via email
7. Customer accepts → Convert to order

### Complex Quote Workflow (Clustering)
1. Create new quote, select customer
2. Add cluster "Kitchen Cabinets"
3. Add material lines (boards, hardware)
4. Add labor lines (cutting, assembly, install)
5. Set cluster markup
6. Add second cluster "Bathroom Vanity"
7. Repeat material and labor entries
8. Add quote-level attachments (drawings)
9. Generate PDF with full breakdown
10. Send to customer
11. Revise based on feedback (version 2)
12. Convert accepted quote to order

### Cutlist Quote Workflow
1. Create quote, select customer
2. Add line item for "Custom Shelving Unit"
3. Open cutlist editor for item
4. Define board dimensions and quantities
5. Run nesting optimization
6. Save cutlist (cost automatically calculated)
7. Add edging and hardware as additional lines
8. Complete quote and send

---

## Database Schema

### Core Tables

**quotes**
- `quote_id` (PK)
- `quote_number` (unique)
- `customer_id` (FK)
- `status` (draft, sent, accepted, rejected, expired, converted)
- `quote_date`
- `valid_until`
- `subtotal`
- `discount_total`
- `tax_total`
- `grand_total`
- `internal_notes`
- `customer_notes`
- `terms_conditions`
- `created_at`, `updated_at`
- `created_by` (user)

**quote_items**
- `item_id` (PK)
- `quote_id` (FK)
- `product_id` (FK, nullable)
- `description`
- `quantity`
- `unit_cost`
- `unit_price`
- `discount_percent`
- `discount_amount`
- `line_total`
- `sort_order`
- `created_at`, `updated_at`

**quote_item_clusters**
- `cluster_id` (PK)
- `quote_id` (FK)
- `name`
- `description`
- `markup_percent`
- `subtotal`
- `total`
- `sort_order`

**quote_cluster_lines**
- `line_id` (PK)
- `cluster_id` (FK)
- `line_type` (labor, material, manual)
- `description`
- `component_id` (FK, nullable)
- `quantity`
- `unit_cost`
- `unit_price`
- `hours` (for labor)
- `rate` (for labor)
- `line_total`
- `sort_order`

**quote_attachments**
- `attachment_id` (PK)
- `quote_id` (FK)
- `item_id` (FK, nullable)
- `filename`
- `file_url`
- `file_size`
- `scope` (quote, item)
- `uploaded_at`

**quote_versions**
- `version_id` (PK)
- `quote_id` (FK)
- `version_number`
- `snapshot_data` (JSON)
- `notes`
- `created_at`
- `created_by`

**quote_notes** (Activity Log)
- `note_id` (PK)
- `quote_id` (FK)
- `note_type` (created, modified, sent, status_change)
- `content`
- `created_at`
- `created_by`

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quotes` | GET | List all quotes with filters |
| `/api/quotes` | POST | Create new quote |
| `/api/quotes/[id]` | GET | Get quote details |
| `/api/quotes/[id]` | PUT | Update quote |
| `/api/quotes/[id]` | DELETE | Delete quote |
| `/api/quotes/[id]/send-email` | POST | Send quote via email |
| `/api/quotes/[id]/duplicate` | POST | Duplicate quote |
| `/api/quotes/[id]/convert` | POST | Convert to order |
| `/api/quotes/[id]/versions` | GET | List versions |
| `/api/quotes/[id]/versions` | POST | Create version snapshot |
| `/api/quote-items` | POST | Add line item |
| `/api/quote-items/[id]` | PUT | Update line item |
| `/api/quote-items/[id]` | DELETE | Delete line item |
| `/api/quote-items/[id]/cutlist` | GET/PUT | Cutlist operations |
| `/api/quote-clusters` | POST | Create cluster |
| `/api/quote-clusters/[id]` | PUT | Update cluster |
| `/api/quote-attachments` | POST | Upload attachment |

---

## Integration Points

### Required Integrations
- **Customers** - Customer selection and details
- **Products** - Product catalog and pricing

### Optional Integrations
- **Inventory/Components** - Component costing for clusters
- **Suppliers** - Supplier pricing lookup
- **Orders** - Quote-to-order conversion
- **Cutlist** - Material optimization
- **Labor** - Labor rate lookup for labor lines

---

## Technical Requirements

### Frontend
- Next.js 14 with App Router
- React Hook Form for form management
- Zod validation schemas
- React Query for data fetching
- Radix UI + Tailwind CSS

### Backend
- Supabase PostgreSQL database
- Row-level security policies
- Supabase storage for attachments
- Resend for email delivery

### PDF Generation
- Server-side PDF generation
- Company branding support
- Professional quote layout

---

## Deliverables

1. ✅ Quote list page with filtering
2. ✅ Quote editor with line items
3. ✅ Cluster management for complex quotes
4. ✅ Cutlist integration per line item
5. ✅ File attachment management
6. ✅ Quote versioning
7. ✅ PDF generation
8. ✅ Email delivery
9. ✅ Quote-to-order conversion
10. ✅ Database migrations
11. ✅ API endpoints
12. ✅ Row-level security policies

---

## What's Included

✅ Full quote management interface
✅ Multi-line quote items
✅ Quote clustering for complex quotes
✅ Labor, material, and manual line types
✅ Cutlist integration
✅ File attachments (quote and item level)
✅ Quote versioning and history
✅ PDF generation with company branding
✅ Email delivery via Resend
✅ Quote-to-order conversion
✅ Activity tracking
✅ Mobile-responsive design

---

## What's NOT Included (Additional Modules)

❌ Customer management (Customer Module)
❌ Product catalog (Products & BOM Module)
❌ Inventory tracking (Inventory Module)
❌ Order fulfillment (Orders Module)
❌ Supplier management (Suppliers Module)

---

## Timeline

| Phase | Duration | Activities |
|-------|----------|------------|
| Setup | 1-2 days | Database migrations, basic structure |
| Core Features | 3-5 days | Quote CRUD, line items, totals |
| Advanced Features | 3-5 days | Clustering, cutlist, attachments |
| PDF & Email | 2-3 days | PDF generation, email delivery |
| Testing & Polish | 2-3 days | Bug fixes, UI polish, documentation |

**Estimated Total:** 2-3 weeks

---

## Acceptance Criteria

1. User can create, edit, and delete quotes
2. Quote line items calculate totals correctly
3. Clusters group items with markup calculations
4. Cutlist integration calculates material costs
5. Attachments upload and download correctly
6. PDF generates with all quote details
7. Email delivers to customer with PDF attached
8. Quote converts to order with all data transferred
9. Versioning saves and restores quote snapshots
10. All CRUD operations respect row-level security

---

*Document Version: 1.0*
*Last Updated: January 2025*
