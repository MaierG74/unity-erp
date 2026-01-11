import fs from 'fs';
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
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!projectRef || !accessToken) {
  throw new Error('Missing project-ref in MCP config or SUPABASE_ACCESS_TOKEN in environment');
}

async function executeSQL(sql: string) {
  // Use Supabase Management API to execute SQL
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: sql,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SQL execution failed: ${response.status} ${error}`);
  }

  return await response.json();
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx scripts/execute-sql-via-mcp-config.ts <sql-file>');
    process.exit(1);
  }

  const sql = fs.readFileSync(file, 'utf8');
  
  // Split SQL into individual statements, handling comments
  const statements = sql
    .split(';')
    .map(s => {
      // Remove single-line comments
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

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    console.log(`[${i + 1}/${statements.length}] Executing statement...`);
    
    try {
      const result = await executeSQL(statement + ';');
      console.log('✅ Success');
      if (result && Array.isArray(result) && result.length > 0) {
        console.log('Result:');
        console.table(result);
      } else if (result) {
        console.log('Result:', JSON.stringify(result, null, 2));
      }
    } catch (err: any) {
      console.error('❌ Error:', err.message);
      console.error('Statement:', statement.substring(0, 200) + (statement.length > 200 ? '...' : ''));
      throw err;
    }
    console.log('');
  }

  console.log('All statements executed successfully!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
