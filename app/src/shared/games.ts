// Which open window is a game, for one-click streaming and "Playing …" status.
// Kept free of Electron so it can be unit-tested (test/games.test.ts).

/** Program file name (lowercase) → game name. */
export const KNOWN_GAMES: Record<string, string> = {
  'valorant-win64-shipping.exe': 'VALORANT',
  'cs2.exe': 'Counter-Strike 2',
  'league of legends.exe': 'League of Legends',
  'dota2.exe': 'Dota 2',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'r5apex.exe': 'Apex Legends',
  'r5apex_dx12.exe': 'Apex Legends',
  'overwatch.exe': 'Overwatch 2',
  'marvel-win64-shipping.exe': 'Marvel Rivals',
  'rocketleague.exe': 'Rocket League',
  'gta5.exe': 'Grand Theft Auto V',
  'gta5_enhanced.exe': 'Grand Theft Auto V',
  'rdr2.exe': 'Red Dead Redemption 2',
  'minecraft.windows.exe': 'Minecraft',
  'robloxplayerbeta.exe': 'Roblox',
  'cod.exe': 'Call of Duty',
  'blackops6.exe': 'Call of Duty: Black Ops 6',
  'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_vulkan.exe': 'Rainbow Six Siege',
  'tslgame.exe': 'PUBG: Battlegrounds',
  'destiny2.exe': 'Destiny 2',
  'escapefromtarkov.exe': 'Escape from Tarkov',
  'rustclient.exe': 'Rust',
  'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
  'deadlock.exe': 'Deadlock',
  'discovery.exe': 'THE FINALS',
  'helldivers2.exe': 'HELLDIVERS 2',
  'palworld-win64-shipping.exe': 'Palworld',
  'eldenring.exe': 'ELDEN RING',
  'bg3.exe': "Baldur's Gate 3",
  'bg3_dx11.exe': "Baldur's Gate 3",
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'witcher3.exe': 'The Witcher 3',
  'monsterhunterwilds.exe': 'Monster Hunter Wilds',
  'pathofexile_x64.exe': 'Path of Exile',
  'pathofexile_x64steam.exe': 'Path of Exile',
  'pathofexilesteam.exe': 'Path of Exile',
  'diablo iv.exe': 'Diablo IV',
  'wow.exe': 'World of Warcraft',
  'hearthstone.exe': 'Hearthstone',
  'warframe.x64.exe': 'Warframe',
  'bf2042.exe': 'Battlefield 2042',
  'bf6.exe': 'Battlefield 6',
  'fc25.exe': 'EA SPORTS FC 25',
  'fc26.exe': 'EA SPORTS FC 26',
  'sotgame.exe': 'Sea of Thieves',
  'fallguys_client_game.exe': 'Fall Guys',
  'phasmophobia.exe': 'Phasmophobia',
  'lethal company.exe': 'Lethal Company',
  'among us.exe': 'Among Us',
  'terraria.exe': 'Terraria',
  'stardew valley.exe': 'Stardew Valley',
  'hogwartslegacy.exe': 'Hogwarts Legacy',
  'starfield.exe': 'Starfield',
  're4.exe': 'Resident Evil 4',
  'forzahorizon5.exe': 'Forza Horizon 5',
  'f1_25.exe': 'F1 25',
  'nba2k26.exe': 'NBA 2K26',
};

/** Programs that go fullscreen but aren't games: browsers, video players, chat, the desktop. */
export const NOT_GAMES = new Set([
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'opera_gx.exe', 'brave.exe', 'vivaldi.exe', 'arc.exe',
  'explorer.exe', 'applicationframehost.exe', 'searchhost.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe',
  'textinputhost.exe', 'lockapp.exe', 'systemsettings.exe', 'taskmgr.exe',
  'discord.exe', 'gamespeaker.exe', 'electron.exe', 'teams.exe', 'ms-teams.exe', 'zoom.exe', 'slack.exe', 'whatsapp.exe', 'telegram.exe',
  'obs64.exe', 'vlc.exe', 'mpc-hc64.exe', 'mpc-be64.exe', 'potplayermini64.exe', 'spotify.exe', 'netflix.exe',
  'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'battle.net.exe', 'eadesktop.exe', 'riotclientux.exe', 'leagueclientux.exe',
  'code.exe', 'powerpnt.exe', 'winword.exe', 'excel.exe', 'acrord32.exe', 'acrobat.exe', 'photoshop.exe',
  // Overlays and helpers that draw over games: GPU software, launchers, recorders, wallpapers.
  'nvidia overlay.exe', 'nvidia share.exe', 'nvcontainer.exe', 'nvidia app.exe', 'nvidia web helper.exe', 'nvsphelper64.exe',
  'nvidia geforce experience.exe', 'amdrsserv.exe', 'radeonsoftware.exe', 'amdow.exe', 'amdrssrcext.exe',
  'gameoverlayui.exe', 'gameoverlayui64.exe', 'igoproxy.exe', 'igoproxy64.exe', 'upc.exe', 'ubisoftconnect.exe',
  'gamebar.exe', 'gamebarftserver.exe', 'gamebarpresencewriter.exe', 'xboxpcapp.exe', 'widgets.exe',
  'rtss.exe', 'msiafterburner.exe', 'overwolf.exe', 'overwolfbrowser.exe', 'medal.exe', 'outplayed.exe', 'sharex.exe',
  'wallpaper32.exe', 'wallpaper64.exe', 'lively.exe', 'rainmeter.exe', 'snippingtool.exe', 'screenclippinghost.exe',
  'powertoys.exe', 'lghub.exe', 'lghub_agent.exe', 'icue.exe', 'steelseriesgg.exe', 'razer synapse 3.exe', 'armourycrate.exe',
]);

