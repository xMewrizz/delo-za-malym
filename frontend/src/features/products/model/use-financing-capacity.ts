import {useEffect,useState} from "react";
import {getFinancingCapacity,type FinancingCapacity} from "../api/financing-capacity";

/** Bank data only: typing a request cannot raise the business's capacity. */
export function useFinancingCapacity(revision:string,grace=0) {
  const key=JSON.stringify([revision,grace]);
  const [state,setState]=useState<{key:string;data?:FinancingCapacity;failed:boolean}>({key:"",failed:false});
  useEffect(()=>{
    const abort=new AbortController();
    void getFinancingCapacity(abort.signal,grace).then(data=>{
      if(!abort.signal.aborted)setState({key,data,failed:false});
    }).catch(()=>{if(!abort.signal.aborted)setState({key,failed:true});});
    return()=>abort.abort();
  },[key,grace]);
  return state.key===key?{data:state.data,loading:false,failed:state.failed}:{loading:true,failed:false,data:undefined};
}
