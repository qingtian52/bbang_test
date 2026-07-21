import os

# Complete App.jsx - all ASCII, English comments only
# This script writes the complete file to avoid encoding issues

parts = []

p1 = """import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations, ContactShadows } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

useGLTF.preload('/Idle.glb');
useGLTF.preload('/Run.glb');
useGLTF.preload('/shop_a_low.glb');
useGLTF.preload('/shop_b_low.glb');
useGLTF.preload('/shop_c_low.glb');

const GROUND_SIZE = 120;
const WALKABLE_BOUNDS = {
  min: new THREE.Vector3(-GROUND_SIZE / 2, 0, -GROUND_SIZE / 2),
  max: new THREE.Vector3(GROUND_SIZE / 2, 0, GROUND_SIZE / 2),
};
const NON_COLLIDABLE_NAME = /ground|floor|plane|terrain|road|sidewalk|grass|water|sky|ceiling|light|shadow/i;
const BUILD_INTERACT_DIST = 4.0;

// Grass colors
const GRASS_LIGHT = '#b8d8a0';
const GRASS_DARK  = '#4a8c2a';

// Trees
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

// Road curves (avoiding buildings)
const ROAD_CURVES = [
  {
    id: 'road_main',
    points: [[-55,0,-40],[-30,0,-25],[-20,0,-10],[-5,0,5],[0,0,12],[15,0,10],[28,0,-5],[45,0,-20],[58,0,-35]],
    width: 3.0,
  },
  {
    id: 'road_arc_h',
    points: [[-50,0,20],[-25,0,35],[0,0,30],[25,0,35],[50,0,20]],
    width: 2.2,
  },
  {
    id: 'road_arc_v',
    points: [[-20,0,-50],[-10,0,-25],[5,0,0],[10,0,25],[5,0,45]],
    width: 2.2,
  },
  {
    id: 'road_loop',
    points: [[-15,0,-15],[0,0,-20],[15,0,-15],[20,0,0],[15,0,15],[0,0,20],[-15,0,15],[-20,0,0],[-15,0,-15]],
    width: 1.5,
    closed: true,
  },
];

// Camera params
const CAM_LERP_POSITION = 6.0;
const CAM_LERP_LOOKAT = 5.0;
const CAM_MIN_HEIGHT = 2.5;
const CAM_MIN_DIST = 3.5;
const CAM_RADIUS = 1.2;
const CAM_DEFAULT_DIST = 9.0;
const CAM_DEFAULT_HEIGHT = 5.0;
"""

p2 = """
// Util: check blocked position
function isBlockedPosition(position, collisionBoxes, radius) {
  if (!collisionBoxes || collisionBoxes.length === 0) return false;
  const sphere = new THREE.Sphere(position, radius);
  for (const { box } of collisionBoxes) {
    if (sphere.intersectsBox(box)) return true;
  }
  return false;
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

function normalizeModelScene(scene) {
  scene.traverse((child) => {
    if (!child.isMesh) return;
    child.matrixAutoUpdate = true;
    child.updateMatrix();
    child.updateMatrixWorld(true);
    child.material.side = THREE.DoubleSide;
    child.material.needsUpdate = true;
    child.receiveShadow = true;
    child.castShadow = true;
    if (child.material.metalness !== undefined) child.material.metalness = Math.min(child.material.metalness, 0.2);
    if (child.material.roughness !== undefined) child.material.roughness = Math.max(child.material.roughness, 0.6);
  });
  return scene;
}

function collectCollisionBoxes(scene) {
  const boxes = [];
  scene.traverse((child) => {
    if (!child.isMesh) return;
    const name = child.name.toLowerCase();
    if (NON_COLLIDABLE_NAME.test(name)) return;
    child.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(child);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y < 0.2 && size.x > 1.5 && size.z > 1.5) return;
    if (size.x * size.y * size.z < 0.3) return;
    boxes.push({ mesh: child, box });
  });
  return boxes;
}

function dampedLerp(current, target, factor, delta) {
  const t = 1 - Math.exp(-factor * delta);
  return current + (target - current) * t;
}

// Buildings config
const BUILDINGS = [
  { id: 'shop_a', name: 'Clothing', low: '/shop_a_low.glb', high: '/shop_a_high.glb', pos: [-22, 0, -9] },
  { id: 'shop_b', name: 'Cafe', low: '/shop_b_low.glb', high: '/shop_b_high.glb', pos: [-5, 0, 12] },
  { id: 'shop_c', name: 'Bookstore', low: '/shop_c_low.glb', high: '/shop_c_high.glb', pos: [28, 0, -5] },
];
"""

