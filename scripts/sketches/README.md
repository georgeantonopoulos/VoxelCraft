# Building-sketch drawings

The sketchbook (`src/ui/grove/Sketchbook.tsx`, J in game) shows ink-and-wash
drawings that match the real building pieces. They are made from the game
itself, not drawn by hand:

1. **Reference shots**: the test harness builds each subject through the real
   placement code and screenshots it (`steps/*.json`: a bench, the shaped
   pieces, posts with sills, and a finished hut from the corner, doorway,
   gable end and door).
2. **Codex image generation** redraws each shot as an old carpenter's
   notebook illustration, told to keep the pieces, proportions and joints
   exactly (`prompts/prompt-*.txt`; they save `<name>.png` in
   `output/sketch-gen/`). Needs a current Codex CLI (`codex update`) and a
   model the account allows.
3. **Paper to white**: each drawing's own paper colour is mapped to white
   (ffmpeg `colorlevels`) so it multiplies invisibly onto the book's paper,
   then encoded to 900 px WebP in `src/assets/sketches/`.

`./make-sketches.sh` runs all three. Look at every result against its
reference before keeping it (the generator can invent pieces). Redo the
drawings when a piece's look or a building rule changes; the page notes in
`Sketchbook.tsx` carry the rules in words.
