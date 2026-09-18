// SPDX-License-Identifier: MPL-2.0
/**
 * Burst: the per-triangle shatter (plan 267, lane C).
 *
 * The object breaks into its own triangles. Each one spins about its centroid, flies away
 * from the middle of the object and shrinks as it goes, so at full burst every triangle has
 * collapsed onto its centroid and covers no pixel at all. Nothing fades, so this needs no
 * transparency, and nothing is random: a triangle's flight comes from a hash of its index,
 * which gives the same picture on every device and every run.
 *
 * It is drawn as a vertex displacement on the materials the studio already uses, patched
 * through three's onBeforeCompile, plus a matching depth material so the cast shadow
 * shatters with the object instead of staying whole under it.
 *
 * Three steps, in this order:
 *   prepareShatter(asset)    once per placed subject. Every mesh gets its triangles unshared
 *                            (non-indexed) plus a centroid and a seed per vertex. Geometry is
 *                            owned by the loaded source and shared by every copy of it, so
 *                            the conversion runs once however many copies ask for it.
 *   setShatter(object, …)    per frame, on one placed copy: how far through the burst it is,
 *                            how far the pieces travel and how far they fall. Zero is inert.
 *   clearShatter(object)     puts back the materials the copy was drawn with.
 *
 * Why the patch is per copy rather than on the source's materials: applyStudioMaterials hands
 * some meshes a material the loaded source still owns (a GLB in source mode is the common
 * one), so patching what the mesh is wearing would give every copy of that source one shared
 * burst. setShatter clones the mesh's current material, patches the clone and remembers what
 * was there, which keeps two copies of one source independent and leaves the restore closure
 * in materials.ts doing exactly what it did before: it puts the source's own materials back.
 */
import * as THREE from 'three';
import type { StudioAsset } from './source.ts';

/**
 * Triangles one subject can shatter. Burst gives every triangle its own three vertices and
 * four more floats on each of them, so a quarter of a million triangles is already three
 * quarters of a million vertices and tens of megabytes of vertex data. Above this the studio
 * says why it cannot and draws the subject whole.
 */
export const MAX_SHATTER_TRIANGLES = 250_000;

/** What prepareShatter found: the triangles it counted, and why it refused, when it did. */
export interface StudioShatterReport {
  triangles: number;
  refused?: string;
}

/** The uniforms one mesh is drawn with. Distances are in that mesh's own units. */
interface ShatterUniforms {
  uBurst: { value: number };
  uSpread: { value: number };
  uLift: { value: number };
  uOrigin: { value: THREE.Vector3 };
  uDown: { value: THREE.Vector3 };
}

/** One patched mesh of one placed copy, with everything needed to put it back. */
interface MeshShatter {
  mesh: THREE.Mesh;
  /** The material the mesh wore before the burst, put back by clearShatter. */
  previous: THREE.Material | THREE.Material[];
  /** The patched copy the mesh wears now; a swap away from this means a rebuild. */
  patched: THREE.Material | THREE.Material[];
  /** The patched clones this mesh owns, disposed on clear. */
  clones: THREE.Material[];
  depth: THREE.MeshDepthMaterial;
  previousDepth: THREE.Material | undefined;
  culled: boolean;
  uniforms: ShatterUniforms;
  /** Mesh units per studio unit inside the copy, without the copy's own scale. */
  units: number;
}

interface ShatterState {
  meshes: MeshShatter[];
}

/** Prepared geometry by the geometry it was made from, so one conversion serves every copy. */
const preparedGeometry = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** One report per prepared subject, so a second prepare is free and a refusal stays refused. */
const reports = new WeakMap<StudioAsset, StudioShatterReport>();
/** The patched materials of each placed copy, by the copy's own object. */
const shatters = new WeakMap<THREE.Object3D, ShatterState>();

/** Declarations the patch adds to the vertex shader. */
const SHATTER_HEAD = `
attribute vec3 aCentroid;
attribute float aSeed;
uniform float uBurst;
uniform float uSpread;
uniform float uLift;
uniform vec3 uOrigin;
uniform vec3 uDown;
`;

