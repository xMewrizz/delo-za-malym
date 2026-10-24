import {useCallback,useEffect,useState} from "react";

export function useSelectionAdmission() {
  const [opened,setOpened]=useState<ReadonlySet<string>>(()=>new Set());
  const reset=useCallback(()=>setOpened(current=>current.size ? new Set() : current),[]);
  const allow=useCallback((id:string)=>setOpened(current=>current.has(id) ? current : new Set([...current,id])),[]);
  useEffect(()=>{
    let awaySince:number|null=document.hidden ? Date.now() : null;
    const leave=()=>{awaySince??=Date.now();};
    const resume=()=>{if(document.hidden)return;if(awaySince!=null&&Date.now()-awaySince>=30*60*1000)reset();awaySince=null;};
    const visibility=()=>{if(document.hidden)leave();else resume();};
    window.addEventListener("blur",leave);window.addEventListener("focus",resume);document.addEventListener("visibilitychange",visibility);
    return()=>{window.removeEventListener("blur",leave);window.removeEventListener("focus",resume);document.removeEventListener("visibilitychange",visibility);};
  },[reset]);
  return {opened,allow,reset};
}

