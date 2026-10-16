/** Simulation-owned sample clock. Resource extent is an explicit project adapter. */
export interface GrabSourcePresentation {
  readonly framesElapsed:number;
  readonly lastFrame:number;
  readonly facing:1|-1;
}
export function beginGrabSourcePresentation(frame:number,facing:1|-1):GrabSourcePresentation {
  return {framesElapsed:0,lastFrame:frame,facing};
}
export function stepGrabSourcePresentation(state:GrabSourcePresentation|null,
  frame:number,duration:number,frozen=false):GrabSourcePresentation|null {
  if(!state)return null;
  if(frame<=state.lastFrame)return state;
  const framesElapsed=state.framesElapsed+(frozen?0:1);
  return framesElapsed>=duration?null:{...state,framesElapsed,lastFrame:frame};
}
