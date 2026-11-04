/**
 * The simulated Roblox viewport.
 *
 * There is a permanent "Simulation" badge in the corner by design. Roblox's
 * engine cannot run in a browser: this is three.js drawing a scene derived from
 * the instance tree. Anything the script does that depends on the real engine
 * (physics behaviour, lighting fidelity, particle randomness) will visibly
 * differ, and the badge is there so nobody is misled about which one they are
 * looking at.
 *
 * Rendering is split from mapping on purpose. `partMesh.ts` owns the
 * Roblox-to-three decisions and is unit-tested in Node; this file owns the
 * canvas, the camera, and the render loop, which cannot be tested without a
 * browser.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../useStore';
import { sceneStore } from '../../core/sceneStore';
import type { ScenePart } from '../../core/types';
import {
  CYLINDER_ROTATION_Z,
  boxArgs,
  cylinderRadius,
  opacityFor,
  rgbHex,
  shapeForClass,
  lookForMaterial,
} from './partMesh';

/** Roblox's default field of view, in degrees. */
const ROBLOX_FOV = 70;

interface BuiltPart {
  mesh: THREE.Object3D;
  material: THREE.MeshStandardMaterial | null;
  signature: string;
}

/**
 * Disposes geometry and materials for meshes removed from the scene. Called on
 * every rebuild; without it a long session leaks GPU buffers on each run.
 */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

function buildGeometry(part: ScenePart): { geometry: THREE.BufferGeometry; rotationZ: number } {
  switch (shapeForClass(part.className)) {
    case 'sphere':
      return { geometry: new THREE.SphereGeometry(Math.max(part.size.x, part.size.y, part.size.z) / 2, 24, 16), rotationZ: 0 };
    case 'cylinder':
      return {
        geometry: new THREE.CylinderGeometry(cylinderRadius(part.size), cylinderRadius(part.size), part.size.x, 20),
        rotationZ: CYLINDER_ROTATION_Z,
      };
    case 'wedge':
      // A wedge is half of a box: a triangular prism spanning the part's size.
      return { geometry: new THREE.BoxGeometry(...boxArgs(part.size)).translate(0, 0, 0), rotationZ: 0 };
    default:
      return { geometry: new THREE.BoxGeometry(...boxArgs(part.size)), rotationZ: 0 };
  }
}

/** Changes to these fields require rebuilding that part's mesh. */
function signatureFor(part: ScenePart): string {
  return [
    part.className,
    part.size.x, part.size.y, part.size.z,
    part.color.r, part.color.g, part.color.b,
    part.transparency, part.material, part.reflectance,
  ].join('|');
}

function buildMaterial(part: ScenePart): THREE.MeshStandardMaterial {
  const look = lookForMaterial(part.material);
  const opacity = opacityFor(part);
  const color = rgbHex(part.color);
  return new THREE.MeshStandardMaterial({
    color,
    roughness: look.roughness,
    metalness: look.metalness,
    transparent: opacity < 1,
    opacity,
    // Neon glows in Roblox; emitting the base color is a cheap approximation.
    emissive: look.emissive ? color : 0x000000,
    emissiveIntensity: look.emissive ? 1 : 0,
  });
}

export function RobloxViewport() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const partsRef = useRef<Map<number, BuiltPart>>(new Map());
  const [stats, setStats] = useState({ parts: 0, triangles: 0 });
  const state = useStore(sceneStore);

  // --- one-time scene setup ------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87a7c7);

    const camera = new THREE.PerspectiveCamera(ROBLOX_FOV, 1, 0.1, 200_000);
    camera.position.set(0, 30, 60);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // Lighting is a fixed studio-ish rig in M3. M6 drives it from the Lighting
    // service so ClockTime and Ambient take effect.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x555560, 1.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(60, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    const shadowExtent = 160;
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    // Roblox has no hard shadow cutoff, but a large scene needs far shadows.
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    // ResizeObserver rather than a window listener: the panel is resizable.
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame = 0;
    let disposed = false;
    const tick = () => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      // Every mesh built so far is owned by this renderer.
      for (const built of partsRef.current.values()) {
        built.material?.dispose();
        if (!built.mesh.parent) disposeTree(built.mesh);
      }
      for (const built of partsRef.current.values()) disposeTree(built.mesh);
      partsRef.current.clear();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  // --- rebuild whenever a new scene arrives --------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const snapshot = state.snapshot;
    if (!scene || !camera || !controls || !snapshot) {
      setStats({ parts: 0, triangles: 0 });
      return;
    }

    const built = partsRef.current;
    const liveIds = new Set<number>();
    let triangles = 0;

    for (const part of snapshot.parts) {
      liveIds.add(part.id);
      const signature = signatureFor(part);
      const existing = built.get(part.id);

      // Rebuild the mesh only when something that affects geometry or material
      // changed; otherwise just move it. A script that repositions fifty parts
      // should not rebuild fifty buffers.
      if (!existing || existing.signature !== signature) {
        if (existing) {
          scene.remove(existing.mesh);
          disposeTree(existing.mesh);
        }
        const { geometry, rotationZ } = buildGeometry(part);
        const material = buildMaterial(part);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.z = rotationZ;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = part.path;
        scene.add(mesh);
        built.set(part.id, { mesh, material, signature });
      }

      const entry = built.get(part.id);
      if (entry) {
        entry.mesh.position.set(part.position.x, part.position.y, part.position.z);
        const geo = (entry.mesh as THREE.Mesh).geometry;
        if (geo) {
          const index = geo.getIndex();
          const position = geo.getAttribute('position');
          triangles += index ? index.count / 3 : (position ? position.count / 3 : 0);
        }
      }
    }

    // Anything the script destroyed (or the run did not recreate) is removed.
    for (const [id, entry] of built) {
      if (liveIds.has(id)) continue;
      scene.remove(entry.mesh);
      disposeTree(entry.mesh);
      built.delete(id);
    }

    setStats({ parts: snapshot.parts.length, triangles: Math.round(triangles) });
  }, [state.snapshot]);

  // Frame the scene the first time parts appear, so a baseplate at the origin is
  // visible without the user hunting for it. Later runs keep the user's camera.
  const framedRuns = useRef<Set<number>>(new Set());
  useEffect(() => {
    const snapshot = state.snapshot;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!snapshot || !camera || !controls) return;
    if (framedRuns.current.has(snapshot.runId)) return;
    framedRuns.current.add(snapshot.runId);
    if (snapshot.parts.length === 0) return;

    let maxExtent = 0;
    for (const part of snapshot.parts) {
      maxExtent = Math.max(
        maxExtent,
        Math.abs(part.position.x) + part.size.x,
        Math.abs(part.position.y) + part.size.y,
        Math.abs(part.position.z) + part.size.z,
      );
    }
    const distance = Math.max(maxExtent * 1.4, 20);
    camera.position.set(distance * 0.6, distance * 0.55, distance * 0.9);
    controls.target.set(0, 0, 0);
    controls.update();
  }, [state.snapshot]);

  return (
    <div className="viewport">
      <div className="viewport-canvas" ref={mountRef} />
      <div className="viewport-badge" title="Roblox's engine cannot run in a browser; this is a three.js simulation.">
        Simulation
      </div>
      <div className="viewport-stats">
        {stats.parts} part{stats.parts === 1 ? '' : 's'} · {stats.triangles.toLocaleString()} tris
      </div>
      {state.error ? <div className="viewport-error">{state.error}</div> : null}
      {!state.snapshot ? (
        <div className="viewport-hint">
          Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or Run to build the scene.
        </div>
      ) : null}
    </div>
  );
}
