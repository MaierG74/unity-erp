// This is a simple script to fix the time segments
const { execSync } = require('child_process');

console.log('Starting to fix time segments...');

// Run the next.js command with our custom environment variable
try {
  execSync('NEXT_PUBLIC_FIX_SEGMENTS=true npm run dev', { 
    stdio: 'inherit',
    cwd: '/Users/gregorymaier/Documents/Projects/unity-erp'
  });
} catch (error) {
  console.error('Error running script:', error);
  process.exit(1);
}
