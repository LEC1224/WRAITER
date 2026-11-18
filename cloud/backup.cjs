const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
async function snapshot(dataDir,output) { const source=new DatabaseSync(path.join(dataDir,'wraiter.sqlite'),{readOnly:true}); try { await fs.mkdir(path.dirname(output),{recursive:true}); const temporary=output+'.next'; await fs.rm(temporary,{force:true}); await backup(source,temporary); const check=new DatabaseSync(temporary,{readOnly:true}); try { const result=check.prepare('PRAGMA integrity_check').get(); if(result.integrity_check!=='ok')throw new Error('Backup integrity check failed.'); } finally{check.close();} await fs.rename(temporary,output); const hash=createHash('sha256'); for await(const chunk of createReadStream(output))hash.update(chunk); const stat=await fs.stat(output), manifest={version:1,createdAt:new Date().toISOString(),bytes:stat.size,sha256:hash.digest('hex'),contents:'Users (salted password hashes), encrypted documents and wrapped vault metadata, any unmigrated legacy documents, account settings, sessions and schema'}; await fs.writeFile(output+'.manifest.json',JSON.stringify(manifest,null,2)); return manifest; } finally{source.close();} }
if(require.main===module){const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];snapshot(get('--data-dir'),get('--output')).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={snapshot};
