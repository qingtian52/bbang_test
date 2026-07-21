import os

# Continue gen_app.py - append more parts
# This file contains the remaining React components

p7 = """
// ========== Building component ==========
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
      loader.load(
        high,
        (gltf) => {
          highSceneRef.current = normalizeModelScene(gltf.scene.clone());
          console.log('High model loaded: ' + id);
          setLoadingHigh(false);
        },
        undefined,
        (err) => {
          console.error('High model failed: ' + id, err);
          setLoadingHigh(false);
        }
      );
    }
    if (!highState[id]) highSceneRef.current = null;
  }, [highState[id], high, id, loadingHigh]);

  const displayModel = highState[id] ? highSceneRef.current || lowScene : lowScene;
  const [px, py, pz] = pos;

  return (
    <group ref={groupRef} position={[px, py, pz]}>
      {displayModel && <primitive object={displayModel} />}
    </group>
  );
}
"""

p8 = """
// ========== Pig component ==========
const Pig = React.forwardRef(({ targetPos, collisionBoxes, onReachedTarget }, ref) => {
  const groupRef = useRef();
  useImperativeHandle(ref, () => groupRef.current);
  const idleData = useGLTF('/Idle.glb');
  const runData = useGLTF('/Run.glb');
  const { actions: idleActions } = useAnimations(idleData.animations, groupRef);
  const { actions: runActions } = useAnimations(runData.animations, groupRef);

  const [isRunning, setIsRunning] = useState(false);
  const targetWorldPos = useRef(new THREE.Vector3());
  const hasReached = useRef(false);
  const speed = 9.5;
  const pigRadius = 0.25;
  const stopDistance = 0.2;
  const tempMove = useRef(new THREE.Vector3());
  const tempPos = useRef(new THREE.Vector3());

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(30, 0, 30);
    }
  }, []);

  useEffect(() => {
    idleActions?.Idle?.play();
    return () => {
      Object.values(idleActions || {}).forEach(a => a?.stop());
      Object.values(runActions || {}).forEach(a => a?.stop());
    };
  }, [idleActions, runActions]);

  useEffect(() => {
    if (targetPos) {
      targetWorldPos.current.copy(targetPos);
      hasReached.current = false;
      setIsRunning(true);
    } else {
      setIsRunning(false);
    }
  }, [targetPos]);

  useEffect(() => {
    if (!idleActions || !runActions) return;
    if (isRunning) {
      idleActions.Idle?.stop();
      runActions.Run?.reset().play();
    } else {
      runActions.Run?.stop();
      idleActions.Idle?.reset().play();
    }
  }, [isRunning, idleActions, runActions]);

  const canMoveTo = useCallback((position) => {
    if (!isInsideWalkableBounds(position, pigRadius)) return false;
    return !isBlockedPosition(position, collisionBoxes, pigRadius);
  }, [collisionBoxes]);

  const resolveMovement = useCallback((currentPos, moveStep) => {
    tempPos.current.copy(currentPos);
    tempPos.current.x += moveStep.x;
    tempPos.current.z += moveStep.z;
    if (canMoveTo(tempPos.current)) return moveStep.clone();
    tempPos.current.copy(currentPos);
    tempPos.current.x += moveStep.x;
    if (canMoveTo(tempPos.current)) return new THREE.Vector3(moveStep.x, 0, 0);
    tempPos.current.copy(currentPos);
    tempPos.current.z += moveStep.z;
    if (canMoveTo(tempPos.current)) return new THREE.Vector3(0, 0, moveStep.z);
    return null;
  }, [canMoveTo]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const pigPos = groupRef.current.position;
    pigPos.y = 0;

    if (!isRunning) {
      if (!hasReached.current && targetWorldPos.current.lengthSq() > 0) {
        hasReached.current = true;
        onReachedTarget?.();
      }
      return;
    }

    const clampedDelta = Math.min(delta, 0.05);
    const target = targetWorldPos.current;
    const dx = target.x - pigPos.x;
    const dz = target.z - pigPos.z;
    const distSq = dx * dx + dz * dz;

    if (distSq < stopDistance * stopDistance) {
      setIsRunning(false);
      hasReached.current = true;
      onReachedTarget?.();
      return;
    }

    const dir = tempMove.current.set(dx, 0, dz);
    const dist = Math.sqrt(distSq);
    dir.divideScalar(dist);
    const stepSize = Math.min(speed * clampedDelta, dist);
    dir.multiplyScalar(stepSize);
    const resolvedMove = resolveMovement(pigPos, dir);

    if (resolvedMove) {
      pigPos.x += resolvedMove.x;
      pigPos.z += resolvedMove.z;
      pigPos.y = 0;
      groupRef.current.lookAt(target.x, pigPos.y, target.z);
    } else {
      setIsRunning(false);
      hasReached.current = true;
      onReachedTarget?.();
    }
  });

  return (
    <group ref={groupRef} scale={0.5}>
      <primitive object={idleData.scene} />
    </group>
  );
});
"""

