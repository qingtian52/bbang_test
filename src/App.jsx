import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations, ContactShadows, PerformanceMonitor } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

useGLTF.preload('${import.meta.env.BASE_URL}Idle.glb');
useGLTF.preload('${import.meta.env.BASE_URL}Run.glb');
useGLTF.preload('${import.meta.env.BASE_URL}shop_a_low.glb');
useGLTF.preload('${import.meta.env.BASE_URL}shop_b_low.glb');
useGLTF.preload('${import.meta.env.BASE_URL}shop_c_low.glb');

const GROUND_SIZE = 120;
const WALKABLE_BOUNDS = {
  min: new THREE.Vector3(-GROUND_SIZE / 2, 0, -GROUND_SIZE / 2),
  max: new THREE.Vector3(GROUND_SIZE / 2, 0, GROUND_SIZE / 2),
};
const NON_COLLIDABLE_NAME = /ground|floor|plane|terrain|road|sidewalk|grass|water|sky|ceiling|light|shadow/i;
const BUILD_INTERACT_DIST = 4.0;

const GRASS_LIGHT = '#b8d8a0';
const GRASS_DARK  = '#4a8c2a';

const TREES = [
  { id: 'tree_1', pos: [15, 0, 18] },
  { id: 'tree_2', pos: [-18, 0, 25] },
  { id: 'tree_3', pos: [35, 0, -15] },
  { id: 'tree_4', pos: [-35, 0, -20] },
  { id: 'tree_5', pos: [0, 0, -30] },
  { id: 'tree_6', pos: [42, 0, 8] },
  { id: 'tree_7', pos: [-40, 0, 10] },
  { id: 'tree_8', pos: [20, 0, -40] },
];

const ROCKS = [
  { id: 'rock_1', pos: [10, 0, 5], scale: 1.0 },
  { id: 'rock_2', pos: [-15, 0, -5], scale: 1.3 },
  { id: 'rock_3', pos: [30, 0, 20], scale: 0.8 },
  { id: 'rock_4', pos: [-8, 0, 28], scale: 1.1 },
  { id: 'rock_5', pos: [45, 0, -25], scale: 1.5 },
  { id: 'rock_6', pos: [-30, 0, -35], scale: 0.9 },
];

const HILLS = [
  { id: 'hill_1', pos: [25, 0, 35], scale: 1.0 },
  { id: 'hill_2', pos: [-45, 0, -10], scale: 1.4 },
  { id: 'hill_3', pos: [50, 0, -40], scale: 0.8 },
];

const ROAD_CURVES = [
  { id: 'road_main', points: [[-55,0,-40],[-30,0,-25],[-20,0,-10],[-5,0,5],[0,0,12],[15,0,10],[28,0,-5],[45,0,-20],[58,0,-35]], width: 3.0 },
  { id: 'road_arc_h', points: [[-50,0,20],[-25,0,35],[0,0,30],[25,0,35],[50,0,20]], width: 2.2 },
  { id: 'road_arc_v', points: [[-20,0,-50],[-10,0,-25],[5,0,0],[10,0,25],[5,0,45]], width: 2.2 },
  { id: 'road_loop', points: [[-15,0,-15],[0,0,-20],[15,0,-15],[20,0,0],[15,0,15],[0,0,20],[-15,0,15],[-20,0,0],[-15,0,-15]], width: 1.5, closed: true },
];

// Camera: lower speed = smoother, more stable
const CAM_LERP_POSITION = 2.0;
const CAM_LERP_LOOKAT = 2.5;
const CAM_MIN_HEIGHT = 2.5;
const CAM_RADIUS = 1.0;
const CAM_DEFAULT_DIST = 9.0;
const CAM_DEFAULT_HEIGHT = 5.0;
const CAM_ORBIT_RECHECK_INTERVAL = 2000;

const PIG_CHECK_INTERVAL = 200; // ms

// --- pure collision helpers ---
function pointInBox(px, pz, boxMinX, boxMinZ, boxMaxX, boxMaxZ, radius) {
  const cx = Math.max(boxMinX, Math.min(px, boxMaxX));
  const cz = Math.max(boxMinZ, Math.min(pz, boxMaxZ));
  const dx = px - cx;
  const dz = pz - cz;
  return (dx * dx + dz * dz) < (radius * radius);
}

function isInsideWalkableBounds(position, radius) {
  const { min, max } = WALKABLE_BOUNDS;
  return (
    position.x >= min.x + radius &&
    position.x <= max.x - radius &&
    position.z >= min.z + radius &&
    position.z <= max.z - radius
  );
}