/**
 * The begin_vertex replacement. At uBurst 0 the branch is skipped and `transformed` is the
 * stock `vec3( position )`, bit for bit, which is what keeps a prepared subject that is not
 * bursting identical to one that was never prepared.
 */
const SHATTER_BODY = `vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif
if ( uBurst > 0.0 ) {
	float turn = fract( aSeed * 17.0 + 0.137 ) * 6.2831853;
	float rise = fract( aSeed * 31.0 + 0.729 ) * 2.0 - 1.0;
	float ring = sqrt( max( 0.0, 1.0 - rise * rise ) );
	vec3 axis = vec3( ring * cos( turn ), rise, ring * sin( turn ) );
	float angle = aSeed * uBurst * 6.2831853;
	float spinCos = cos( angle );
	float spinSin = sin( angle );
	vec3 local = position - aCentroid;
	local = local * spinCos + cross( axis, local ) * spinSin + axis * dot( axis, local ) * ( 1.0 - spinCos );
	local *= 1.0 - uBurst;
	vec3 away = aCentroid - uOrigin;
	float reach = length( away );
	vec3 outward = reach > 1.0e-6 ? away / reach : axis;
	vec3 blend = mix( outward, axis, 0.35 );
	float blendLength = length( blend );
	vec3 flight = blendLength > 1.0e-6 ? blend / blendLength : outward;
	transformed = aCentroid + local + flight * uBurst * uSpread + uDown * ( uBurst * uBurst * uLift );
}`;

/** Keeps the patched programs apart from the unpatched ones in three's program cache. */
const SHATTER_CACHE_KEY = 'studio-shatter-v1';

/**
 * A triangle's seed, in [0, 1): the lowbias32 integer hash of its index. All three vertices
 * of a triangle take the same value, and the same index gives the same value everywhere.
 */
function triangleSeed(index: number): number {
  let h = (index + 1) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** The triangles a geometry draws, indexed or not. */
function triangleCount(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  return Math.floor((geometry.index?.count ?? position?.count ?? 0) / 3);
}

/**
 * The prepared form of one geometry: unshared triangles carrying `aCentroid` and `aSeed`.
 * Converting does not change what is drawn. toNonIndexed keeps the triangle order, the
 * groups and every attribute value, so the same triangles are rasterised in the same order.
 */
function prepareGeometry(original: THREE.BufferGeometry): THREE.BufferGeometry {
  const done = preparedGeometry.get(original);
  if (done) return done;
  if (original.getAttribute('aCentroid')) return original;
  const geometry = original.index ? original.toNonIndexed() : original;
  const position = geometry.getAttribute('position');
  const count = position.count;
  const centroids = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i + 2 < count; i += 3) {
    const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
    const y = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
    const seed = triangleSeed(i / 3);
    for (let v = i; v < i + 3; v++) {
      centroids[v * 3] = x;
      centroids[v * 3 + 1] = y;
      centroids[v * 3 + 2] = z;
      seeds[v] = seed;
    }
  }
  // A stray vertex past the last whole triangle stays where it is: its centroid is itself.
  for (let v = count - (count % 3); v < count; v++) {
    centroids[v * 3] = position.getX(v);
    centroids[v * 3 + 1] = position.getY(v);
    centroids[v * 3 + 2] = position.getZ(v);
  }
  geometry.setAttribute('aCentroid', new THREE.BufferAttribute(centroids, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  preparedGeometry.set(original, geometry);
  return geometry;
}

/** Every mesh under a copy, with the matrix that takes it into the copy's own space. */
function placedMeshes(root: THREE.Object3D): { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] {
  const found: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] = [];
  const walk = (node: THREE.Object3D, parent: THREE.Matrix4): void => {
    if (node.matrixAutoUpdate) node.updateMatrix();
    const matrix = new THREE.Matrix4().multiplyMatrices(parent, node.matrix);
    if (node instanceof THREE.Mesh) found.push({ mesh: node, matrix });
    for (const child of node.children) walk(child, matrix);
  };
  for (const child of root.children) walk(child, new THREE.Matrix4());
  return found;
}

/** One number for a three-axis scale, so a spread in studio units becomes mesh units. */
function meanScale(scale: THREE.Vector3): number {
  const volume = Math.abs(scale.x * scale.y * scale.z);
  return volume > 0 ? Math.cbrt(volume) : 1;
}

/** The prepared geometry this mesh should draw with, or null when it has none. */
function preparedFor(mesh: THREE.Mesh): THREE.BufferGeometry | null {
  if (mesh.geometry.getAttribute('aCentroid')) return mesh.geometry;
  return preparedGeometry.get(mesh.geometry) ?? null;
}

/** Give one material the burst patch and its own view of the uniforms. */
function patchMaterial(material: THREE.Material, uniforms: ShatterUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurst = uniforms.uBurst;
    shader.uniforms.uSpread = uniforms.uSpread;
    shader.uniforms.uLift = uniforms.uLift;
    shader.uniforms.uOrigin = uniforms.uOrigin;
    shader.uniforms.uDown = uniforms.uDown;
    shader.vertexShader =
      SHATTER_HEAD + shader.vertexShader.replace('#include <begin_vertex>', SHATTER_BODY);
  };
  material.customProgramCacheKey = () => SHATTER_CACHE_KEY;
  material.needsUpdate = true;
}

