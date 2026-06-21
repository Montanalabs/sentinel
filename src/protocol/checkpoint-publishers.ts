/**
 * Concrete {@link CheckpointPublisher} sinks.
 *
 * Two starter implementations: a local file (one JSON document per checkpoint) and an HTTP webhook.
 * Both are deliberately thin — the value of a checkpoint is that it lands somewhere the gate
 * operator does not solely control. A transparency-log or on-chain anchor can implement the same
 * interface without changing the checkpoint domain type.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Checkpoint, CheckpointPublisher } from './checkpoint.js';

/** Writes each checkpoint as `<dir>/<checkpointId>.json`. */
export class FileCheckpointPublisher implements CheckpointPublisher {
  constructor(private readonly dir: string) {}

  async publish(checkpoint: Checkpoint): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${checkpoint.checkpointId}.json`), JSON.stringify(checkpoint, null, 2));
  }
}

/** POSTs each checkpoint as JSON to a webhook URL (e.g. an independent witness service). */
export class WebhookCheckpointPublisher implements CheckpointPublisher {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  async publish(checkpoint: Checkpoint): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(checkpoint),
    });
    if (!res.ok) throw new Error(`checkpoint webhook failed: HTTP ${res.status}`);
  }
}