function dampedLerp(current, target, factor, delta) {
  const t = 1 - Math.exp(-factor * delta);
  return current + (target - current) * t;
}

function normalizeModelScene(scene) {
  scene.traverse((child) => {
    if (!child.isMesh) return;
    child.receiveShadow = true;
    child.castShadow = true;
    if (child.material) {
      child.material.side = THREE.DoubleSide;
      if (child.material.metalness !== undefined) child.material.metalness = Math.min(child.material.metalness, 0.2);
      if (child.material.roughness !== undefined) child.material.roughness = Math.max(child.material.roughness, 0.6);
    }
  });
  return scene;
}

function collectCollisionBoxes(scene) {
  const boxes = [];
  scene.traverse((child) => {
    if (!child.isMesh) return;
    const name = (child.name || '').toLowerCase();
    if (NON_COLLIDABLE_NAME.test(name)) return;
    const box = new THREE.Box3().setFromObject(child);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y < 0.2 && size.x > 1.5 && size.z > 1.5) return;
    if (size.x * size.y * size.z < 0.3) return;
    boxes.push({
      minX: box.min.x, minZ: box.min.z,
      maxX: box.max.x, maxZ: box.max.z,
    });
  });
  return boxes;
}

const BUILDINGS = [
  { id: 'shop_a', name: 'Clothing Store', low: '${import.meta.env.BASE_URL}shop_a_low.glb', high: '${import.meta.env.BASE_URL}shop_a_high.glb', pos: [-22, 0, -9] },
  { id: 'shop_b', name: 'Cafe', low: '${import.meta.env.BASE_URL}shop_b_low.glb', high: '${import.meta.env.BASE_URL}shop_b_high.glb', pos: [-5, 0, 12] },
  { id: 'shop_c', name: 'Bookstore', low: '${import.meta.env.BASE_URL}shop_c_low.glb', high: '${import.meta.env.BASE_URL}shop_c_high.glb', pos: [28, 0, -5] },
];

