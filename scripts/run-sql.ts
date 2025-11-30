import fs from 'fs'
import path from 'path'
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
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: tsx scripts/run-sql.ts <sql-file>')
    process.exit(1)
  }
  const abs = path.resolve(process.cwd(), file)
  const sql = fs.readFileSync(abs, 'utf8')
  const url = getSupabaseUrlFromMcp()
  const client = new Client({ connectionString: url, application_name: 'run-sql' })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Executed SQL file:', file)
  } catch (err: any) {
    console.error('Query failed:', err.message)
    if (err?.position) {
      const pos = Number(err.position)
      const start = Math.max(0, pos - 120)
      const end = Math.min(sql.length, pos + 120)
      const snippet = sql.slice(start, end)
      console.error(`At position ${pos}. Context:`)
      console.error('---8<---')
      console.error(snippet)
      console.error('---8<---')
    }
    process.exit(1)
  } finally {
    await client.end()
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1) })
