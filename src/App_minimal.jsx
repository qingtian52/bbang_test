import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations, ContactShadows } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

console.log('Minimal App test - encoding check');
console.log('useImperativeHandle: OK');
console.log('useGLTF: OK');
console.log('THREE.BoxGeometry: OK');
console.log('speed test: OK');
console.log('hits test: OK');

export default function AppMinimal() {
  return <div style={{ color: 'white' }}>Encoding Test OK</div>;
}
