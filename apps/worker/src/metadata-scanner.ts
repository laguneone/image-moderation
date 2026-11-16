import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';

export interface MetadataScan {
  hasMetadata: boolean;
  tags: Record<string, string>;
  c2pa: { manifestPresent: boolean; signatureStatus: 'NOT_VERIFIED' };
  sourceUrls: Array<{ url: string; domain: string }>;
  suspiciousKeywords: string[];
  riskPoints: number;
}

@Injectable()
export class MetadataScanner {
  async scan(buffer: Buffer, originalName: string | null): Promise<MetadataScan> {
    const tags = await readExifTool(buffer);
    const text = [originalName ?? '', ...Object.values(tags)].join('\n');
    const sourceUrls = [...text.matchAll(/https?:\/\/[^\s"'<>]+/giu)].map(([url]) => {
      try {
        const normalized = new URL(url.replace(/[),.;]+$/u, ''));
        return { url: normalized.toString(), domain: normalized.hostname.toLowerCase() };
      } catch {
        return null;
      }
    }).filter((entry): entry is { url: string; domain: string } => entry !== null);
    const suspiciousKeywords = [...new Set((text.match(/\b(?:nsfw|explicit|adult|porn|xxx|nude|naked| эротик\w*)\b/giu) ?? []).map((word) => word.toLowerCase()))];
    return {
      hasMetadata: Object.keys(tags).length > 0,
      tags,
      c2pa: { manifestPresent: Object.keys(tags).some((key) => /c2pa|contentcredentials/iu.test(key)), signatureStatus: 'NOT_VERIFIED' },
      sourceUrls,
      suspiciousKeywords,
      riskPoints: 0,
    };
  }
}

function readExifTool(buffer: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn('exiftool', ['-json', '-G1', '-a', '-s', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000);
    let outputSize = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > 1_000_000) child.kill('SIGKILL');
      else output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`ExifTool could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`ExifTool failed: ${Buffer.concat(errors).toString('utf8').slice(0, 500)}`));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(output).toString('utf8'));
        if (!Array.isArray(parsed) || typeof parsed[0] !== 'object' || parsed[0] === null) throw new Error('Invalid ExifTool JSON output.');
        const tags: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed[0] as Record<string, unknown>)) {
          if (!key.startsWith('SourceFile') && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
            tags[key] = String(value).slice(0, 4000);
          }
        }
        resolve(tags);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Invalid ExifTool output.'));
      }
    });
    child.stdin.on('error', (error) => reject(new Error(`ExifTool input failed: ${error.message}`)));
    child.stdin.end(buffer);
  });
}
