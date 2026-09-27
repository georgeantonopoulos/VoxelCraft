#!/usr/bin/env bash
# Rebuild the building-sketch drawings (src/assets/sketches/*.webp) from the
# real pieces. See scripts/sketches/README.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
REFS=output/sketch-refs; GEN=output/sketch-gen; OUT=src/assets/sketches
mkdir -p "$REFS" "$GEN" "$OUT"

shot() { # scenario steps-file -> newest scene folder
  npm run scene -- "$1" --hud hidden --size 1024x1024 --steps "scripts/sketches/steps/$2" >/dev/null
  ls -td output/scenes/"$1"-*/ | head -1
}
d=$(shot workbench ref-bench.json);  cp "$d"01-ref-bench.png  "$REFS/ref-bench.png"
d=$(shot workbench ref-posts.json);  cp "$d"01-ref-posts.png  "$REFS/ref-posts.png"
d=$(shot workbench ref-pieces.json); cp "$d"01-ref-pieces.png "$REFS/ref-pieces.png"
d=$(shot hut ref-hut.json)
for n in corner doorway roof door; do cp "$d"0*-ref-$n.png "$REFS/ref-$n.png"; done

# Codex image generation, one per drawing, in parallel (prompt files name the output).
( cd "$GEN"
  for n in bench pieces corner doorway posts roof door; do
    codex exec --skip-git-repo-check -s workspace-write --image "../sketch-refs/ref-$n.png" - \
      < "../../scripts/sketches/prompts/prompt-$n.txt" > "codex-$n.log" 2>&1 &
  done; wait )

# Map each drawing's own paper to white (so it multiplies invisibly onto the
# book's paper), then encode at 900 px.
for n in bench pieces corner doorway posts roof door; do
  read -r r g b <<< "$(ffmpeg -v error -i "$GEN/$n.png" -vf "crop=60:60:12:1180,scale=1:1" -f rawvideo -pix_fmt rgb24 - | od -An -tu1)"
  ffmpeg -v error -y -i "$GEN/$n.png" -vf "colorlevels=rimax=$(echo "scale=3;$r/255*0.99"|bc):gimax=$(echo "scale=3;$g/255*0.99"|bc):bimax=$(echo "scale=3;$b/255*0.99"|bc)" "$GEN/$n-white.png"
  cwebp -quiet -q 78 -resize 900 0 "$GEN/$n-white.png" -o "$OUT/$n.webp"
done
echo "done: $OUT"