// ========== GrassGround ==========
function GrassGround() {
  const patches = useMemo(() => {
    const seed = 42;
    const rng = (i) => ((seed * 9301 + i * 49297) % 233280) / 233280;
    const result = [];
    for (let i = 0; i < 14; i++) {
      const angle = rng(i) * Math.PI * 2;
      const dist = rng(i + 100) * 35;
      result.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, rx: 6 + rng(i + 200) * 10, rz: 4 + rng(i + 300) * 7, rot: rng(i + 400) * Math.PI });
    }
    return result;
  }, []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial color={GRASS_LIGHT} roughness={0.95} metalness={0.0} />
      </mesh>
      {patches.map((p, i) => (
        <mesh key={'patch_' + i} position={[p.x, 0.01, p.z]} rotation={[-Math.PI / 2, 0, p.rot]} receiveShadow>
          <planeGeometry args={[p.rx * 2, p.rz * 2]} />
          <meshStandardMaterial color={GRASS_DARK} roughness={0.95} metalness={0.0} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} visible={false}>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

// ========== Tree ==========
function Tree({ config, onCollisionUpdate }) {
  const { pos, id } = config;
  const px = pos[0], pz = pos[2];
  const r = 1.2;
  useEffect(() => {
    onCollisionUpdate(id, [{ minX: px - r, minZ: pz - r, maxX: px + r, maxZ: pz + r }]);
    return () => onCollisionUpdate(id, []);
  }, [id, px, pz, onCollisionUpdate]);
  return (
    <group position={[px, 0, pz]}>
      <mesh position={[0, 1.75, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.4, 3.5, 8]} />
        <meshStandardMaterial color='#8B6914' roughness={0.9} />
      </mesh>
      <mesh position={[0, 4.2, 0]} castShadow>
        <sphereGeometry args={[2.0, 12, 10]} />
        <meshStandardMaterial color='#2d6a1e' roughness={0.8} />
      </mesh>
      <mesh position={[0, 5.5, 0]} castShadow>
        <sphereGeometry args={[1.5, 10, 8]} />
        <meshStandardMaterial color='#3a8a28' roughness={0.8} />
      </mesh>
    </group>
  );
}

// ========== Rock ==========
function Rock({ config, onCollisionUpdate }) {
  const { pos, id, scale } = config;
  const px = pos[0], pz = pos[2];
  const r = 0.9 * scale;
  useEffect(() => {
    onCollisionUpdate(id, [{ minX: px - r, minZ: pz - r, maxX: px + r, maxZ: pz + r }]);
    return () => onCollisionUpdate(id, []);
  }, [id, px, pz, r, onCollisionUpdate]);
  const randY = useMemo(() => Math.random() * Math.PI * 2, [id]);
  return (
    <group position={[px, 0, pz]} scale={[scale, scale, scale]}>
      <mesh castShadow rotation={[0, randY, 0]}>
        <dodecahedronGeometry args={[1.0, 0]} />
        <meshStandardMaterial color='#6b6b6b' roughness={0.95} flatShading />
      </mesh>
      <mesh position={[0.8, 0.2, -0.5]} scale={[0.4, 0.3, 0.4]} castShadow>
        <dodecahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial color='#5a5a5a' roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}

// ========== Hill ==========
function Hill({ config, onCollisionUpdate }) {
  const { pos, id, scale } = config;
  const px = pos[0], pz = pos[2];
  const hr = 3.5 * scale;
  useEffect(() => {
    onCollisionUpdate(id, [{ minX: px - hr, minZ: pz - hr, maxX: px + hr, maxZ: pz + hr }]);
    return () => onCollisionUpdate(id, []);
  }, [id, px, pz, hr, onCollisionUpdate]);
  return (
    <group position={[px, 0, pz]}>
      <mesh scale={[scale, scale * 0.5, scale]} position={[0, 0, 0]} castShadow receiveShadow>
        <sphereGeometry args={[3.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color='#5a8a3a' roughness={0.9} />
      </mesh>
      <mesh position={[0, scale * 1.6, 0]} scale={[scale * 0.9, scale * 0.3, scale * 0.9]} castShadow>
        <sphereGeometry args={[2.0, 12, 8]} />
        <meshStandardMaterial color='#4a7a2a' roughness={0.85} />
      </mesh>
    </group>
  );
}

// ========== Building ==========
function Building({ config, onCollisionUpdate, highState }) {
  const { low, high, pos, id } = config;
  const groupRef = useRef();
  const lowGltf = useGLTF(low);
  const lowScene = useMemo(() => normalizeModelScene(lowGltf.scene.clone()), [lowGltf]);
  const highSceneRef = useRef(null);
  const [loadingHigh, setLoadingHigh] = useState(false);

  useEffect(() => {
    const boxes = collectCollisionBoxes(lowScene);
    onCollisionUpdate(id, boxes);
  }, [lowScene, id, onCollisionUpdate]);

  useEffect(() => {
    if (highState[id] && !highSceneRef.current && !loadingHigh) {
      setLoadingHigh(true);
      const loader = new GLTFLoader();
      loader.load(high,
        (gltf) => { highSceneRef.current = normalizeModelScene(gltf.scene.clone()); setLoadingHigh(false); },
        undefined,
        (err) => { console.error('High model load failed:', id, err); setLoadingHigh(false); }
      );
    }
    if (!highState[id]) highSceneRef.current = null;
  }, [highState[id], high, id, loadingHigh]);

  const displayModel = highState[id] ? (highSceneRef.current || lowScene) : lowScene;
  const [px, py, pz] = pos;
  return (
    <group ref={groupRef} position={[px, py, pz]}>
      {displayModel && <primitive object={displayModel} />}
    </group>
  );
}

// ========== Pig ==========
const Pig = React.forwardRef(({ targetPos, collisionBoxesRef, onReachedTarget, onHeadingUpdate }, ref) => {
  const groupRef = useRef();
  useImperativeHandle(ref, () => groupRef.current);
  const idleData = useGLTF('${import.meta.env.BASE_URL}Idle.glb');
  const runData = useGLTF('${import.meta.env.BASE_URL}Run.glb');
  const { actions: idleActions } = useAnimations(idleData.animations, groupRef);
  const { actions: runActions } = useAnimations(runData.animations, groupRef);

  const isRunningRef = useRef(false);
  const targetWorldPos = useRef(new THREE.Vector3());
  const hasReached = useRef(false);
  const moveSpeed = 9.5;
  const pigRadius = 0.25;
  const stopDistance = 0.2;
  const animInitialized = useRef(false);
  const headingRef = useRef(new THREE.Vector3(0, 0, 1));

  useEffect(() => {
    if (groupRef.current) groupRef.current.position.set(30, 0, 30);
  }, []);

  useEffect(() => {
    if (idleActions && idleActions.Idle && !animInitialized.current) {
      idleActions.Idle.play();
      animInitialized.current = true;
    }
    return () => {
      if (idleActions && idleActions.Idle) idleActions.Idle.stop();
      if (runActions && runActions.Run) runActions.Run.stop();
    };
  }, [idleActions, runActions]);

  const switchAnim = useCallback((toRunning) => {
    if (toRunning) {
      if (idleActions && idleActions.Idle) idleActions.Idle.stop();
      if (runActions && runActions.Run) runActions.Run.reset().play();
    } else {
      if (runActions && runActions.Run) runActions.Run.stop();
      if (idleActions && idleActions.Idle) idleActions.Idle.reset().play();
    }
  }, [idleActions, runActions]);

  useEffect(() => {
    if (targetPos) {
      targetWorldPos.current.copy(targetPos);
      hasReached.current = false;
      if (!isRunningRef.current) { isRunningRef.current = true; switchAnim(true); }
    } else {
      if (isRunningRef.current) { isRunningRef.current = false; switchAnim(false); }
    }
  }, [targetPos, switchAnim]);

  const canMoveTo = useCallback((x, z) => {
    if (!isInsideWalkableBounds({ x, y: 0, z }, pigRadius)) return false;
    const boxes = collisionBoxesRef.current;
    if (!boxes || boxes.length === 0) return true;
    for (let i = 0, len = boxes.length; i < len; i++) {
      const b = boxes[i];
      if (pointInBox(x, z, b.minX, b.minZ, b.maxX, b.maxZ, pigRadius)) return false;
    }
    return true;
  }, [collisionBoxesRef]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const pigPos = groupRef.current.position;
    pigPos.y = 0;
    if (!isRunningRef.current) {
      return;
    }
    const clampedDelta = Math.min(delta, 0.05);
    const target = targetWorldPos.current;
    const dx = target.x - pigPos.x;
    const dz = target.z - pigPos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < stopDistance * stopDistance) {
      isRunningRef.current = false;
      hasReached.current = true;
      switchAnim(false);
      if (onReachedTarget) onReachedTarget();
      return;
    }
    const dist = Math.sqrt(distSq);
    const stepSize = Math.min(moveSpeed * clampedDelta, dist);
    const stepX = (dx / dist) * stepSize;
    const stepZ = (dz / dist) * stepSize;

    if (canMoveTo(pigPos.x + stepX, pigPos.z + stepZ)) {
      pigPos.x += stepX;
      pigPos.z += stepZ;
    } else if (canMoveTo(pigPos.x + stepX, pigPos.z)) {
      pigPos.x += stepX;
    } else if (canMoveTo(pigPos.x, pigPos.z + stepZ)) {
      pigPos.z += stepZ;
    } else {
      isRunningRef.current = false;
      hasReached.current = true;
      switchAnim(false);
      if (onReachedTarget) onReachedTarget();
      return;
    }
    pigPos.y = 0;
    groupRef.current.lookAt(target.x, pigPos.y, target.z);

    headingRef.current.set(dx, 0, dz).normalize();
    if (onHeadingUpdate) onHeadingUpdate(headingRef.current);
  });

  return (
    <group ref={groupRef} scale={0.5}>
      <primitive object={idleData.scene} />
    </group>
  );
});

// ========== CameraFollow ==========
function CameraFollow({ pigRef, collisionBoxesRef, pigHeadingRef }) {
  const { camera } = useThree();
  const currentOrbitAngle = useRef(-Math.PI / 2);
  const smoothedCamPos = useRef(null);
  const smoothedLookAt = useRef(null);
  const initialized = useRef(false);
  const lastOrbitCheck = useRef(0);

  const isCameraBlocked = (camX, camZ) => {
    const boxes = collisionBoxesRef.current;
    if (!boxes || boxes.length === 0) return false;
    for (let i = 0, len = boxes.length; i < len; i++) {
      const b = boxes[i];
      if (pointInBox(camX, camZ, b.minX, b.minZ, b.maxX, b.maxZ, CAM_RADIUS)) return true;
    }
    return false;
  };

  const findClearOrbit = (targetX, targetZ, preferAngle) => {
    const dist = CAM_DEFAULT_DIST;
    const directions = [0, +0.5, -0.5, +1.0, -1.0, +1.5, -1.5, +2.0, -2.0, +2.5, -2.5, +3.0, -3.0];

    for (let i = 0; i < directions.length; i++) {
      const angle = preferAngle + directions[i];
      const cx = targetX + Math.cos(angle) * dist;
      const cz = targetZ + Math.sin(angle) * dist;
      if (!isCameraBlocked(cx, cz)) return angle;
    }
    return preferAngle;
  };

  useFrame((_, delta) => {
    if (!pigRef || !pigRef.current) return;
    const pigPos = pigRef.current.position;
    const targetX = pigPos.x;
    const targetZ = pigPos.z;

    if (!initialized.current) {
      initialized.current = true;
      const angle = findClearOrbit(targetX, targetZ, currentOrbitAngle.current);
      currentOrbitAngle.current = angle;
      camera.position.set(
        targetX + Math.cos(angle) * CAM_DEFAULT_DIST,
        CAM_DEFAULT_HEIGHT,
        targetZ + Math.sin(angle) * CAM_DEFAULT_DIST
      );
      camera.lookAt(targetX, 0, targetZ);
      smoothedCamPos.current = camera.position.clone();
      smoothedLookAt.current = new THREE.Vector3(targetX, 0, targetZ);
      return;
    }

    const now = performance.now();

    let preferAngle = currentOrbitAngle.current;
    if (pigHeadingRef && pigHeadingRef.current) {
      const h = pigHeadingRef.current;
      if (h.lengthSq() > 0.001) {
        preferAngle = Math.atan2(-h.z, -h.x);
        preferAngle = currentOrbitAngle.current * 0.2 + preferAngle * 0.8;
      }
    }

    const idealOrbitDist = CAM_DEFAULT_DIST;
    const camTestX = targetX + Math.cos(currentOrbitAngle.current) * idealOrbitDist;
    const camTestZ = targetZ + Math.sin(currentOrbitAngle.current) * idealOrbitDist;

    if (isCameraBlocked(camTestX, camTestZ) || now - lastOrbitCheck.current > CAM_ORBIT_RECHECK_INTERVAL) {
      lastOrbitCheck.current = now;
      const newAngle = findClearOrbit(targetX, targetZ, preferAngle);
      const angleDiff = newAngle - currentOrbitAngle.current;
      const normalizedDiff = ((angleDiff + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      currentOrbitAngle.current += normalizedDiff * 0.15;
    }

    const angle = currentOrbitAngle.current;
    const idealCamX = targetX + Math.cos(angle) * idealOrbitDist;
    const idealCamZ = targetZ + Math.sin(angle) * idealOrbitDist;
    const idealCamY = CAM_DEFAULT_HEIGHT;

    smoothedCamPos.current.x = dampedLerp(smoothedCamPos.current.x, idealCamX, CAM_LERP_POSITION, delta);
    smoothedCamPos.current.y = dampedLerp(smoothedCamPos.current.y, idealCamY, CAM_LERP_POSITION, delta);
    smoothedCamPos.current.z = dampedLerp(smoothedCamPos.current.z, idealCamZ, CAM_LERP_POSITION, delta);
    smoothedLookAt.current.x = dampedLerp(smoothedLookAt.current.x, targetX, CAM_LERP_LOOKAT, delta);
    smoothedLookAt.current.y = dampedLerp(smoothedLookAt.current.y, 0, CAM_LERP_LOOKAT, delta);
    smoothedLookAt.current.z = dampedLerp(smoothedLookAt.current.z, targetZ, CAM_LERP_LOOKAT, delta);

    camera.position.copy(smoothedCamPos.current);
    camera.lookAt(smoothedLookAt.current);
  });
  return null;
}

// ========== ClickMarker (white breathing ripple) ==========
function ClickMarker({ targetPos, fadingOut }) {
  const groupRef = useRef();
  const animStart = useRef(0);
  const ringAMatRef = useRef();
  const ringBMatRef = useRef();
  const ringCMatRef = useRef();
  const ringDMatRef = useRef();
  const pulseMatRef = useRef();
  const fadeOutStart = useRef(0);
  const isFadingOut = useRef(false);

  useEffect(() => {
    animStart.current = performance.now();
    fadeOutStart.current = 0;
    isFadingOut.current = false;
  }, [targetPos]);

  // Trigger fade-out when pig reaches target
  useEffect(() => {
    if (fadingOut && !isFadingOut.current) {
      isFadingOut.current = true;
      fadeOutStart.current = performance.now();
    }
  }, [fadingOut]);

  useFrame(() => {
    if (!groupRef.current) return;
    if (isFadingOut.current) {
      // Quick dissolve: 0.4s fade to zero, then hide
      const fadeElapsed = (performance.now() - fadeOutStart.current) / 1000;
      const fadeProgress = Math.min(fadeElapsed / 0.4, 1);
      const fadeAlpha = 1 - fadeProgress * fadeProgress; // ease-out quadratic
      if (ringAMatRef.current) ringAMatRef.current.opacity = 0;
      if (ringBMatRef.current) ringBMatRef.current.opacity = 0;
      if (ringCMatRef.current) ringCMatRef.current.opacity = 0;
      if (ringDMatRef.current) ringDMatRef.current.opacity = 0;
      if (pulseMatRef.current) pulseMatRef.current.opacity = Math.max(0, fadeAlpha * 0.55);
      if (groupRef.current.children[4]) {
        groupRef.current.children[4].scale.setScalar(1.0 - fadeProgress * 0.8 + fadeProgress * 1.6);
      }
      return;
    }

    const elapsed = (performance.now() - animStart.current) / 1000;
    const t = Math.min(elapsed, 2.0);
    // Outer burst ring: expands fast, fades out
    const burst = Math.min(t / 0.7, 1);
    const burstScale = 0.2 + burst * 2.8;
    const burstAlpha = 1 - burst * burst;
    if (ringAMatRef.current) {
      ringAMatRef.current.opacity = burstAlpha * 0.7;
    }
    // Second burst ring: slightly delayed
    const burst2 = Math.min(Math.max(0, (t - 0.08) / 0.6), 1);
    const burst2Alpha = 1 - burst2 * burst2;
    if (ringBMatRef.current) {
      ringBMatRef.current.opacity = burst2Alpha * 0.5;
    }
    // Third ring: slower expansion
    const burst3 = Math.min(Math.max(0, (t - 0.15) / 0.9), 1);
    const burst3Alpha = 1 - burst3;
    if (ringCMatRef.current) {
      ringCMatRef.current.opacity = burst3Alpha * 0.35;
    }
    // Fourth ring: slow and subtle
    const burst4 = Math.min(Math.max(0, (t - 0.22) / 1.0), 1);
    const burst4Alpha = (1 - burst4) * (1 - burst4);
    if (ringDMatRef.current) {
      ringDMatRef.current.opacity = burst4Alpha * 0.3;
    }
    // Steady pulse ring: breathes forever
    const pulse = Math.sin(t * 3.5) * 0.15 + 0.55;
    const pulseScale = 0.85 + Math.sin(t * 2.8) * 0.15;
    if (pulseMatRef.current) {
      pulseMatRef.current.opacity = pulse;
    }

    const children = groupRef.current.children;
    if (children[0]) children[0].scale.setScalar(burstScale);
    if (children[1]) children[1].scale.setScalar(burst2 * 1.8 + 0.2);
    if (children[2]) children[2].scale.setScalar(burst3 * 2.0 + 0.1);
    if (children[3]) children[3].scale.setScalar(burst4 * 1.6 + 0.1);
    if (children[4]) children[4].scale.setScalar(pulseScale);
  });

  if (!targetPos) return null;
  return (
    <group ref={groupRef} position={[targetPos.x, 0.06, targetPos.z]}>
      {/* Burst ring A: outer fast expand */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.12, 0.16, 32]} />
        <meshBasicMaterial
          ref={ringAMatRef}
          color='#ffffff'
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Burst ring B: delayed medium */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, 0.13, 28]} />
        <meshBasicMaterial
          ref={ringBMatRef}
          color='#ffffff'
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Burst ring C: slower large */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.09, 0.11, 24]} />
        <meshBasicMaterial
          ref={ringCMatRef}
          color='#ffffff'
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Burst ring D: subtle accent */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.10, 20]} />
        <meshBasicMaterial
          ref={ringDMatRef}
          color='#ffffff'
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Steady breathing pulse ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.18, 32]} />
        <meshBasicMaterial
          ref={pulseMatRef}
          color='#ffffff'
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ========== MiniMap ==========
function MiniMap({ pigWorldPos, buildings, pigRotation }) {
  const mapSize = 160;
  const worldHalf = GROUND_SIZE / 2;
  const canvasRef = useRef(null);

  const worldToMap = useCallback((wx, wz) => ({
    x: ((wx + worldHalf) / GROUND_SIZE) * mapSize,
    y: ((wz + worldHalf) / GROUND_SIZE) * mapSize,
  }), [worldHalf, mapSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, mapSize, mapSize);
    ctx.fillStyle = '#c8d8a8';
    ctx.fillRect(0, 0, mapSize, mapSize);
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 2;
    ROAD_CURVES.forEach((rc) => {
      ctx.beginPath();
      rc.points.forEach((pt, idx) => {
        const mp = worldToMap(pt[0], pt[2]);
        if (idx === 0) ctx.moveTo(mp.x, mp.y); else ctx.lineTo(mp.x, mp.y);
      });
      if (rc.closed) ctx.closePath();
      ctx.stroke();
    });
    buildings.forEach((b) => {
      const bp = worldToMap(b.pos[0], b.pos[2]);
      ctx.fillStyle = '#555555';
      ctx.fillRect(bp.x - 5, bp.y - 5, 10, 10);
    });
    TREES.forEach((t) => {
      const tp = worldToMap(t.pos[0], t.pos[2]);
      ctx.fillStyle = '#2d6a1e';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 3, 0, Math.PI * 2); ctx.fill();
    });
    if (pigWorldPos) {
      const pp = worldToMap(pigWorldPos.x, pigWorldPos.z);
      ctx.save(); ctx.translate(pp.x, pp.y); ctx.rotate(-pigRotation + Math.PI / 2);
      ctx.fillStyle = '#ff4444'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-4, 5); ctx.lineTo(4, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }, [pigWorldPos, buildings, pigRotation, worldToMap]);

  return (
    <canvas ref={canvasRef} width={mapSize} height={mapSize} style={{
      position: 'fixed', top: '12px', right: '12px',
      width: mapSize + 'px', height: mapSize + 'px',
      borderRadius: '12px', border: '2px solid rgba(255,255,255,0.7)',
      boxShadow: '0 3px 12px rgba(0,0,0,0.4)', zIndex: 100000,
    }} />
  );
}

