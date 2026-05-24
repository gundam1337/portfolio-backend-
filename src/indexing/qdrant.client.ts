// dotenv.config() must run before any other import reads process.env.
// Calling it here means any script that imports this module gets env vars
// populated automatically — no second dotenv call needed in the entry point.
import { config } from 'dotenv';
config();

import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Returns a configured QdrantClient using QDRANT_URL and QDRANT_API_KEY from env.
 * Throws immediately if QDRANT_URL is absent so the error is clear and early.
 */
export function createQdrantClient(): QdrantClient {
  const url = process.env['QDRANT_URL'];
  const apiKey = process.env['QDRANT_API_KEY'];

  if (!url) {
    throw new Error(
      'QDRANT_URL is not set. Add it to your .env file.\n' +
        'Example: QDRANT_URL=https://your-cluster-id.qdrant.io',
    );
  }

  // apiKey is optional for local Qdrant (no auth). When undefined the client
  // simply omits the api-key header. For Qdrant Cloud it is required — the
  // first API call will return 401 if it is missing, which surfaces in the
  // caller's catch block.
  return new QdrantClient({ url, apiKey });
}

/** Returns the collection name, falling back to 'personal_docs' if not set. */
export function getCollectionName(): string {
  return process.env['QDRANT_COLLECTION'] ?? 'personal_docs';
}