p3 = """
// ========== GrassGround component ==========
function GrassGround() {
  const patches = useMemo(() => {
    const seed = 42;
    const rng = (i) => ((seed * 9301 + i * 49297) % 233280) / 233280;
    const result = [];
    for (let i = 0; i < 14; i++) {
      const angle = rng(i) * Math.PI * 2;
      const dist = rng(i + 100) * 35;
      result.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        rx: 6 + rng(i + 200) * 10,
        rz: 4 + rng(i + 300) * 7,
        rot: rng(i + 400) * Math.PI,
      });
    }
    return result;
  }, []);

  return (
    <group>
      {/* Base ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial color={GRASS_LIGHT} roughness={0.95} metalness={0.0} />
      </mesh>

      {/* Dark green patches */}
      {patches.map((p, i) => (
        <mesh key={`patch_${i}`} position={[p.x, 0.01, p.z]} rotation={[-Math.PI / 2, 0, p.rot]} receiveShadow>
          <planeGeometry args={[p.rx * 2, p.rz * 2]} />
          <meshStandardMaterial color={GRASS_DARK} roughness={0.95} metalness={0.0} />
        </mesh>
      ))}

      {/* Road curves */}
      {ROAD_CURVES.map((rc) => {
        const pts = rc.points.map(p => new THREE.Vector3(p[0], 0.02, p[2]));
        const curve = new THREE.CatmullRomCurve3(pts, rc.closed || false, 'catmullrom', 0.5);
        return (
          <mesh key={rc.id} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <tubeGeometry args={[curve, 80, rc.width / 2, 8, rc.closed || false]} />
            <meshStandardMaterial color="#c8c8c8" roughness={0.85} metalness={0.05} />
          </mesh>
        );
      })}

      {/* Road lines */}
      {ROAD_CURVES.filter(rc => rc.width >= 2.2).map((rc) => {
        const pts = rc.points.map(p => new THREE.Vector3(p[0], 0.03, p[2]));
        const curve = new THREE.CatmullRomCurve3(pts, rc.closed || false, 'catmullrom', 0.5);
        return (
          <mesh key={`line_${rc.id}`} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <tubeGeometry args={[curve, 80, 0.06, 4, rc.closed || false]} />
            <meshStandardMaterial color="#e8e8e8" roughness={0.7} metalness={0.0} />
          </mesh>
        );
      })}

      {/* Invisible ground for collision */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} visible={false}>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
"""

