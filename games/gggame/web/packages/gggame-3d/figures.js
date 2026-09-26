import * as THREE from 'three';
import { createRoundedBox, createContactShadow } from '@a3game/playable';

export const COLORS = [0xe89558, 0x699eb2, 0xbb827d, 0x9ca968, 0xb496bc, 0xd1b768, 0x719c85, 0x9e91b9];
export const material = color => new THREE.MeshStandardMaterial({ color, roughness: .85 });
export function box(parent, size, position, color, radius = .06) {
  const mesh = createRoundedBox({ width: size[0], height: size[1], depth: size[2], radius, segments: 2, material: material(color) });
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function ball(parent, radius, position, color, scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material(color));
  mesh.position.set(...position); mesh.scale.set(...scale); mesh.castShadow = true; parent.add(mesh); return mesh;
}
export function house(parent, center, color, id) {
  const root = new THREE.Group(); root.position.set(center.x, 0, center.z); root.userData.homeId = id; parent.add(root);
  box(root, [5.45, .36, 5.3], [0, .02, 0], 0xd7cbb6, .18);
  box(root, [5.05, .1, 4.9], [0, .25, 0], 0xf3e7cb);
  // Rear facade and low side walls keep every resident visible.
  box(root, [5.15, 1.7, .22], [0, 1.03, -2.4], 0xf3ecdb);
  box(root, [.22, .68, 4.8], [-2.46, .66, 0], 0xe4dcc6);
  box(root, [.22, .68, 4.8], [2.46, .66, 0], 0xe4dcc6);
  box(root, [5.5, .2, .7], [0, 1.96, -2.4], color);
  box(root, [1.1, .9, .08], [-1.35, 1.16, -2.24], color);
  box(root, [.91, .71, .09], [-1.35, 1.16, -2.18], 0xadc6c1);
  box(root, [.055, .73, .12], [-1.35, 1.16, -2.1], 0xfff2d9, .01);
  box(root, [.92, .055, .12], [-1.35, 1.16, -2.1], 0xfff2d9, .01);
  box(root, [1.25, .4, .55], [1.4, .51, -1.91], 0xbb9871);
  box(root, [.52, .08, .48], [1.4, .75, -1.91], color);
  box(root, [1.8, .035, 1.1], [0, .33, 1.57], color);
  box(root, [1.6, .13, .65], [0, .14, 2.91], 0xe6dac0);
  const pot = box(root, [.4, .42, .4], [2.01, .48, 1.94], 0xc58c68);
  ball(pot, .31, [0, .38, 0], 0x829361);
  return root;
}
export function neighbor(color, id) {
  const root = new THREE.Group(); root.userData.playerId = id;
  const body = new THREE.Group(); root.add(body);
  const shirt = box(body, [.6, .65, .42], [0, 1.01, 0], color, .15);
  const head = new THREE.Group(); head.position.y = 1.65; body.add(head);
  ball(head, .36, [0, 0, 0], 0xf2cda4, [1, 1.06, .93]);
  ball(head, .37, [0, .15, -.055], 0x544638, [1, .6, .95]);
  ball(head, .06, [0, .36, 0], 0x544638);
  for (const x of [-.125, .125]) ball(head, .035, [x, .015, .305], 0x343e35, [1, 1.2, .5]);
  ball(head, .052, [0, -.055, .34], 0xe3b78e);
  const arms = [-1, 1].map(side => {
    const arm = new THREE.Group(); arm.position.set(side * .4, 1.22, 0); body.add(arm);
    box(arm, [.22, .32, .28], [0, -.09, 0], color, .08);
    box(arm, [.18, .26, .19], [0, -.33, 0], 0xf2cda4, .08); return arm;
  });
  const legs = [-1, 1].map(side => {
    const leg = new THREE.Group(); leg.position.set(side * .18, .69, 0); body.add(leg);
    const pants = box(leg, [.26, .31, .3], [0, -.11, 0], 0x577b8e, .07);
    box(leg, [.17, .2, .2], [0, -.33, 0], 0xf2cda4);
    box(leg, [.24, .17, .37], [0, -.48, .06], 0x4a5148);
    return { pivot: leg, pants };
  });
  const belts = [0, 1, 2].map(i => box(body, [.65 + i * .012, .065, .46 + i * .015], [0, .71 + i * .082, 0], [0x557b8e, 0x9db5ba, 0xe6bd60][i], .03));
  const blade = new THREE.Group(); arms[1].add(blade); blade.position.set(0, -.4, .1);
  box(blade, [.12, .22, .12], [0, -.08, 0], 0x704c37);
  box(blade, [.28, .07, .12], [0, .06, 0], 0xd4b269);
  box(blade, [.19, .58, .065], [0, .37, 0], 0xe5e9de, .025);
  blade.rotation.x = -.8;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.49, .57, 32), new THREE.MeshBasicMaterial({ color: 0xe9bf5c, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .015; root.add(ring);
  const shadow = createContactShadow({ radius: .65, opacity: .25 }); root.add(shadow);
  return { root, body, head, shirt, arms, legs, belts, blade, ring, shadow };
}
export function tree(parent, x, z, scale = 1) {
  const root = new THREE.Group(); root.position.set(x, 0, z); root.scale.setScalar(scale); parent.add(root);
  box(root, [.25, 1.1, .25], [0, .55, 0], 0x927858);
  ball(root, .85, [0, 1.65, 0], 0x819868, [.8, 1, .8]);
  ball(root, .63, [.36, 1.27, .1], 0x99aa75);
}
