import { lstat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, type ProjectEntry } from './store.js';
import { cleanExpiredScreenshots, GENERATED_IMAGE, SCREENSHOT_RETENTION_MS } from './screenshot-retention.js';

/** Only delete managed media. Documents, backup files, conversations and reports count toward total storage. */
export async function projectStorage(entry:ProjectEntry, clean?:'screenshots'|'traces'):Promise<{total:number;screenshots:number;traces:number;images:number;recordings:number;removed:number}> {
  const home=dataDir();
  const result={total:0,screenshots:0,traces:0,images:0,recordings:0,removed:0};
  const traceFiles:string[]=[];
  async function walk(parts:string[]) {
    const path=join(home,...parts);
    const st=await lstat(path).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
    if(!st || st.isSymbolicLink())return;
    if(st.isDirectory()){
      for(const name of await readdir(path))await walk([...parts,name]);
    }else if(st.isFile()){
      result.total+=st.size;
      if(parts[0]==='rounds' && parts.length===4 && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-shots$/.test(parts[2]) && GENERATED_IMAGE.test(parts[3])){
        result.screenshots+=st.size;result.images++;
      }
      if(parts[0]==='projects' && parts.length===6 && parts[2]==='assurance' && parts[3]==='sample-evidence' && /^[a-f0-9-]{36}$/.test(parts[4]) && /^[\w.-]+\.trace\.zip$/.test(parts[5])){
        result.traces+=st.size;result.recordings++;traceFiles.push(path);
      }
    }
  }
  for(const dir of ['rounds','projects','project-agent-backups'])await walk([dir,entry.id]);
  await walk(['project-agent',entry.id+'.json']);
  if(clean==='screenshots')result.removed=await cleanExpiredScreenshots(Date.now()+SCREENSHOT_RETENTION_MS,entry.id);
  if(clean==='traces')for(const path of traceFiles){await unlink(path);result.removed++;}
  if(clean)return {...await projectStorage(entry),removed:result.removed};
  return result;
}
