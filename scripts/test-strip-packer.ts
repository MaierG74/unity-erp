import { packWithStrips } from '../lib/cutlist/stripPacker.js';

// Test case matching Cutlist Optimizer
const stock = {
  id: 'standard',
  length_mm: 2750,
  width_mm: 1830,
  qty: 10,
  kerf_mm: 3,
};

const parts = [
  { id: 'part1', length_mm: 700, width_mm: 600, qty: 4, grain: 'length' as const },
  { id: 'part2', length_mm: 1200, width_mm: 750, qty: 1, grain: 'length' as const },
  { id: 'part3', length_mm: 400, width_mm: 1080, qty: 1, grain: 'length' as const },
];

console.log('Testing Strip Packer');
console.log('====================\n');

console.log('Parts:');
for (const p of parts) {
  console.log('  ' + p.id + ': ' + p.length_mm + '×' + p.width_mm + ' × ' + p.qty + ' (grain=' + p.grain + ')');
}
console.log('\nSheet: ' + stock.length_mm + '×' + stock.width_mm + ', kerf=' + stock.kerf_mm + 'mm\n');

const result = packWithStrips(parts, stock);

const sheetArea = stock.length_mm * stock.width_mm;
const utilization = (result.stats.used_area_mm2 / (sheetArea * result.sheets.length) * 100).toFixed(1);

console.log('Results:');
console.log('  Sheets: ' + result.sheets.length);
console.log('  Cuts: ' + result.cutCount);
console.log('  Utilization: ' + utilization + '%');

console.log('\nStrips by sheet:');
for (let i = 0; i < result.stripsBySheet.length; i++) {
  console.log('  Sheet ' + (i + 1) + ':');
  for (const strip of result.stripsBySheet[i]) {
    const partIds = strip.parts.map(p => p.part.uid + ' (' + p.width + '×' + p.height + ')').join(', ');
    console.log('    Strip @ y=' + strip.y + ', h=' + strip.height + ': ' + partIds);
  }
}

console.log('\nPlacements:');
for (const sheet of result.sheets) {
  console.log('  ' + sheet.sheet_id + ':');
  for (const p of sheet.placements) {
    console.log('    ' + p.part_id + ': (' + p.x + ', ' + p.y + ') ' + p.w + '×' + p.h + ' rot=' + p.rot);
  }
}

console.log('\nCut lines (' + result.cutLines.length + ' total):');
const horizontalCuts = result.cutLines.filter(c => c.type === 'horizontal');
const verticalCuts = result.cutLines.filter(c => c.type === 'vertical');
console.log('  Horizontal cuts: ' + horizontalCuts.length);
console.log('  Vertical cuts: ' + verticalCuts.length);
