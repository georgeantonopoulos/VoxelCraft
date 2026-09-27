# Test mode: seeing the game without the menus

Test mode loads a prepared world with no title screen, loading screen or
"click to begin". The seed, time of day and weather are fixed, so two runs of
the same scenario show the same scene. Saves from earlier runs are erased
first. The mouse counts as captured even where the browser cannot lock it, so
the game runs at full frame rate with no pause veil, and clicks and keys reach
gameplay.

## The command (use this first)

```bash
npm run scene -- <scenario> [world options] [steps]    # one scene -> output/scenes/<scenario>-<time>/
npm run scene -- all                                   # every scenario + sheet.png: the smoke check
npm run scene -- --list                                # scenarios and what they show
```

The command starts its own Vite on port 3100. It starts fresh each time
because Vite's file watcher misses edits on /Volumes. It then opens headless
Chrome on the real GPU, waits until the scene is ready, runs the steps, and
writes numbered PNGs, `report.json` (ready report, step results, final state,
errors) and `console.log`. It prints a short summary. The exit code is
non-zero if the scene never became ready (and, for `all`, if any scene logged
errors). A scene takes about 7 s to get ready; `all` takes about 80 s.

World options (all optional; each overrides the scenario's own setting):

| option | meaning |
|---|---|
| `--world DEFAULT\|FROZEN\|LUSH\|CHAOS\|SKY_ISLANDS` | land type |
| `--seed N` | world seed (default 1337) |
| `--at x,z` | stand here instead of the scenario's spot |
| `--yaw deg --pitch deg` | first view (yaw 0 looks down -Z, positive turns left; pitch negative looks down) |
| `--time h` | hour, held still: 6 sunrise, 12 noon, 18 sunset, 23 night. `live` lets it move |
| `--weather clear\|gathering\|rain\|clearing` | held, at full strength at once |
| `--hud normal\|awake\|hidden` | `hidden` hides the HUD for clean renders, `awake` stops it fading |
| `--give saw,stick:3,...` | extra items (see `give` below) |
| `--keep` | keep what earlier runs saved in this world |

Steps run in the order given, once the scene is ready:

| step | does |
|---|---|
| `--shot name` | screenshot now (a `final` one is always taken) |
| `--do "<js>"` | runs in the page with `t = window.__vcTest`; its value is printed. `--do "t.aim()"`, `--do "await t.goto(200, -40)"` |
| `--key KeyW:1500` | a real key press (code, optional hold in ms) |
| `--click left\|right` | a real mouse press at the crosshair |
| `--wait ms` / `--fps seconds` | pause / measure frame rate |
| `--steps file.json` | an array of the above, e.g. `[{"do":"t.look(90)"},{"shot":"east"}]` |

Runner options: `--size 1280x720`, `--headed` (visible window, add
`--keep-open` to leave it open), `--url http://localhost:3000` (use a server
that is already running), `--out dir`, `--timeout seconds`.

## Scenarios (`src/testing/scenarios.ts`)

meadow, forest, shore, river, hollow, cave, night, rain, carpentry, sky. Each
one can set the world, seed, time, weather and starting items. It can also
choose where to stand, using only the world's generation functions (so the
chunks stream in around that spot), and run a `setup(t)` once the scene is
ready (the carpentry bench, the cave pocket, the densest trees). When you are
checking a feature that none of them reaches, add a scenario rather than
scripting the same steps over and over.

## In the page: `window.__vcTest`

Open `http://localhost:3000/?test=<scenario>&...` (the same parameters as
above, without the dashes) in any browser, including the Chrome and
Playwright MCP tools. Angles are in degrees.

- `await t.ready()`: waits until the player has spawned and is standing on
  the ground, the shaders are warmed, and the weather, items, view and
  scenario setup are applied. Returns `{ ok, ms, player, errors, failed? }`.
- `t.state()`: player, camera, inventory, grove, weather, logs, chunks,
  frame count, error count.
- `t.errors()` / `t.clearErrors()`: everything sent to `console.error`, plus
  uncaught errors and rejected promises, since the page loaded.
- `t.teleport(x,y,z)`, `await t.goto(x,z)` (waits for the chunk to load and
  the player to land), `await t.settle()`, `t.look(yaw, pitch)`,
  `t.lookAt(x,y,z)`, `t.aim()` (what the crosshair rests on: point, distance,
  owner), `t.groundAt(x,z)`, `t.player()`, `t.camera()`.
- `t.setTime(h | 'live')`, `t.setWeather(phase, instant = true)`,
  `t.hud(mode)`.
- `t.give(...)`: pickaxe, axe, torch[:n], stick[:n], stone[:n], shard[:n],
  flora[:n], saw, pick, flintaxe, maul, spear, copper[:n], hinge[:n], all.
  `t.select(slot)`.
- `--do` steps with more than one statement need an explicit `return` for
  their value to print (a single expression is returned by itself).
- `await t.key(code, ms)`, `await t.click('left' | 'right')`: pretend key
  and mouse events (the runner's `--key` and `--click` use real ones).
- `await t.wait(ms)`, `await t.frames(n)`, `await t.fps(seconds)`.

The older handles still work alongside it: `__vcDebug`, `__weather`,
`__logStore`, `__groveStore`, `__terrainView`, `__waterDebug` and others (see
CLAUDE.md).

## How it hooks into the game

- `src/core/input/pointerCapture.ts`: `isPointerCaptured()` replaces reads of
  `document.pointerLockElement`. Test mode turns on a virtual capture.
- `App.tsx`: when `TEST` is set it skips the title and startup screens, uses
  the test seed, spawn and held sun, and mounts `TestHarness` and
  `TestFrameProbe`.
- `prepareTestWorld` erases the world's saves (`eraseWorldData`), but never
  a seed that belongs to one of the player's saved worlds. It never records
  the world in the saved-worlds list.
- `SceneWarmup` fires `vc-warmup-done`. `WeatherDirector`'s `set` takes
  `{ hold, instant }`. `__vcDebug.aim` casts the view ray.
- Unit tests: `src/tests/testMode.test.ts` covers URL parsing and holding the
  sun at an hour.