p4 = """
// ========== Tree component ==========
function Tree({ config, onCollisionUpdate }) {
  const { pos, id } = config;
  const px = pos[0], pz = pos[2];

  useEffect(() => {
    const r = 1.2;
    const box = new THREE.Box3(
      new THREE.Vector3(px - r, 0, pz - r),
      new THREE.Vector3(px + r, 5.5, pz + r)
    );
    const dummyGeo = new THREE.BoxGeometry(2.4, 5.5, 2.4);
    const dummyMat = new THREE.MeshBasicMaterial({ visible: false });
    const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);
    dummyMesh.position.set(px, 2.75, pz);
    dummyMesh.name = `tree_${id}`;
    onCollisionUpdate(id, [{ mesh: dummyMesh, box }]);
    return () => onCollisionUpdate(id, []);
  }, [id, px, pz, onCollisionUpdate]);

  return (
    <group position={[px, 0, pz]}>
      <mesh position={[0, 1.75, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.4, 3.5, 8]} />
        <meshStandardMaterial color="#8B6914" roughness={0.9} />
      </mesh>
      <mesh position={[0, 4.2, 0]} castShadow>
        <sphereGeometry args={[2.0, 12, 10]} />
        <meshStandardMaterial color="#2d6a1e" roughness={0.8} />
      </mesh>
      <mesh position={[0, 5.5, 0]} castShadow>
        <sphereGeometry args={[1.5, 10, 8]} />
        <meshStandardMaterial color="#3a8a28" roughness={0.8} />
      </mesh>
    </group>
  );
}
"""

p5 = """
// ========== Rock component ==========
function Rock({ config, onCollisionUpdate }) {
  const { pos, id, scale } = config;
  const px = pos[0], pz = pos[2];

  useEffect(() => {
    const r = 0.9 * scale;
    const box = new THREE.Box3(
      new THREE.Vector3(px - r, 0, pz - r),
      new THREE.Vector3(px + r, r * 0.7, pz + r)
    );
    const dummyGeo = new THREE.BoxGeometry(r * 2, r * 0.7, r * 2);
    const dummyMat = new THREE.MeshBasicMaterial({ visible: false });
    const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);
    dummyMesh.position.set(px, r * 0.35, pz);
    dummyMesh.name = `rock_${id}`;
    onCollisionUpdate(id, [{ mesh: dummyMesh, box }]);
    return () => onCollisionUpdate(id, []);
  }, [id, px, pz, scale, onCollisionUpdate]);

  const randY = useMemo(() => Math.random() * Math.PI * 2, [id]);

  return (
    <group position={[px, 0, pz]} scale={[scale, scale, scale]}>
      <mesh castShadow rotation={[0, randY, 0]}>
        <dodecahedronGeometry args={[1.0, 0]} />
        <meshStandardMaterial color="#6b6b6b" roughness={0.95} flatShading />
      </mesh>
      <mesh position={[0.8, 0.2, -0.5]} scale={[0.4, 0.3, 0.4]} castShadow>
        <dodecahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial color="#5a5a5a" roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}
"""

p6 = """
// ========== Hill component ==========
function Hill({ config, onCollisionUpdate }) {
  const { pos, id, scale } = config;
  const px = pos[0], pz = pos[2];

  useEffect(() => {
    const r = 3.5 * scale;
    const box = new THREE.Box3(
      new THREE.Vector3(px - r, 0, pz - r),
      new THREE.Vector3(px + r, 1.5 * scale, pz + r)
    );
    const dummyGeo = new THREE.BoxGeometry(r * 2, 1.5 * scale, r * 2);
    const dummyMat = new THREE.MeshBasicMaterial({ visible: false });
    const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);
    dummyMesh.position.set(px, 0.75 * scale, pz);
    dummyMesh.name = `hill_${id}`;
    onCollisionUpdate(id, [{ mesh: dummyMesh, box }]);
    return () => onCollisionUpdate(id, []);
  }, [id, px, pz, scale, onCollisionUpdate]);

  return (
    <group position={[px, 0, pz]}>
      <mesh scale={[scale, scale * 0.5, scale]} position={[0, 0, 0]} castShadow receiveShadow>
        <sphereGeometry args={[3.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#5a8a3a" roughness={0.9} />
      </mesh>
      <mesh position={[0, scale * 1.6, 0]} scale={[scale * 0.9, scale * 0.3, scale * 0.9]} castShadow>
        <sphereGeometry args={[2.0, 12, 8]} />
        <meshStandardMaterial color="#4a7a2a" roughness={0.85} />
      </mesh>
    </group>
  );
}
"""
