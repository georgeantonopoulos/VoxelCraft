---
name: grove-scene
description: Launch and look at The Grove / VoxelCraft in a real browser without menus, to check any runtime change (visuals, shaders, lighting, water, trees, UI, HUD, gameplay, building, physics, errors). Use whenever a VoxelCraft change needs to be seen or played, when asked to run, screenshot or smoke-test the game, or before reporting visible work as done.
---

# grove-scene

The game's own test harness. It boots straight into a fixed-seed world at a
held time and weather, waits until the scene is truly ready, and captures
screenshots, state and console errors. Full reference: `src/testing/README.md`.

## Use

```bash
npm run scene -- <scenario> [options] [steps]   # ~7 s to ready; prints a summary
npm run scene -- all                            # every scenario + sheet.png; fails on console errors
npm run scene -- --list
```

- Scenarios: meadow, forest, shore, river, hollow, cave, night, rain, carpentry, workbench, hut, sky.
- Options: `--world FROZEN`, `--seed N`, `--at x,z`, `--yaw deg --pitch deg`,
  `--time 21|live`, `--weather rain`, `--hud hidden|awake`, `--give saw,stick:3`, `--keep`.
- Steps (in order): `--shot name`, `--do "<js; t = window.__vcTest>"`,
  `--key KeyW:1200`, `--click left|right`, `--wait ms`, `--fps s`, `--steps file.json`.
- Output folder `output/scenes/<scenario>-<time>/`: numbered PNGs, `report.json`, `console.log`.

## Workflow

1. Pick the scenario closest to the change (add one in `src/testing/scenarios.ts`
   if none reaches it: spawn from world functions, `setup(t)` after ready).
2. Run it, then **Read the PNGs** and judge them. `errors: N` in the summary
   counts console errors since load; open `console.log` for the rest.
3. For a visual change, shoot the same scene before and after (`git stash`,
   run, `git stash pop`, run) and compare.
4. Before calling a runtime change done, run `npm run scene -- all` as well.
5. Aiming at something: `--do "t.lookAt(x,y,z)"` or check `--do "t.aim()"`
   (it returns the owner userData, e.g. `{type:'log', id}`) before `--click`.

If the harness is in the way (a missing helper, a flaky wait), fix it in
`src/testing/` rather than working around it by hand.
