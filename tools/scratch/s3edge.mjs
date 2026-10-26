// debug: does headless Edge stay alive with the bake flags?
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const profile = mkdtempSync(join(tmpdir(), 'edge-dbg-'));
const extra = process.argv.slice(2);
const p = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', `--user-data-dir=${profile}`, ...extra, 'about:blank'], { stdio: 'inherit' });
const t0 = Date.now();
p.on('exit', (c) => { console.log('exit', c, Date.now() - t0, 'ms'); process.exit(0); });
setTimeout(() => { console.log('still alive after 6 s'); import('node:child_process').then((m) => m.execSync(`taskkill /PID ${p.pid} /T /F`)); setTimeout(() => process.exit(0), 500); }, 6000);
