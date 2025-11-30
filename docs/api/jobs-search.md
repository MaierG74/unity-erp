# Jobs Search Pattern (Labor)

Purpose: document the scalable job selection/search used in the Labor section (Piecework Rates and other pickers).

Components using this pattern
- components/features/labor/piecework-rates-manager.tsx
- components/features/labor/jobs-manager.tsx (table uses same filters/pagination concepts)

Behavior
- Optional Category filter. When selected, the job list can be browsed immediately.
- Async, debounced search against Supabase with server-side pagination.
- If no category is selected: require at least 3 characters before querying.
- Page size: 25 items; show a "Load more" control to append.

Supabase query shape (illustrative)

```ts
const pageSize = 25
const from = (page - 1) * pageSize
const to = from + pageSize - 1

let q = supabase
  .from('jobs')
  .select('job_id, name, category_id')
  .order('name')

if (categoryId) q = q.eq('category_id', categoryId)
if (search) q = q.ilike('name', `%${search}%`)

const { data, error } = await q.range(from, to)
```

Indexes
- Consider enabling pg_trgm and add:
  - create index concurrently idx_jobs_category_name on public.jobs (category_id, lower(name));
  - create index concurrently idx_jobs_name_trgm on public.jobs using gin (name gin_trgm_ops);

Notes
- This pattern avoids fetching hundreds of jobs into a dropdown and provides consistent performance as the dataset grows.
