import { expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

it('loads MatchSim through a runtime import graph without Phaser, host scenes or browser adapters',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),seen=new Set<string>(),queue=[path.join(root,'src/sim/MatchSim.ts')];
  const forbidden:string[]=[];
  while(queue.length){
    const file=queue.shift()!;if(seen.has(file))continue;seen.add(file);
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    for(const statement of source.statements){
      if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement)||!statement.moduleSpecifier||!ts.isStringLiteral(statement.moduleSpecifier))continue;
      if(ts.isExportDeclaration(statement)&&statement.isTypeOnly||ts.isImportDeclaration(statement)&&statement.importClause?.isTypeOnly)continue;
      const names=ts.isImportDeclaration(statement)?statement.importClause?.namedBindings:statement.exportClause;
      if(names&&'elements' in names&&names.elements.every(name=>name.isTypeOnly))continue;
      const specifier=statement.moduleSpecifier.text;
      if(specifier==='phaser'||specifier.startsWith('phaser/')){forbidden.push(`${path.relative(root,file)} → ${specifier}`);continue;}
      if(specifier==='three'||specifier.startsWith('three/')){forbidden.push(`${path.relative(root,file)} → ${specifier}`);continue;}
      if(!specifier.startsWith('.'))continue;
      const base=path.resolve(path.dirname(file),specifier),dependency=[base,`${base}.ts`,`${base}.js`,path.join(base,'index.ts')].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
      if(!dependency||!dependency.endsWith('.ts'))continue;
      if(/\/scenes\/.*Scene\.ts$/.test(dependency))forbidden.push(path.relative(root,dependency));
      if(dependency.includes('/port/') || /\/characterPresentation\/(registry|contracts)\.ts$/.test(dependency))forbidden.push(path.relative(root,dependency));
      queue.push(dependency);
    }
  }
  expect(forbidden).toEqual([]);expect(seen.size).toBeGreaterThan(100);
});
