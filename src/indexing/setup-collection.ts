// Standalone script — runs outside NestJS bootstrap.
// Usage:
//   npm run qdrant:setup                  # create collection if absent
//   npm run qdrant:setup:recreate         # delete and recreate (destructive)
//   npm run qdrant:setup:recreate -- --yes  # skip confirmation prompt (CI-safe)

// dotenv is loaded inside qdrant.client.ts at import time — no second call needed.
import { createQdrantClient, getCollectionName } from './qdrant.client';
import * as readline from 'node:readline/promises';

// ── Constants ────────────────────────────────────────────────────────────────

const VECTOR_SIZE = 3072; // text-embedding-3-large output dimensions
const DISTANCE = 'Cosine' as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

function warn(msg: string): void {
  console.warn(`[${ts()}] ⚠  ${msg}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const hasRecreate = process.argv.includes('--recreate');
  const hasYes = process.argv.includes('--yes');
  const isCI = process.env['CI'] === 'true';

  const collectionName = getCollectionName();
  const client = createQdrantClient();

  log(`Checking collection "${collectionName}"...`);

  const { exists } = await client.collectionExists(collectionName);

  if (exists) {
    if (!hasRecreate) {
      log(
        `Collection "${collectionName}" already exists. ` +
          `Pass --recreate to delete and recreate it.`,
      );
      process.exit(0);
    }

    // ── Destructive path: --recreate was passed ──────────────────────────────
    const info = await client.getCollection(collectionName);
    const pointCount = info.points_count ?? 0;

    warn(`You are about to DELETE "${collectionName}".`);
    warn(`Points that will be permanently lost: ${pointCount}`);

    if (!isCI && !hasYes) {
      // Require the user to type the collection name to confirm deletion.
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      let confirmed = false;
      try {
        const answer = await rl.question(
          `\nType the collection name to confirm deletion: `,
        );
        confirmed = answer.trim() === collectionName;
      } finally {
        rl.close();
      }

      if (!confirmed) {
        log('Aborted — collection name did not match. Nothing was changed.');
        process.exit(0);
      }
    } else {
      log(
        isCI
          ? 'Auto-confirmed: CI=true — skipping interactive prompt.'
          : 'Auto-confirmed: --yes flag passed.',
      );
    }

    log(`Deleting collection "${collectionName}"...`);
    await client.deleteCollection(collectionName);
    log('Deleted.');
  } else {
    log(`Collection "${collectionName}" does not exist.`);
  }

  // ── Create ───────────────────────────────────────────────────────────────
  log(`Creating collection "${collectionName}"...`);
  await client.createCollection(collectionName, {
    vectors: {
      size: VECTOR_SIZE,
      distance: DISTANCE,
      on_disk: false, // keep vectors in memory for fast search at small scale
    },
  });
  log('Collection created.');

  // ── Payload indexes ───────────────────────────────────────────────────────
  // Keyword indexes on sourceFile and sourceType enable efficient filtered
  // search (e.g. "search only within resume.md") without a full scan.
  log('Creating payload index on "sourceFile"...');
  await client.createPayloadIndex(collectionName, {
    field_name: 'sourceFile',
    field_schema: 'keyword',
    wait: true,
  });

  log('Creating payload index on "sourceType"...');
  await client.createPayloadIndex(collectionName, {
    field_name: 'sourceType',
    field_schema: 'keyword',
    wait: true,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  log('');
  log('✓ Setup complete.');
  log(`  Collection : ${collectionName}`);
  log(`  Dimensions : ${VECTOR_SIZE}`);
  log(`  Distance   : ${DISTANCE}`);
  log(`  On-disk    : false (in-memory)`);
  log(`  Indexes    : sourceFile (keyword), sourceType (keyword)`);

  process.exit(0);
}

void main().catch((err: unknown) => {
  console.error(
    `[${new Date().toISOString()}] Setup failed:`,
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
