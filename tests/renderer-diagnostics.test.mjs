import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeError, reportError } from '../src/diagnostics.js';

test('renderer errors retain classification and safe source locations without private values', () => {
  const error = new TypeError('Network connection failed with PRIVATE_TEXT PRIVATE_KEY');
  error.code = 'ECONNRESET';
  error.stack = 'TypeError: PRIVATE_TEXT\n    at PRIVATE_FUNCTION (file:///D:/PRIVATE_USER/WRAITER/dist/assets/index-abc.js:25:4)\n    at D:\\PRIVATE_USER\\PRIVATE_DOCUMENT.js:1:2\n    at node:fs:19:1';
  const safe = serializeError(error, { componentStack: '\n    at PRIVATE_COMPONENT (file:///D:/PRIVATE_USER/WRAITER/src/App.jsx:40:6)' });
  assert.equal(safe.name, 'TypeError');
  assert.equal(safe.category, 'connection');
  assert.equal(safe.code, 'ECONNRESET');
  assert.equal(safe.stack, '\n    at /dist/assets/index-abc.js:25:4\n    at node:fs:19:1');
  assert.equal(safe.componentStack, '\n    at /src/App.jsx:40:6');
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_|file:|D:/);
});

test('ErrorEvent source coordinates and string rejections survive without raw messages', () => {
  assert.deepEqual(serializeError('Request timed out: PRIVATE_TEXT', { filename: 'file:///D:/PRIVATE_USER/WRAITER/dist/assets/index-def.js', lineno: 8, colno: 0 }), {
    name: 'Error', category: 'timeout', stack: '\n    at /dist/assets/index-def.js:8:0',
  });
  assert.equal(serializeError(undefined, { filename: 'file:///D:/PRIVATE_FILE.txt', lineno: 4, colno: 7 }).stack, '');
  assert.equal(serializeError({ name: 'AbortError', message: 'PRIVATE_TEXT' }).category, 'cancelled');
  assert.equal(serializeError({ name: 'TimeoutError' }).category, 'timeout');
  assert.doesNotMatch(JSON.stringify(serializeError({ name: 'PRIVATE_NAME', code: 'PRIVATE_CODE', message: 'PRIVATE_TEXT' })), /PRIVATE_/);
});

test('cause chains and aggregates keep diagnostic evidence within bounded depth and size', () => {
  const root = new Error('PRIVATE_WRAPPER');
  root.cause = new AggregateError([Object.assign(new Error('Permission denied: PRIVATE_PATH'), { code: 'EACCES' }), root, new TypeError('PRIVATE_TYPE'), new RangeError('PRIVATE_OMITTED')], 'PRIVATE_AGGREGATE');
  const safe = serializeError(root);
  assert.equal(safe.cause.name, 'AggregateError');
  assert.equal(safe.cause.errors.length, 2);
  assert.equal(safe.cause.errors[0].code, 'EACCES');
  assert.equal(safe.cause.errors[0].category, 'permission');
  assert.equal(safe.cause.errors[1].name, 'TypeError');
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_/);
  const deep = new Error(); deep.cause = new Error(); deep.cause.cause = new Error(); deep.cause.cause.cause = new Error();
  assert.equal(serializeError(deep).cause.cause.cause, undefined);
  const tree = () => ({ errors: [{ errors: [new Error(), new Error(), new Error()] }, { errors: [new Error(), new Error(), new Error()] }, { errors: [new Error(), new Error(), new Error()] }] });
  const count = value => 1 + (value.cause ? count(value.cause) : 0) + (value.errors || []).reduce((total, item) => total + count(item), 0);
  assert.ok(count(serializeError(tree())) <= 8);
});

test('unreadable errors and unavailable diagnostics never break the error handler', () => {
  const error = { get message() { throw new Error('PRIVATE_GETTER'); } };
  assert.deepEqual(serializeError(error), { name: 'Error', category: 'other', stack: '' });
  assert.doesNotThrow(() => reportError('window.error', error));
});
