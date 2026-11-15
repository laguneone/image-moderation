const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const { BadRequestException } = require('@nestjs/common');
const { ImageValidationService } = require('../dist/moderations/image-validation.service');

const validator = new ImageValidationService();

test('accepts a verified static JPEG and calculates its digest and dimensions', async () => {
  const buffer = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const result = await validator.validate(buffer, 'image/jpeg', 1024 * 1024, 100, 100);

  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.width, 2);
  assert.equal(result.height, 3);
  assert.equal(result.frameCount, 1);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('rejects a MIME type that does not match the file signature', async () => {
  const buffer = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();

  await assert.rejects(validator.validate(buffer, 'image/jpeg', 1024 * 1024, 100, 100), BadRequestException);
});

test('rejects unsupported and empty files', async () => {
  await assert.rejects(validator.validate(Buffer.alloc(0), 'image/png', 1024, 100, 100), BadRequestException);
  await assert.rejects(validator.validate(Buffer.from('not an image'), 'image/png', 1024, 100, 100), BadRequestException);
});

test('rejects oversized files and dimensions above the configured pixel limit', async () => {
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();

  await assert.rejects(validator.validate(buffer, 'image/png', buffer.length - 1, 100, 100), BadRequestException);
  await assert.rejects(validator.validate(buffer, 'image/png', 1024, 3, 100), BadRequestException);
});
