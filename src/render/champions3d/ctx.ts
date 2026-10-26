// Build context shared by the body, outfit and prop builders of one champion.
import * as THREE from 'three';
import type { Mat } from '../champions/core';
import type { Kit } from '../champions/types';
import { MeshBuilder, type Vec, type WeightFn } from './mesh';
import type { BoneDef, Landmarks } from './rig';

export class Ctx {
  readonly b = new MeshBuilder();
  readonly bone: Record<string, number> = {};
  /** model-space matrices of bones in the HOLD pose (arms solved by IK); others = bind translation */
  readonly holdM: THREE.Matrix4[] = [];
  /** bind-space world positions */
  readonly bindP: THREE.Vector3[] = [];
  constructor(
    readonly kit: Kit,
    readonly L: Landmarks,
    readonly bones: BoneDef[],
  ) {
    bones.forEach((d, i) => {
      this.bone[d.name] = i;
      this.bindP.push(new THREE.Vector3(...d.p));
      this.holdM.push(new THREE.Matrix4().makeTranslation(d.p[0], d.p[1], d.p[2]));
    });
  }

  idx(name: string): number {
    const i = this.bone[name];
    if (i === undefined) throw new Error(`champions3d: no bone ${name}`);
    return i;
  }

  /** Author in bind model space, rigid to `name`. */
  on(name: string): this {
    this.b.mat.identity();
    this.b.set({ bone: this.idx(name), weights: null });
    return this;
  }

  /** Author in HOLD-pose model space (how the prop looks in the idle hold), rigid to `name`. */
  held(name: string): this {
    const i = this.idx(name);
    const inv = this.holdM[i]!.clone().invert();
    this.b.mat.makeTranslation(this.bindP[i]!.x, this.bindP[i]!.y, this.bindP[i]!.z).multiply(inv);
    this.b.set({ bone: i, weights: null });
    return this;
  }

  /** Smooth weights (cloth). The function receives bind-space positions. */
  weights(fn: WeightFn): this {
    this.b.mat.identity();
    this.b.set({ weights: fn });
    return this;
  }

  /** Hold-pose position of a bone origin (model space). */
  holdPos(name: string): Vec {
    const e = this.holdM[this.idx(name)]!.elements;
    return [e[12]!, e[13]!, e[14]!];
  }

  /** Add an extra bone; `pHold` is given in the parent's HOLD-pose model space. */
  addBone(name: string, parent: string, pHold: Vec): number {
    const pi = this.idx(parent);
    const inv = this.holdM[pi]!.clone().invert();
    const local = new THREE.Vector3(...pHold).applyMatrix4(inv);
    const bindPos = local.clone().add(this.bindP[pi]!);
    const i = this.bones.length;
    this.bones.push({ name, parent: pi, p: [bindPos.x, bindPos.y, bindPos.z] });
    this.bone[name] = i;
    this.bindP.push(bindPos);
    // hold matrix of the child = parent hold * translation(local)
    this.holdM.push(this.holdM[pi]!.clone().multiply(new THREE.Matrix4().makeTranslation(local.x, local.y, local.z)));
    return i;
  }

  /** Set colour + fx from a 2D-kit material (metal → spec, glow → self-lit). */
  paint(m: Mat | string, o: { glow?: number; metal?: number } = {}): this {
    const mm: Mat = typeof m === 'string' ? { c: m, k: 'cloth' } : m;
    this.b.set({
      color: mm.c,
      metal: o.metal ?? (mm.k === 'metal' ? 1 : mm.k === 'glass' ? 0.7 : 0),
      glow: o.glow ?? (mm.k === 'glow' ? 1 : 0),
    });
    return this;
  }
}
