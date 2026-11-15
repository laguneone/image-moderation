const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const { ConflictException, ServiceUnavailableException } = require('@nestjs/common');
const { ImageValidationService } = require('../dist/moderations/image-validation.service');
const { ModerationsService } = require('../dist/moderations/moderations.service');

async function imageFile(name = '../../chair.png') {
  const buffer = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#eeeeee' } }).png().toBuffer();
  return { buffer, size: buffer.length, mimetype: 'image/png', originalname: name };
}

function harness({ existingAsset = null, existingJob = null, queueError = null } = {}) {
  const calls = { put: [], delete: [], queue: [], assetCreate: [], jobCreate: [], jobUpdate: [] };
  const asset = existingAsset ?? { id: 'asset-id', sha256: 'validated-later', objectKey: 'originals/file.png' };
  const prisma = {
    imageAsset: {
      findUnique: async () => existingAsset,
      create: async ({ data }) => {
        calls.assetCreate.push(data);
        return { ...asset, ...data };
      },
    },
    moderationJob: {
      findUnique: async () => existingJob,
      create: async ({ data }) => {
        calls.jobCreate.push(data);
        return { id: 'job-id', status: 'QUEUED', ...data };
      },
      update: async ({ data }) => calls.jobUpdate.push(data),
    },
  };
  const storage = {
    putObject: async (...args) => calls.put.push(args),
    deleteObject: async (key) => calls.delete.push(key),
  };
  const queue = {
    enqueue: async (payload) => {
      calls.queue.push(payload);
      if (queueError) throw queueError;
    },
  };
  const service = new ModerationsService(prisma, storage, queue, new ImageValidationService());
  return { service, calls };
}

const input = async (file = imageFile()) => ({
  applicationId: 'local',
  pipeline: 'interior-default',
  context: {},
  idempotencyKey: 'request-1',
  file: await file,
});

test('stores an original, creates an asset and enqueues an upload exactly once', async () => {
  const { service, calls } = harness();
  const result = await service.create(await input());

  assert.deepEqual(result, { job_id: 'job-id', status: 'queued' });
  assert.equal(calls.put.length, 1);
  assert.equal(calls.assetCreate.length, 1);
  assert.equal(calls.assetCreate[0].originalName, 'chair.png');
  assert.equal(calls.jobCreate.length, 1);
  assert.equal(calls.queue.length, 1);
  assert.equal(calls.queue[0].moderationJobId, 'job-id');
  assert.equal(calls.delete.length, 0);
});

test('reuses a cached asset and returns the existing job for an idempotent request', async () => {
  const cachedAsset = { id: 'asset-id', sha256: 'sha', objectKey: 'originals/cached.png' };
  const existingJob = { id: 'existing-job', applicationId: 'local', imageAssetId: 'asset-id', status: 'PROCESSING' };
  const { service, calls } = harness({ existingAsset: cachedAsset, existingJob });
  const result = await service.create(await input());

  assert.deepEqual(result, { job_id: 'existing-job', status: 'processing' });
  assert.equal(calls.put.length, 0);
  assert.equal(calls.assetCreate.length, 0);
  assert.equal(calls.jobCreate.length, 0);
  assert.equal(calls.queue.length, 0);
});

test('rejects reuse of an idempotency key for another application or asset', async () => {
  const existingJob = { id: 'existing-job', applicationId: 'other', imageAssetId: 'asset-id', status: 'QUEUED' };
  const { service } = harness({ existingAsset: { id: 'asset-id' }, existingJob });

  await assert.rejects(service.create(await input()), ConflictException);
});

test('records a failed status when the queue is unavailable', async () => {
  const { service, calls } = harness({ queueError: new Error('Redis unavailable') });

  await assert.rejects(service.create(await input()), ServiceUnavailableException);
  assert.equal(calls.jobUpdate[0].status, 'FAILED');
  assert.equal(calls.jobUpdate[0].errorCode, 'QUEUE_UNAVAILABLE');
});
