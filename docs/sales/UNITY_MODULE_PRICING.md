# Unity ERP - Module Pricing & Breakdown

**Standard Module Price:** R3,000 per module

---

## Module Summary

| # | Module Name | Complexity | Standalone Viable | Price |
|---|-------------|------------|-------------------|-------|
| 1 | **Staff Time Analysis** | High | ✅ Yes | R3,000 |
| 2 | **Inventory & Stock Control** | Very High | ✅ Yes | R3,000 |
| 3 | **Quoting & Proposals** | High | ✅ Yes | R3,000 |
| 4 | **Purchasing & Purchase Orders** | High | ⚠️ Needs Suppliers | R3,000 |
| 5 | **Supplier Management** | Medium | ⚠️ Needs Purchasing | R3,000 |
| 6 | **Products & Bill of Materials** | Very High | ✅ Yes | R3,000 |
| 7 | **Orders & Fulfillment** | Very High | ⚠️ Needs Products | R3,000 |
| 8 | **Customer Management** | Low-Medium | ✅ Yes | R3,000 |
| 9 | **Cutlist & Material Optimization** | High (Niche) | ⚠️ Needs Products | R3,000 |
| 10 | **User Control & Access Management** | Very High | ✅ Yes (Foundational) | R3,000 |

---

## Already Sold

| Module | Original Price | Current Price | Discount Given |
|--------|---------------|---------------|----------------|
| Staff Time Analysis | R1,750 | R3,000 | R1,250 (42%) |
| Inventory & Stock Control | R1,750 | R3,000 | R1,250 (42%) |

**Total Already Sold:** R3,500

---

## Module Descriptions

### 1. Staff Time Analysis Module ✅ SOLD
Workforce management including:
- Time clock events (clock in/out)
- Facial recognition integration
- Automatic payroll calculations (Regular/OT/Double Time)
- Tea break deductions (SA labor rules)
- Daily and weekly attendance reports
- PDF payroll exports
- Approval workflow

### 2. Inventory & Stock Control Module ✅ SOLD
Complete inventory management:
- Component catalog with images
- Real-time stock levels
- Multi-supplier pricing
- Category management with bulk tools
- Transaction history & auditing
- Stock adjustments with reason codes
- Manual and order-based stock issuance
- Low stock alerts & reports
- On-order tracking
- Airtable import

### 3. Quoting & Proposals Module
Professional quote creation:
- Multi-line quote items with pricing
- Quote item clustering for complex quotes
- Markup calculations at multiple levels
- Cutlist integration for material costing
- File attachments (quote-level and item-level)
- PDF generation and email delivery
- Quote versioning and history
- Quote-to-Order conversion
- Labor, material, and component line items

### 4. Purchasing & Purchase Orders Module
Procurement management:
- Multi-line purchase orders
- Q-number generation and tracking
- Supplier selection per line item
- Approval workflow with status cascade
- Receipt tracking with inventory integration
- Email PO documents to suppliers
- Multi-order PO creation (batch from sales orders)
- Edit mode for draft POs
- Follow-up email tracking

**Requires:** Supplier Management module

### 5. Supplier Management Module
Vendor master data:
- Supplier contact information
- Multi-email management
- Supplier-component mapping with pricing
- Price list uploads and preview
- Supplier order history
- Performance tracking
- Deep linking to inventory

**Requires:** Purchasing module for full value

### 6. Products & Bill of Materials Module
Product catalog and costing:
- Product master data with images
- Bill of Materials (BOM) with quantities
- BOM collections (reusable component sets)
- Configurable product options
- Bill of Labor (labor requirements)
- Product costing and margin calculation
- Cutlist configuration
- Overhead cost allocation
- Effective BOM calculation
- Product publishing to web catalog
- Category management

### 7. Orders & Fulfillment Module
Sales order management:
- Order creation from quotes or scratch
- Multi-line items with product configuration
- Order status tracking
- Component requirement calculation
- Stock picking lists (PDF)
- Stock issuance with documentation
- Finished goods reservation
- Supplier order generation
- BOM override per order
- Reverse issuance capability

