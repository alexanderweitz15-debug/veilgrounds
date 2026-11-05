// usage: node p.cjs file 'anchor' 'insert-after-anchor-line-text' (inserts text after the first line containing anchor, keeps EOL)
const fs=require('fs');const [,,f,anchor,ins,mode]=process.argv;
let s=fs.readFileSync(f,'utf8');const eol=s.includes('\r\n')?'\r\n':'\n';
const lines=s.split(eol);const i=lines.findIndex(l=>l.includes(anchor));
if(i<0){console.error('NO ANCHOR',f,anchor);process.exit(1)}
if(mode==='append'){lines[i]=lines[i].replace(anchor,anchor+ins)}else lines.splice(i+1,0,...ins.split('\n'));
fs.writeFileSync(f,lines.join(eol));
