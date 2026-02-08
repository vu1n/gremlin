/**
 * Import command - imports sessions from external sources
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  createPostHogImporter,
  type PostHogConfig,
  type ListOptions,
} from '@gremlin/analysis';
import { output, outputError, type OutputOptions } from '../output.ts';

export interface ImportOptions extends OutputOptions {
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

export interface ImportResult {
  source: string;
  imported: number;
  failed: number;
  sessions: string[];
}

/**
 * Import sessions from PostHog
 */
export async function importFromPostHog(
  options: PostHogImportOptions
): Promise<ImportResult> {
  const { apiKey, projectId, host, output: outputDir, verbose, limit, recordingId } =
    options;

  // Validate required options
  if (!apiKey) {
    if (outputError('import', ['PostHog API key required. Set POSTHOG_API_KEY or use --api-key'], options)) {
      process.exit(1);
    }
    console.error(
      'PostHog API key required. Set POSTHOG_API_KEY or use --api-key'
    );
    console.error(
      '   Get your API key from: https://app.posthog.com/settings/user-api-keys'
    );
    process.exit(1);
  }

  if (!projectId) {
    if (outputError('import', ['PostHog project ID required. Set POSTHOG_PROJECT_ID or use --project-id'], options)) {
      process.exit(1);
    }
    console.error(
      'PostHog project ID required. Set POSTHOG_PROJECT_ID or use --project-id'
    );
    console.error('   Find your project ID in the PostHog URL or settings');
    process.exit(1);
  }

  const config: PostHogConfig = {
    apiKey,
    projectId,
    baseUrl: host || 'https://app.posthog.com',
  };

  if (!options.json) {
    console.log('Importing sessions from PostHog...');
    if (verbose) {
      console.log(`   Host: ${config.baseUrl}`);
      console.log(`   Project: ${projectId}`);
    }
  }

  const importer = createPostHogImporter(config);

  try {
    await mkdir(outputDir, { recursive: true });

    if (recordingId) {
      if (!options.json) console.log(`   Fetching recording ${recordingId}...`);

      const recording = await importer.fetchRecording(recordingId);
      const session = importer.convertToGremlinSession(recording);

      // Sanitize ID to prevent path traversal
      const safeId = basename(recordingId).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const outputPath = join(outputDir, `${safeId}.json`);
      await writeFile(outputPath, JSON.stringify(session, null, 2));

      const result: ImportResult = {
        source: 'posthog',
        imported: 1,
        failed: 0,
        sessions: [recordingId],
      };

      if (output('import', result, options)) return result;

      console.log(`Imported 1 session`);
      console.log(`   ${outputPath}`);
      return result;
    } else {
      const listOptions: ListOptions = {
        limit: limit || 10,
      };

      if (options.dateFrom) {
        listOptions.dateFrom = new Date(options.dateFrom);
      }
      if (options.dateTo) {
        listOptions.dateTo = new Date(options.dateTo);
      }

      if (!options.json) console.log(`   Listing recordings (limit: ${listOptions.limit})...`);

      const recordingList = await importer.listRecordings(listOptions);

      if (recordingList.results.length === 0) {
        const result: ImportResult = { source: 'posthog', imported: 0, failed: 0, sessions: [] };
        if (output('import', result, options)) return result;
        console.log('No recordings found matching filters');
        return result;
      }

      if (!options.json) {
        console.log(`   Found ${recordingList.results.length} recordings`);
        if (recordingList.total_count) {
          console.log(`   (${recordingList.total_count} total available)`);
        }
      }

      let imported = 0;
      const errors: string[] = [];
      const sessionIds: string[] = [];

      for (const metadata of recordingList.results) {
        try {
          if (verbose && !options.json) {
            console.log(
              `   Fetching ${metadata.id} (${Math.round(metadata.recording_duration)}s)...`
            );
          }

          const recording = await importer.fetchRecording(metadata.id);
          const session = importer.convertToGremlinSession(recording);

          // Sanitize ID to prevent path traversal
          const safeMetaId = basename(metadata.id).replace(/[^a-zA-Z0-9_\-]/g, '_');
          const outputPath = join(outputDir, `${safeMetaId}.json`);
          await writeFile(outputPath, JSON.stringify(session, null, 2));

          imported++;
          sessionIds.push(metadata.id);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unknown error';
          errors.push(`${metadata.id}: ${message}`);
          if (verbose && !options.json) {
            console.error(`   Failed to import ${metadata.id}: ${message}`);
          }
        }
      }

      const result: ImportResult = {
        source: 'posthog',
        imported,
        failed: errors.length,
        sessions: sessionIds,
      };

      if (output('import', result, options)) return result;

      console.log(`\nImported ${imported} sessions to ${outputDir}`);

      if (errors.length > 0) {
        console.log(`${errors.length} recordings failed to import`);
        if (verbose) {
          for (const error of errors) {
            console.log(`   - ${error}`);
          }
        }
      }

      console.log('\nNext steps:');
      console.log(`  gremlin generate -i ${outputDir}`);
      return result;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (outputError('import', [`Import failed: ${message}`], options)) {
      process.exit(1);
    }
    console.error(`\nImport failed: ${message}`);

    if (message.includes('401') || message.includes('403')) {
      console.error('\nCheck your API key permissions:');
      console.error('   - Ensure the key has "Session Recording" read access');
      console.error('   - Personal API keys work better than project keys');
    }

    process.exit(1);
  }
}

/**
 * Import sessions from a local file
 */
export async function importFromFile(options: FileImportOptions): Promise<ImportResult> {
  const { file, format, output: outputDir, verbose } = options;

  if (!options.json) console.log(`Importing sessions from ${file}...`);

  try {
    const { importRrwebRecording } = await import('@gremlin/analysis');

    const content = await Bun.file(file).text();
    const events = JSON.parse(content);

    const detectedFormat =
      format || (Array.isArray(events) ? 'rrweb' : 'posthog');

    if (verbose && !options.json) {
      console.log(`   Format: ${detectedFormat}`);
      console.log(`   Events: ${Array.isArray(events) ? events.length : 'N/A'}`);
    }

    await mkdir(outputDir, { recursive: true });

    if (detectedFormat === 'rrweb') {
      const session = importRrwebRecording(events);
      const sessionId = `imported-${Date.now()}`;
      const outputPath = join(outputDir, `${sessionId}.json`);
      await writeFile(outputPath, JSON.stringify(session, null, 2));

      const result: ImportResult = {
        source: 'file',
        imported: 1,
        failed: 0,
        sessions: [sessionId],
      };

      if (output('import', result, options)) return result;

      console.log(`Imported 1 session`);
      console.log(`   ${outputPath}`);

      console.log('\nNext steps:');
      console.log(`  gremlin generate -i ${outputDir}`);
      return result;
    } else {
      const result: ImportResult = { source: 'file', imported: 0, failed: 1, sessions: [] };
      if (outputError('import', ['PostHog file format not yet supported. Use --posthog flag to import directly from PostHog API'], options)) {
        process.exit(1);
      }
      console.error('PostHog file format not yet supported');
      console.error('   Use --posthog flag to import directly from PostHog API');
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (outputError('import', [`Import failed: ${message}`], options)) {
      process.exit(1);
    }
    console.error(`\nImport failed: ${message}`);
    process.exit(1);
  }
}
