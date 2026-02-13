/**
 * Web Worker entry point for Simulated Annealing optimization.
 *
 * Runs the SA algorithm off the main thread so the UI stays responsive
 * during long (10-60s) optimization runs.
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'start', parts, stock, config, packingConfig, timeBudgetMs }
 *     { type: 'cancel' }
 *
 *   Worker → Main:
 *     { type: 'progress', ...SAProgress }
 *     { type: 'complete', result: GuillotinePackResult }
 */

import type { PartSpec, StockSheetSpec } from './types';
import type { SAConfig, SAProgress } from './saOptimizer';
import type { PackingConfig, GuillotinePackResult } from './guillotinePacker';
import { runSimulatedAnnealing } from './saOptimizer';

// Message types from main thread
interface StartMessage {
  type: 'start';
  parts: PartSpec[];
  stock: StockSheetSpec;
  timeBudgetMs: number;
  config?: Partial<SAConfig>;
  packingConfig?: Partial<PackingConfig>;
}

interface CancelMessage {
  type: 'cancel';
}

type IncomingMessage = StartMessage | CancelMessage;

// Message types to main thread
interface ProgressMessage {
  type: 'progress';
  iteration: number;
  bestScore: number;
  bestResult: GuillotinePackResult;
  elapsed: number;
  temperature: number;
  improvementCount: number;
  baselineScore: number;
}

interface CompleteMessage {
  type: 'complete';
  result: GuillotinePackResult;
}

type OutgoingMessage = ProgressMessage | CompleteMessage;

// Track cancellation state
let cancelled = false;

// Listen for messages from main thread
self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (msg.type === 'start') {
    cancelled = false;

    const result = runSimulatedAnnealing(
      msg.parts,
      msg.stock,
      msg.timeBudgetMs,
      msg.config,
      msg.packingConfig,
      // Progress callback
      (progress: SAProgress) => {
        const progressMsg: ProgressMessage = {
          type: 'progress',
          ...progress,
        };
        (self as unknown as Worker).postMessage(progressMsg);
      },
      // Cancellation check
      () => cancelled
    );

    const completeMsg: CompleteMessage = {
      type: 'complete',
      result,
    };
    (self as unknown as Worker).postMessage(completeMsg);
  }
};
