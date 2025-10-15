# Product Creation Guide

This document provides a comprehensive overview of how products are created, managed, and stored in the Unity ERP system.

## Database Schema

### Core Product Tables

#### `products` Table
```sql
CREATE TABLE public.products (
  product_id serial NOT NULL,
  internal_code text NOT NULL,
  name text NOT NULL,
  description text NULL,
  CONSTRAINT products_pkey PRIMARY KEY (product_id),
  CONSTRAINT products_internal_code_key UNIQUE (internal_code)
);
```

**Fields:**
- `product_id`: Auto-incrementing primary key
- `internal_code`: Unique product code (required, e.g., "APOHB", "WIDGET-001")
- `name`: Product name (required)
- `description`: Product description (optional)

### Related Tables

#### `product_categories`
```sql
CREATE TABLE public.product_categories (
  product_cat_id serial NOT NULL,
  categoryname text NOT NULL,
  CONSTRAINT product_categories_pkey PRIMARY KEY (product_cat_id),
  CONSTRAINT product_categories_categoryname_key UNIQUE (categoryname)
);
```

#### `product_category_assignments`
```sql
CREATE TABLE public.product_category_assignments (
  product_id integer NOT NULL,
  product_cat_id integer NOT NULL,
  CONSTRAINT product_category_assignments_pkey PRIMARY KEY (product_id, product_cat_id),
  CONSTRAINT product_category_assignments_product_cat_id_fkey FOREIGN KEY (product_cat_id)
    REFERENCES public.product_categories(product_cat_id) ON DELETE CASCADE,
  CONSTRAINT product_category_assignments_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES public.products(product_id) ON DELETE CASCADE
);
```

