import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

function readMcpConfig(): any {
  try {
    return JSON.parse(fs.readFileSync('.mcp.json', 'utf8'));
  } catch {
    return JSON.parse(fs.readFileSync('.cursor/mcp.json', 'utf8'));
  }
}

// Read MCP config to get project ref
const mcpConfig = readMcpConfig();
const supabaseConfig = mcpConfig.mcpServers?.supabase;

if (!supabaseConfig) {
  throw new Error('Supabase MCP config not found');
}

const projectRef = supabaseConfig.args?.find((arg: string) => arg.startsWith('--project-ref='))?.split('=')[1];
const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!projectRef || !serviceRoleKey) {
  throw new Error('Missing project-ref in MCP config or SUPABASE_SERVICE_KEY in environment');
}

const serviceKey = serviceRoleKey;

// Construct Supabase URL from project-ref
const supabaseUrl = `https://${projectRef}.supabase.co`;
const supabase = createClient(supabaseUrl, serviceKey);

async function executeSQL(sql: string) {
  // Try using Supabase REST API with rpc if exec_sql exists, otherwise use direct query
  // Since exec_sql doesn't exist, we'll use the REST API's query endpoint
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
      'apikey': serviceKey,
    },
    body: JSON.stringify({ sql }),
  }).catch(() => null);

  if (response && response.ok) {
    return await response.json();
  }

  // Fallback: Use pg client via connection string
  // For now, let's try the Management API approach with the service role key
  // Actually, service role key is for REST API, not Management API
  // Let's use the Supabase REST API query endpoint
  throw new Error('Direct SQL execution via Supabase REST API requires exec_sql RPC function');
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx scripts/execute-sql-direct.ts <sql-file>');
    process.exit(1);
  }

  const sql = fs.readFileSync(file, 'utf8');
  
  // Split SQL into individual statements
  const statements = sql
    .split(';')
    .map(s => {
      return s.split('\n')
        .map(line => {
          const commentIndex = line.indexOf('--');
          return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
        })
        .join('\n')
        .trim();
    })
    .filter(s => s.length > 0);

  console.log(`Executing ${statements.length} SQL statement(s)...\n`);

  // Since we can't execute SQL directly via REST API without exec_sql RPC,
  // let's output what needs to be executed
  console.log('⚠️  Direct SQL execution via Supabase REST API requires an exec_sql RPC function.');
  console.log('Please execute this SQL via the Supabase Dashboard SQL Editor:\n');
  console.log('--- SQL TO EXECUTE ---');
  console.log(sql);
  console.log('--- END SQL ---\n');
  
  console.log('Alternatively, if you have DATABASE_URL set, we can use pg client.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
