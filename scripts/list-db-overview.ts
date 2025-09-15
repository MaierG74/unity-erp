import fs from 'fs'
import { Client } from 'pg'

function getSupabaseUrlFromMcp(): string {
  const json = JSON.parse(fs.readFileSync('.cursor/mcp.json', 'utf8'))
  const args: string[] | undefined = json?.mcpServers?.supabase?.args
  if (!args || args.length < 3) throw new Error('Supabase MCP args missing in .cursor/mcp.json')
  const url = args[2]
  if (typeof url !== 'string' || !url.startsWith('postgres')) throw new Error('Invalid Supabase URL in MCP config')
  return url
}

async function main() {
  const url = getSupabaseUrlFromMcp()
  const u = new URL(url)
  const client = new Client({ connectionString: url, application_name: 'list-db-overview' })
  await client.connect()
  try {
    console.log(`Host: ${u.hostname}, DB: ${u.pathname.slice(1)}`)

    const schemas = await client.query(
      "select schema_name from information_schema.schemata where schema_name not in ('pg_catalog','information_schema') order by 1"
    )
    console.log('\nSchemas:')
    for (const r of schemas.rows) console.log(`- ${r.schema_name}`)

    const tables = await client.query(
      `select n.nspname as schema, c.relname as table, coalesce(s.n_live_tup,0)::bigint as est_rows
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
       where c.relkind = 'r' and n.nspname not in ('pg_catalog','information_schema')
       order by 1,2
       limit 200`
    )
    console.log('\nTables (first 200):')
    for (const r of tables.rows) {
      console.log(`- ${r.schema}.${r.table}  ~${r.est_rows} rows`)
    }
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1) })

