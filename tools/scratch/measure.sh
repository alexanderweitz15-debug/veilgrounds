#!/bin/sh
# Sequential before/after measurement. usage: measure.sh <label> ; run from a worktree root. Output: tools/scratch/out/<label>-*.txt
L=$1
mkdir -p tools/scratch/out
npx tsx tools/scratch/early.ts 1,2 gold > tools/scratch/out/$L-early.txt 2>&1
npx tsx tools/scratch/roams.ts 12 1,2 gold > tools/scratch/out/$L-roams.txt 2>&1
npm run bot-sim -- --brain=new --rank=gold --games=2 --minutes=12 --jobs=2 > tools/scratch/out/$L-botsim.txt 2>&1
echo finished > tools/scratch/out/$L-done.txt
