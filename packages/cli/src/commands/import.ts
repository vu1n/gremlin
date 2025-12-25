/**
 * Import command - imports sessions from external sources
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createPostHogImporter,
  type PostHogConfig,
  type ListOptions,
} from '@gremlin/analysis';

export interface ImportOptions {
  output: string;
  verbose?: boolean;
}

export interface PostHogImportOptions extends ImportOptions {
  apiKey: string;
  projectId: string;
  host?: string;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  recordingId?: string;
}

export interface FileImportOptions extends ImportOptions {
  file: string;
  format?: 'rrweb' | 'posthog';
}

/**
 * Import sessions from PostHog
 */
export async function importFromPostHog(
  options: PostHogImportOptions
): Promise<void> {
  const { apiKey, projectId, host, output, verbose, limit, recordingId } =
    options;

  // Validate required options
  if (!apiKey) {
    console.error(
      '❌ PostHog API key required. Set POSTHOG_API_KEY or use --api-key'
    );
    console.error(
      '   Get your API key from: https://app.posthog.com/settings/user-api-keys'
    );
    process.exit(1);
  }

  if (!projectId) {
    console.error(
      '❌ PostHog project ID required. Set POSTHOG_PROJECT_ID or use --project-id'
    );
    console.error('   Find your project ID in the PostHog URL or settings');
    process.exit(1);
  }

  const config: PostHogConfig = {
    apiKey,
    projectId,
    baseUrl: host || 'https://app.posthog.com',
  };

  console.log('📥 Importing sessions from PostHog...');
  if (verbose) {
    console.log(`   Host: ${config.baseUrl}`);
    console.log(`   Project: ${projectId}`);
  }

  const importer = createPostHogImporter(config);

  try {
    // Ensure output directory exists
    await mkdir(output, { recursive: true });

    if (recordingId) {
      // Import a specific recording
      console.log(`   Fetching recording ${recordingId}...`);

      const recording = await importer.fetchRecording(recordingId);
      const session = importer.convertToGremlinSession(recording);

      const outputPath = join(output, `${recordingId}.json`);
      await writeFile(outputPath, JSON.stringify(session, null, 2));

      console.log(`✅ Imported 1 session`);
      console.log(`   → ${outputPath}`);
    } else {
      // List and import multiple recordings
      const listOptions: ListOptions = {
        limit: limit || 10,
      };

      if (options.dateFrom) {
        listOptions.dateFrom = new Date(options.dateFrom);
      }
      if (options.dateTo) {
        listOptions.dateTo = new Date(options.dateTo);
      }

      console.log(`   Listing recordings (limit: ${listOptions.limit})...`);

      const recordingList = await importer.listRecordings(listOptions);

      if (recordingList.results.length === 0) {
        console.log('⚠️  No recordings found matching filters');
        return;
      }

      console.log(`   Found ${recordingList.results.length} recordings`);
      if (recordingList.total_count) {
        console.log(`   (${recordingList.total_count} total available)`);
      }

      let imported = 0;
      const errors: string[] = [];

      for (const metadata of recordingList.results) {
        try {
          if (verbose) {
            console.log(
              `   Fetching ${metadata.id} (${Math.round(metadata.recording_duration)}s)...`
            );
          }

          const recording = await importer.fetchRecording(metadata.id);
          const session = importer.convertToGremlinSession(recording);

          const outputPath = join(output, `${metadata.id}.json`);
          await writeFile(outputPath, JSON.stringify(session, null, 2));

          imported++;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unknown error';
          errors.push(`${metadata.id}: ${message}`);
          if (verbose) {
            console.error(`   ❌ Failed to import ${metadata.id}: ${message}`);
          }
        }
      }

      console.log(`\n✅ Imported ${imported} sessions to ${output}`);

      if (errors.length > 0) {
        console.log(`⚠️  ${errors.length} recordings failed to import`);
        if (verbose) {
          for (const error of errors) {
            console.log(`   - ${error}`);
          }
        }
      }

      console.log('\nNext steps:');
      console.log(`  gremlin generate -i ${output}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`\n❌ Import failed: ${message}`);

    if (message.includes('401') || message.includes('403')) {
      console.error('\n💡 Check your API key permissions:');
      console.error('   - Ensure the key has "Session Recording" read access');
      console.error('   - Personal API keys work better than project keys');
    }

    process.exit(1);
  }
}

/**
 * Import sessions from a local file
 */
export async function importFromFile(options: FileImportOptions): Promise<void> {
  const { file, format, output, verbose } = options;

  console.log(`📥 Importing sessions from ${file}...`);

  try {
    const { importRrwebRecording } = await import('@gremlin/analysis');

    // Read file
    const content = await Bun.file(file).text();
    const events = JSON.parse(content);

    // Detect format if not specified
    const detectedFormat =
      format || (Array.isArray(events) ? 'rrweb' : 'posthog');

    if (verbose) {
      console.log(`   Format: ${detectedFormat}`);
      console.log(`   Events: ${Array.isArray(events) ? events.length : 'N/A'}`);
    }

    // Ensure output directory exists
    await mkdir(output, { recursive: true });

    if (detectedFormat === 'rrweb') {
      const session = importRrwebRecording(events);
      const outputPath = join(output, `imported-${Date.now()}.json`);
      await writeFile(outputPath, JSON.stringify(session, null, 2));

      console.log(`✅ Imported 1 session`);
      console.log(`   → ${outputPath}`);
    } else {
      console.error('❌ PostHog file format not yet supported');
      console.error('   Use --posthog flag to import directly from PostHog API');
      process.exit(1);
    }

    console.log('\nNext steps:');
    console.log(`  gremlin generate -i ${output}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`\n❌ Import failed: ${message}`);
    process.exit(1);
  }
}
