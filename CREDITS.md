# Credits

Pocket Alert is almost entirely procedural (art, music, announcer, most SFX are
generated in code). The third-party pieces below are the exceptions.

## Sound effects — Kenney (CC0)

The recorded sound effects in `public/audio/sfx/` are cherry-picked from three
[Kenney](https://kenney.nl) audio packs, all released under
[Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/).
Attribution is not required — this credit is a courtesy. Support Kenney at
<https://kenney.nl/donate>.

| Pack | URL | Files used |
| --- | --- | --- |
| Sci-Fi Sounds | <https://kenney.nl/assets/sci-fi-sounds> | `shot_small`, `shot_zap`, `shot_heavy`, `boom_small`, `boom_med`, `boom_big`, `collapse`, `hit_metal`, `forcefield` |
| Impact Sounds | <https://kenney.nl/assets/impact-sounds> | `claw`, `hit_thud`, `hit_crunch` |
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> | `ui_click`, `ui_confirm`, `ui_error`, `ui_notify` |

Each sample ships as `.ogg` plus an `.m4a` transcode (for Safari, which cannot
decode Ogg Vorbis).

## Sound library — ZzFX (MIT)

Crate chimes, cheer notes and taunt blips are synthesized with
[ZzFX](https://github.com/KilledByAPixel/ZzFX) by Frank Force, used under the
MIT license (npm package `zzfx`). The full license text is included in
`node_modules/zzfx/LICENSE` and reproduced by the bundler's license handling.

## Everything else

All other assets — sprites, map art, the soundtrack, the EVA announcer (Web
Speech API) and the remaining sound effects — are generated procedurally by
code in this repository and carry no third-party license requirements.