#### `product_images`
```sql
CREATE TABLE product_images (
  image_id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  alt_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### `billofmaterials` (BOM)
```sql
CREATE TABLE public.billofmaterials (
  bom_id serial NOT NULL,
  product_id integer NULL,
  component_id integer NULL,
  quantity_required integer NULL,
  CONSTRAINT billofmaterials_pkey PRIMARY KEY (bom_id),
  CONSTRAINT billofmaterials_component_id_fkey FOREIGN KEY (component_id)
    REFERENCES public.components(component_id),
  CONSTRAINT billofmaterials_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES public.products(product_id)
);
```

#### `billoflabour` (BOL)
```sql
CREATE TABLE public.billoflabour (
  bol_id serial NOT NULL,
  product_id integer NULL,
  job_id integer NULL,
  time_required numeric(5,2) NULL,
  CONSTRAINT billoflabour_pkey PRIMARY KEY (bol_id),
  CONSTRAINT billoflabour_job_id_fkey FOREIGN KEY (job_id)
    REFERENCES public.jobs(job_id),
  CONSTRAINT billoflabour_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES public.products(product_id)
);
```

## Current Product Management Features

### Existing UI Components

#### Product List Page (`/app/products/page.tsx`)
- Displays all products in a paginated table
- Shows product code, name, and description
- Includes search and category filtering
- "Add Product" opens the create dialog
- Row actions:
  - Edit navigates directly to the full detail page for that product
  - Delete opens a confirmation dialog and removes the item optimistically
- Clicking on a row still previews details in the right-side card
 - The side card also includes a Delete action with confirmation

#### Product Detail Page (`/app/products/[productId]/page.tsx`)
- Tabbed interface with sections for:
  - **Details** – Basic product information
  - **Images** – Image management with gallery
  - **Categories** – Category assignment management
  - **Bill of Materials** – Component requirements (inline editing, supplier-aware tooling)
  - **Bill of Labor** – Labor requirements
  - **Options** – Manage configurable attributes (option groups + values) and hook BOM overrides
  - **Costing** – Combined materials + labor unit cost summary (see `docs/plans/product-costing-plan.md`)
- Options tab specifics:
  - Focuses on attaching **Option Sets** from the global library (see `docs/domains/components/bom-option-cut.md`).
  - Displays attached sets in order; each group shows usage badges indicating which BOM rows reference it.
  - Inline controls let authors alias group/value labels for this product, toggle defaults, hide unused values, and detach the set.
  - Supports adding bespoke product-only groups when necessary (legacy `product_option_groups` / `product_option_values`). These appear under a separate "Product-specific" heading.
  - Quick action "Create option set" opens a side panel to author a new reusable set without leaving the page.
- BOM override dialog:
  - Each BOM row exposes “Configure option overrides” and is now the primary entry point for configuring option behavior.
  - If no option set is attached, the dialog prompts to attach an existing set or create a new one inline before override editing.
  - Map option values to replacement components, quantity deltas, cutlist metadata, and notes (persisted in `bom_option_overrides`).
  - UI uses collapsible groups/values with summaries showing configuration status, includes a search picker for replacement components, and supports copying overrides to additional BOM rows.
  - Option-set defaults (component, supplier, quantity, cutlist flags) now write to `bom_option_overrides` automatically when the dialog loads, so authors only need to save when deviating from the defaults.
  - “Save” remains disabled when there are no changes and displays a spinner during persistence; clearing shows a spinner as well. Inline toasts surface success/destructive states.
- Edit Product button reserved for future full‑form editing.
- Consistent styling across tabs:
  - Delete actions use `destructiveSoft` (pastel in light, strong in dark).
  - Image frames use `bg-card` in light and `dark:bg-white/5 dark:ring-1 dark:ring-white/10` with subtle image lift in dark.

### Product Image Management

#### Image Upload Component (`/components/features/products/image-upload.tsx`)
- Drag-and-drop image upload interface
- Supports PNG, JPG, GIF, WEBP formats
- Uploads to Supabase storage bucket "QButton"
- Automatically creates database records in `product_images` table

#### Image Gallery Component (`/components/features/products/image-gallery.tsx`)
- Displays all product images in a grid
- Supports setting primary images
- Allows deleting images
- Shows upload progress for multiple files
 - Thumbnails and main image use the same neutral frame/light ring pattern as the details view

#### Image Presentation (Light/Dark)
- A neutral frame is applied so dark products remain visible in dark mode, while avoiding banding in light mode.
- Containers:
  - Light: `bg-card` (no ring) to blend with the card
  - Dark: `dark:bg-white/5 dark:ring-1 dark:ring-white/10`
- Images: `object-contain` plus subtle emphasis in dark `dark:brightness-110 dark:drop-shadow-[0_8px_24px_rgba(0,0,0,0.85)]`
- Applied in: side card preview, Product Details image, and the gallery

#### Image Path Generation (`/lib/utils/image.ts`)
Images are stored with the following naming convention:
```
products/{PRODUCT_CODE}/{PRODUCT_CODE}_{TIMESTAMP}_{CLEAN_FILENAME}.{EXT}
```

Example:
```
products/APOHB/APOHB_20240315123456_front_view.jpg
```

### Category Management

#### Category Dialog Component (`/components/features/products/category-dialog.tsx`)
- Multi-select interface for assigning categories to products
- Search functionality for finding categories
- Prevents duplicate category assignments
- Batch category assignment/removal

### Bill of Materials (BOM) Management

#### Product BOM Component (`/components/features/products/product-bom.tsx`)
- Manages component requirements for products
- Links products to required components with quantities
- Used for inventory management and cost calculation
- Actions available:
  - Add Component (search components, set quantity, optional supplier)
  - Add From Collection (apply a saved set of components; see Collections)
  - Add Product (explode another product’s BOM into this product)

##### Add Product (Sub‑assembly as components)
- UI button: "Add Product" on the BOM tab toolbar.
- Flow: search/select a product → preview its BOM → set Quantity → Apply.
- Behavior: copies the selected product’s BOM rows into the current product’s BOM, scaling each child quantity by the Quantity value. This acts like a phantom sub‑assembly (no separate inventory item is added).
- Supplier handling: if the source BOM rows refer to `supplier_component_id`, those are preserved for costing.
- Guards & limits:
  - You cannot add the current product to itself.
  - No merge/deduplication yet; duplicate component_ids will appear as separate rows. A merge option can be added later.
  - Depth: one level (the selected product’s own BOM). Nested products would need multiple applies.

API endpoint backing this action:
- `POST /api/products/:productId/bom/apply-product`
  - Body: `{ sub_product_id: number, quantity?: number }`
  - Effect: inserts rows into `billofmaterials` for `:productId` using the BOM of `sub_product_id`, scaling `quantity_required` by `quantity` (default 1).
  - Returns: `{ added: number }` on success.

##### Attach Product (Link, planned)
- Optional mode where the selected product’s BOM stays linked (phantom explosion) so changes to the sub‑product automatically flow into the parent’s effective BOM.
- Status: available behind feature flag `NEXT_PUBLIC_FEATURE_ATTACH_BOM=true`. With the flag on, totals use the effective BOM (explicit + attached); the table still shows explicit rows.
- Initial scope: follow latest only; later we’ll support pinning to a published snapshot/version.
- Controls: scale factor; mode (phantom now, stocked later); quick actions to bake (convert link to rows) or detach (planned).
- See: `docs/domains/components/subcomponent-planning-and-execution.md` → “Phase 2 — Attach Product (Dynamic Link)”.

##### Decisions Pending (BOM)
- Merge duplicates on Apply (sum by `component_id`) vs keep separate rows; consider a user toggle on apply.
- Attach: follow latest vs pinned snapshot/version; introduce product BOM snapshots.
- Stocked sub‑assembly mode vs phantom only.
- Merge key for totals: `component_id` only vs `(component_id, supplier_component_id)`.
- Bake vs Detach behavior for attached links and provenance retention.

##### Operator Notes (Attach)
- Attach is available behind a feature flag and affects totals only; the editable table shows explicit rows.
- To enable: set `NEXT_PUBLIC_FEATURE_ATTACH_BOM=true` and restart the app.
- To remove a link: use DELETE `/api/products/:productId/bom/attach-product?sub_product_id=…` until the Detach UI is added.

### Bill of Labor (BOL) Management

#### Product BOL Component (`/components/features/products/product-bol.tsx`)
- Manages labor requirements for products
- Links products to required jobs with time estimates
- Used for production planning and cost calculation

## Missing Product Creation Features

### Currently Implemented ✅

1. **Product Creation Form** ✅
   - `ProductCreateForm` component with full dialog interface
   - Connected to "Add Product" button in products list
   - Supports category assignment during creation

2. **API Endpoints** ✅
   - `POST /api/products` - Create new products
   - `GET /api/products` - List all products
   - `GET /api/products/[productId]` - Get single product with relations
   - `PUT /api/products/[productId]` - Update existing products
   - `DELETE /api/products/[productId]` - Delete products (with safety checks)

3. **Product Validation** ✅
   - Server-side validation for required fields (internal_code, name)
   - Duplicate product code prevention
   - Order reference checks before deletion

### Still Missing Components

1. **Product Edit Form**
   - No UI for editing existing product details
   - The "Edit Product" button in product detail page has no functionality

2. **Product Code Generation**
   - No automatic product code generation logic
   - Manual entry required for unique codes

3. ~~Product Deletion UI~~
   - Implemented. See "Product Deletion" section below.

4. **Product Costing Tab**
   - Planned. See `docs/plans/product-costing-plan.md` for UX and data model. Will surface Unit Cost and detailed breakdowns.

## Product Deletion

### Frontend UI (Implemented)
- Location: `app/products/page.tsx`
- Interaction: Select a product in the table. In the right-side Product Details card, click the "Delete" button.
- Safety: A confirmation `AlertDialog` is shown before deletion.
- Feedback: While deleting, the dialog action shows "Deleting..." and disables controls. The deleted row disappears immediately (optimistic update), then the list refetches and the selection clears.

### Backend API (Already existed)
- Endpoint: `DELETE /api/products/[productId]`
- Behavior: Prevents deletion if product is referenced by orders (`order_details`). Otherwise deletes product and relies on FK cascade for related records (e.g., categories, images).
- Responses:
  - 200: `{ success: true, message: 'Product deleted successfully' }`
  - 409: `{ error: 'Cannot delete product that is referenced by orders' }`
  - 500: `{ error: 'Failed to delete product' }`

### Notes
- UI uses TanStack Query `useMutation` with an optimistic cache update and invalidation to refresh the list.
- Confirmation dialog components: `@/components/ui/alert-dialog`.

## Product Creation Process (Current vs. Ideal)

### Current Process ✅
1. **Web Interface**: Click "Add Product" button opens creation dialog
2. **Form Validation**: Client-side and server-side validation
3. **Category Assignment**: Select categories during creation
4. **Database Storage**: Full CRUD operations via API endpoints
5. **Error Handling**: Comprehensive error messages and validation

### Ideal Process
1. **Access Product Creation**
   - Navigate to `/products` page
   - Click "Add Product" button

2. **Basic Information**
   - Enter product name (required)
   - Enter unique product code (required)
   - Enter description (optional)

3. **Category Assignment**
   - Select one or more product categories
   - Use search to find categories quickly

4. **Image Management**
   - Upload multiple product images
   - Set primary image for display
   - Add alt text for accessibility

5. **Bill of Materials**
   - Add required components
   - Specify quantities for each component

6. **Bill of Labor**
   - Add required jobs/tasks
   - Specify time requirements for each task

7. **Validation & Creation**
   - Client-side validation
   - Server-side validation
   - Database constraints enforcement
   - Success confirmation with redirect to product detail

## Implementation Recommendations

### Priority 1: Basic Product CRUD
1. Create product creation form component
2. Implement POST `/api/products` endpoint
3. Add edit functionality and PUT endpoint
4. Connect existing "Add Product" and "Edit Product" buttons

### Priority 2: Enhanced Features
1. Implement automatic product code generation
2. Add comprehensive validation
3. Create product deletion functionality (done; now includes optimistic updates)
4. Add bulk operations support

### Priority 3: Advanced Features
1. Product import/export functionality
2. Product duplication/cloning
3. Advanced search and filtering
4. Product templates

## Code Examples

### Creating a Product via Web Interface (Current Method)
```typescript
// 1. User fills form with:
// - internal_code: "NEW-PRODUCT-001"
// - name: "New Product Name"
// - description: "Product description"
// - categories: [1, 2] (optional)