// ========== GameScene ==========
function GameScene({ pigRef, highState, setPigWorldPosition, setNearBuildList, setPigRotation }) {
  const [targetPos, setTargetPos] = useState(null);
  const [markerVisible, setMarkerVisible] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const collisionBoxesRef = useRef([]);
  const pigHeadingRef = useRef(new THREE.Vector3(0, 0, 1));
  const targetFadeTimer = useRef(null);

  const handleCollisionUpdate = useCallback((id, boxes) => {
    if (!handleCollisionUpdate.list) handleCollisionUpdate.list = [];
    const list = handleCollisionUpdate.list;
    const filtered = list.filter(item => item.id !== id);
    if (boxes && boxes.length > 0) filtered.push({ id, boxes });
    handleCollisionUpdate.list = filtered;
    const flat = [];
    for (let i = 0, len = filtered.length; i < len; i++) {
      const item = filtered[i];
      for (let j = 0, jl = item.boxes.length; j < jl; j++) flat.push(item.boxes[j]);
    }
    collisionBoxesRef.current = flat;
  }, []);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    // Clear any pending fade-out timer from previous click
    if (targetFadeTimer.current) {
      clearTimeout(targetFadeTimer.current);
      targetFadeTimer.current = null;
    }
    setFadingOut(false);
    const point = e.point.clone();
    setTargetPos(point);
    setMarkerVisible(true);
  }, []);

  // Pig reached the target: fade out and clear marker + stop movement
  const handleReached = useCallback(() => {
    // Trigger dissolve animation on the marker
    setFadingOut(true);
    // After fade animation completes, clear target and hide marker completely
    targetFadeTimer.current = setTimeout(() => {
      setTargetPos(null);
      setMarkerVisible(false);
      setFadingOut(false);
      targetFadeTimer.current = null;
    }, 450); // slightly longer than the 0.4s fade animation
  }, []);

  const handleHeadingUpdate = useCallback((heading) => {
    pigHeadingRef.current.copy(heading);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (targetFadeTimer.current) clearTimeout(targetFadeTimer.current);
    };
  }, []);

  // Throttled rAF loop for pig UI updates
  const pigWorldPosRef = useRef({ x: 0, y: 0, z: 0 });
  const lastCheckTime = useRef(0);
  const prevNearIds = useRef([]);

  useEffect(() => {
    let rafId;
    const checkPig = (timestamp) => {
      if (timestamp - lastCheckTime.current < PIG_CHECK_INTERVAL) {
        rafId = requestAnimationFrame(checkPig);
        return;
      }
      lastCheckTime.current = timestamp;

      if (pigRef && pigRef.current) {
        const pos = pigRef.current.position;
        const newPos = { x: pos.x, y: pos.y, z: pos.z };

        if (Math.abs(pigWorldPosRef.current.x - newPos.x) > 0.3 ||
            Math.abs(pigWorldPosRef.current.z - newPos.z) > 0.3) {
          pigWorldPosRef.current = newPos;
          setPigWorldPosition(newPos);
          setPigRotation(pigRef.current.rotation.y);
        }

        const nearIds = [];
        for (let i = 0, len = BUILDINGS.length; i < len; i++) {
          const b = BUILDINGS[i];
          const dx = b.pos[0] - pos.x;
          const dz = b.pos[2] - pos.z;
          if (dx * dx + dz * dz < BUILD_INTERACT_DIST * BUILD_INTERACT_DIST) nearIds.push(b.id);
        }

        const prev = prevNearIds.current;
        let changed = nearIds.length !== prev.length;
        if (!changed) {
          for (let i = 0; i < nearIds.length; i++) {
            if (nearIds[i] !== prev[i]) { changed = true; break; }
          }
        }
        if (changed) {
          prevNearIds.current = nearIds;
          setNearBuildList(nearIds);
        }
      }
      rafId = requestAnimationFrame(checkPig);
    };
    rafId = requestAnimationFrame(checkPig);
    return () => cancelAnimationFrame(rafId);
  }, [pigRef, setPigWorldPosition, setPigRotation, setNearBuildList]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight skyColor='#87CEEB' groundColor='#a2c490' intensity={0.6} />
      <directionalLight
        position={[15, 25, 10]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={150}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
        shadow-bias={-0.001}
        shadow-normalBias={0.02}
        color='#fff5e6'
      />
      <GrassGround />
      {TREES.map((t) => (
        <Tree key={t.id} config={t} onCollisionUpdate={handleCollisionUpdate} />
      ))}
      {ROCKS.map((r) => (
        <Rock key={r.id} config={r} onCollisionUpdate={handleCollisionUpdate} />
      ))}
      {HILLS.map((h) => (
        <Hill key={h.id} config={h} onCollisionUpdate={handleCollisionUpdate} />
      ))}
      {BUILDINGS.map((b) => (
        <Building key={b.id} config={b} onCollisionUpdate={handleCollisionUpdate} highState={highState} />
      ))}
      <Pig
        ref={pigRef}
        targetPos={targetPos}
        collisionBoxesRef={collisionBoxesRef}
        onReachedTarget={handleReached}
        onHeadingUpdate={handleHeadingUpdate}
      />
      <CameraFollow pigRef={pigRef} collisionBoxesRef={collisionBoxesRef} pigHeadingRef={pigHeadingRef} />
      {(targetPos && markerVisible) && <ClickMarker targetPos={targetPos} fadingOut={fadingOut} />}
      <ContactShadows opacity={0.35} scale={40} far={10} blur={2} position={[0, 0.01, 0]} color='#000000' />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} onClick={handleClick}>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </>
  );
}