/**
 * Programs that belong together: a game and its client or launcher. While you
 * stream one, the stream follows to another when a window closes (the League
 * match ends and the client comes back, and the other way round).
 */
export const GAME_FAMILIES: string[][] = [
  ['league of legends.exe', 'leagueclientux.exe', 'leagueclient.exe', 'riotclientux.exe'],
  ['valorant-win64-shipping.exe', 'riotclientux.exe'],
  ['battle.net.exe', 'overwatch.exe', 'wow.exe', 'diablo iv.exe', 'cod.exe', 'blackops6.exe', 'hearthstone.exe'],
  ['epicgameslauncher.exe', 'fortniteclient-win64-shipping.exe', 'rocketleague.exe'],
  ['eadesktop.exe', 'fc25.exe', 'fc26.exe', 'bf2042.exe', 'bf6.exe'],
  ['upc.exe', 'ubisoftconnect.exe', 'rainbowsix.exe', 'rainbowsix_vulkan.exe'],
];

export type Family = { exes: Set<string>; installRoot: string | null };

const lowerName = (path: string) => (path.split(/[\\/]/).pop() ?? '').toLowerCase();

/** The family of the program at `exePath`: its known relatives and its install folder. */
export function familyOf(exePath: string): Family {
  const exe = lowerName(exePath);
  const exes = new Set([exe]);
  for (const f of GAME_FAMILIES) if (f.includes(exe)) f.forEach((e) => exes.add(e));
  // One folder up from the program, e.g. C:\Riot Games\League of Legends for ...\Game\League of Legends.exe,
  // but never something as broad as C:\Program Files.
  const parts = exePath.split(/[\\/]/).filter(Boolean);
  const root = parts.slice(0, -2);
  // Library folders hold many games: following one game must not follow them all.
  const broad = /^(program files( \(x86\))?|windows|users|games|common|steamapps|steamlibrary|steam|epic games|gog games|origin games|ea games|ubisoft game launcher)$/i;
  const installRoot = root.length >= 2 && !broad.test(root[root.length - 1]!) ? root.join('\\').toLowerCase() : null;
  return { exes, installRoot };
}

/** Whether follow-the-game should follow this program: a known game or a known game's client. */
export function isFollowable(exePath: string): boolean {
  const exe = lowerName(exePath);
  return Boolean(KNOWN_GAMES[exe]) || GAME_FAMILIES.some((f) => f.includes(exe));
}

export function inFamily(f: Family, exePath: string): boolean {
  if (f.exes.has(lowerName(exePath))) return true;
  return f.installRoot !== null && exePath.split(/[\\/]/).filter(Boolean).join('\\').toLowerCase().startsWith(f.installRoot + '\\');
}

/** A known game's window beats its client; then the bigger window. */
export function pickFamilyWindow(windows: { id: string; exePath: string; area: number }[]): { id: string; isGame: boolean } | null {
  let best: { id: string; isGame: boolean; area: number } | null = null;
  for (const w of windows) {
    const isGame = Boolean(KNOWN_GAMES[lowerName(w.exePath)]);
    if (!best || (isGame && !best.isGame) || (isGame === best.isGame && w.area > best.area)) best = { id: w.id, isGame, area: w.area };
  }
  return best && { id: best.id, isGame: best.isGame };
}

export type WindowInfo = {
  /** Capture source id, e.g. "window:1234:0". */
  sourceId: string;
  title: string;
  /** Program file name, lowercase; empty if unknown. */
  exe: string;
  /** Covers its whole monitor (borderless or exclusive fullscreen). */
  fullscreen: boolean;
  /** The window the user is using right now. */
  focused: boolean;
  /** Has been the focused window while fullscreen: something you actually played. */
  played: boolean;
  /** Click-through, tool or never-focused window: an overlay drawn over games, not a game. */
  overlay: boolean;
};

export type DetectedGame = { sourceId: string; name: string; exe: string; known: boolean };

/** The game in this window, or null if it isn't one. */
export function identifyGame(w: WindowInfo): DetectedGame | null {
  const exe = w.exe.toLowerCase();
  const known = KNOWN_GAMES[exe];
  if (known) return { sourceId: w.sourceId, name: known, exe, known: true };
  // Minecraft Java runs inside Java, so the program name alone says nothing.
  if ((exe === 'javaw.exe' || exe === 'java.exe') && /^minecraft\b/i.test(w.title)) {
    return { sourceId: w.sourceId, name: 'Minecraft', exe, known: true };
  }
  // Anything else you've been playing fullscreen is probably a game we don't know yet.
  // Overlays (NVIDIA, Steam, Game Bar…) cover the screen too but never take focus.
  if (w.fullscreen && w.played && !w.overlay && exe && !NOT_GAMES.has(exe) && w.title.trim()) {
    return { sourceId: w.sourceId, name: w.title.trim().slice(0, 60), exe, known: false };
  }
  return null;
}

/** The game to offer: a known game beats a fullscreen guess, and the focused window wins ties. */
export function pickGame(windows: WindowInfo[]): DetectedGame | null {
  let best: { game: DetectedGame; score: number } | null = null;
  for (const w of windows) {
    const game = identifyGame(w);
    if (!game) continue;
    const score = (game.known ? 2 : 0) + (w.focused ? 1 : 0);
    if (!best || score > best.score) best = { game, score };
  }
  return best?.game ?? null;
}
