import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

async function main() {
    const sqlFile = process.argv[2];
    if (!sqlFile) {
        console.error('Usage: tsx scripts/run-migration-simple.ts <sql-file>');
        process.exit(1);
    }

    const databaseUrl = process.env.DATABASE_URL?.replace(':6543', ':5432');
    if (!databaseUrl) {
        console.error('DATABASE_URL not found in .env.local');
        process.exit(1);
    }


    const sql = fs.readFileSync(path.resolve(sqlFile), 'utf8');
    const client = new Client({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log(`Connecting to database...`);

        // Split SQL into statements while respecting $$ blocks
        const statements: string[] = [];
        let currentStatement = '';
        let inDollarBlock = false;

        const lines = sql.split('\n');
        for (const line of lines) {
            currentStatement += line + '\n';
            if (line.includes('$$')) {
                inDollarBlock = !inDollarBlock;
            }
            if (!inDollarBlock && line.trim().endsWith(';')) {
                statements.push(currentStatement.trim());
                currentStatement = '';
            }
        }
        if (currentStatement.trim().length > 0) {
            statements.push(currentStatement.trim());
        }

        for (let i = 0; i < statements.length; i++) {
            console.log(`Executing statement ${i + 1}/${statements.length}...`);
            await client.query(statements[i]);
        }

        console.log(`Successfully executed ${sqlFile}`);
    } catch (err) {
        console.error('Error executing SQL:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
