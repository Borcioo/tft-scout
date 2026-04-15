#!/usr/bin/env bash
# Refactor R sub-project baseline checkpoint.
# Re-runs the 5 scenarios captured in tmp/refactor-R-baseline/
# and byte-diffs the output. Used by every task in the R plan.

set -e

BASELINE_DIR="tmp/refactor-R-baseline"
CURRENT_DIR="tmp/refactor-R-current"
mkdir -p "$CURRENT_DIR"

run() {
  local name="$1"; shift
  npm run --silent scout -- generate --full "$@" 2>/dev/null > "$CURRENT_DIR/$name.json"
  if diff -q "$BASELINE_DIR/$name.json" "$CURRENT_DIR/$name.json" > /dev/null; then
    echo "OK   $name"
  else
    echo "DRIFT $name — see diff:" >&2
    diff "$BASELINE_DIR/$name.json" "$CURRENT_DIR/$name.json" | head -40 >&2
    exit 1
  fi
}

run 01-non-lock        --level 8  --top-n 10 --seed 42
run 02-shieldtank6     --level 10 --top-n 30 --seed 42 --locked-trait TFT17_ShieldTank:6
run 03-darkstar4       --level 10 --top-n 30 --seed 42 --locked-trait TFT17_DarkStar:4
run 04-darkstar-emblem --level 10 --top-n 30 --seed 42 --locked-trait TFT17_DarkStar:4 --emblem TFT17_ShieldTank:1
run 05-hero-swap       --level 9  --top-n 10 --seed 42 --locked TFT17_Poppy_hero

echo ""
echo "All 5 scenarios byte-identical to baseline."
