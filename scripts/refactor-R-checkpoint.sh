#!/usr/bin/env bash
# Refactor R sub-project baseline checkpoint.
# Re-runs the 5 scenarios captured in tmp/refactor-R-baseline/
# and byte-diffs the output. Used by every task in the R plan.
#
# Scenarios use Set 18 api_names. A baseline only means something for
# the snapshot it was captured from — after a set change or a fresh
# `scout snapshot`, re-capture on the pre-change code first:
#   scripts/refactor-R-checkpoint.sh --capture

set -e

BASELINE_DIR="tmp/refactor-R-baseline"
CURRENT_DIR="tmp/refactor-R-current"
CAPTURE=0

if [ "${1:-}" = "--capture" ]; then
  CAPTURE=1
  mkdir -p "$BASELINE_DIR"
  CURRENT_DIR="$BASELINE_DIR"
elif [ ! -d "$BASELINE_DIR" ] || [ -z "$(ls -A "$BASELINE_DIR" 2>/dev/null)" ]; then
  echo "ERROR: baseline not found at $BASELINE_DIR" >&2
  echo "Run the Task 0 baseline capture commands first (see plan)." >&2
  exit 1
fi

mkdir -p "$CURRENT_DIR"

run() {
  local name="$1"; shift
  local errfile
  errfile=$(mktemp)
  if ! npm run --silent scout -- generate --full "$@" 2>"$errfile" > "$CURRENT_DIR/$name.json"; then
    echo "CLI ERROR $name:" >&2
    cat "$errfile" >&2
    rm -f "$errfile"
    exit 1
  fi
  rm -f "$errfile"
  if [ "$CAPTURE" = "1" ]; then
    echo "CAPTURED $name"
    return
  fi
  if diff -q "$BASELINE_DIR/$name.json" "$CURRENT_DIR/$name.json" > /dev/null; then
    echo "OK   $name"
  else
    echo "DRIFT $name — see diff:" >&2
    diff "$BASELINE_DIR/$name.json" "$CURRENT_DIR/$name.json" | head -40 >&2
    exit 1
  fi
}

run 01-non-lock        --level 8  --top-n 10 --seed 42
run 02-vanguard6       --level 10 --top-n 30 --seed 42 --locked-trait DA_18_Vanguard:6
run 03-riftbeast10     --level 9  --top-n 30 --seed 42 --locked-trait DA_Riftbeast18:10
run 04-coven5-emblem   --level 9  --top-n 30 --seed 42 --locked-trait DA_18_Coven:5 --emblem DA_18_Coven:1
run 05-lux-variant     --level 9  --top-n 10 --seed 42 --locked DA_18_Lux_Coven

echo ""
if [ "$CAPTURE" = "1" ]; then
  echo "Baseline captured in $BASELINE_DIR."
else
  echo "All 5 scenarios byte-identical to baseline."
fi
