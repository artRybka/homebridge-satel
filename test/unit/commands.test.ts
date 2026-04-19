import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { chooseEntityWidth, padUserCode } from '../../src/satel/commands';

describe('padUserCode', () => {
  it('pads 4-digit code with F to 16 chars', () => {
    assert.equal(padUserCode('1234'), '1234FFFFFFFFFFFF');
  });

  it('accepts already-16-char code verbatim', () => {
    assert.equal(padUserCode('1234567890ABCDEF'), '1234567890ABCDEF');
  });

  it('rejects non-hex characters', () => {
    assert.throws(() => padUserCode('12XY'), /hex characters/);
  });

  it('rejects empty code', () => {
    assert.throws(() => padUserCode(''));
  });
});

describe('chooseEntityWidth', () => {
  it('returns 128 for ids ≤ 128', () => {
    assert.equal(chooseEntityWidth(0), 128);
    assert.equal(chooseEntityWidth(64), 128);
    assert.equal(chooseEntityWidth(128), 128);
  });

  it('returns 256 for ids > 128', () => {
    assert.equal(chooseEntityWidth(129), 256);
    assert.equal(chooseEntityWidth(256), 256);
  });
});
