// Game detection for the FolkChat Windows app: running .exe name (lower-case) -> [name, emoji].
// Names match the activity list in app.js, so detected hours add up with hours set by hand.
// Add a game: put its .exe (as shown in Task Manager → Details) here, lower-case.
const G = (name, emoji, ...exes) => exes.map(x => [x, [name, emoji]]);
export const EXE = new Map([
  ...G("Fortnite", "🎯", "fortniteclient-win64-shipping.exe"),
  ...G("Roblox", "🧱", "robloxplayerbeta.exe"),
  ...G("Valorant", "🔫", "valorant-win64-shipping.exe"),
  ...G("Counter-Strike 2", "💣", "cs2.exe"),
  ...G("League of Legends", "⚔️", "league of legends.exe"),
  ...G("GTA V", "🚗", "gta5.exe", "gta5_enhanced.exe", "playgtav.exe"),
  ...G("Rocket League", "⚽", "rocketleague.exe"),
  ...G("Apex Legends", "🪂", "r5apex.exe", "r5apex_dx12.exe"),
  ...G("Call of Duty", "🎖️", "cod.exe", "cod24-cod.exe", "cod25-cod.exe", "modernwarfare.exe", "blackops6.exe", "blackops7.exe"),
  ...G("EA SPORTS FC", "🏟️", "fc24.exe", "fc25.exe", "fc26.exe", "fc27.exe"),
  ...G("Among Us", "🚀", "among us.exe"),
  ...G("Rainbow Six Siege", "🛡️", "rainbowsix.exe", "rainbowsix_vulkan.exe", "rainbowsix_dx11.exe"),
  ...G("Overwatch 2", "🦾", "overwatch.exe"),
  ...G("Dota 2", "🐉", "dota2.exe"),
  ...G("Genshin Impact", "🌸", "genshinimpact.exe", "yuanshen.exe"),
  ...G("PUBG", "🍳", "tslgame.exe"),
  ...G("The Sims 4", "🏠", "ts4_x64.exe", "ts4_dx9_x64.exe"),
  ...G("Terraria", "🌳", "terraria.exe", "tmodloader.exe"),
  ...G("Geometry Dash", "🔷", "geometrydash.exe"),
  ...G("Stumble Guys", "🏃", "stumble guys.exe"),
  ...G("Marvel Rivals", "🦸", "marvel-win64-shipping.exe"),
  ...G("Minecraft", "⛏️", "minecraft.windows.exe"),
  ...G("Honkai: Star Rail", "🚂", "starrail.exe"),
  ...G("Zenless Zone Zero", "📺", "zenlesszonezero.exe"),
  ...G("Rust", "🪓", "rustclient.exe"),
  ...G("Escape from Tarkov", "🎒", "escapefromtarkov.exe"),
  ...G("DayZ", "🧟", "dayz_x64.exe"),
  ...G("Arma 3", "🪖", "arma3_x64.exe"),
  ...G("Battlefield", "💥", "bf6.exe", "bf2042.exe", "bfv.exe", "bf1.exe"),
  ...G("Halo Infinite", "🪐", "haloinfinite.exe"),
  ...G("Destiny 2", "🌌", "destiny2.exe"),
  ...G("Warframe", "🥷", "warframe.x64.exe"),
  ...G("Path of Exile", "💀", "pathofexile.exe", "pathofexile_x64.exe", "pathofexilesteam.exe", "pathofexile_x64steam.exe"),
  ...G("Diablo IV", "😈", "diablo iv.exe"),
  ...G("World of Warcraft", "🐲", "wow.exe", "wowclassic.exe"),
  ...G("Hearthstone", "🃏", "hearthstone.exe"),
  ...G("Lost Ark", "⛵", "lostark.exe"),
  ...G("Albion Online", "🗡️", "albion-online.exe"),
  ...G("World of Tanks", "🛞", "worldoftanks.exe"),
  ...G("War Thunder", "✈️", "aces.exe"),
  ...G("Team Fortress 2", "🎩", "tf_win64.exe", "tf.exe"),
  ...G("Deadlock", "🔒", "deadlock.exe", "project8.exe"),
  ...G("The Finals", "🏆", "discovery.exe"),
  ...G("Helldivers 2", "🪐", "helldivers2.exe"),
  ...G("Palworld", "🐑", "palworld-win64-shipping.exe", "palworld-wingdk-shipping.exe"),
  ...G("Lethal Company", "📦", "lethal company.exe"),
  ...G("R.E.P.O.", "🧲", "repo.exe"),
  ...G("PEAK", "🧗", "peak.exe"),
  ...G("Phasmophobia", "👻", "phasmophobia.exe"),
  ...G("Valheim", "🪓", "valheim.exe"),
  ...G("Sea of Thieves", "🏴‍☠️", "sotgame.exe"),
  ...G("Dead by Daylight", "🔪", "deadbydaylight-win64-shipping.exe", "deadbydaylight-egs-shipping.exe"),
  ...G("Fall Guys", "🫘", "fallguys_client_game.exe", "fallguys_client.exe"),
  ...G("Brawlhalla", "🥊", "brawlhalla.exe"),
  ...G("Elden Ring", "💍", "eldenring.exe", "nightreign.exe"),
  ...G("Cyberpunk 2077", "🌆", "cyberpunk2077.exe"),
  ...G("The Witcher 3", "🐺", "witcher3.exe"),
  ...G("Red Dead Redemption 2", "🤠", "rdr2.exe"),
  ...G("Baldur's Gate 3", "🎲", "bg3.exe", "bg3_dx11.exe"),
  ...G("Hogwarts Legacy", "🪄", "hogwartslegacy.exe"),
  ...G("Black Myth: Wukong", "🐒", "b1-win64-shipping.exe"),
  ...G("Stardew Valley", "🌾", "stardew valley.exe", "stardewvalley.exe"),
  ...G("Hollow Knight", "🪲", "hollow_knight.exe", "hollow knight silksong.exe"),
  ...G("Forza Horizon 5", "🏎️", "forzahorizon5.exe"),
  ...G("Euro Truck Simulator 2", "🚚", "eurotrucks2.exe"),
  ...G("Assetto Corsa", "🏁", "acs.exe", "assettocorsa2.exe"),
  ...G("F1", "🏎️", "f1_24.exe", "f1_25.exe"),
  ...G("Satisfactory", "🏭", "factorygamesteam-win64-shipping.exe", "factorygameegs-win64-shipping.exe"),
  ...G("Factorio", "⚙️", "factorio.exe"),
  ...G("Cities: Skylines", "🏙️", "cities.exe", "cities2.exe"),
  ...G("osu!", "🎵", "osu!.exe"),
  ...G("Smite 2", "⚡", "hemingway-win64-shipping.exe"),
  ...G("Paladins", "🛡️", "paladins.exe"),
  ...G("Delta Force", "🎯", "deltaforceclient-win64-shipping.exe"),
  ...G("Once Human", "🧬", "oncehuman.exe"),
  ...G("Mount & Blade II", "🐎", "bannerlord.exe"),
  ...G("Sons of the Forest", "🌲", "sonsoftheforest.exe"),
  ...G("Schedule I", "🌿", "schedule i.exe"),
  ...G("Clash Royale", "👑", "clashroyale.exe"),
  ...G("Brawl Stars", "⭐", "brawlstars.exe"),
]);

// Programs that are never games, so the Unreal-Engine guess below doesn't pick them up.
const NOT_GAMES = /^(unrealeditor|unrealcefsubprocess|crashreportclient|epicgameslauncher|easyanticheat|eossdk|battleye)/;

/** procs: lower-case .exe names of running programs; fg: { exe, title } of the window in front. */
export function detect(procs, fg){
  const set = new Set(procs || []);
  // the game in front wins (two games open → the one you're playing)
  if (fg && fg.exe && EXE.has(fg.exe)) return EXE.get(fg.exe);
  // Minecraft Java runs inside java/javaw — recognise it by its window title
  if (fg && /^(javaw?\.exe)$/.test(fg.exe || "") && /^minecraft\b/i.test(fg.title || "")) return ["Minecraft", "⛏️"];
  for (const p of set) if (EXE.has(p)) return EXE.get(p);
  // Unknown Unreal Engine games run as "<Name>-Win64-Shipping.exe": use the window title if it's in front
  if (fg && /-win64-shipping\.exe$/.test(fg.exe || "") && !NOT_GAMES.test(fg.exe) && fg.title && fg.title.length <= 48) return [fg.title.trim(), "🎮"];
  return null;
}
