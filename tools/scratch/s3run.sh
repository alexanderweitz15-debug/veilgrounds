#!/bin/bash
# S3: before/after load-time table. Usage: tools/scratch/s3run.sh <distBefore> <distAfter> <outFile>
set -u
cd "$(dirname "$0")/../.."
node tools/scratch/s3serve.mjs "$1" 4181 > /dev/null 2>&1 &
P1=$!
node tools/scratch/s3serve.mjs "$2" 4182 > /dev/null 2>&1 &
P2=$!
trap 'kill $P1 $P2 2>/dev/null' EXIT
sleep 1
{
  echo "== before cold"; node tools/scratch/s3measure.mjs http://127.0.0.1:4181 cold 3 before
  echo "== before warm"; node tools/scratch/s3measure.mjs http://127.0.0.1:4181 warm 3 before game
  echo "== after cold (unthrottled)"; node tools/scratch/s3measure.mjs http://127.0.0.1:4182 cold 3 after
  echo "== after cold (50 Mbit)"; NET_MBIT=50 node tools/scratch/s3measure.mjs http://127.0.0.1:4182 cold 3 after50
  echo "== after warm"; node tools/scratch/s3measure.mjs http://127.0.0.1:4182 warm 3 after game
  echo "== done"
} > "$3" 2>&1
