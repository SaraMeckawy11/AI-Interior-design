/**
 * Mobile host for Livinai_web's exact realtime walkthrough export.
 *
 * Furniture geometry, dimensions and initial placement are not recreated here:
 * the WebView loads the very same GLB and metadata returned by
 * `/api/walkthrough/realtime/session` in Livinai_web. This file only supplies
 * touch navigation, selection and the React Native bridge around that scene.
 */

import { EXACT_THREE_REVISION, EXACT_THREE_RUNTIME } from "./exactThreeRuntime";

const escapePayload = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

// Keep this aligned with Livinai_web/src/walkthroughRendererRevision.js. The
// canonical exporter also hashes the Interior_plan source and catalog files,
// so changing the desktop project still invalidates stale GLBs automatically.
export const LIVINAI_WEB_RENDERER_REVISION = "wardrobe-first-bedrooms-v33";

export function buildExactWalkthroughHtml({
  scene,
  settings = {},
  furnitureEdits = {},
  mode = "walk",
  roomIndex = 0,
  night = false,
  xray = false,
}) {
  const payload = escapePayload({ scene, settings, furnitureEdits, mode, roomIndex, night, xray });
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<style>
html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden;background:#c9d5d8;touch-action:none}
canvas{display:block;width:100%;height:100%;outline:none}
#loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;background:#eef1ef;color:#39423f;font:600 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:opacity .25s}
#loading.done{opacity:0;pointer-events:none}
</style></head><body><div id="stage"></div><div id="loading">Loading the exact Livinai_web furniture…</div>
<script>window.__EXACT_LIVINAI__=${payload};</script>
<script>${EXACT_THREE_RUNTIME}</script>
<script>
(function(){
  'use strict';
  var payload=window.__EXACT_LIVINAI__, data=payload.scene, settings=payload.settings||{}, edits=payload.furnitureEdits||{};
  var post=function(value){try{window.ReactNativeWebView.postMessage(JSON.stringify(value));}catch(error){}};
  if(!window.THREE||!THREE.GLTFLoader){post({type:'error',message:'The exact 3D engine could not be loaded.'});return;}
  var host=document.getElementById('stage');
  var renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  var threeScene=new THREE.Scene();
  var camera=new THREE.PerspectiveCamera(68,1,0.05,180);camera.rotation.order='YXZ';
  var state={mode:payload.mode||'walk',night:!!payload.night,roomIndex:payload.roomIndex||0,freeExplore:settings.freeExplore!==false,xray:!!payload.xray,designer:false};
  var engine={yaw:Number(data.spawnYaw)||0,pitch:-0.04,orbitAngle:0.72,orbitPitch:0.72,selected:null,selectionBox:null,drag:false,moved:0,lastX:0,lastY:0,joystick:{x:0,y:0},furniture:[],ceilings:[],overheads:[],walls:[],userPose:null,clock:new THREE.Clock()};
  camera.position.fromArray(data.spawn||[0,1.62,0]);
  threeScene.background=new THREE.Color(state.night?0x132333:0xc9d5d8);
  var pmrem=null,environment=null;
  if(THREE.RoomEnvironment){pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(new THREE.RoomEnvironment(),0.04).texture;threeScene.environment=environment;threeScene.environmentIntensity=state.night?0.3:0.48;}
  var hemisphere=new THREE.HemisphereLight(state.night?0x6f89a0:0xf5f1e8,0x39433e,state.night?0.48:0.85);threeScene.add(hemisphere);
  var sun=new THREE.DirectionalLight(0xfff2da,state.night?0.7:1.7);sun.position.set(-5.5,10,7.5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.near=0.5;sun.shadow.camera.far=45;sun.shadow.camera.left=-16;sun.shadow.camera.right=16;sun.shadow.camera.top=16;sun.shadow.camera.bottom=-16;sun.shadow.bias=-0.00025;threeScene.add(sun);
  var roomPointLights=[];(data.roomCenters||[]).slice(0,6).forEach(function(centre){var light=new THREE.PointLight(0xffdfb7,state.night?8:2.2,7,2);light.position.set(centre[0],2.58,centre[2]);threeScene.add(light);roomPointLights.push(light);});
  var pointInPolygon=function(x,z,polygon){var inside=false;for(var i=0,j=polygon.length-1;i<polygon.length;j=i++){var xi=polygon[i][0],zi=polygon[i][1],xj=polygon[j][0],zj=polygon[j][1];if((zi>z)!==(zj>z)&&x<((xj-xi)*(z-zi))/(zj-zi+1e-9)+xi)inside=!inside;}return inside;};
  var planPoints=(data.walkable||[]).reduce(function(all,polygon){return all.concat(polygon);},[]);
  var xs=planPoints.map(function(p){return p[0];}),zs=planPoints.map(function(p){return p[1];});
  var bounds={minX:Math.min.apply(null,xs),maxX:Math.max.apply(null,xs),minZ:Math.min.apply(null,zs),maxZ:Math.max.apply(null,zs)};
  bounds.cx=(bounds.minX+bounds.maxX)/2;bounds.cz=(bounds.minZ+bounds.maxZ)/2;
  var planWidth=Math.max(1,bounds.maxX-bounds.minX),planDepth=Math.max(1,bounds.maxZ-bounds.minZ);
  var planDistance=Math.max(6,Math.max(planWidth,planDepth)*1.35);
  var roomCentre=function(index){var centre=(data.roomCenters||[])[index]||(data.roomCenters||[])[0]||[bounds.cx,1.62,bounds.cz];return new THREE.Vector3(centre[0],centre[1],centre[2]);};
  var reportChange=function(group,reset){if(!group||!group.userData.editId)return;post({type:'furnitureChange',id:group.userData.editId,transform:reset?null:{x:group.position.x,y:group.position.y,z:group.position.z,rotation:group.rotation.y}});};
  var clearSelection=function(){if(engine.selectionBox){threeScene.remove(engine.selectionBox);engine.selectionBox.geometry.dispose();engine.selectionBox=null;}engine.selected=null;};
  var selectGroup=function(group){clearSelection();engine.selected=group;engine.selectionBox=new THREE.BoxHelper(group,0xed6259);threeScene.add(engine.selectionBox);var item=group.userData.item||{};post({type:'select',info:{name:item.label||'Livinai_web furniture',material:'Livinai_web native PBR object',detail:'Original Livinai_web furniture, dimensions and placement.',category:'exact-furniture'}});};
  var applyLighting=function(){var bird=state.mode!=='walk';threeScene.background.set(state.night?0x132333:0xc9d5d8);renderer.toneMappingExposure=state.night?0.84:0.8;if(environment)threeScene.environmentIntensity=bird?(state.night?0.24:0.38):(state.night?0.3:0.48);hemisphere.intensity=bird?(state.night?0.38:0.62):(state.night?0.48:0.85);sun.intensity=bird?(state.night?0.45:1.2):(state.night?0.7:1.7);roomPointLights.forEach(function(light){light.intensity=bird?(state.night?3.8:0.65):(state.night?8:2.2);});};
  var focusRoom=function(index){state.roomIndex=Math.max(0,Math.min((data.roomCenters||[]).length-1,Number(index)||0));var centre=roomCentre(state.roomIndex);camera.position.set(centre.x,1.62,centre.z);engine.yaw=Number(data.spawnYaw)||0;engine.pitch=-0.04;};
  // Walking through walls is what the x-ray view is *for*: the point of removing
  // a wall is to be able to stand behind where it was.
  var validMove=function(target){return state.freeExplore||state.xray||(data.walkable||[]).some(function(poly){return pointInPolygon(target.x,target.z,poly);});};

  /**
   * The corner of a room that shows the most of it.
   *
   * "Designer" was a choice with no implementation: capture took a
   * designerCamera argument and ignored it, so picking it in the render sheet
   * changed the caption underneath and nothing else — the render came from
   * wherever the user happened to be standing. This is the viewpoint an estate
   * agent's photographer uses: stand in the corner furthest from the middle of
   * the room, a little way in from it, and look at the middle.
   */
  var designerPose=function(index){
    var polygon=(data.walkable||[])[index]||(data.walkable||[])[0];
    var centre=roomCentre(index);
    if(!polygon||polygon.length<3)return{x:centre.x,z:centre.z,yaw:engine.yaw,pitch:-0.04};
    var far=polygon[0],best=-1;
    polygon.forEach(function(point){var d=Math.hypot(point[0]-centre.x,point[1]-centre.z);if(d>best){best=d;far=point;}});
    // Step in off the corner so the camera is inside the room rather than in the
    // wall, but never past the middle of a small room.
    var inset=Math.min(0.75,Math.max(0.25,best*0.22));
    var toCentre=[centre.x-far[0],centre.z-far[1]],length=Math.hypot(toCentre[0],toCentre[1])||1;
    var x=far[0]+(toCentre[0]/length)*inset,z=far[1]+(toCentre[1]/length)*inset;
    return{x:x,z:z,yaw:Math.atan2(centre.x-x,centre.z-z)+Math.PI,pitch:-0.08};
  };
  var applyPose=function(pose){camera.position.set(pose.x,1.62,pose.z);engine.yaw=pose.yaw;engine.pitch=pose.pitch;};
  var setDesignerView=function(on){
    if(on){
      if(!state.designer)engine.userPose={x:camera.position.x,z:camera.position.z,yaw:engine.yaw,pitch:engine.pitch};
      state.designer=true;applyPose(designerPose(state.roomIndex));
    }else{
      state.designer=false;
      if(engine.userPose)applyPose(engine.userPose);
      engine.userPose=null;
    }
  };

  /**
   * Hide the walls standing between the camera and the room it is looking at.
   *
   * The exporter already ships every architectural piece as its own node so that
   * exactly this is possible — it says so in a comment — but nothing on the
   * phone ever used it, so backing out of a room to frame a wider shot put the
   * back of a wall across the whole screen.
   *
   * A wall is hidden only while it is genuinely in the way: the test is a ray
   * from the camera to the middle of the focused room, and a wall counts as
   * occluding when the ray reaches it *before* it reaches the room. The far wall
   * of the room is past that point and stays, which is what keeps the room
   * looking like a room rather than furniture floating on a lawn.
   */
  var occlusionRay=new THREE.Ray(),occlusionHit=new THREE.Vector3();
  var applyWallVisibility=function(){
    if(!engine.walls.length)return;
    if(!state.xray||state.mode!=='walk'){engine.walls.forEach(function(wall){wall.node.visible=true;});return;}
    var target=roomCentre(state.roomIndex),origin=camera.position;
    var direction=new THREE.Vector3(target.x-origin.x,0,target.z-origin.z);
    var span=direction.length();
    if(span<0.05){engine.walls.forEach(function(wall){wall.node.visible=true;});return;}
    occlusionRay.origin.copy(origin);occlusionRay.direction.copy(direction.divideScalar(span));
    engine.walls.forEach(function(wall){
      var hit=occlusionRay.intersectBox(wall.box,occlusionHit);
      // intersectBox returns the entry point, or the origin when the camera is
      // already inside the box — which is the case for the wall you are standing
      // in the middle of, and that one has to go too.
      wall.node.visible=!(hit&&origin.distanceTo(occlusionHit)<span-0.35);
    });
  };
  var moveCamera=function(direction,amount){if(state.mode!=='walk')return;var step=amount||0.36,forward=new THREE.Vector3(-Math.sin(engine.yaw),0,-Math.cos(engine.yaw)),right=new THREE.Vector3(Math.cos(engine.yaw),0,-Math.sin(engine.yaw)),next=camera.position.clone();if(direction==='forward')next.addScaledVector(forward,step);if(direction==='back')next.addScaledVector(forward,-step);if(direction==='left')next.addScaledVector(right,-step);if(direction==='right')next.addScaledVector(right,step);if(validMove(next))camera.position.copy(next);};
  var composition=function(){return{source:'Livinai_web exact realtime',viewpoint:state.mode==='plan'?'bird':'user',furnitureCount:engine.furniture.length,visibleFurnitureCount:engine.furniture.length,doorCount:(data.openings||[]).filter(function(o){return o.type==='door';}).length,windowCount:(data.openings||[]).filter(function(o){return o.type==='window';}).length,furnitureLabels:engine.furniture.filter(function(o){return o.item.roomIndex===state.roomIndex;}).map(function(o){return o.item.label;})};};
  window.LivinaiScene={
    move:moveCamera,
    turn:function(delta){engine.yaw+=delta;},
    setJoystick:function(x,y){engine.joystick.x=x;engine.joystick.y=y;},
    setMode:function(value){state.mode=value;clearSelection();if(value==='walk')focusRoom(state.roomIndex);applyLighting();},
    setNight:function(value){state.night=!!value;applyLighting();},
    setRoom:function(index){focusRoom(index);},
    setFreeExplore:function(value){state.freeExplore=!!value;},
    setXray:function(value){state.xray=!!value;applyWallVisibility();},
    setDesignerView:setDesignerView,
    frameRoom:function(index){focusRoom(index);},
    rotateSelected:function(delta){if(!engine.selected)return;engine.selected.rotation.y+=delta;engine.selectionBox&&engine.selectionBox.update();reportChange(engine.selected,false);},
    moveSelected:function(direction,amount){if(!engine.selected)return;var step=amount||0.12,forward=new THREE.Vector3(-Math.sin(engine.yaw),0,-Math.cos(engine.yaw)),right=new THREE.Vector3(Math.cos(engine.yaw),0,-Math.sin(engine.yaw)),axis=direction==='forward'?forward:direction==='back'?forward.negate():direction==='left'?right.negate():right,target=engine.selected.position.clone().addScaledVector(axis,step);if(validMove(target)){engine.selected.position.copy(target);engine.selectionBox&&engine.selectionBox.update();reportChange(engine.selected,false);}},
    resetSelected:function(){if(!engine.selected||!engine.selected.userData.home)return;var home=engine.selected.userData.home;engine.selected.position.set(home.x,home.y,home.z);engine.selected.rotation.y=home.rotation;engine.selectionBox&&engine.selectionBox.update();reportChange(engine.selected,true);},
    clearSelection:clearSelection,
    /**
     * Grab the frame, optionally from the designer viewpoint.
     *
     * The designerCamera argument has been passed from the app since this
     * screen existed and was dropped on the floor here, so "Designer" and "My
     * view" produced the same picture. It now moves, renders one frame, grabs
     * it, and puts the camera back — unless the user is already previewing the
     * designer view, in which case there is nothing to move.
     */
    capture:function(purpose,designerCamera){
      var restore=null;
      if(designerCamera&&!state.designer){
        restore={x:camera.position.x,z:camera.position.z,yaw:engine.yaw,pitch:engine.pitch};
        applyPose(designerPose(state.roomIndex));
        camera.rotation.set(engine.pitch,engine.yaw,0);
        applyWallVisibility();
        renderer.render(threeScene,camera);
      }
      var info=composition();
      post({type:'composition',composition:info});
      post({type:'snapshot',purpose:purpose||'photo',composition:info,image:renderer.domElement.toDataURL('image/jpeg',0.92)});
      if(restore)applyPose(restore);
    }
  };
  var resize=function(){var width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();};
  window.addEventListener('resize',resize);resize();applyLighting();
  var raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',function(event){engine.drag=true;engine.moved=0;engine.lastX=event.clientX;engine.lastY=event.clientY;canvas.setPointerCapture&&canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',function(event){if(!engine.drag)return;var dx=event.clientX-engine.lastX,dy=event.clientY-engine.lastY;engine.moved+=Math.abs(dx)+Math.abs(dy);engine.lastX=event.clientX;engine.lastY=event.clientY;if(state.mode==='walk'){engine.yaw-=dx*0.0052;engine.pitch=Math.max(-0.72,Math.min(0.6,engine.pitch-dy*0.0042));}else{engine.orbitAngle-=dx*0.007;engine.orbitPitch=Math.max(0.2,Math.min(1.25,engine.orbitPitch+dy*0.005));}});
  canvas.addEventListener('pointerup',function(event){engine.drag=false;if(engine.moved>10)return;var rect=canvas.getBoundingClientRect();pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);var hits=raycaster.intersectObjects(engine.furniture.map(function(item){return item.group;}),true);if(!hits.length){clearSelection();post({type:'select',info:null});return;}var node=hits[0].object;while(node&&!node.userData.item)node=node.parent;if(node)selectGroup(node);});
  new THREE.GLTFLoader().load(data.modelUrl,function(gltf){
    var model=gltf.scene;threeScene.add(model);var architecture=[];
    model.traverse(function(child){if(child.name.indexOf('ceiling_')===0)engine.ceilings.push(child);if(child.name.indexOf('overhead_')===0)engine.overheads.push(child);if(!child.isMesh)return;child.receiveShadow=true;child.castShadow=child.name.indexOf('furniture_')===0;if(child.name.indexOf('architecture_')===0)architecture.push(child);var materials=Array.isArray(child.material)?child.material:[child.material];materials.forEach(function(material){material.envMapIntensity=state.night?0.42:0.68;if(material.map)material.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());});});
    // Each architectural piece with its world box, measured once. A wall does
    // not move, so recomputing this per frame would be work for nothing — and
    // the floor is excluded by height, or standing anywhere would remove it.
    model.updateMatrixWorld(true);
    architecture.forEach(function(mesh){
      var box=new THREE.Box3().setFromObject(mesh);
      if(box.max.y-box.min.y<0.6)return;
      engine.walls.push({node:mesh,box:box});
    });
    engine.furniture=(data.furniture||[]).map(function(item){var group=new THREE.Group();group.name='editable_'+item.index;group.position.fromArray(item.pivot);threeScene.add(group);var nodes=[];model.traverse(function(node){if(node.name.indexOf(item.nodePrefix)===0)nodes.push(node);});nodes.forEach(function(node){group.attach(node);});var id='exact:'+item.index;group.userData.item=item;group.userData.editId=id;group.userData.home={x:group.position.x,y:group.position.y,z:group.position.z,rotation:0};var saved=edits[id];if(saved){group.position.set(Number(saved.x)||0,Number.isFinite(Number(saved.y))?Number(saved.y):group.position.y,Number(saved.z)||0);group.rotation.y=Number(saved.rotation)||0;}return{item:item,group:group};});
    document.getElementById('loading').className='done';focusRoom(state.roomIndex);post({type:'ready',objects:engine.furniture.length,rooms:(data.roomCenters||[]).length,exact:true,source:'Livinai_web',threeVersion:${JSON.stringify(EXACT_THREE_REVISION)}});
  },undefined,function(error){post({type:'error',message:'The exact Livinai_web scene could not be loaded: '+(error&&error.message?error.message:'model error')});});
  // The roof and everything hanging from it are only ever wanted from inside a
  // room. Seen from any camera that is above the building — which is every
  // camera that is not the walking one — a ceiling is an opaque lid over the
  // home, and the pendants and chandelier under it are lit from the wrong side.
  // This used to test for the bird view by name, so the orbit camera kept the
  // ceiling and spent most of its arc looking at the top of it.
  var setRoofVisible=function(){var inside=state.mode==='walk';engine.ceilings.forEach(function(node){node.visible=inside;});engine.overheads.forEach(function(node){node.visible=inside;});};
  var render=function(){requestAnimationFrame(render);var delta=Math.min(engine.clock.getDelta(),0.05);setRoofVisible();applyWallVisibility();if(state.mode==='walk'){if(engine.joystick.x||engine.joystick.y){var forward=new THREE.Vector3(-Math.sin(engine.yaw),0,-Math.cos(engine.yaw)),right=new THREE.Vector3(Math.cos(engine.yaw),0,-Math.sin(engine.yaw)),next=camera.position.clone().addScaledVector(forward,-engine.joystick.y*2.35*delta).addScaledVector(right,engine.joystick.x*2.35*delta);if(validMove(next))camera.position.copy(next);}camera.up.set(0,1,0);camera.rotation.set(engine.pitch,engine.yaw,0);}else{var target=new THREE.Vector3(bounds.cx,0,bounds.cz),pitch=Math.max(0.12,engine.orbitPitch*0.34),horizontal=planDistance*Math.sin(pitch);camera.position.set(target.x+horizontal*Math.sin(engine.orbitAngle),target.y+planDistance*Math.cos(pitch),target.z+horizontal*Math.cos(engine.orbitAngle));camera.up.set(0,1,0);camera.lookAt(target);}engine.selectionBox&&engine.selectionBox.update();renderer.render(threeScene,camera);};render();
}());
</script></body></html>`;
}

export default buildExactWalkthroughHtml;
