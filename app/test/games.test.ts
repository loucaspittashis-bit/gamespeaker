import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { identifyGame, pickGame, type WindowInfo } from '../src/shared/games.ts';

const win = (over: Partial<WindowInfo>): WindowInfo => ({
  sourceId: 'window:1:0', title: '', exe: '', fullscreen: false, focused: false, ...over,
});

describe('identifyGame', () => {
  it('knows games by their program name', () => {
    const g = identifyGame(win({ exe: 'VALORANT-Win64-Shipping.exe', title: 'VALORANT  ' }));
    assert.deepEqual(g, { sourceId: 'window:1:0', name: 'VALORANT', exe: 'valorant-win64-shipping.exe', known: true });
    assert.equal(identifyGame(win({ exe: 'cs2.exe', title: 'Counter-Strike 2' }))?.name, 'Counter-Strike 2');
  });

  it('spots Minecraft Java by its window title', () => {
    assert.equal(identifyGame(win({ exe: 'javaw.exe', title: 'Minecraft 1.21.4 - Multiplayer' }))?.name, 'Minecraft');
    assert.equal(identifyGame(win({ exe: 'javaw.exe', title: 'IntelliJ IDEA' })), null);
  });

  it('treats unknown fullscreen programs as games', () => {
    const g = identifyGame(win({ exe: 'somenewgame.exe', title: 'Some New Game', fullscreen: true }));
    assert.deepEqual(g, { sourceId: 'window:1:0', name: 'Some New Game', exe: 'somenewgame.exe', known: false });
  });

  it('ignores fullscreen browsers, video players and windowed apps', () => {
    assert.equal(identifyGame(win({ exe: 'chrome.exe', title: 'YouTube', fullscreen: true })), null);
    assert.equal(identifyGame(win({ exe: 'vlc.exe', title: 'movie.mkv', fullscreen: true })), null);
    assert.equal(identifyGame(win({ exe: 'notepad.exe', title: 'notes.txt' })), null);
    assert.equal(identifyGame(win({ exe: '', title: 'Untitled', fullscreen: true })), null);
  });
});

describe('pickGame', () => {
  it('prefers a known game over a fullscreen guess, then the focused window', () => {
    const windows = [
      win({ sourceId: 'window:1:0', exe: 'somenewgame.exe', title: 'Guess', fullscreen: true, focused: true }),
      win({ sourceId: 'window:2:0', exe: 'cs2.exe', title: 'Counter-Strike 2' }),
      win({ sourceId: 'window:3:0', exe: 'r5apex.exe', title: 'Apex Legends', focused: true }),
    ];
    assert.equal(pickGame(windows)?.sourceId, 'window:3:0');
    assert.equal(pickGame(windows.slice(0, 2))?.sourceId, 'window:2:0');
    assert.equal(pickGame([win({ exe: 'notepad.exe' })]), null);
  });
});
