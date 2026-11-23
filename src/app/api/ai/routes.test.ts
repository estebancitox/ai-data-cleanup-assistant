// The AI routes, called directly with a fake model client. SPEC §4.3 and §6.7.

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeRecording } from '../../../ai';
import { fakeModel, verdictOnAll } from '../../../ai/testing';
import { selectCases } from '../../../core/adjudicate';
import { analyze } from '../../../core/analyze';
import { buildContractRequest } from '../../../core/contract';
import { inventory, nursery, nurseryContract } from '../../../core/testing';
import { createAdjudicateHandler } from './adjudicate/handler';
import { createContractHandler } from './contract/handler';
import { createRateLimiter } from './handler';
import { createRecordingHandler } from './recording/handler';
import * as recordingRoute from './recording/route';
import * as statusRoute from './status/route';

const valid = buildContractRequest(nursery());
const good = { parsed: nurseryContract(), model: 'fake-model' };
const failing = { throws: Anthropic.APIError.generate(500, undefined, 'server error', new Headers()) };

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/ai/contract', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_MODEL', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/ai/contract', () => {
  it('answers 200 with the contract and the model', async () => {
    const model = fakeModel(good);
    const handler = createContractHandler({ getClient: () => model.client });
    const response = await handler(post(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contract: nurseryContract(), model: 'fake-model' });
    expect(model.requests).toHaveLength(1);
  });

  it('answers 400 to a body that is not a contract request, without calling the model', async () => {
    const model = fakeModel(good);
    const handler = createContractHandler({ getClient: () => model.client });
    for (const body of ['{ not json', '"text"', {}, { ...valid, prompt: 'Write a poem.' }, { ...valid, columns: [] }]) {
      const response = await handler(post(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(model.requests).toHaveLength(0);
  });

  it('answers 413 to a body over 256 KB, by its real size and by its declared size', async () => {
    const model = fakeModel(good);
    const handler = createContractHandler({ getClient: () => model.client });
    const large = await handler(post({ ...valid, padding: 'x'.repeat(256 * 1024) }));
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: 'too_large' });
    const declared = await handler(post(valid, { 'content-length': String(256 * 1024 + 1) }));
    expect(declared.status).toBe(413);
    // Just under the limit is read and then judged on its content.
    expect((await handler(post({ ...valid, padding: 'x'.repeat(200 * 1024) }))).status).toBe(400);
    expect(model.requests).toHaveLength(0);
  });

  it('answers 429 after 20 valid requests in 10 minutes from one address', async () => {
    let time = 1_000_000;
    const model = fakeModel(good);
    const handler = createContractHandler({ getClient: () => model.client, now: () => time });
    // Invalid requests do not use up the limit.
    for (let i = 0; i < 5; i += 1) expect((await handler(post({}))).status).toBe(400);
    for (let i = 0; i < 20; i += 1) {
      time += 1_000;
      expect((await handler(post(valid))).status).toBe(200);
    }
    const refused = await handler(post(valid));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'rate_limited' });
    expect(refused.headers.get('retry-after')).toBe('600');
    expect(model.requests).toHaveLength(20);

    // Another address has its own count.
    expect((await handler(post(valid, { 'x-forwarded-for': '198.51.100.2, 203.0.113.7' }))).status).toBe(200);
    // Ten minutes after the first request, one more is allowed.
    time = 1_000_000 + 1_000 + 10 * 60 * 1000;
    expect((await handler(post(valid))).status).toBe(200);
    expect((await handler(post(valid))).status).toBe(429);
  });

  it('retries once: a failure and then an answer is a 200', async () => {
    const model = fakeModel(failing, good);
    const handler = createContractHandler({ getClient: () => model.client });
    const response = await handler(post(valid));
    expect(response.status).toBe(200);
    expect(model.requests).toHaveLength(2);
  });

  it('answers 502 ai_unavailable after the single retry also fails', async () => {
    const model = fakeModel(failing);
    const handler = createContractHandler({ getClient: () => model.client });
    const response = await handler(post(valid));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'ai_unavailable' });
    expect(model.requests).toHaveLength(2);
  });

  it('answers 502 when the answer is invalid twice, and never returns a partial contract', async () => {
    const model = fakeModel({ parsed: { columns: [] } });
    const response = await createContractHandler({ getClient: () => model.client })(post(valid));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'ai_unavailable' });
  });

  it('answers 502 when the server has no API key', async () => {
    const response = await createContractHandler({ getClient: () => null })(post(valid));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'ai_unavailable' });
  });

  it('logs nothing', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    await createContractHandler({ getClient: () => fakeModel(good).client })(post(valid));
    await createContractHandler({ getClient: () => fakeModel(failing).client })(post(valid));
    await createContractHandler({ getClient: () => null })(post('{ not json'));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/adjudicate', () => {
  const stock = inventory();
  const cases = selectCases(stock, analyze(stock)).slice(0, 3);
  const adjudicatePost = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/ai/adjudicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
      body: JSON.stringify(body),
    });

  it('answers 200 with one verdict per case and the model', async () => {
    const model = fakeModel({ ...verdictOnAll('dismiss', 'Two different parts.'), model: 'fake-model' });
    const response = await createAdjudicateHandler({ getClient: () => model.client })(adjudicatePost({ cases }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      verdicts: cases.map((entry) => ({ issueId: entry.issueId, value: 'dismiss', reason: 'Two different parts.' })),
      model: 'fake-model',
    });
  });

  it('answers 400 to more than 10 cases, to none, and to anything else', async () => {
    const model = fakeModel(verdictOnAll('confirm'));
    const handler = createAdjudicateHandler({ getClient: () => model.client });
    const eleven = Array.from({ length: 11 }, () => cases[0]);
    for (const body of [{ cases: eleven }, { cases: [] }, {}, { cases, prompt: 'Write a poem.' }, { cases: [{ ...cases[0], detector: 'whitespace' }] }]) {
      const response = await handler(adjudicatePost(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(model.requests).toHaveLength(0);
  });

  it('answers 413 and 502 like the contract route', async () => {
    const failingModel = fakeModel(failing);
    const handler = createAdjudicateHandler({ getClient: () => failingModel.client });
    expect((await handler(adjudicatePost({ cases, padding: 'x'.repeat(256 * 1024) }))).status).toBe(413);
    const unavailable = await handler(adjudicatePost({ cases }));
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({ error: 'ai_unavailable' });
    expect(failingModel.requests).toHaveLength(2);
    expect((await createAdjudicateHandler({ getClient: () => null })(adjudicatePost({ cases }))).status).toBe(502);
  });

  it('shares the limit of 20 AI requests with the contract route', async () => {
    const limiter = createRateLimiter(() => 1_000_000);
    const contract = createContractHandler({ getClient: () => fakeModel(good).client, limiter });
    const adjudication = createAdjudicateHandler({ getClient: () => fakeModel(verdictOnAll('confirm')).client, limiter });
    for (let i = 0; i < 14; i += 1) expect((await adjudication(adjudicatePost({ cases }))).status).toBe(200);
    for (let i = 0; i < 6; i += 1) expect((await contract(post(valid))).status).toBe(200);
    expect((await adjudication(adjudicatePost({ cases }))).status).toBe(429);
    expect((await contract(post(valid))).status).toBe(429);
  });
});

describe('GET /api/ai/status', () => {
  it('reads the environment on every request', async () => {
    expect(await statusRoute.GET().json()).toEqual({ live: false, model: null });
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    expect(await statusRoute.GET().json()).toEqual({ live: true, model: 'claude-sonnet-5-5' });
  });

  it('is marked to be rendered at request time, not at build time', () => {
    expect(statusRoute.dynamic).toBe('force-dynamic');
    expect(recordingRoute.dynamic).toBe('force-dynamic');
  });
});

describe('GET /api/ai/recording', () => {
  const sha256 = 'c'.repeat(64);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'recording-route-'));
  writeRecording(
    { format: 1, dataset: 'nursery', sha256, recordedAt: '2000-01-01T00:00:00.000Z', model: 'fake-model', settings: {}, calls: [], contract: nurseryContract() },
    directory,
  );
  const handler = createRecordingHandler({ directory });
  const get = (query: string) => handler(new Request(`http://localhost/api/ai/recording${query}`));

  it('answers 200 with the contract, the model and the date; no verdicts for a recording made without adjudication', async () => {
    const response = get(`?sha256=${sha256}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contract: nurseryContract(), verdicts: [], model: 'fake-model', recordedAt: '2000-01-01T00:00:00.000Z' });
  });

  it('also answers with the recorded verdicts', async () => {
    const other = mkdtempSync(path.join(os.tmpdir(), 'recording-route-'));
    const verdicts = [{ issueId: 'range:36:height_cm:flag', value: 'confirm' as const, reason: 'No plant here is that tall.' }];
    writeRecording(
      { format: 2, dataset: 'nursery', sha256, recordedAt: '2000-01-01T00:00:00.000Z', model: 'fake-model', settings: {}, calls: [], contract: nurseryContract(), verdicts },
      other,
    );
    const response = createRecordingHandler({ directory: other })(new Request(`http://localhost/api/ai/recording?sha256=${sha256}`));
    expect(await response.json()).toMatchObject({ verdicts, model: 'fake-model' });
  });

  it('answers 404 when no recording matches', async () => {
    const response = get(`?sha256=${'d'.repeat(64)}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('answers 400 unless sha256 is 64 hexadecimal characters', async () => {
    for (const query of ['', '?sha256=', `?sha256=${'c'.repeat(63)}`, `?sha256=${'c'.repeat(65)}`, `?sha256=${'c'.repeat(63)}z`, '?sha256=../nursery']) {
      const response = get(query);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
  });
});
