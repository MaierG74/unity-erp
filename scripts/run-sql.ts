import fs from 'fs'
import path from 'path'
import { Client } from 'pg'
import * as dotenv from 'dotenv'

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' })

function getSupabaseUrlFromMcp(): string {
  // Try .mcp.json first, then .cursor/mcp.json
  let json;
  let configPath = '.mcp.json';
  try {
    json = JSON.parse(fs.readFileSync('.mcp.json', 'utf8'));
  } catch {
    try {
      json = JSON.parse(fs.readFileSync('.cursor/mcp.json', 'utf8'));
      configPath = '.cursor/mcp.json';
    } catch {
      throw new Error('Neither .mcp.json nor .cursor/mcp.json found');
    }
  }
  
  // Check if it's the new format with project-ref (needs DATABASE_URL from env)
  const supabaseConfig = json?.mcpServers?.supabase;
  if (supabaseConfig?.args?.some((arg: string) => arg.startsWith('--project-ref='))) {
    // New format - try to get DATABASE_URL from environment
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl && databaseUrl.startsWith('postgres')) {
      return databaseUrl;
    }
    throw new Error('DATABASE_URL not found in environment. New MCP format requires DATABASE_URL env var.');
  }
  
  // Old format with connection string in args
  const args: string[] | undefined = supabaseConfig?.args;
  if (!args || args.length < 3) throw new Error(`Supabase MCP args missing in ${configPath}`);
  const url = args[2];
  if (typeof url !== 'string' || !url.startsWith('postgres')) throw new Error('Invalid Supabase URL in MCP config');
  return url;
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
  const client = new Client({ 
    connectionString: url, 
    application_name: 'run-sql',
    ssl: { rejectUnauthorized: false }
  })
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
