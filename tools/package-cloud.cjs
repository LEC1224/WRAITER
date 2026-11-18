const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');
const root = path.resolve(__dirname,'..');
async function main() {
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  await fs.mkdir(path.join(root,'tmp'),{recursive:true});
  // A fresh staging directory prevents old hashed assets surviving a rebuild.
  const staging=await fs.mkdtemp(path.join(root,'tmp','cloud-release-'+pkg.version+'-'));
  for(const relative of ['cloud','electron','assets/thesaurus','dist-web']) {
    const source=path.join(root,relative);
    await fs.cp(source,path.join(staging,relative),{recursive:true,filter:input=>!/(?:^|[\\/])(?:data|config|node_modules|\.runtime|\.backup-transfer)(?:[\\/]|$)/.test(path.relative(source,input))&&!input.endsWith('.test.cjs')&&!input.endsWith('.env')&&!input.endsWith('.env.example')});
  }
  await fs.mkdir(path.join(staging,'src'),{recursive:true});
  for(const file of ['tabs.js','named-styles.js'])await fs.copyFile(path.join(root,'src',file),path.join(staging,'src',file));
  for(const file of ['LICENSE','THIRD-PARTY-NOTICES.md'])await fs.copyFile(path.join(root,file),path.join(staging,file));
  const dependencies=Object.fromEntries(Object.entries(pkg.dependencies).filter(([key])=>!['onnxruntime-node','@huggingface/tokenizers'].includes(key)));
  await fs.writeFile(path.join(staging,'package.json'),JSON.stringify({name:'wraiter-cloud',version:pkg.version,private:true,type:'module',engines:{node:'>=24.13.0'},scripts:{start:'node cloud/server.cjs'},dependencies},null,2)+'\n');
  if(!await fs.stat(path.join(staging,'dist-web','index.html')).catch(()=>null))throw new Error('Build the web app first; dist-web/index.html is required.');
  const zip=new JSZip();
  async function add(directory,prefix=''){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const relative=prefix+entry.name,full=path.join(directory,entry.name);if(entry.isDirectory())await add(full,relative+'/');else zip.file(relative,await fs.readFile(full));}}
  await add(staging); const archive=path.join(root,'tmp',`WRAITER-Cloud-${pkg.version}.zip`);await fs.writeFile(archive,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}));
  console.log(JSON.stringify({archive,staging,bytes:(await fs.stat(archive)).size,version:pkg.version}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
