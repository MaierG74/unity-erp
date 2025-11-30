# Supabase Query Patterns & Troubleshooting

## Overview
This guide documents common Supabase query patterns, anti-patterns, and troubleshooting steps based on real issues encountered in the Unity ERP codebase.

## Table of Contents
1. [Query Chain Immutability](#query-chain-immutability)
2. [Join Syntax & Foreign Keys](#join-syntax--foreign-keys)
3. [Filter Operators](#filter-operators)
4. [Client Types (Admin vs Authenticated)](#client-types)
5. [Common Errors & Solutions](#common-errors--solutions)

---

## Query Chain Immutability

### ❌ Anti-Pattern: Mutating Query Chain
Supabase query methods return **new** query objects. Calling methods without reassigning loses the modifications.

```typescript
// WRONG: Conditional filter is lost
const ordersQuery = supabase
  .from('orders')
  .select('*')
  .order('created_at', { ascending: false });

if (search) {
  ordersQuery.ilike('order_number', `%${search}%`); // ❌ LOST!
}

const { data } = await ordersQuery; // search filter never applied
```

### ✅ Correct Pattern: Reassign Query Chain
```typescript
// CORRECT: Reassign to capture modifications
let ordersQuery = supabase
  .from('orders')
  .select('*')
  .order('created_at', { ascending: false });

if (search) {
  ordersQuery = ordersQuery.ilike('order_number', `%${search}%`); // ✅ Captured!
}

const { data } = await ordersQuery; // search filter applied
```

### Why This Happens
Supabase uses a fluent/builder pattern where each method returns a new query object:
```typescript
class QueryBuilder {
  ilike(column: string, pattern: string): QueryBuilder {
    return new QueryBuilder(/* with new filter */);
  }
}
```

---

## Join Syntax & Foreign Keys

### Understanding Foreign Key Relationships
Supabase automatically detects foreign key relationships. You can join related tables using the table name in the `select()` clause.

#### Example Schema
```sql
-- Foreign keys
orders.customer_id → customers.id
orders.status_id → order_statuses.status_id
supplier_orders.supplier_component_id → suppliercomponents.supplier_component_id
suppliercomponents.supplier_id → suppliers.id
```

### ❌ Anti-Pattern: Alias Syntax (Unreliable)
```typescript
// WRONG: Alias syntax doesn't work consistently
const { data } = await supabase
  .from('orders')
  .select(`
    order_id,
    customer:customers(name),
    status:order_statuses(status_name)
  `);

// Trying to access:
const customerName = data[0].customer?.name; // May not work
```

### ✅ Correct Pattern: Table Name Syntax
```typescript
// CORRECT: Use table names directly
const { data } = await supabase
  .from('orders')
  .select(`
    order_id,
    customer_id,
    customers(name),
    order_statuses(status_name)
  `);

// Access nested data:
const customerName = data[0].customers?.name; // ✅ Works
const statusName = data[0].order_statuses?.status_name; // ✅ Works
```

### Nested Relationships (Multi-hop Joins)
When the relationship requires multiple hops, chain the table names:

```typescript
// supplier_orders → suppliercomponents → suppliers
const { data } = await supabase
  .from('supplier_orders')
  .select(`
    order_id,
    supplier_component_id,
    suppliercomponents(
      supplier_id,
      suppliers(name)
    )
  `);

// Access deeply nested data:
const supplierName = data[0].suppliercomponents?.suppliers?.name;
```

### TypeScript Typing Consideration
When using nested joins, TypeScript may not infer the correct types. Use type assertions:

```typescript
type SupplierOrderWithSupplier = {
  order_id: number;
  supplier_component_id: number;
  suppliercomponents?: {
    supplier_id: number;
    suppliers?: {
      name: string;
    };
  } | null;
};

const { data } = await supabase
  .from('supplier_orders')
  .select(`
    order_id,
    supplier_component_id,
    suppliercomponents(supplier_id, suppliers(name))
  `);

const typedData = data as unknown as SupplierOrderWithSupplier[];
```

---

## Filter Operators

### Text Search with `.ilike()`
Case-insensitive pattern matching (PostgreSQL `ILIKE`):

```typescript
// Single column
const { data } = await supabase
  .from('orders')
  .select('*')
  .ilike('order_number', '%apollo%');

// Multiple patterns with .or()
const { data } = await supabase
  .from('orders')
  .select('*')
  .or(`order_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
```

### ❌ Anti-Pattern: Type Casting in Filters
PostgreSQL type casting (`::text`) doesn't work well with Supabase filter syntax:

```typescript
// WRONG: Causes parse errors
const { data } = await supabase
  .from('supplier_orders')
  .select('*')
  .or(`order_id::text.ilike.%${term}%`);

// Error: unexpected "d" expecting "(" in logic tree
```

### ✅ Workaround: Filter by Original Type
```typescript
// CORRECT: Filter numeric columns by numeric values
const searchNumber = parseInt(search, 10);
if (!isNaN(searchNumber)) {
  const { data } = await supabase
    .from('supplier_orders')
    .select('*')
    .eq('order_id', searchNumber);
}
```

Or create a PostgreSQL computed column:
```sql
ALTER TABLE supplier_orders
  ADD COLUMN order_id_text TEXT GENERATED ALWAYS AS (order_id::text) STORED;

CREATE INDEX idx_supplier_orders_order_id_text ON supplier_orders (order_id_text);
```

Then search the computed column:
```typescript
const { data } = await supabase
  .from('supplier_orders')
  .select('*')
  .ilike('order_id_text', `%${term}%`);
```

---

## Client Types

### `supabaseAdmin` vs `ctx.supabase`

#### Admin Client (Service Role)
- **Use case**: Bypasses RLS, full database access
- **Authentication**: Requires `SUPABASE_SERVICE_ROLE_KEY` environment variable
- **When to use**: Background jobs, admin operations, seeding data
- **Security risk**: ⚠️ High - bypasses all security policies

```typescript
import { supabaseAdmin } from '@/lib/supabase-admin';

// Bypasses RLS - use with caution!
const { data } = await supabaseAdmin
  .from('users')
  .select('*'); // Returns ALL users regardless of RLS
```

#### Authenticated Client (User Context)
- **Use case**: API routes handling user requests
- **Authentication**: Uses user's JWT token from session
- **When to use**: All user-facing API endpoints
- **Security**: ✅ Respects RLS policies

```typescript
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: 401 });
  }

  // Respects RLS - only returns data user has access to
  const { data } = await ctx.supabase
    .from('orders')
    .select('*'); // Only orders the user can see

  return NextResponse.json(data);
}
```

### When You Get "Missing SUPABASE_SERVICE_ROLE_KEY" Error
This means you're using `supabaseAdmin` without the environment variable configured.

**Solution**: Switch to authenticated client unless you truly need admin access:
```typescript
// BEFORE
const { data } = await supabaseAdmin.from('orders').select('*');

// AFTER
const { data } = await ctx.supabase.from('orders').select('*');
```

---

## Common Errors & Solutions

### Error: "Could not find a relationship between 'X' and 'Y'"

**Example**:
```
Could not find a relationship between 'supplier_orders' and 'suppliers' in the schema cache
```

**Cause**: You're trying to join two tables that don't have a direct foreign key relationship.

**Solution**: Check the foreign key chain and use nested joins:
```typescript
// Check foreign keys:
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'supplier_orders';

// Result: supplier_orders.supplier_component_id → suppliercomponents
//         suppliercomponents.supplier_id → suppliers

// WRONG: Direct join
.select('supplier_orders(*, suppliers(name))')

// CORRECT: Nested join through junction table
.select('supplier_orders(*, suppliercomponents(suppliers(name)))')
```

---

### Error: "Failed to parse logic tree"

**Example**:
```
"failed to parse logic tree ((order_id::text.ilike.%test%))" (line 1, column 6)
```

**Cause**: Invalid PostgreSQL syntax in filter expression, often type casting in `.or()` filters.

**Solution**: Remove type casting or use computed columns (see [Filter Operators](#filter-operators)).

---

### Error: "new row violates row-level security policy"

**Example**:
```
new row violates row-level security policy for table "todo_items"
```

**Cause**: RLS policy is blocking the insert/update.

**Common Issues**:
1. Using `auth.uid()` on server-side (returns NULL) instead of `auth.jwt()->>'sub'`
2. Foreign key constraint fails (referenced row doesn't exist)
3. User doesn't have required role/permission

**Debugging Steps**:

1. **Check RLS policy syntax**:
```sql
-- WRONG: auth.uid() returns NULL on server
CREATE POLICY todo_items_insert ON todo_items
  FOR INSERT WITH CHECK (created_by = auth.uid());

-- CORRECT: Use JWT claim
CREATE POLICY todo_items_insert ON todo_items
  FOR INSERT WITH CHECK (
    created_by = (auth.jwt()->>'sub')::uuid
  );
```

2. **Check foreign key constraints**:
```sql
-- Does the user profile exist?
SELECT id FROM profiles WHERE id = 'user-uuid-here';

-- If not, backfill:
INSERT INTO profiles (id, username)
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
WHERE p.id IS NULL;
```

3. **Temporarily disable RLS to diagnose**:
```sql
-- ⚠️ DANGER: Only do this in development!
ALTER TABLE todo_items DISABLE ROW LEVEL SECURITY;

-- Try insert again to see if it's RLS or data issue

-- Re-enable after testing:
ALTER TABLE todo_items ENABLE ROW LEVEL SECURITY;
```

---

### Error: "Searched for a foreign key relationship... but no matches were found"

**Example**:
```
Searched for a foreign key relationship between 'supplier_orders' and 'suppliers'
Hint: Perhaps you meant 'suppliercomponents' instead
```

**Cause**: You're selecting a join that doesn't exist.

**Solution**: Follow the hint and check the actual foreign key relationships:
```sql
-- List all foreign keys for a table
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'supplier_orders';
```

Then adjust your query to follow the actual relationships.

---

## Best Practices

### 1. Always Reassign Query Chains with Conditionals
```typescript
let query = supabase.from('table').select('*');
if (filter) query = query.eq('status', filter);
if (search) query = query.ilike('name', `%${search}%`);
const { data } = await query;
```

### 2. Use Table Names for Joins (Not Aliases)
```typescript
.select('order_id, customers(name), order_statuses(status_name)')
// Access: data[0].customers.name
```

### 3. Prefer Authenticated Client Over Admin Client
```typescript
// In API routes
const ctx = await getRouteClient(req);
const { data } = await ctx.supabase.from('table').select('*');
```

### 4. Add Detailed Error Logging
```typescript
const { data, error } = await supabase.from('table').select('*');
if (error) {
  console.error('[context] Query failed:', error);
  throw error;
}
```

### 5. Document Foreign Key Relationships
When working with complex joins, add a comment:
```typescript
// Foreign key chain: supplier_orders → suppliercomponents → suppliers
const { data } = await supabase
  .from('supplier_orders')
  .select('order_id, suppliercomponents(suppliers(name))');
```

---

## Related Documentation
- [Supabase Joins Documentation](https://supabase.com/docs/guides/database/joins-and-nesting)
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgREST API Reference](https://postgrest.org/en/stable/api.html)
- [Entity Link Picker Fix](../changelogs/todo-entity-link-picker-fix-20251009.md)
- [Todo Module Fixes](../changelogs/todo-module-fixes-20251008.md)
