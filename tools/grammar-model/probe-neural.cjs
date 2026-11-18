const fs=require('node:fs/promises'),path=require('node:path');
const {NeuralGrammarEngine}=require('../../electron/neural-grammar-engine.cjs');
(async()=>{
 const engine=new NeuralGrammarEngine(path.resolve('build/neural-grammar'));
 for(const source of process.argv.slice(2)){
  const raw=await fs.readFile(source,'utf8'),rows=raw.trim().startsWith('[')?JSON.parse(raw):raw.trim().split(/\r?\n/u).map(JSON.parse);
  const output=[];
  for(let i=0;i<rows.length;i++){
   const start=performance.now(),hints=await engine.check(rows[i].text);
   output.push({id:rows[i].id||String(i+1),text:rows[i].text,underlines:hints.map(h=>({...h,span:h.original,kind:'grammar'})),ms:performance.now()-start});
  }
  const target='test-output/neural-v2-'+path.basename(source).replace(/\.[^.]+$/u,'')+'.json';
  await fs.writeFile(target,JSON.stringify(output,null,2));
  console.log(target,output.length,output.reduce((n,row)=>n+row.underlines.length,0));
 }
 await engine.session?.release();
})().catch(e=>{console.error(e);process.exitCode=1;});