/**
 * Ready one placed subject to shatter, once. Every mesh gets unshared triangles and two
 * attributes: `aCentroid`, the centroid of the vertex's own triangle, and `aSeed`, a hash of
 * the triangle index that all three of its vertices share. The converted geometry replaces
 * the original on the mesh, and because the loaded source owns its geometry and every copy
 * shares it, one conversion serves them all.
 *
 * Over the triangle budget nothing is touched and the report says why in one sentence.
 */
export function prepareShatter(asset: StudioAsset): StudioShatterReport {
  const cached = reports.get(asset);
  if (cached) return cached;
  const meshes = placedMeshes(asset.object).map((placed) => placed.mesh);
  let triangles = 0;
  for (const mesh of meshes) triangles += triangleCount(preparedFor(mesh) ?? mesh.geometry);
  if (triangles > MAX_SHATTER_TRIANGLES) {
    const refused =
      'Burst gives every triangle a flight of its own, and this object has ' +
      `${triangles.toLocaleString('en')} of them, more than the ` +
      `${MAX_SHATTER_TRIANGLES.toLocaleString('en')} the studio can shatter. ` +
      'Simplify the model, or choose another motion.';
    const report = { triangles, refused };
    reports.set(asset, report);
    return report;
  }
  for (const mesh of meshes) mesh.geometry = prepareGeometry(mesh.geometry);
  const report = { triangles };
  reports.set(asset, report);
  return report;
}

/**
 * Put one placed copy back together and let go of the patched materials. A mesh that has
 * been given a different material since (a materials edit does that) keeps the one it has:
 * the patched clone is disposed and nothing stale is written back.
 */
function release(state: ShatterState): void {
  for (const record of state.meshes) {
    if (record.mesh.material === record.patched) record.mesh.material = record.previous;
    if (record.mesh.customDepthMaterial === record.depth)
      record.mesh.customDepthMaterial = record.previousDepth;
    record.mesh.frustumCulled = record.culled;
    for (const clone of record.clones) clone.dispose();
    record.depth.dispose();
  }
  state.meshes = [];
}

/**
 * True when the patched materials are still the ones on the copy. A materials edit runs the
 * restore closure and applies a fresh set, which leaves the copy in unpatched materials, so
 * the next frame rebuilds rather than writing uniforms nobody reads.
 */
