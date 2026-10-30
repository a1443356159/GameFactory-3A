/** Geometric framing checks; independent of temporal camera controls. */
export function boxCorners(T, box) {
  const corners=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new T.Vector3(x,y,z));return corners;
}

export function inspectTargets(T,scene,camera,names,width=1280,height=720,padding=.05) {
  return names.map(name=>{
    const object=scene.getObjectByName(name);if(!object)return {name,missing:true};
    const box=new T.Box3().setFromObject(object,true), points=boxCorners(T,box).map(p=>p.project(camera));
    const min=[0,1,2].map(i=>Math.min(...points.map(p=>p.toArray()[i]))),max=[0,1,2].map(i=>Math.max(...points.map(p=>p.toArray()[i])));
    const finite=[...min,...max,...box.min.toArray(),...box.max.toArray()].every(Number.isFinite);
    const safe=1-2*padding;
    return {name,finite,worldMin:box.min.toArray(),worldMax:box.max.toArray(),ndcMin:min,ndcMax:max,projectedWidthPx:(max[0]-min[0])*width/2,projectedHeightPx:(max[1]-min[1])*height/2,insideFrustum:finite&&min.every(v=>v>=-1)&&max.every(v=>v<=1),insideSafeFrame:finite&&min[0]>=-safe&&min[1]>=-safe&&max[0]<=safe&&max[1]<=safe&&min[2]>=-1&&max[2]<=1};
  });
}
