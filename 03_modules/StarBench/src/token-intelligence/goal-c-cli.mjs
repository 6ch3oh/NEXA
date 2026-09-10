import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ForecastWorkbench } from './forecast-workbench.mjs';
import { mapNexaPlanToProjectBrief, parseNexaPlanMarkdown } from './nexa-plan-intake.mjs';
import { buildForecastAccuracyReport, renderForecastAccuracyCopyable, renderForecastAccuracyMarkdown } from './forecast-accuracy-report.mjs';

export async function runGoalCCommand(options,{rootDir,bounded,readJson}){
 if(options.command==='plan-forecast'){if(typeof options.input!=='string'||typeof options.output!=='string')return 2;const intake=parseNexaPlanMarkdown(await readFile(bounded(rootDir,options.input),'utf8'));if(intake.status!=='READY'){process.stdout.write(`${JSON.stringify(intake)}\n`);return 3;}const mapped=mapNexaPlanToProjectBrief(intake.normalized_plan),workbench=new ForecastWorkbench(),result=workbench.run({input:mapped.brief,format:'json'});if(result.status!=='READY')return 3;const written=await workbench.writeBundle(result.bundle,{rootDir,outputDir:bounded(rootDir,options.output)});await writeFile(join(written.directory,'normalized-plan.json'),`${JSON.stringify(intake.normalized_plan,null,2)}\n`,'utf8');await writeFile(join(written.directory,'plan-mapping.json'),`${JSON.stringify(mapped.mapping_provenance,null,2)}\n`,'utf8');process.stdout.write(`${JSON.stringify(written)}\n`);return 0;}
 if(options.command==='accuracy-report'){if(typeof options.input!=='string'||typeof options.output!=='string')return 2;const report=buildForecastAccuracyReport(await readJson(bounded(rootDir,options.input))),output=bounded(rootDir,options.output);await mkdir(output,{recursive:true});await writeFile(join(output,'forecast-accuracy-report.json'),`${JSON.stringify(report,null,2)}\n`,'utf8');await writeFile(join(output,'forecast-accuracy-report.md'),renderForecastAccuracyMarkdown(report),'utf8');await writeFile(join(output,'forecast-accuracy-report.txt'),`${renderForecastAccuracyCopyable(report)}\n`,'utf8');process.stdout.write(`${JSON.stringify({status:'READY',report_id:report.report_id})}\n`);return 0;}
 return null;
}
