import {createContext,useContext,useEffect} from 'react';

/** Presentation-only breadcrumb; it never selects a route or grants access. */
export const WorkspaceHeadingContext=createContext<(heading:string|null)=>void>(()=>{});
export function useWorkspaceHeading(heading:string){
 const setHeading=useContext(WorkspaceHeadingContext);
 useEffect(()=>{setHeading(heading);return()=>setHeading(null);},[heading,setHeading]);
}
