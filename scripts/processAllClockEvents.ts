import { processAllClockEvents } from '../lib/utils/attendance';

(async () => {
  try {
    await processAllClockEvents();
    console.log('All clock events processed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error processing all clock events:', error);
    process.exit(1);
  }
})();
