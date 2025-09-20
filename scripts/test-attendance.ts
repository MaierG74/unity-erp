import { processClockEventsIntoSegments } from '@/lib/utils/attendance';
import { format } from 'date-fns';

// Get today's date in YYYY-MM-DD format
const today = format(new Date(), 'yyyy-MM-dd');

async function runTest() {
  console.log(`Processing clock events for ${today}...`);
  
  try {
    // Process clock events into segments (summary regeneration handled inside the helper)
    await processClockEventsIntoSegments(today);
    console.log('Successfully processed clock events into segments');

    console.log('Test completed successfully');
  } catch (error) {
    console.error('Error running test:', error);
  }
}

// Run the test
runTest();
