// max_sim decision: verify three.js scene-graph math for mapping Roblox Instance -> mesh.
import * as THREE from 'three';
console.log('three revision:', THREE.REVISION);
const scene = new THREE.Scene();
// Roblox Part: Size (4,1,2), Position (12,20,0), Color3.fromRGB(40,200,90)
const size = { X: 4, Y: 1, Z: 2 }, pos = { X: 12, Y: 20, Z: 0 };
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(size.X, size.Y, size.Z),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(40/255, 200/255, 90/255) })
);
// Roblox Position is the part CENTER; three.js mesh origin is also center -> direct map
mesh.position.set(pos.X, pos.Y, pos.Z);
scene.add(mesh);
const box = new THREE.Box3().setFromObject(mesh);
console.log('mesh position :', mesh.position.toArray().join(', '));
console.log('aabb size     :', box.getSize(new THREE.Vector3()).toArray().join(', '));
console.log('aabb center   :', box.getCenter(new THREE.Vector3()).toArray().join(', '));
console.log('color hex     :', '#' + mesh.material.color.getHexString());
console.log('children      :', scene.children.length);