**Requires:** Products & BOM module

### 8. Customer Management Module
Customer database:
- Customer master data
- Contact information
- Address management
- Quote history linkage
- Order history linkage
- Customer metrics
- Inline editing

### 9. Cutlist & Material Optimization Module
Material planning for sheet goods:
- Nesting optimization algorithms
- Cut list layout visualization
- Board slot assignment
- Cutlist clustering
- Quote item integration
- PDF export
- Waste calculation
- Optimization parameters

**Requires:** Products & BOM module

### 10. User Control & Access Management Module
Enterprise security and audit capabilities:
- Custom role creation and management
- Granular module-level permissions (view/create/edit/delete/approve)
- User role assignment with multi-role support
- Permission override capability per user
- Comprehensive activity logging across all modules
- Activity log viewer with advanced filtering
- Per-record change history tabs
- Organization data isolation (RLS)
- Login history and failed attempt tracking
- Active session management and force logout
- Sidebar filtering based on permissions
- API permission enforcement

**Foundational module** - enhances security across all other modules

---

## Supporting Features (Included with Any Module)

These features are included with the base platform:

- ✅ User authentication & authorization
- ✅ Dashboard with module-specific KPIs
- ✅ Dark theme interface
- ✅ Mobile-responsive design
- ✅ Supabase cloud database
- ✅ Row-level security
- ✅ PDF generation
- ✅ Email integration (Resend)
- ✅ File storage (Supabase)
- ✅ Todo/Task management

---

## Module Dependencies

```
Customer Management ←─────────────────────────┐
        │                                     │
        ▼                                     │
Quoting & Proposals ──────────────────────────┤
        │                                     │
        ▼                                     │
Orders & Fulfillment ◄──── Products & BOM ────┤
        │                        │            │
        ▼                        ▼            │
Inventory ◄──────────────── Cutlist           │
        │                                     │
        ▼                                     │
Purchasing ◄──────────────── Suppliers        │
        │                                     │
        └─────────────────────────────────────┘

Staff Time Analysis (Standalone)
```

---

## Professional Services

**Hourly Rate:** R600/hour

### Services Available

| Service | Description | Typical Hours |
|---------|-------------|---------------|
| **Installation & Setup** | Deploy to client infrastructure, configure database, set up email | 2-4 hours |
| **Data Migration** | Import existing data from spreadsheets, Airtable, or other systems | 4-8 hours |
| **Training** | On-site or remote training sessions per module | 2-3 hours/module |
| **Customization** | Minor UI tweaks, report modifications, workflow adjustments | Varies |
| **Integration** | Connect to external systems (accounting, e-commerce, etc.) | 8-20 hours |
| **Support & Troubleshooting** | Bug fixes, performance issues, user assistance | As needed |
| **Documentation** | Custom user manuals, SOPs, how-to guides | 4-8 hours |

### Training Packages

| Package | Hours | Price | Description |
|---------|-------|-------|-------------|
| Basic | 2 | R1,200 | Single module overview |
| Standard | 4 | R2,400 | 2 modules with hands-on exercises |
| Comprehensive | 8 | R4,800 | Full system training for team |
| Train-the-Trainer | 6 | R3,600 | Enable internal champion |

### Support Plans (Monthly)

| Plan | Price | Response Time | Hours Included |
|------|-------|---------------|----------------|
| Email Support | Free | 48 hours | — |
| Priority Support | R1,000/mo | 24 hours | 1 hour |
| Premium Support | R2,500/mo | 4 hours | 4 hours |

---

## Implementation Notes

### Deployment
- Hosted on client's infrastructure or cloud (Vercel/Netlify)
- Supabase database (managed or self-hosted)
- Email via Resend (transactional)

### What's Included
- 2 hours training per module (at no extra charge)
- Email support
- Minor customizations

### Additional Services (Charged at R600/hour)
- Extended training
- Data migration
- Custom integrations
- Major customizations
- On-site support

---

*Document Version: 1.1*
*Last Updated: January 2026*
*Note: Bundle discounts removed - all modules sold individually at R3,000 each*