// 2. Form submits to API
const response = await fetch('/api/products', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    internal_code: 'NEW-PRODUCT-001',
    name: 'New Product Name',
    description: 'Product description',
    categories: [1, 2]
  })
});

// 3. API validates and creates product
const result = await response.json();
// Returns: { success: true, product: {...}, message: "Product created successfully" }
```

### Creating a Product via Direct Database (Alternative Method)
```typescript
const { data, error } = await supabase
  .from('products')
  .insert({
    internal_code: 'NEW-PRODUCT-001',
    name: 'New Product Name',
    description: 'Product description'
  })
  .select();
```

### Image Upload Process
```typescript
// 1. Generate unique filename
const uniqueName = generateUniqueImageName('NEW-PRODUCT-001', 'image.jpg');

// 2. Upload to Supabase storage
const { error: uploadError } = await supabase.storage
  .from('QButton')
  .upload(filePath, file);

// 3. Create database record
const { error: dbError } = await supabase
  .from('product_images')
  .insert({
    product_id: productId,
    image_url: publicUrl,
    is_primary: false
  });
```

## Best Practices

### Product Code Guidelines
- Use consistent naming conventions
- Include product type or category prefixes
- Keep codes short but descriptive
- Avoid special characters and spaces

### Image Management
- Always set one primary image per product
- Use descriptive alt text for accessibility
- Optimize images before upload
- Maintain consistent naming conventions

### Category Management
- Use hierarchical categories when possible
- Limit category assignments to relevant categories
- Keep category names consistent and clear

### Data Validation
- Validate product codes for uniqueness
- Ensure required fields are populated
- Check for valid data types and ranges
- Prevent duplicate entries where appropriate

This guide covers the current state of product creation in the Unity ERP system and provides a roadmap for implementing the missing functionality.
