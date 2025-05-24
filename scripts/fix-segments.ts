import { processAllClockEvents } from '../lib/utils/attendance';

// Run the function to process all clock events
async function main() {
  console.log('Starting to process all clock events...');
  await processAllClockEvents();
  console.log('Finished processing all clock events!');
}

main().catch(error => {
  console.error('Error running script:', error);
  process.exit(1);
});
