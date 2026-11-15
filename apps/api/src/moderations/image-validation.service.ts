import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

export interface ValidatedImage {
  sha256: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  sizeBytes: number;
  width: number;
  height: number;
  frameCount: number;
}

const SIGNATURES = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  riff: Buffer.from('RIFF'),
  webp: Buffer.from('WEBP'),
} as const;

interface ImageSignature {
  format: 'jpeg' | 'png' | 'webp';
  mimeType: ValidatedImage['mimeType'];
  extension: ValidatedImage['extension'];
}

@Injectable()
export class ImageValidationService {
  async validate(
    buffer: Buffer,
    declaredMimeType: string,
    maxUploadBytes: number,
    maxImagePixels: number,
    maxImageSide: number,
  ): Promise<ValidatedImage> {
    if (buffer.length === 0) throw new BadRequestException('The uploaded file is empty.');
    if (buffer.length > maxUploadBytes) throw new BadRequestException('The uploaded file exceeds the configured size limit.');

    const signature = detectSignature(buffer);
    if (!signature) throw new BadRequestException('Unsupported image format. Use JPEG, PNG, or WebP.');
    if (signature.mimeType !== declaredMimeType.toLowerCase()) {
      throw new BadRequestException('The declared MIME type does not match the file signature.');
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer, { animated: true, limitInputPixels: maxImagePixels, failOn: 'error' }).metadata();
    } catch {
      throw new BadRequestException('The image is damaged or exceeds safe decoding limits.');
    }

    if (!metadata.width || !metadata.height || !metadata.format) {
      throw new BadRequestException('Image dimensions could not be verified.');
    }
    if (metadata.format !== signature.format) throw new BadRequestException('The image content does not match its file signature.');

    const frameCount = metadata.pages ?? 1;
    if (frameCount !== 1) throw new BadRequestException('Animated images are not supported.');
    if (metadata.width > maxImageSide || metadata.height > maxImageSide || metadata.width * metadata.height > maxImagePixels) {
      throw new BadRequestException('Image dimensions exceed the configured safety limits.');
    }

    return {
      sha256: createHash('sha256').update(buffer).digest('hex'),
      mimeType: signature.mimeType,
      extension: signature.extension,
      sizeBytes: buffer.length,
      width: metadata.width,
      height: metadata.height,
      frameCount,
    };
  }
}

function detectSignature(buffer: Buffer): ImageSignature | null {
  if (startsWith(buffer, SIGNATURES.jpeg)) return { mimeType: 'image/jpeg', extension: 'jpg', format: 'jpeg' };
  if (startsWith(buffer, SIGNATURES.png)) return { mimeType: 'image/png', extension: 'png', format: 'png' };
  if (
    startsWith(buffer, SIGNATURES.riff) &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).equals(SIGNATURES.webp)
  ) {
    return { mimeType: 'image/webp', extension: 'webp', format: 'webp' };
  }
  return null;
}

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}
