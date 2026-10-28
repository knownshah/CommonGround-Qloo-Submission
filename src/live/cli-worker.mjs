import { runQloo } from '@qloo/qloo-harness';
import { startCliWorker } from './cli-worker-runtime.mjs';

startCliWorker(runQloo);
