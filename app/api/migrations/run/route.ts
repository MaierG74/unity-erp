import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * API Route to run database migrations
 * POST /api/migrations/run
 * Body: { migrationFile: "20251005_quote_email_log.sql" }
 */
export async function POST(req: NextRequest) {
  try {
    const { migrationFile } = await req.json();

    if (!migrationFile) {
      return NextResponse.json(
        { error: 'Migration file name is required' },
        { status: 400 }
      );
    }

    // Read the migration file
    const migrationPath = join(process.cwd(), 'migrations', migrationFile);
    const sql = readFileSync(migrationPath, 'utf-8');

    // Split SQL into individual statements (by semicolon, ignoring those in comments)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    const results = [];

    // Execute each statement
    for (const statement of statements) {
      const { data, error } = await supabaseAdmin.rpc('exec', {
        query: statement
      });

      if (error) {
        console.error('Migration statement failed:', statement);
        console.error('Error:', error);
        return NextResponse.json(
          {
            error: 'Migration failed',
            details: error.message,
            statement
          },
          { status: 500 }
        );
      }

      results.push({ statement: statement.substring(0, 50) + '...', success: true });
    }

    return NextResponse.json({
      success: true,
      message: `Migration ${migrationFile} completed successfully`,
      results
    });

  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: 'Failed to run migration', details: error.message },
      { status: 500 }
    );
  }
}
