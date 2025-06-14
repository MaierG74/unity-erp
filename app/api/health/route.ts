import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Test database connection
    const { data, error } = await supabase.from('components').select('count').single();
    
    if (error) {
      console.error('Database health check failed:', error);
      return NextResponse.json(
        { 
          status: 'error', 
          message: 'Database connection failed', 
          error: error.message 
        }, 
        { status: 500 }
      );
    }
    
    return NextResponse.json({ 
      status: 'ok', 
      message: 'Server is healthy', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json(
      { 
        status: 'error', 
        message: 'Server error', 
        error: error instanceof Error ? error.message : String(error) 
      }, 
      { status: 500 }
    );
  }
} 