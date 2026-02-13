
import { packPartsSmartOptimized } from '../components/features/cutlist/packing';
import type { PartSpec, StockSheetSpec } from '../lib/cutlist/types';

// Performance measurement helper
async function measure(name: string, fn: () => Promise<any>) {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    return {
        name,
        time: end - start,
        result
    };
}

async function runBenchmark() {
    console.log('Starting Cutlist Deep Optimization Benchmark...');

    // Setup test data (complex enough to benefit from deep opt)
    const stock: StockSheetSpec[] = [{
        id: 'S1',
        length_mm: 2750,
        width_mm: 1830,
        qty: 100,
        kerf_mm: 3
    }];

    const parts: PartSpec[] = [
        // Mix of large and small parts
        { id: 'TableTop', length_mm: 1600, width_mm: 800, qty: 2, grain: 'length' },
        { id: 'SidePanel', length_mm: 720, width_mm: 600, qty: 4, grain: 'length' },
        { id: 'Shelf', length_mm: 760, width_mm: 350, qty: 6, grain: 'any' },
        { id: 'DrawerFront', length_mm: 396, width_mm: 196, qty: 8, grain: 'width' },
        { id: 'BackPanel', length_mm: 720, width_mm: 800, qty: 2, grain: 'length' },
        { id: 'ModestyPanel', length_mm: 1400, width_mm: 400, qty: 2, grain: 'length' },
        { id: 'Filler', length_mm: 720, width_mm: 100, qty: 4, grain: 'any' },
    ];

    console.log(`Packing ${parts.reduce((s, p) => s + p.qty, 0)} parts...`);

    // Run Strip (Fast)
    const stripRes = await measure('Fast (Strip)', async () => {
        return packPartsSmartOptimized(parts, stock, { algorithm: 'strip' });
    });

    // Run Guillotine (Standard/Offcut)
    const guillotineRes = await measure('Guillotine (Best Offcut)', async () => {
        return packPartsSmartOptimized(parts, stock, { algorithm: 'guillotine' });
    });

    // Run Deep (1s)
    const deepRes1s = await measure('Deep (1s)', async () => {
        return packPartsSmartOptimized(parts, stock, { algorithm: 'deep', timeBudgetMs: 1000 });
    });

    // Run Deep (3s)
    const deepRes3s = await measure('Deep (3s)', async () => {
        return packPartsSmartOptimized(parts, stock, { algorithm: 'deep', timeBudgetMs: 3000 });
    });

    // Report
    const runs = [stripRes, guillotineRes, deepRes1s, deepRes3s];

    console.table(runs.map(r => {
        const res = r.result;
        const sheetCount = res.sheets.reduce((sum: number, s: any) => sum + (s.used_area_mm2 / (2750 * 1830)), 0).toFixed(2);
        const wastePct = ((res.stats.waste_area_mm2 / (res.stats.used_area_mm2 + res.stats.waste_area_mm2)) * 100).toFixed(2);

        // Calculate largest offcut info from the result structure or re-calculate if needed
        // GuillotinePacker returns `largestOffcutArea` but `LayoutResult` might not expose it directly in `stats`.
        // We can infer it or just look at waste area. 
        // Actually `LayoutResult` doesn't strictly have `largestOffcutArea`. 
        // But `packPartsSmartOptimized` returns `LayoutResult & ...`
        // The internal `GuillotinePackResult` has it.
        // For this benchmark, we'll just print what we have.

        return {
            Algorithm: r.name,
            TimeMs: Math.round(r.time),
            Sheets: res.sheets.length,
            'Sheets (Frac)': sheetCount,
            'Waste %': wastePct + '%',
            Strategy: res.strategyUsed
        };
    }));

    // Analyze offcut consolidation (if available in internal stats or by checking usage)
    console.log('\nDetailed Comparison:');
    runs.forEach(r => {
        console.log(`\n--- ${r.name} ---`);
        console.log(`Sheets Used: ${r.result.sheets.length} (${r.result.stats.used_area_mm2.toLocaleString()} mm² used)`);
        console.log(`Strategy: ${r.result.strategyUsed}`);
    });
}

runBenchmark().catch(console.error);
