# Vendored H5 Plants vs Zombies

- Repository: https://github.com/yangyunhe369/h5-game-plantsVSzombies
- Commit: `79fb2aeeffe7358100af01cee01c3813495bea85`
- License: MIT, copyright 2018 Yang Yunhe (see LICENSE).
- `js/`, `css/`, `index.html`, and `UPSTREAM_README.md` retain upstream source.
- `provenance.json` records original JS hashes and 344 shipped image hashes.

Run `python3 scripts/build-pvz-vendor.py` from the project root. It concatenates
the original classes into `assets/plants-engine.js`, exports them for the
adapter, and applies only these explicit edits:

1. Image paths move to local `assets/pvz/images/`; an image cache prevents
   constructing identical sprite images during every draw/preview.
2. Timeout/interval calls use the pauseable per-document PvZClock. All original
   attack, death, animation and plant behavior still runs in upstream classes.
3. Window input listeners are registered through the lifetime owner for removal
   on retry/exit. The original automatic Main startup is removed for the auth
   and preload gate.
4. Sunflower DOM images append to the scaled game world, using local paths.
5. Card cooldown and countdown keep separate timer IDs (upstream overwrote the
   timeout handle). The random-row expression includes all five rows.
6. CSS resource references become relative to the local vendor folder.

`assets/plants-game.js` handles account gating, image preload, responsive pointer
coordinates, start/pause/continue/retry/return and RUM. Its single entry-level
preset sets `Main.zombies_iMax = 9`; all seven original plants, original prices,
200 starting sun, automatic sun collection, five rows, lawnmowers and original
combat/animation remain. This is the upstream H5 implementation, not a new
simulation of its gameplay and not an official PopCap source release.

The Gateway manifest contains exact asset paths, not a directory wildcard.
SourceMap packaging includes the generated unminified bundle and its precise
line mapping, as well as the clock, adapter and shared game runtime.