p9 = """
// ========== CameraFollow component ==========
function CameraFollow({ target, collisionBoxes }) {
  const { camera } = useThree();
  const currAngle = useRef(0);
  const currDist = useRef(CAM_DEFAULT_DIST);
  const currHeight = useRef(CAM_DEFAULT_HEIGHT);
  const tgtAngle = useRef(0);
  const tgtDist = useRef(CAM_DEFAULT_DIST);
  const tgtHeight = useRef(CAM_DEFAULT_HEIGHT);
  const smoothedCamPos = useRef(new THREE.Vector3());
  const smoothedLookAt = useRef(new THREE.Vector3());
  const tempLookAt = useRef(new THREE.Vector3());
  const raycaster = useRef(new THREE.Raycaster());
  const initialized = useRef(false);
  const meshCache = useRef([]);
  const lastBoxesLen = useRef(0);
  const _vTmp = useRef(new THREE.Vector3());
  const _dirTmp = useRef(new THREE.Vector3());

  const getOcclusionDist = useCallback((pigPos, camPos) => {
    const meshes = meshCache.current;
    if (meshes.length === 0) return -1;
    _dirTmp.current.subVectors(camPos, pigPos).normalize();
    raycaster.current.set(pigPos, _dirTmp.current);
    raycaster.current.far = pigPos.distanceTo(camPos);
    const hits = raycaster.current.intersectObjects(meshes, true);
    return hits.length > 0 ? hits[0].distance : -1;
  }, []);

  const calcCamPos = useCallback((pigPos, angle, dist, height) => {
    const pos = _vTmp.current;
    pos.x = pigPos.x + Math.sin(angle) * dist;
    pos.y = Math.max(pigPos.y + height, pigPos.y + CAM_MIN_HEIGHT);
    pos.z = pigPos.z + Math.cos(angle) * dist;
    return pos;
  }, []);

  const findBestOrbit = useCallback((pigPos) => {
    const meshes = meshCache.current;
    const NUM_SWEEP = 12;
    let found = false;

    for (let d = CAM_DEFAULT_DIST; d >= CAM_MIN_DIST; d -= 0.6) {
      const cam = calcCamPos(pigPos, currAngle.current, d, currHeight.current);
      if (getOcclusionDist(pigPos, cam) < 0) {
        tgtAngle.current = currAngle.current;
        tgtDist.current = d;
        tgtHeight.current = currHeight.current;
        found = true;
        break;
      }
    }
    if (found) return;

    const SWEEP_ORDER = [];
    for (let i = 1; i <= Math.ceil(NUM_SWEEP / 2); i++) {
      SWEEP_ORDER.push(i);
      if (i < NUM_SWEEP / 2) SWEEP_ORDER.push(-i);
    }
    const STEP = (Math.PI * 2) / NUM_SWEEP;
    for (let idx = 0; idx < SWEEP_ORDER.length; idx++) {
      const angle = currAngle.current + SWEEP_ORDER[idx] * STEP;
      for (let d = CAM_DEFAULT_DIST; d >= CAM_MIN_DIST; d -= 0.8) {
        const cam = calcCamPos(pigPos, angle, d, currHeight.current);
        if (getOcclusionDist(pigPos, cam) < 0) {
          tgtAngle.current = angle;
          tgtDist.current = d;
          tgtHeight.current = currHeight.current;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) return;

    for (let h = CAM_DEFAULT_HEIGHT + 1; h <= CAM_DEFAULT_HEIGHT + 4; h += 1) {
      for (let d = CAM_DEFAULT_DIST; d >= CAM_MIN_DIST; d -= 0.8) {
        const cam = calcCamPos(pigPos, currAngle.current, d, h);
        if (getOcclusionDist(pigPos, cam) < 0) {
          tgtAngle.current = currAngle.current;
          tgtDist.current = d;
          tgtHeight.current = h;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) return;

    tgtAngle.current = currAngle.current;
    tgtDist.current = CAM_MIN_DIST;
    tgtHeight.current = CAM_DEFAULT_HEIGHT + 3;
  }, [collisionBoxes]);

  const pushCameraOutOfBuilding = useCallback((pigPos) => {
    const meshes = meshCache.current;
    if (meshes.length === 0) return;
    const camPos = smoothedCamPos.current;
    _dirTmp.current.subVectors(pigPos, camPos).normalize();
    raycaster.current.set(camPos, _dirTmp.current);
    raycaster.current.far = camPos.distanceTo(pigPos);
    const hits = raycaster.current.intersectObjects(meshes, true);
    if (hits.length > 0) {
      const safeDist = Math.max(hits[0].distance + CAM_RADIUS, CAM_MIN_DIST);
      camPos.x = pigPos.x - _dirTmp.current.x * safeDist;
      camPos.y = Math.max(pigPos.y + CAM_MIN_HEIGHT + 1.0, camPos.y);
      camPos.z = pigPos.z - _dirTmp.current.z * safeDist;
    }
  }, [collisionBoxes]);

  useFrame((_, delta) => {
    if (!target.current) return;
    const clampedDelta = Math.min(delta, 0.05);
    const pigPos = target.current.position;

    const currentLen = collisionBoxes.length;
    if (currentLen !== lastBoxesLen.current) {
      meshCache.current = collisionBoxes.map(item => item.mesh);
      lastBoxesLen.current = currentLen;
    }

    findBestOrbit(pigPos);
    const targetCamPos = calcCamPos(pigPos, tgtAngle.current, tgtDist.current, tgtHeight.current);

    if (!initialized.current) {
      smoothedCamPos.current.copy(targetCamPos);
      smoothedLookAt.current.set(pigPos.x, pigPos.y + 1.2, pigPos.z);
      currAngle.current = tgtAngle.current;
      currDist.current = tgtDist.current;
      currHeight.current = tgtHeight.current;
      initialized.current = true;
    }

    smoothedCamPos.current.x = dampedLerp(smoothedCamPos.current.x, targetCamPos.x, CAM_LERP_POSITION, clampedDelta);
    smoothedCamPos.current.y = dampedLerp(smoothedCamPos.current.y, targetCamPos.y, CAM_LERP_POSITION, clampedDelta);
    smoothedCamPos.current.z = dampedLerp(smoothedCamPos.current.z, targetCamPos.z, CAM_LERP_POSITION, clampedDelta);

    pushCameraOutOfBuilding(pigPos);
    camera.position.copy(smoothedCamPos.current);

    tempLookAt.current.set(pigPos.x, pigPos.y + 1.2, pigPos.z);
    smoothedLookAt.current.x = dampedLerp(smoothedLookAt.current.x, tempLookAt.current.x, CAM_LERP_LOOKAT, clampedDelta);
    smoothedLookAt.current.y = dampedLerp(smoothedLookAt.current.y, tempLookAt.current.y, CAM_LERP_LOOKAT, clampedDelta);
    smoothedLookAt.current.z = dampedLerp(smoothedLookAt.current.z, tempLookAt.current.z, CAM_LERP_LOOKAT, clampedDelta);
    camera.lookAt(smoothedLookAt.current);

    currAngle.current = tgtAngle.current;
    currDist.current = tgtDist.current;
    currHeight.current = tgtHeight.current;
  });

  return null;
}
"""

with open('App.jsx', 'a', encoding='utf-8') as f:
    f.write(p7 + p8 + p9)

print('Parts 7-9 appended successfully')
print('File size:', os.path.getsize('App.jsx'), 'bytes')
