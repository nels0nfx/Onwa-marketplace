import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from './logger.js';

test('logger emits JSON and redacts sensitive keys', () => {
  const lines: string[] = [];
  const log = createLogger('info', (l) => lines.push(l));
  log.info('hello', { authorization: 'Bearer abc', nested: { password: 'p', ok: 1 }, userId: 'u1' });
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0] as string);
  assert.equal(rec.msg, 'hello');
  assert.equal(rec.authorization, '[redacted]');
  assert.equal(rec.nested.password, '[redacted]');
  assert.equal(rec.nested.ok, 1);
  assert.equal(rec.userId, 'u1');
});

test('logger respects minimum level', () => {
  const lines: string[] = [];
  const log = createLogger('warn', (l) => lines.push(l));
  log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
  assert.equal(lines.length, 2);
});
