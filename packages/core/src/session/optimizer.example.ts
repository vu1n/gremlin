/**
 * Example usage of the session optimizer
 *
 * This demonstrates how to use the compression and optimization APIs
 * for storing and transmitting GremlinSession data efficiently.
 */

import {
  compressSession,
  decompressSession,
  measureCompression,
  formatCompressionStats,
} from './optimizer.ts';
import { createSession } from './types.ts';
import type { GremlinSession, DeviceInfo, AppInfo } from './types.ts';

// ============================================================================
// Example: Basic Compression
// ============================================================================

function basicCompressionExample() {
  console.log('=== Basic Compression Example ===\n');

  // Create a sample session
  const device: DeviceInfo = {
    platform: 'web',
    osVersion: '1.0',
    screen: { width: 1920, height: 1080, pixelRatio: 1 },
  };

  const app: AppInfo = {
    name: 'MyApp',
    version: '1.0.0',
    identifier: 'https://myapp.com',
  };

  const session = createSession(device, app);

  // Add some events...
  session.events.push({
    dt: 100,
    type: 0, // TAP
    data: {
      kind: 'tap',
      x: 500,
      y: 300,
    },
  });

  // Compress the session
  const compressed = compressSession(session);

  console.log(`Original size: ${JSON.stringify(session).length} bytes`);
  console.log(`Compressed size: ${compressed.length} bytes`);
  console.log(`Compression ratio: ${(JSON.stringify(session).length / compressed.length).toFixed(2)}x\n`);

  // Decompress back to original
  const restored = decompressSession(compressed);
  console.log('Successfully restored session!');
  console.log(`Session ID: ${restored.header.sessionId}`);
  console.log(`Events: ${restored.events.length}\n`);
}

// ============================================================================
// Example: Storage Use Case
// ============================================================================

async function storageExample(session: GremlinSession) {
  console.log('=== Storage Use Case ===\n');

  // Compress for storage
  const compressed = compressSession(session);

  // Save to file/database/storage
  // await fs.writeFile('session.bin', compressed);
  console.log(`Stored ${compressed.length} bytes to storage`);

  // Later, load from storage
  // const loaded = await fs.readFile('session.bin');
  const restored = decompressSession(compressed);

  console.log(`Loaded session ${restored.header.sessionId}`);
  console.log(`Contains ${restored.events.length} events\n`);
}

// ============================================================================
// Example: Network Transmission
// ============================================================================

async function networkExample(session: GremlinSession) {
  console.log('=== Network Transmission Example ===\n');

  // Compress before sending
  const compressed = compressSession(session);

  // Convert to base64 for JSON APIs (if needed)
  const base64 = compressed.toString('base64');

  console.log(`Original JSON: ${JSON.stringify(session).length} bytes`);
  console.log(`Binary compressed: ${compressed.length} bytes`);
  console.log(`Base64 encoded: ${base64.length} bytes`);
  console.log(
    `Ratio: ${(JSON.stringify(session).length / compressed.length).toFixed(2)}x\n`
  );

  // Send over network
  // await fetch('/api/sessions', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/octet-stream' },
  //   body: compressed,
  // });

  // Or with base64
  // await fetch('/api/sessions', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ sessionData: base64 }),
  // });
}

// ============================================================================
// Example: Compression Analysis
// ============================================================================

function analysisExample(session: GremlinSession) {
  console.log('=== Compression Analysis ===\n');

  // Measure compression stats
  const stats = measureCompression(session);

  // Display formatted stats
  console.log(formatCompressionStats(stats));
  console.log();

  // Make decisions based on stats
  if (stats.finalRatio < 2) {
    console.log('⚠️  Warning: Low compression ratio. Session may contain:');
    console.log('   - Already compressed data (screenshots)');
    console.log('   - High entropy data (random strings)');
    console.log('   - Very small session size');
  } else if (stats.finalRatio > 10) {
    console.log('✅ Excellent compression! Session is highly compressible.');
  } else {
    console.log('✅ Good compression ratio achieved.');
  }
  console.log();
}

// ============================================================================
// Example: Batch Processing
// ============================================================================

function batchProcessingExample(sessions: GremlinSession[]) {
  console.log('=== Batch Processing Example ===\n');

  let totalOriginal = 0;
  let totalCompressed = 0;

  for (const session of sessions) {
    const compressed = compressSession(session);
    const originalSize = JSON.stringify(session).length;

    totalOriginal += originalSize;
    totalCompressed += compressed.length;
  }

  console.log(`Processed ${sessions.length} sessions`);
  console.log(`Total original size: ${(totalOriginal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total compressed size: ${(totalCompressed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Overall ratio: ${(totalOriginal / totalCompressed).toFixed(2)}x`);
  console.log(`Space saved: ${((1 - totalCompressed / totalOriginal) * 100).toFixed(1)}%\n`);
}

// ============================================================================
// Run Examples
// ============================================================================

if (import.meta.main) {
  basicCompressionExample();
}
