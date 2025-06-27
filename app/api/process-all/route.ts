import { NextResponse } from 'next/server';
import { processAllClockEvents } from '@/lib/utils/attendance';

export async function GET() {
  try {
    await processAllClockEvents();
    return NextResponse.json({ status: 'success', message: 'Processed all clock events.' });
  } catch (error: any) {
    console.error('Error processing all clock events:', error);
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