// ========== Root App ==========
export default function App() {
  const pigRef = useRef();
  const [pigWorldPosition, setPigWorldPosition] = useState(null);
  const [pigRotation, setPigRotation] = useState(0);
  const [highState, setHighState] = useState({});
  const [nearBuildIdList, setNearBuildList] = useState([]);

  const toggleHighModel = useCallback((buildId) => {
    setHighState((prev) => ({ ...prev, [buildId]: !Boolean(prev[buildId]) }));
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 8, 10], fov: 50, near: 0.1, far: 200 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        shadows
        dpr={[1, 1.5]}
        performance={{ min: 0.5 }}
      >
        <color attach='background' args={['#87CEEB']} />
        <Suspense fallback={null}>
          <GameScene
            pigRef={pigRef}
            highState={highState}
            setPigWorldPosition={setPigWorldPosition}
            setNearBuildList={setNearBuildList}
            setPigRotation={setPigRotation}
          />
        </Suspense>
      </Canvas>
      {nearBuildIdList.length > 0 && (
        <div style={{ position: 'fixed', top: '20px', right: '220px', zIndex: 999999, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {BUILDINGS.filter(item => nearBuildIdList.includes(item.id)).map(b => (
            <button key={b.id} onClick={() => toggleHighModel(b.id)} style={{
                padding: '14px 22px', fontSize: '16px', fontWeight: 'bold',
                color: '#fff', backgroundColor: highState[b.id] ? '#27ae60' : '#e74c3c',
                border: 'none', borderRadius: '26px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.3)', cursor: 'pointer',
              }}>
              {highState[b.id] ? ('Low poly(' + b.name + ')') : ('High detail(' + b.name + ')')}
            </button>
          ))}
        </div>
      )}
      <MiniMap pigWorldPos={pigWorldPosition} buildings={BUILDINGS} pigRotation={pigRotation} />
    </div>
  );
}
