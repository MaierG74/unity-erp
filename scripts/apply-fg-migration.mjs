import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

async function main() {
  const sqlPath = process.argv[2] || 'db/migrations/20250920_fg_reservations.sql'

  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  const host = process.env.PGHOST
  const user = process.env.PGUSER
  const password = process.env.PGPASSWORD
  const database = process.env.PGDATABASE
  const port = process.env.PGPORT ? Number(process.env.PGPORT) : undefined

  let client
  if (url) {
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  } else if (host && user && password && database) {
    client = new Client({ host, user, password, database, port, ssl: { rejectUnauthorized: false } })
  } else {
    console.error('[apply-fg-migration] Missing DB connection info. Provide SUPABASE_DB_URL or PG* env vars.')
    process.exit(1)
  }

  const sql = await readFile(sqlPath, 'utf8')
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('[apply-fg-migration] Migration applied successfully.')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('[apply-fg-migration] Failed:', e.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
