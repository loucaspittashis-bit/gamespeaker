import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AutoQuality, ladder, tierLabel, uploadNeeded, type Sample } from '../src/renderer/src/lib/quality.ts';

const held: Sample = { limitedBy: 'bandwidth', available: 9 };
const busyPc: Sample = { limitedBy: 'cpu', available: 50 };
const fine = (available = 0): Sample => ({ limitedBy: 'none', available });

describe('ladder', () => {
  it('steps down from the chosen quality, keeping 60 fps as long as it can', () => {
    assert.deepEqual(ladder('1440p', 60).map(tierLabel), ['1440p60', '1080p60', '720p60']);
    assert.deepEqual(ladder('1080p', 60).map(tierLabel), ['1080p60', '720p60']);
    assert.deepEqual(ladder('720p', 60).map(tierLabel), ['720p60', '720p30']);
    assert.deepEqual(ladder('1440p', 30).map(tierLabel), ['1440p30', '1080p30', '720p30']);
    // Never below 720p.
    for (const r of ['720p', '1080p', '1440p'] as const) {
      for (const f of [30, 60] as const) assert.ok(ladder(r, f).every((t) => ['720p', '1080p', '1440p'].includes(t.res)));
    }
  });

  it('counts the 720p backup layer in the upload needed', () => {
    assert.equal(uploadNeeded('1440p', 60), Math.ceil(16 * 1.1 + 3 + 1));
    assert.equal(uploadNeeded('720p', 60), Math.ceil(5 * 1.1 + 1));
  });
});

describe('AutoQuality', () => {
  it('steps down after a few seconds of a full upload, and says why', () => {
    const q = new AutoQuality(ladder('1440p', 60));
    assert.equal(q.next(held), false);
    assert.equal(q.next(held), false);
    assert.equal(q.next(held), true);
    assert.equal(tierLabel(q.tier), '1080p60');
    assert.equal(q.reason, 'upload');
    // A blip of good samples resets the count.
    q.next(held);
    q.next(fine());
    q.next(held);
    q.next(held);
    assert.equal(tierLabel(q.tier), '1080p60');
  });

  it('blames the PC when the encoder is the limit', () => {
    const q = new AutoQuality(ladder('1440p', 60));
    for (let i = 0; i < 3; i++) q.next(busyPc);
    assert.equal(q.reason, 'pc');
  });

  it('never goes below the lowest step or above the chosen one', () => {
    const q = new AutoQuality(ladder('1080p', 60));
    for (let i = 0; i < 30; i++) q.next(held);
    assert.equal(tierLabel(q.tier), '720p60');
    for (let i = 0; i < 200; i++) q.next(fine(100));
    assert.equal(tierLabel(q.tier), '1080p60');
    assert.equal(q.reason, null);
    assert.equal(q.lowered, false);
  });

  it('waits longer before guessing again after a guessed step up fails', () => {
    const q = new AutoQuality(ladder('1440p', 60));
    for (let i = 0; i < 3; i++) q.next(held); // down to 1080p
    const climb = () => {
      let n = 0;
      while (q.level === 1) {
        q.next(fine(0));
        n++;
      }
      return n;
    };
    assert.equal(climb(), 30); // first guess after a minute
    for (let i = 0; i < 3; i++) q.next(held); // too much again: back down
    assert.equal(climb(), 60); // next guess waits twice as long
    for (let i = 0; i < 3; i++) q.next(held);
    assert.equal(climb(), 120);
  });

  it('steps up quickly when there is clearly room, slowly when it has to guess', () => {
    const roomy = new AutoQuality(ladder('1440p', 60));
    for (let i = 0; i < 3; i++) roomy.next(held);
    let n = 0;
    while (roomy.lowered) {
      roomy.next(fine(30)); // 30 Mbps is plenty for 1440p60 (16)
      n++;
    }
    assert.equal(n, 10);

    const unknown = new AutoQuality(ladder('1440p', 60));
    for (let i = 0; i < 3; i++) unknown.next(held);
    n = 0;
    while (unknown.lowered) {
      unknown.next(fine(0));
      n++;
    }
    assert.equal(n, 30);
  });
});
