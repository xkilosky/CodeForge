// max_sim decision: verify a real physics engine runs client-side with NO wasm fetch,
// and that Roblox-style gravity + .Touched can be driven from it.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();   // -compat inlines the wasm; a fetch-based build would fail offline
console.log('rapier version:', RAPIER.version());

const world = new RAPIER.World({ x: 0, y: -196.2, z: 0 });  // Roblox default gravity = 196.2 studs/s^2
const ground = world.createCollider(RAPIER.ColliderDesc.cuboid(256, 10, 256).setTranslation(0, -10, 0));
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 60, 0));
const part = world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.5, 1), body);

const ys = [];
let touched = false;
for (let i = 0; i < 120; i++) {
  world.timestep = 1 / 60;
  world.step();
  if (i % 30 === 29) ys.push(+body.translation().y.toFixed(2));
  // NOTE: callback receives a Collider OBJECT, not a handle — compare .handle
  world.contactPairsWith(part, (other) => { if (other.handle === ground.handle) touched = true; });
}
console.log('Part Y at t=0.5s, 1.0s, 1.5s, 2.0s:', ys.join(' -> '));
console.log('came to rest on baseplate:', Math.abs(body.translation().y - 0.5) < 0.75 ? 'YES' : 'NO');
console.log('.Touched fired:', touched ? 'YES' : 'NO');
