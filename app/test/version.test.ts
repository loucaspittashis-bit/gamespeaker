import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOlder } from '../src/shared/version.ts';

describe('isOlder', () => {
  it('compares versions by number, not text', () => {
    assert.equal(isOlder('0.1.9', '0.1.10'), true);
    assert.equal(isOlder('0.1.10', '0.1.9'), false);
    assert.equal(isOlder('0.1.10', '0.1.10'), false);
    assert.equal(isOlder('0.2.0', '0.1.10'), false);
    assert.equal(isOlder('0.1.3', '1.0.0'), true);
  });
});
