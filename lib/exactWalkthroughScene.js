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
export const LIVINAI_WEB_RENDERER_REVISION = "style-kits-full-polyhaven-v40";

export function buildExactWalkthroughHtml({
  scene,
  settings = {},
  furnitureEdits = {},
  mode = "walk",
  roomIndex = 0,
  night = false,
}) {
  const payload = escapePayload({ scene, settings, furnitureEdits, mode, roomIndex, night });
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<style>
html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden;background:#c9d5d8;touch-action:none}
/* touch-action does not inherit, and without it here the WebView can still take
   part of a drag as a scroll or a page zoom. */
canvas{display:block;width:100%;height:100%;outline:none;touch-action:none}
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
  var state={mode:payload.mode||'walk',night:!!payload.night,roomIndex:payload.roomIndex||0,freeExplore:settings.freeExplore!==false,designer:false};
  /**
   * Where the camera is, and where the fingers are asking it to be.
   *
   * Every angle is kept twice: the value being rendered, and the target the
   * gesture is steering towards. The render loop eases one into the other, so a
   * drag reads as momentum rather than as the camera being dragged frame by
   * frame — and so a finger lifted mid-swipe settles instead of stopping dead.
   */
  var spawnYaw=Number(data.spawnYaw)||0;
  var engine={
    yaw:spawnYaw,targetYaw:spawnYaw,
    pitch:-0.04,targetPitch:-0.04,
    orbitAngle:0.72,targetOrbitAngle:0.72,
    orbitTilt:0.78,targetOrbitTilt:0.78,
    orbitDistance:0,targetOrbitDistance:0,
    panX:0,panZ:0,
    // Active touches, by pointer id. Everything about the gesture is derived
    // from this: one entry is a look, two is a pinch-and-pan.
    pointers:{},pointerCount:0,
    centroidX:0,centroidY:0,spread:0,
    tapCandidate:false,moved:0,startedAt:0,
    selected:null,selectionBox:null,
    joystick:{x:0,y:0},vel:new THREE.Vector3(),want:new THREE.Vector3(),
    glide:null,walkPose:null,
    furniture:[],ceilings:[],overheads:[],userPose:null,clock:new THREE.Clock()};
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
  engine.orbitDistance=planDistance;engine.targetOrbitDistance=planDistance;

  /**
   * ── The gesture model ───────────────────────────────────────────────────
   *
   * One finger looks, two fingers move. That is the whole of it, and it is the
   * same pair in both views so nothing has to be relearned when you switch.
   *
   * **The camera follows the finger, in both views.** Swipe right and you turn
   * right; swipe down and you look down. This is the aiming convention rather
   * than the drag-the-panorama one, and it is a deliberate choice: it is what
   * this app has always done in the walking view and what it is being asked to
   * do everywhere.
   *
   * The bug it replaces was never the direction on its own — it was that the
   * two views disagreed. Walking turned the camera with the finger while the
   * bird view turned the plan with it, so switching between them reversed the
   * controls halfway through a session. Both now do the same thing, and if the
   * convention is ever flipped it has to be flipped in all four places below:
   * yaw and pitch while walking, angle and tilt while orbiting.
   *
   * **Sensitivity is a fraction of the screen, not a count of pixels.** The old
   * constants were radians-per-CSS-pixel, so the same swipe turned noticeably
   * further on a small phone than on a large one. A drag across the full width
   * now turns the same 135° on every device.
   *
   * **The bird view can actually tilt.** Its angle was a raw drag total
   * scaled by 0.34 under a hard floor, leaving a usable range of 7° to 24° off
   * vertical — and the first 40% of any downward drag landed under the floor
   * and did nothing at all. It is now a plain angle between 15° and 75°, so the
   * roof view and the eye-level view are both reachable, and every pixel of the
   * drag moves something.
   */
  /** A full-width drag turns 135°. */
  var LOOK_YAW_PER_WIDTH=Math.PI*0.75;
  /** A full-height drag covers slightly more than the whole tilt range, so both ends are reachable in one go. */
  var LOOK_PITCH_PER_HEIGHT=1.9;
  var PITCH_MIN=-0.95,PITCH_MAX=0.85;
  /** 15° and 75° off vertical: straight down onto the plan, or almost level with it. */
  var BIRD_TILT_MIN=0.26,BIRD_TILT_MAX=1.31;
  var BIRD_DISTANCE_MIN=planDistance*0.42,BIRD_DISTANCE_MAX=planDistance*2.1;
  /** How far two fingers sliding the full height of the screen walks you. */
  var WALK_DRAG_METRES=4.5;

  /**
   * How the camera walks, in real units.
   *
   * The number this replaces was a single 2.35 m/s applied the instant the stick
   * left centre and dropped the instant it came back. That is a third faster
   * than a person walks, with no acceleration at either end, in rooms three
   * metres across — so the smallest touch of the stick shot the camera over the
   * rug and let go of it against the far wall.
   */
  var NAV={
    walk:1.45,        // m/s for an ordinary push of the stick
    sprint:2.2,       // m/s once the stick is pushed to its rim
    accel:9.5,        // how quickly the camera takes up the speed asked for
    brake:16,         // and how quickly it gives it back
    glideMin:0.9,     // m/s when walking to a tapped spot
    glideMax:3.2,
    glideReach:14     // m — further than any room, closer than the horizon
  };
  var clamp=function(value,low,high){return value<low?low:(value>high?high:value);};
  var roomCentre=function(index){var centre=(data.roomCenters||[])[index]||(data.roomCenters||[])[0]||[bounds.cx,1.62,bounds.cz];return new THREE.Vector3(centre[0],centre[1],centre[2]);};
  var reportChange=function(group,reset){if(!group||!group.userData.editId)return;post({type:'furnitureChange',id:group.userData.editId,transform:reset?null:{x:group.position.x,y:group.position.y,z:group.position.z,rotation:group.rotation.y}});};
  var clearSelection=function(){if(engine.selectionBox){threeScene.remove(engine.selectionBox);engine.selectionBox.geometry.dispose();engine.selectionBox=null;}engine.selected=null;};
  var selectGroup=function(group){clearSelection();engine.selected=group;engine.selectionBox=new THREE.BoxHelper(group,0xed6259);threeScene.add(engine.selectionBox);var item=group.userData.item||{};post({type:'select',info:{name:item.label||'Livinai_web furniture',material:'Livinai_web native PBR object',detail:'Original Livinai_web furniture, dimensions and placement.',category:'exact-furniture'}});};
  var applyLighting=function(){var bird=state.mode!=='walk';threeScene.background.set(state.night?0x132333:0xc9d5d8);renderer.toneMappingExposure=state.night?0.84:0.8;if(environment)threeScene.environmentIntensity=bird?(state.night?0.24:0.38):(state.night?0.3:0.48);hemisphere.intensity=bird?(state.night?0.38:0.62):(state.night?0.48:0.85);sun.intensity=bird?(state.night?0.45:1.2):(state.night?0.7:1.7);roomPointLights.forEach(function(light){light.intensity=bird?(state.night?3.8:0.65):(state.night?8:2.2);});};
  // Both the rendered angle and the target, or the easing in the render loop
  // would immediately pull the camera back to wherever it was looking before.
  var setLook=function(yaw,pitch){engine.yaw=yaw;engine.targetYaw=yaw;engine.pitch=pitch;engine.targetPitch=pitch;};
  // ── Where the camera may stand ───────────────────────────────────────────
  // The walkable data is the exporter's own allowed area: every room inset by a
  // body radius, joined to its neighbours only through the door openings.
  // Standing inside it already means "not in a wall, and not in a gap too narrow
  // to fit through", so a point test is the whole of the collision model.
  var insideWalk=function(x,z){
    var polygons=data.walkable||[];
    if(!polygons.length)return true;
    for(var i=0;i<polygons.length;i++){if(pointInPolygon(x,z,polygons[i]))return true;}
    return false;
  };
  var canStand=function(x,z){return state.freeExplore||insideWalk(x,z);};
  var validMove=function(target){return canStand(target.x,target.z);};

  /**
   * Take as much of a step as the walls allow.
   *
   * One point test vetoing the whole step is why walking used to stop dead the
   * moment you brushed a wall at an angle: the part of the step running *along*
   * the wall was thrown away together with the part running into it, so a room
   * being crossed diagonally simply refused to let you past, and a doorway had
   * to be hit exactly rather than found. Each axis is now offered on its own,
   * which turns a step into a corner into a step along it — and turns aiming for
   * a door into sliding down the wall until you reach it.
   *
   * Standing outside the plan is never a trap: a spawn on a threshold, or a room
   * jump that lands on a boundary, would otherwise freeze the camera where it
   * stood with no legal move in any direction.
   */
  var stepCamera=function(dx,dz){
    if(!dx&&!dz)return;
    var position=camera.position;
    if(state.freeExplore||!insideWalk(position.x,position.z)){position.x+=dx;position.z+=dz;return;}
    if(canStand(position.x+dx,position.z+dz)){position.x+=dx;position.z+=dz;return;}
    if(dx&&canStand(position.x+dx,position.z)){position.x+=dx;return;}
    if(dz&&canStand(position.x,position.z+dz))position.z+=dz;
  };

  var focusRoom=function(index){state.roomIndex=Math.max(0,Math.min((data.roomCenters||[]).length-1,Number(index)||0));var centre=roomCentre(state.roomIndex);camera.position.set(centre.x,1.62,centre.z);setLook(spawnYaw,-0.04);engine.vel.set(0,0,0);engine.glide=null;};

  /**
   * The corner of a room that shows the most of it.
   *
   * "Designer" was a choice with no implementation: capture took a
   * designerCamera argument and ignored it, so picking it in the render sheet
   * changed the caption underneath and nothing else — the render came from
   * wherever the user happened to be standing. This is the viewpoint an estate
   * agent's photographer uses: stand in the corner furthest from the middle of
   * the room, a little way in from it, and look at the middle.
   *
   * The room's own outline is what "corner" has to mean. This used to measure
   * against the walkable area, which is not one polygon per room — it is the
   * connected components of the whole flat's floor, so in any home whose rooms
   * are joined by doors it is a single polygon covering all of them, and "the
   * furthest corner" was the furthest corner of the *apartment*. Every designer
   * render of every room was framed from one spot, usually in another room.
   */
  var roomPolygon=function(index){
    var polygons=data.roomPolygons||[];
    return polygons[index]||polygons[0]||(data.walkable||[])[0]||null;
  };
  var designerPose=function(index){
    var polygon=roomPolygon(index);
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
  var applyPose=function(pose){camera.position.set(pose.x,1.62,pose.z);setLook(pose.yaw,pose.pitch);engine.vel.set(0,0,0);engine.glide=null;};

  /**
   * Jump to a room, and arrive looking at it.
   *
   * Picking a room from the strip dropped the camera on the room's centre facing
   * whatever the spawn yaw happened to be, which — standing in the middle of a
   * small bedroom — is very often a close-up of a wall. Arriving in the corner
   * looking across the room shows the room.
   */
  var showcaseRoom=function(index){
    state.roomIndex=Math.max(0,Math.min((data.roomCenters||[]).length-1,Number(index)||0));
    // Picking a room is also a decision about where to stand when the walk
    // resumes, so the remembered pose gives way to it.
    engine.walkPose=null;
    if(state.mode!=='walk'){focusRoom(state.roomIndex);return;}
    var pose=designerPose(state.roomIndex);
    if(!canStand(pose.x,pose.z)){
      var centre=roomCentre(state.roomIndex);
      pose={x:centre.x,z:centre.z,yaw:pose.yaw,pitch:-0.05};
    }
    applyPose(pose);
  };

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

  var moveCamera=function(direction,amount){
    if(state.mode!=='walk')return;
    var step=amount||0.36;
    var forward=new THREE.Vector3(-Math.sin(engine.yaw),0,-Math.cos(engine.yaw));
    var right=new THREE.Vector3(Math.cos(engine.yaw),0,-Math.sin(engine.yaw));
    var axis=direction==='forward'?forward
      :direction==='back'?forward.negate()
      :direction==='left'?right.negate()
      :right;
    engine.glide=null;
    stepCamera(axis.x*step,axis.z*step);
  };
  var composition=function(){return{source:'Livinai_web exact realtime',viewpoint:state.mode==='plan'?'bird':'user',furnitureCount:engine.furniture.length,visibleFurnitureCount:engine.furniture.length,doorCount:(data.openings||[]).filter(function(o){return o.type==='door';}).length,windowCount:(data.openings||[]).filter(function(o){return o.type==='window';}).length,furnitureLabels:engine.furniture.filter(function(o){return o.item.roomIndex===state.roomIndex;}).map(function(o){return o.item.label;})};};
  window.LivinaiScene={
    move:moveCamera,
    turn:function(delta){engine.targetYaw+=delta;},
    setJoystick:function(x,y){engine.joystick.x=Number(x)||0;engine.joystick.y=Number(y)||0;},
    /**
     * Switching into the bird view always frames the whole floor again. Leaving
     * it zoomed and panned from last time meant coming back to a corner of the
     * home with no clue how you got there.
     *
     * Coming *back* keeps the place you were standing. Looking down at the plan
     * used to restart you in the middle of the selected room, so checking the
     * layout cost you your place in the walk every single time.
     */
    setMode:function(value){
      if(value===state.mode)return;
      if(state.mode==='walk')engine.walkPose={x:camera.position.x,z:camera.position.z,yaw:engine.yaw,pitch:engine.pitch};
      state.mode=value;clearSelection();
      engine.joystick.x=0;engine.joystick.y=0;engine.vel.set(0,0,0);engine.glide=null;
      if(value==='walk'){
        if(engine.walkPose)applyPose(engine.walkPose);
        else showcaseRoom(state.roomIndex);
      }else{
        engine.panX=0;engine.panZ=0;
        engine.targetOrbitDistance=planDistance;engine.orbitDistance=planDistance;
        engine.targetOrbitTilt=0.78;engine.orbitTilt=0.78;
      }
      applyLighting();
    },
    setNight:function(value){state.night=!!value;applyLighting();},
    setRoom:function(index){showcaseRoom(index);},
    setFreeExplore:function(value){state.freeExplore=!!value;},
    setDesignerView:setDesignerView,
    frameRoom:function(index){showcaseRoom(index);},
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

  // ── Touch ────────────────────────────────────────────────────────────────
  //
  // Every finger currently down is tracked by id and the gesture is read from
  // the set. That is the part the old handler had no notion of: it kept a
  // single last-x/last-y pair shared by every pointer, so a second finger
  // touching down rewrote the anchor and the next move — from either finger —
  // measured its delta against the other one's position. Two fingers anywhere
  // near the screen threw the camera across the room, and pinch and two-finger
  // pan could not exist at all.
  var viewWidth=function(){return Math.max(1,canvas.clientWidth||canvas.width||1);};
  var viewHeight=function(){return Math.max(1,canvas.clientHeight||canvas.height||1);};
  var activePointers=function(){var list=[],id;for(id in engine.pointers)list.push(engine.pointers[id]);return list;};
  var centroidOf=function(list){var x=0,y=0,i;for(i=0;i<list.length;i++){x+=list[i].x;y+=list[i].y;}return{x:x/list.length,y:y/list.length};};
  var spreadOf=function(list){return list.length<2?0:Math.hypot(list[0].x-list[1].x,list[0].y-list[1].y);};
  var syncGesture=function(){
    var list=activePointers();
    engine.pointerCount=list.length;
    if(!list.length)return;
    var centre=centroidOf(list);
    engine.centroidX=centre.x;engine.centroidY=centre.y;
    engine.spread=spreadOf(list);
  };

  /** Ground-plane basis for the walking camera. */
  var walkForward=function(){return new THREE.Vector3(-Math.sin(engine.yaw),0,-Math.cos(engine.yaw));};
  var walkRight=function(){return new THREE.Vector3(Math.cos(engine.yaw),0,-Math.sin(engine.yaw));};
  var stepBy=function(vector,metres){
    if(!metres)return;
    engine.glide=null;
    stepCamera(vector.x*metres,vector.z*metres);
  };

  // ── Walking to a spot you tapped ─────────────────────────────────────────
  /**
   * The floor point under a tap, as far along it as the plan allows.
   *
   * There is no need to raycast floor geometry for this: the floor of a home is
   * the plane y = 0, and the useful part of the answer is not where the ray
   * lands but how much of the way there is walkable. Sampling the straight line
   * and stopping at the first point outside the plan is what makes tapping a
   * wall walk you *up to* the wall, and tapping through a doorway walk you to
   * the doorway rather than through the wall beside it.
   */
  var floorTarget=function(clientX,clientY){
    var rect=canvas.getBoundingClientRect();
    pointer.x=((clientX-rect.left)/rect.width)*2-1;
    pointer.y=-((clientY-rect.top)/rect.height)*2+1;
    raycaster.setFromCamera(pointer,camera);
    var origin=raycaster.ray.origin,direction=raycaster.ray.direction;
    if(direction.y>-0.06)return null; // aimed at or above the horizon: no floor
    var reach=Math.min(NAV.glideReach,-origin.y/direction.y);
    var goalX=origin.x+direction.x*reach,goalZ=origin.z+direction.z*reach;
    var fromX=camera.position.x,fromZ=camera.position.z;
    if(state.freeExplore||!insideWalk(fromX,fromZ))return{x:goalX,z:goalZ};
    var dx=goalX-fromX,dz=goalZ-fromZ,distance=Math.hypot(dx,dz);
    if(distance<0.2)return null;
    var samples=Math.max(1,Math.ceil(distance/0.18)),bestX=fromX,bestZ=fromZ,reached=0;
    for(var i=1;i<=samples;i++){
      var t=i/samples,sampleX=fromX+dx*t,sampleZ=fromZ+dz*t;
      if(!insideWalk(sampleX,sampleZ))break;
      bestX=sampleX;bestZ=sampleZ;reached=t*distance;
    }
    return reached>0.3?{x:bestX,z:bestZ}:null;
  };

  var glideStep=function(delta){
    var goal=engine.glide,fromX=camera.position.x,fromZ=camera.position.z;
    var dx=goal.x-fromX,dz=goal.z-fromZ,distance=Math.hypot(dx,dz);
    if(distance<0.08){engine.glide=null;return;}
    // Eased at the end rather than stopped at it, so arriving somewhere you
    // tapped feels like walking up to it and not like being dropped on it.
    var speed=clamp(distance*2.4,NAV.glideMin,NAV.glideMax);
    var travel=Math.min(distance,speed*delta);
    stepCamera((dx/distance)*travel,(dz/distance)*travel);
    // Level the view on the way. A tap on the floor is usually made looking down
    // at it, and arriving still looking down is disorienting. A finger on the
    // glass outranks this — nothing should pull against a drag in progress.
    if(!engine.pointerCount)engine.targetPitch=damp(engine.targetPitch,-0.04,delta,2.4);
    if(Math.hypot(camera.position.x-fromX,camera.position.z-fromZ)<travel*0.35)engine.glide=null;
  };

  /** Metres of plan under one screen pixel, at the height the bird camera sits. */
  var birdMetresPerPixel=function(){
    return (2*engine.orbitDistance*Math.tan((camera.fov*Math.PI/180)/2))/viewHeight();
  };

  canvas.addEventListener('pointerdown',function(event){
    if(event.cancelable)event.preventDefault();
    canvas.setPointerCapture&&canvas.setPointerCapture(event.pointerId);
    engine.pointers[event.pointerId]={x:event.clientX,y:event.clientY};
    var list=activePointers();
    // A tap can only ever be one finger that never really moved. The moment a
    // second lands, the gesture is a pinch and selecting furniture is off the
    // table — which is what stopped a two-finger zoom from also picking up
    // whatever happened to be under the first finger when it lifted.
    if(list.length===1){engine.tapCandidate=true;engine.moved=0;engine.startedAt=Date.now();}
    else engine.tapCandidate=false;
    syncGesture();
  });

  canvas.addEventListener('pointermove',function(event){
    var tracked=engine.pointers[event.pointerId];
    if(!tracked)return;
    if(event.cancelable)event.preventDefault();
    tracked.x=event.clientX;tracked.y=event.clientY;

    var list=activePointers();
    var centre=centroidOf(list);
    var dx=centre.x-engine.centroidX,dy=centre.y-engine.centroidY;
    var spread=spreadOf(list);
    var pinch=list.length>1?spread-engine.spread:0;
    engine.centroidX=centre.x;engine.centroidY=centre.y;engine.spread=spread;
    engine.moved+=Math.abs(dx)+Math.abs(dy)+Math.abs(pinch);

    if(list.length===1){
      // One finger: look around. The camera follows the finger in both views —
      // swipe right, turn right; swipe down, look down. See the gesture notes.
      if(state.mode==='walk'){
        // yaw grows anticlockwise, so turning right is a subtraction.
        engine.targetYaw-=(dx/viewWidth())*LOOK_YAW_PER_WIDTH;
        engine.targetPitch=clamp(engine.targetPitch-(dy/viewHeight())*LOOK_PITCH_PER_HEIGHT,PITCH_MIN,PITCH_MAX);
      }else{
        // Orbiting the camera right is the plan turning left, which is the
        // same relationship the walking view has between finger and yaw.
        engine.targetOrbitAngle+=(dx/viewWidth())*LOOK_YAW_PER_WIDTH;
        // Swipe down and the camera rises towards straight-down over the plan,
        // matching "swipe down, look down" from inside a room.
        engine.targetOrbitTilt=clamp(
          engine.targetOrbitTilt-(dy/viewHeight())*(BIRD_TILT_MAX-BIRD_TILT_MIN)*1.6,
          BIRD_TILT_MIN,BIRD_TILT_MAX);
      }
      return;
    }

    // Two fingers: move. Pinching and sliding at the same time is one gesture,
    // not a mode, so both are applied on every event.
    if(state.mode==='walk'){
      // Pinch apart walks forward, together walks back. Sliding the pair moves
      // you across the floor: what is under your fingers stays under them, so
      // dragging down brings the floor towards you and you step forward.
      var forward=walkForward(),right=walkRight();
      stepBy(forward,(pinch/viewHeight())*WALK_DRAG_METRES*1.8);
      stepBy(forward,(dy/viewHeight())*WALK_DRAG_METRES);
      stepBy(right,-(dx/viewWidth())*WALK_DRAG_METRES);
    }else{
      engine.targetOrbitDistance=clamp(
        engine.targetOrbitDistance-(pinch/viewHeight())*planDistance*2.2,
        BIRD_DISTANCE_MIN,BIRD_DISTANCE_MAX);
      // Pan along the camera's own axes, so the plan slides the way the fingers
      // do whichever side of the home you have orbited to.
      var scale=birdMetresPerPixel();
      var rightX=Math.cos(engine.orbitAngle),rightZ=-Math.sin(engine.orbitAngle);
      var intoX=-Math.sin(engine.orbitAngle),intoZ=-Math.cos(engine.orbitAngle);
      engine.panX-=(rightX*dx+intoX*dy)*scale;
      engine.panZ-=(rightZ*dx+intoZ*dy)*scale;
    }
  });

  var endPointer=function(event){
    var wasSingle=engine.pointerCount===1;
    var lifted=engine.pointers[event.pointerId];
    delete engine.pointers[event.pointerId];
    canvas.releasePointerCapture&&canvas.hasPointerCapture&&canvas.hasPointerCapture(event.pointerId)&&canvas.releasePointerCapture(event.pointerId);
    // Re-anchor on whatever is still down, so lifting one of two fingers does
    // not read as an enormous jump of the centroid.
    syncGesture();
    if(!lifted)return;
    if(!wasSingle||!engine.tapCandidate)return;
    engine.tapCandidate=false;
    // A tap: short, and it stayed put. 12px and 500ms are the platform's own
    // thresholds for the same question.
    if(engine.moved>12||Date.now()-engine.startedAt>500)return;
    var rect=canvas.getBoundingClientRect();
    pointer.x=((lifted.x-rect.left)/rect.width)*2-1;
    pointer.y=-((lifted.y-rect.top)/rect.height)*2+1;
    raycaster.setFromCamera(pointer,camera);
    var hits=raycaster.intersectObjects(engine.furniture.map(function(item){return item.group;}),true);
    if(hits.length){
      var node=hits[0].object;
      while(node&&!node.userData.item)node=node.parent;
      if(node){selectGroup(node);return;}
    }
    // Nothing was hit. With a piece selected that means "put it down"; with
    // nothing selected, inside a room, it means "take me over there" — which is
    // the one control that makes crossing a flat a single gesture rather than a
    // sustained push on a stick.
    var hadSelection=!!engine.selected;
    clearSelection();
    post({type:'select',info:null});
    if(hadSelection||state.mode!=='walk')return;
    var target=floorTarget(lifted.x,lifted.y);
    if(target)engine.glide=target;
  };
  canvas.addEventListener('pointerup',endPointer);
  // Without these a finger that leaves the canvas, or a gesture the browser
  // takes over, stayed in the map forever — and every later drag measured its
  // centroid against a finger that was no longer touching the screen.
  canvas.addEventListener('pointercancel',endPointer);
  canvas.addEventListener('pointerleave',endPointer);
  // Rugs are editable furniture now, so they arrive under the same
  // "furniture_" prefix as everything else — but they lie a centimetre above
  // the floor, and a shadow cast from a plane that close to the surface
  // receiving it is all acne and no shadow. They light like the floor they sit
  // on instead.
  var flatPrefixes=(data.furniture||[]).filter(function(item){return /rug/i.test(item.label||'');}).map(function(item){return item.nodePrefix;});
  var castsShadow=function(name){
    if(name.indexOf('furniture_')!==0)return false;
    for(var i=0;i<flatPrefixes.length;i++){if(name.indexOf(flatPrefixes[i])===0)return false;}
    return true;
  };
  new THREE.GLTFLoader().load(data.modelUrl,function(gltf){
    var model=gltf.scene;threeScene.add(model);
    model.traverse(function(child){if(child.name.indexOf('ceiling_')===0)engine.ceilings.push(child);if(child.name.indexOf('overhead_')===0)engine.overheads.push(child);if(!child.isMesh)return;child.receiveShadow=true;child.castShadow=castsShadow(child.name);var materials=Array.isArray(child.material)?child.material:[child.material];materials.forEach(function(material){material.envMapIntensity=state.night?0.42:0.68;if(material.map)material.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());});});
    engine.furniture=(data.furniture||[]).map(function(item){var group=new THREE.Group();group.name='editable_'+item.index;group.position.fromArray(item.pivot);threeScene.add(group);var nodes=[];model.traverse(function(node){if(node.name.indexOf(item.nodePrefix)===0)nodes.push(node);});nodes.forEach(function(node){group.attach(node);});var id='exact:'+item.index;group.userData.item=item;group.userData.editId=id;group.userData.home={x:group.position.x,y:group.position.y,z:group.position.z,rotation:0};var saved=edits[id];if(saved){group.position.set(Number(saved.x)||0,Number.isFinite(Number(saved.y))?Number(saved.y):group.position.y,Number(saved.z)||0);group.rotation.y=Number(saved.rotation)||0;}return{item:item,group:group};});
    document.getElementById('loading').className='done';showcaseRoom(state.roomIndex);post({type:'ready',objects:engine.furniture.length,rooms:(data.roomCenters||[]).length,exact:true,source:'Livinai_web',threeVersion:${JSON.stringify(EXACT_THREE_REVISION)}});
  },undefined,function(error){post({type:'error',message:'The exact Livinai_web scene could not be loaded: '+(error&&error.message?error.message:'model error')});});
  // The roof and everything hanging from it are only ever wanted from inside a
  // room. Seen from any camera that is above the building — which is every
  // camera that is not the walking one — a ceiling is an opaque lid over the
  // home, and the pendants and chandelier under it are lit from the wrong side.
  // This used to test for the bird view by name, so the orbit camera kept the
  // ceiling and spent most of its arc looking at the top of it.
  var setRoofVisible=function(){var inside=state.mode==='walk';engine.ceilings.forEach(function(node){node.visible=inside;});engine.overheads.forEach(function(node){node.visible=inside;});};
  /**
   * Frame-rate independent easing towards a target.
   *
   * An exponential curve rather than a fixed fraction per frame, so the camera
   * settles at the same speed on a 60 Hz phone and a 120 Hz one instead of
   * arriving twice as fast on the faster screen.
   */
  var damp=function(current,target,delta,rate){return current+(target-current)*(1-Math.exp(-rate*delta));};

  var render=function(){
    requestAnimationFrame(render);
    var delta=Math.min(engine.clock.getDelta(),0.05);
    setRoofVisible();

    engine.yaw=damp(engine.yaw,engine.targetYaw,delta,17);
    engine.pitch=damp(engine.pitch,engine.targetPitch,delta,17);
    engine.orbitAngle=damp(engine.orbitAngle,engine.targetOrbitAngle,delta,13);
    engine.orbitTilt=damp(engine.orbitTilt,engine.targetOrbitTilt,delta,13);
    engine.orbitDistance=damp(engine.orbitDistance,engine.targetOrbitDistance,delta,11);

    if(state.mode==='walk'){
      /**
       * The stick asks for a velocity; the camera takes it up over about a tenth
       * of a second and gives it back over rather less. That is the difference
       * between steering a person and teleporting a point, and it is what makes
       * easing up to a bookshelf and crossing a hallway the same control at two
       * depths rather than two speeds of the same lurch.
       */
      var push=Math.min(1,Math.hypot(engine.joystick.x,engine.joystick.y));
      var want=engine.want.set(0,0,0);
      if(push>0.001){
        engine.glide=null;
        var speed=NAV.walk+(NAV.sprint-NAV.walk)*Math.max(0,(push-0.7)/0.3);
        var forward=new THREE.Vector3(-Math.sin(engine.yaw),0,-Math.cos(engine.yaw)),
            right=new THREE.Vector3(Math.cos(engine.yaw),0,-Math.sin(engine.yaw));
        want.addScaledVector(forward,-engine.joystick.y).addScaledVector(right,engine.joystick.x);
        if(want.lengthSq()>1e-8)want.normalize().multiplyScalar(speed*push);
      }
      engine.vel.lerp(want,1-Math.exp(-(push>0.001?NAV.accel:NAV.brake)*delta));
      if(push<0.001&&engine.vel.lengthSq()<0.0004)engine.vel.set(0,0,0);
      if(engine.glide)glideStep(delta);
      else stepCamera(engine.vel.x*delta,engine.vel.z*delta);
      camera.up.set(0,1,0);
      camera.rotation.set(engine.pitch,engine.yaw,0);
    }else{
      // orbitTilt is the angle off vertical, used directly. It used to be a
      // raw drag accumulator scaled by 0.34 under a floor, which is what made
      // most of the tilt range unreachable — see the gesture notes above.
      var target=new THREE.Vector3(bounds.cx+engine.panX,0,bounds.cz+engine.panZ),
          horizontal=engine.orbitDistance*Math.sin(engine.orbitTilt);
      camera.position.set(
        target.x+horizontal*Math.sin(engine.orbitAngle),
        target.y+engine.orbitDistance*Math.cos(engine.orbitTilt),
        target.z+horizontal*Math.cos(engine.orbitAngle));
      camera.up.set(0,1,0);
      camera.lookAt(target);
    }

    engine.selectionBox&&engine.selectionBox.update();
    renderer.render(threeScene,camera);
  };
  render();
}());
</script></body></html>`;
}

export default buildExactWalkthroughHtml;
