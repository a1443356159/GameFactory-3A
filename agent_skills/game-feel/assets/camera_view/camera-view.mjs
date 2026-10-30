/** Stable per-video camera contract. No playback, UI or temporal state. */
function object(value,keys,required,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} 必须为对象`);
  for(const key of Object.keys(value))if(!keys.includes(key))throw new TypeError(`${label} 未知字段 ${key}`);
  for(const key of required)if(!Object.hasOwn(value,key))throw new TypeError(`${label} 缺少 ${key}`);
}
const num=(v,label,min=-Infinity,max=Infinity,exclusive=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(exclusive&&v===min))throw new RangeError(`${label} 数值无效`);};
export function validateCameraView(value){
  object(value,['schema_version','coordinate_system','projection','pose','framing'],['schema_version','coordinate_system','projection','pose'],'camera_view');
  if(value.schema_version!=='1.0')throw new RangeError('不支持的 schema_version');
  if(value.coordinate_system!=='Y_UP_RIGHT_HANDED')throw new RangeError('坐标系必须为 Y_UP_RIGHT_HANDED');
  const p=value.projection,type=p?.type;
  if(!['perspective','orthographic'].includes(type))throw new RangeError('projection.type 无效');
  const lens=type==='perspective'?'fov_y_deg':'vertical_size';
  object(p,['type',lens,'near','far'],['type',lens,'near','far'],'projection');
  num(p[lens],lens,type==='perspective'?10:0,type==='perspective'?100:Infinity,type!=='perspective');
  num(p.near,'near',0,Infinity,type==='perspective');num(p.far,'far',0,Infinity,true);
  if(p.near>=p.far)throw new RangeError('near 必须小于 far');
  const pose=value.pose;object(pose,['target','azimuth_deg','elevation_deg','distance'],['target','azimuth_deg','elevation_deg','distance'],'pose');
  if(!Array.isArray(pose.target)||pose.target.length!==3)throw new TypeError('target 必须为三维世界坐标');
  pose.target.forEach(n=>num(n,'target'));num(pose.azimuth_deg,'azimuth_deg',-180,180);num(pose.elevation_deg,'elevation_deg',-85,85);num(pose.distance,'distance',0,Infinity,true);
  const framing=value.framing||{required_targets:[],safe_margin:.05};object(framing,['required_targets','safe_margin'],['required_targets','safe_margin'],'framing');
  if(!Array.isArray(framing.required_targets)||framing.required_targets.some(s=>typeof s!=='string'||!s)||new Set(framing.required_targets).size!==framing.required_targets.length)throw new TypeError('required_targets 必须为不重复的主体 ID');
  num(framing.safe_margin,'safe_margin',0,.4);
  return structuredClone({...value,framing});
}
export function buildCamera(THREE,input,aspect){
  const view=validateCameraView(input);num(aspect,'aspect',0,Infinity,true);
  const p=view.projection,pose=view.pose;
  const camera=p.type==='perspective'?new THREE.PerspectiveCamera(p.fov_y_deg,aspect,p.near,p.far):new THREE.OrthographicCamera(-p.vertical_size*aspect/2,p.vertical_size*aspect/2,p.vertical_size/2,-p.vertical_size/2,p.near,p.far);
  const a=THREE.MathUtils.degToRad(pose.azimuth_deg),e=THREE.MathUtils.degToRad(pose.elevation_deg),d=pose.distance;
  camera.up.set(0,1,0);camera.position.set(pose.target[0]+d*Math.cos(e)*Math.sin(a),pose.target[1]+d*Math.sin(e),pose.target[2]+d*Math.cos(e)*Math.cos(a));
  camera.lookAt(...pose.target);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  return {camera,view};
}
export function cameraViewFromPose(THREE,camera,target,requiredTargets=[],safeMargin=.05){
  const offset=camera.position.clone().sub(new THREE.Vector3(...target)),distance=offset.length();
  return validateCameraView({schema_version:'1.0',coordinate_system:'Y_UP_RIGHT_HANDED',projection:camera.isPerspectiveCamera?{type:'perspective',fov_y_deg:camera.fov,near:camera.near,far:camera.far}:{type:'orthographic',vertical_size:camera.top-camera.bottom,near:camera.near,far:camera.far},pose:{target:[...target],azimuth_deg:THREE.MathUtils.radToDeg(Math.atan2(offset.x,offset.z)),elevation_deg:THREE.MathUtils.radToDeg(Math.asin(offset.y/distance)),distance},framing:{required_targets:[...requiredTargets],safe_margin:safeMargin}});
}
