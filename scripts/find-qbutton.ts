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
  const client = new Client({ connectionString: url, application_name: 'find-qbutton' })
  await client.connect()
  try {
    const like = '%qbutton%'
    const [schemas, tables, views] = await Promise.all([
      client.query("select schema_name from information_schema.schemata where schema_name ilike $1 order by 1", [like]),
      client.query(
        "select table_schema, table_name from information_schema.tables where table_type='BASE TABLE' and (table_name ilike $1 or table_schema ilike $1) order by 1,2",
        [like]
      ),
      client.query(
        "select table_schema, table_name from information_schema.tables where table_type='VIEW' and (table_name ilike $1 or table_schema ilike $1) order by 1,2",
        [like]
      ),
    ])

    const fmt = (rows: any[]) => rows.map(r => Object.values(r).join('.')).join('\n') || '(none)'

    console.log('Schemas matching qbutton:')
    console.log(fmt(schemas.rows))
    console.log('\nTables matching qbutton:')
    console.log(fmt(tables.rows))
    console.log('\nViews matching qbutton:')
    console.log(fmt(views.rows))
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})

