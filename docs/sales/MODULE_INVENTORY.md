# Inventory Module - Product Documentation

**Module Price:** R3,000 (Previously sold at R1,750)

---

## Overview

The Inventory Module provides comprehensive stock management for components and materials. It includes real-time stock tracking, multi-supplier support, transaction auditing, category management, and powerful reporting tools for stock control and reordering decisions.

---

## Core Features

### 1. Component Master (Catalog)
- **Component Records** - Internal codes, descriptions, units of measure
- **Image Management** - Upload and display component images
- **Category Assignment** - Organize components into logical groups
- **Component Detail Pages** - 5 dedicated tabs:
  - Overview - Stock levels, suppliers, location
  - Suppliers - Multiple suppliers with pricing
  - Transactions - Full audit trail
  - Orders - Which orders need this component
  - Analytics - Usage patterns and metrics

### 2. Stock Level Tracking

**Real-Time Visibility:**
- Quantity on hand for each component
- Reorder levels (minimum stock thresholds)
- Storage locations
- On-order quantities from purchase orders
- Required quantities across active customer orders

**Stock Status Classification:**
- 🟢 **In Stock** - Quantity above reorder level
- 🟡 **Low Stock** - Between 0 and reorder level
- 🔴 **Out of Stock** - Zero or negative quantity

### 3. Category Management

- Create, edit, and delete categories
- Merge categories (move components between categories)
- Component count per category
- Search and filter by category

**Bulk Categorization Workflows:**
1. **Single-Click Editing** - Click cell, select category
2. **Copy/Paste** - Ctrl+C on category, Ctrl+V on targets
3. **Quick Apply Mode** - Pin a category, click multiple cells to apply
   - ~30 seconds for 20 items vs 10-15 minutes manually

### 4. Supplier Integration

**Per-Component Supplier Mapping:**
- Multiple suppliers per component
- Supplier-specific part numbers (supplier codes)
- Unit cost/price per supplier
- Lead times in days
- Minimum order quantities (MOQ)

**Price Analytics:**
- Average price across suppliers
- Min/Max price display
- Price comparison for purchasing decisions

### 5. Transaction History & Auditing

**Transaction Types:**
- **IN** - Purchases, returns, corrections
- **OUT** - Stock issues to orders, production
- **ADJUST** - Cycle counts, damage, write-offs

**Transaction Detail Tracking:**
- Date and time of transaction
- Quantity and running balance
- Reference to purchase order or customer order
- Reason codes for adjustments
- User attribution (who made the change)

**Stock Movement Visualization:**
- Interactive charts (7/14/30/90-day views)
- Stock In (green bars) vs Stock Out (red bars)
- Balance line with reorder level reference
- Click-through to daily transaction details

### 6. Stock Adjustments

**Adjustment Types:**
- Set To - Enter counted quantity, system calculates delta
- Add - Add units to current stock
- Subtract - Remove units from current stock

**Mandatory Reason Codes:**
- Stock Count Variance
- Damage/Spoilage
- Theft/Loss
- Data Entry Correction
- Found Stock
- Quality Rejection
- Sample/Testing
- Write-off
- Cycle Count
- Other (requires notes)

**Validation:**
- Large adjustments (>50 units or >50%) show warnings
- Full audit trail maintained

### 7. Stock Issuance

**Manual Stock Issuance:**
- Select component and quantity
- Category selection (Production, Customer Order, Samples, etc.)
- External reference for traceability
- Staff assignment
- PDF generation (Picking List and Issuance Record)

**Order-Based Issuance:**
- BOM integration shows components needed
- Multiple product support
- Partial issuance capability
- Reversible via system function

### 8. Reports & Alerts

**Low Stock Alerts:**
- Components approaching reorder levels
- Sorted by urgency
- Shows current stock vs reorder level

**Out of Stock Report:**
- Components with zero quantity
- Affected orders and shortfall magnitude

**Critical Components to Order:**
- Global shortfalls across all orders
- Apparent vs real shortfalls (accounting for on-order)
- Affected order numbers and severity

**On Order Tab:**
- All components with pending purchase orders
- PO status tracking
- Links to purchase orders

---

## Data Import

### Airtable Integration
- **Single Import** - Lookup and import individual components
- **Bulk Import** - CSV upload for batch processing
- Conflict detection for existing codes
- Progress tracking and error handling

---

## Overhead Costs

Track manufacturing and labor overhead elements:
- Fixed amount or percentage-based costs
- Percentage basis options (Materials, Labor, Total)
- Active/inactive status management
- Usage tracking per element

---

## Technical Architecture

### Database Tables
- `components` - Master component catalog
- `inventory` - Stock levels (one-to-one with components)
- `inventory_transactions` - Full audit trail
- `suppliercomponents` - Supplier-component mapping
- `component_categories` - Category hierarchy
- `unitsofmeasure` - Unit definitions
- `stock_issuances` - Issuance records
- `overhead_cost_elements` - Cost tracking

### Key Functions
- `process_supplier_order_receipt()` - Atomic purchase receipts
- `process_stock_issuance()` - Issue stock to orders
- `reverse_stock_issuance()` - Undo stock movements
- `process_manual_stock_issuance()` - Manual issuances
- `get_global_component_requirements()` - Cross-order shortfalls

---

## User Interface

### Main Inventory Page Tabs
1. **Components** - Master list with filtering
2. **Categories** - Category management
3. **Stock Issue** - Manual stock issuance
4. **On Order** - Purchase order tracking
5. **Reports** - Alerts and analytics
6. **Overhead** - Cost element management
7. **Import** - Airtable integration

### Component Detail Page Tabs
1. **Overview** - Stock status, location, suppliers
2. **Suppliers** - Supplier pricing and availability
3. **Transactions** - Full history with filtering
4. **Orders** - Customer orders requiring this component
5. **Analytics** - Usage patterns and metrics

---

## Business Value

### For Purchasing
- Clear visibility into what needs ordering
- Supplier price comparison
- Lead time awareness for planning
- On-order tracking across all POs

### For Warehouse
- Real-time stock levels
- Easy stock adjustments with reason codes
- Location tracking
- PDF picking lists for issuance

### For Finance
- Full audit trail of all movements
- Cost tracking per component
- Overhead allocation visibility
- Inventory valuation support

### For Operations
- Low stock alerts before stockouts
- Required quantities from orders
- Shortfall analysis for planning
- Historical usage analytics

---

## What's Included

✅ Component master data management
✅ Real-time stock level tracking
✅ Multi-supplier support with pricing
✅ Category management with bulk tools
✅ Full transaction audit trail
✅ Stock adjustments with reason codes
✅ Manual and order-based stock issuance
✅ PDF issuance documents
✅ Low stock and out-of-stock alerts
✅ On-order tracking
✅ Stock movement charts
✅ CSV export
✅ Airtable import integration
✅ Overhead cost tracking
✅ URL filter persistence
✅ Mobile-responsive design

---

## Integration Points

- **Purchasing Module** - Receives stock from purchase orders
- **Orders Module** - Issues stock to customer orders
- **Products Module** - Component usage in BOMs
- **Suppliers Module** - Supplier pricing and availability
- **Cutlist Module** - Material planning

---

## Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection
- Supabase database access

---

*Document Version: 1.0*
*Last Updated: January 2025*