function intact(object: THREE.Object3D, state: ShatterState): boolean {
  const meshes = placedMeshes(object)
    .map((placed) => placed.mesh)
    .filter((mesh) => preparedFor(mesh));
  if (meshes.length !== state.meshes.length) return false;
  return state.meshes.every(
    (record, i) => meshes[i] === record.mesh && record.mesh.material === record.patched
  );
}

/** Patch every prepared mesh of one placed copy and remember what it wore. */
function install(object: THREE.Object3D): ShatterState {
  const placed = placedMeshes(object).filter(({ mesh }) => preparedFor(mesh));
  const box = new THREE.Box3();
  for (const { mesh, matrix } of placed) {
    mesh.geometry = preparedFor(mesh)!;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));
  }
  // Pieces fly away from the middle of the whole copy, not from each mesh's own origin,
  // which for extruded artwork is a corner of the drawing rather than its centre.
  const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const meshes: MeshShatter[] = [];
  for (const { mesh, matrix } of placed) {
    const inverse = matrix.clone().invert();
    const uniforms: ShatterUniforms = {
      uBurst: { value: 0 },
      uSpread: { value: 0 },
      uLift: { value: 0 },
      uOrigin: { value: centre.clone().applyMatrix4(inverse) },
      // Down in the copy's own frame, read in mesh units. Extruded artwork is drawn with a
      // flipped y, so the way down is not the same axis direction in every mesh.
      uDown: { value: new THREE.Vector3(0, -1, 0).transformDirection(inverse) },
    };
    const clones = new Map<THREE.Material, THREE.Material>();
    const patch = (material: THREE.Material): THREE.Material => {
      const made = clones.get(material);
      if (made) return made;
      const copy = material.clone();
      patchMaterial(copy, uniforms);
      clones.set(material, copy);
      return copy;
    };
    const previous = mesh.material;
    const patched = Array.isArray(previous) ? previous.map(patch) : patch(previous);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchMaterial(depth, uniforms);
    meshes.push({
      mesh,
      previous,
      patched,
      clones: [...clones.values()],
      depth,
      previousDepth: mesh.customDepthMaterial,
      culled: mesh.frustumCulled,
      uniforms,
      units: meanScale(new THREE.Vector3().setFromMatrixScale(matrix)),
    });
    mesh.material = patched;
    // three's shadow pass draws a caster with its own depth material when it has one, so
    // the shadow takes the same displacement as the frame.
    mesh.customDepthMaterial = depth;
    // Pieces leave the bounds the geometry describes, and culling is measured on those
    // bounds, so a bursting mesh near the edge of the frame or of the shadow camera would
    // otherwise be dropped whole.
    mesh.frustumCulled = false;
  }
  return { meshes };
}

/** A distance a shader can use: never a NaN, never below zero. */
function safe(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Set the burst on one placed copy. `amount` runs 0 to 1, from whole to gone; `spread` is how
 * far a piece travels at full burst and `lift` how far it falls, both in studio units. The
 * first call patches the copy's materials; later calls only write uniforms, the depth
 * materials among them, because those read the same uniform objects.
 */
export function setShatter(
  object: THREE.Object3D,
  amount: number,
  spread: number,
  lift: number
): void {
  let state = shatters.get(object);
  if (state && !intact(object, state)) {
    release(state);
    shatters.delete(object);
    state = undefined;
  }
  if (!state) {
    state = install(object);
    shatters.set(object, state);
  }
  const burst = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
  const copyScale = meanScale(object.scale);
  for (const record of state.meshes) {
    const unit = Math.max(1e-9, record.units * copyScale);
    record.uniforms.uBurst.value = burst;
    record.uniforms.uSpread.value = safe(spread) / unit;
    record.uniforms.uLift.value = safe(lift) / unit;
  }
}

/**
 * Put one placed copy back to the materials it was drawn with and take its depth material
 * away. The prepared geometry stays: it draws the same picture as the geometry it was made
 * from, and it belongs to the loaded source, which every copy of that source shares.
 */
export function clearShatter(object: THREE.Object3D): void {
  const state = shatters.get(object);
  if (!state) return;
  release(state);
  shatters.delete(object);
}
