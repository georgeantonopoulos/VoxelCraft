Original prompt: Understand this game well and spend one hour improving it on all fronts. Be token conscious so use light model subagents on targeted work. I am expecting improvements in performance graphics and gameplay at the same time.

## 2026-08-23 improvement pass

- Baseline: branch `claude/lumabee-character-implementation-W1UzH`; worktree clean except unrelated untracked `worktrees/` directory, which must remain untouched.
- Implemented: stable fixed inventory hotkeys and legacy-action synchronization with regression tests; pickup audio plus transient item confirmation; a working touch PICK UP action; allocation-free pickup homing, intro camera, and sun/sky color loops; normal-play remesh diagnostic scan removal; inactive chromatic pass culling; lazy debug/creature routes; a complete `?autostart` profiling/test route; sun/sky orbit radius synchronization; conditional valley-fog sampling; entity-health expiry plus fresh-world reset; `render_game_to_text` and real-time `advanceTime` test hooks; nested-worktree test exclusion.
- Refactored: moved the complete Q-pickup transaction out of `VoxelTerrain.tsx` into `useItemPickup.ts`, reducing the streaming controller by 231 lines while preserving ray ordering, chunk mutation, persistence, inventory, and feedback.
- Verification: `npm run build` passed (832 modules; main 4,466.45 kB / 1,521.02 kB gzip plus lazy feature chunks); final `npm run test:unit` passed all 82 tests in 77.83s; fresh `npm run dev` ready in 113 ms; native-GPU gameplay, movement, jump, settings, touch look/pickup, and lazy routes inspected after streaming settled; four-angle captures are saved under `output/web-game/native/`.
- Browser note: the required supplied Playwright client was attempted in headless and headed modes, but its hardcoded SwiftShader path stalled inside `advanceTime` before the first artifact. Native in-app browser verification succeeded; its only errors were the browser surface not supporting Pointer Lock, so touch mode was used for camera verification.

## TODO

- Profile collider mounting and vegetation matrix preparation in a longer roaming session.
- Consider extracting terrain streaming orchestration from `VoxelTerrain.tsx` as the next structural refactor.
