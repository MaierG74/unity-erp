import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  // This is a debug endpoint to clear auth state
  return NextResponse.json({ 
    message: 'Debug endpoint: Please clear your browser cookies and localStorage for this domain.' 
  });
} 