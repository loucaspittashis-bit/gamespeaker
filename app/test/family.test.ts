import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, inFamily, isFollowable, pickFamilyWindow } from '../src/shared/games.ts';

const lolGame = 'C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe';
const lolClient = 'C:\\Riot Games\\League of Legends\\LeagueClientUx.exe';

describe('game families', () => {
  it('ties a game to its client, both ways', () => {
    assert.ok(inFamily(familyOf(lolGame), lolClient));
    assert.ok(inFamily(familyOf(lolClient), lolGame));
    assert.ok(inFamily(familyOf('D:\\Games\\Overwatch\\_retail_\\Overwatch.exe'), 'C:\\Program Files (x86)\\Battle.net\\Battle.net.exe'));
  });

  it('uses the install folder for games it has never heard of', () => {
    const f = familyOf('D:\\Games\\SomeGame\\bin\\SomeGame.exe');
    assert.ok(inFamily(f, 'D:\\Games\\SomeGame\\Launcher.exe'));
    assert.ok(!inFamily(f, 'D:\\Games\\OtherGame\\Other.exe'));
  });

  it('never treats a whole Program Files folder as one family', () => {
    const f = familyOf('C:\\Program Files\\Spotify\\Spotify.exe');
    assert.equal(f.installRoot, null);
    assert.ok(!inFamily(f, 'C:\\Program Files\\Discord\\Discord.exe'));
  });

  it('prefers the game window over the client, then the bigger one', () => {
    const pick = pickFamilyWindow([
      { id: 'window:1:0', exePath: lolClient, area: 1600 * 900 },
      { id: 'window:2:0', exePath: lolGame, area: 1280 * 720 },
    ]);
    assert.deepEqual(pick, { id: 'window:2:0', isGame: true });
    assert.equal(pickFamilyWindow([]), null);
  });
});

describe('what follow-the-game follows', () => {
  it('follows games and their clients, never everyday programs', () => {
    assert.ok(isFollowable(lolGame));
    assert.ok(isFollowable(lolClient));
    assert.ok(!isFollowable('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
    assert.ok(!isFollowable('C:\\Windows\\explorer.exe'));
  });

  it('never treats a whole game library as one family', () => {
    const steamGame = 'D:\\SteamLibrary\\steamapps\\common\\Lethal Company\\Lethal Company.exe';
    assert.equal(familyOf(steamGame).installRoot, null);
    assert.ok(!inFamily(familyOf(steamGame), 'D:\\SteamLibrary\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe'));
    assert.equal(familyOf('D:\\Games\\Valorant\\Valorant.exe').installRoot, null);
  });
});
