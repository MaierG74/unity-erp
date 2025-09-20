import { NextResponse } from 'next/server';
import { processClockEventsIntoSegments } from '@/lib/utils/attendance';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { date, staffId } = await request.json();
    
    if (!date) {
      return NextResponse.json({ 
        status: 'error', 
        message: 'Date is required' 
      }, { status: 400 });
    }

    // Process clock events for the specific date and staff (if provided)
    await processClockEventsIntoSegments(date, staffId);

    const message = staffId
      ? `Processed clock events for staff ${staffId} on ${date}`
      : `Processed clock events for all staff on ${date}`;
    
    return NextResponse.json({ 
      status: 'success', 
      message 
    });
  } catch (error: any) {
    console.error('Error processing clock events:', error);
    return NextResponse.json({ 
      status: 'error', 
      message: error.message 
    }, { status: 500 });
  }
}