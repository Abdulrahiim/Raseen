import * as THREE from '/static/vendor/three.module.js';
import { GLTFLoader } from '/static/vendor/GLTFLoader.js';
import { OrbitControls } from '/static/vendor/OrbitControls.js';

const TAG = 'NAJM_';

const SEVERITY_COLOUR = {
  critical: 0xd03b3b,
  serious: 0xec835a,
  warning: 0xfab219,
};

const state = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  root: null,
  meshesByGroup: new Map(),
  parts: [],
  loadedFile: null,
  faultKeys: null,
  clock: 0,
  pulsing: new Set(),
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  onSelect: null,
  onStatus: () => {},
};

function surface() {
  const dark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? 0x14171c : 0xeef0f3;
}

export function isReady() {
  return Boolean(state.renderer);
}

export function initModelViewer(mount, onSelect, onStatus) {
  state.onSelect = onSelect;
  state.onStatus = onStatus ?? (() => {});

  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) {
    state.onStatus('error', 'WebGL unavailable in this browser.');
    return false;
  }

  const width = mount.clientWidth || 640;
  const height = mount.clientHeight || 460;

  try {
    state.renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (error) {
    state.onStatus('error', `WebGL unavailable: ${error.message}`);
    return false;
  }

  state.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  state.renderer.setSize(width, height);
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.replaceChildren(state.renderer.domElement);

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(surface());

  state.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 40000);
  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;

  state.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4a55, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(600, 900, 600);
  state.scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-500, 300, -400);
  state.scene.add(fill);

  state.renderer.domElement.addEventListener('pointerdown', handlePointer);
  new ResizeObserver(() => resize(mount)).observe(mount);

  animate();
  return true;
}

function resize(mount) {
  if (!state.renderer) return;
  const width = mount.clientWidth || 640;
  const height = mount.clientHeight || 460;
  state.renderer.setSize(width, height);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (!state.renderer) return;
  if (state.pulsing.size) {
    state.clock += 0.045;
    const glow = 0.5 + 0.4 * Math.sin(state.clock);
    for (const material of state.pulsing) material.emissiveIntensity = glow;
  }
  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}

function handlePointer(event) {
  if (!state.root) return;
  const rect = state.renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.setFromCamera(state.pointer, state.camera);
  for (const hit of state.raycaster.intersectObject(state.root, true)) {
    const tag = hit.object.userData.groupTag;
    if (tag && state.onSelect) {
      state.onSelect(tag);
      return;
    }
  }
}

function materialsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

export async function loadModel(file, parts) {
  if (!state.renderer || !file) return;
  state.parts = parts;

  if (state.loadedFile === file) {
    applyFaults(parts, true);
    return;
  }

  state.onStatus('loading', 'Loading station model…');

  try {
    const gltf = await new GLTFLoader().loadAsync(file);
    if (state.root) state.scene.remove(state.root);
    state.root = gltf.scene;
    state.meshesByGroup.clear();

    state.root.traverse((child) => {
      if (!child.isMesh) return;
      child.material = Array.isArray(child.material)
        ? child.material.map((m) => m.clone())
        : child.material.clone();

      for (const material of materialsOf(child)) {
        const name = material.name ?? '';
        if (!name.startsWith(TAG)) continue;
        const tag = name.slice(TAG.length).replace(/_mesh$/, '');
        child.userData.groupTag = tag;
        if (!state.meshesByGroup.has(tag)) state.meshesByGroup.set(tag, []);
        state.meshesByGroup.get(tag).push(child);
      }
      child.userData.baseColors = materialsOf(child).map((m) => m.color.clone());
    });

    state.scene.add(state.root);
    state.loadedFile = file;
    state.faultKeys = null;
    frameAll();
    applyFaults(parts, true);
    state.onStatus(
      'ok',
      `${state.meshesByGroup.size} monitored assets in view`,
    );
  } catch (error) {
    state.onStatus('error', `Model failed to load: ${error.message}`);
  }
}

export function applyFaults(parts, force = false) {
  if (!state.root) return;
  state.parts = parts;
  const signature = parts
    .map((p) => `${p.key}:${p.fault ? p.fault.severity : 0}`)
    .join();
  if (!force && signature === state.faultKeys) return;
  state.faultKeys = signature;
  state.pulsing.clear();

  for (const part of parts) {
    const meshes = state.meshesByGroup.get(part.key) ?? [];
    const colour = part.fault
      ? SEVERITY_COLOUR[part.fault.severity] ?? SEVERITY_COLOUR.warning
      : null;

    for (const mesh of meshes) {
      materialsOf(mesh).forEach((material, index) => {
        if (colour === null) {
          const base = mesh.userData.baseColors?.[index];
          if (base) material.color.copy(base);
          material.emissive?.setHex(0x000000);
          material.emissiveIntensity = 0;
        } else {
          material.color.setHex(colour);
          material.emissive?.setHex(colour);
          material.emissiveIntensity = 0.6;
          state.pulsing.add(material);
        }
      });
    }
  }

  const faulted = parts.find((p) => p.fault);
  if (faulted) focusGroup(faulted.key);
}

function frameBounds(box) {
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 1) * 0.85;
  state.controls.target.copy(centre);
  state.camera.position.set(
    centre.x + radius,
    centre.y + radius * 0.8,
    centre.z + radius,
  );
  state.camera.near = Math.max(radius / 800, 0.05);
  state.camera.far = radius * 80;
  state.camera.updateProjectionMatrix();
  state.controls.update();
}

export function frameAll() {
  if (!state.root) return;
  frameBounds(new THREE.Box3().setFromObject(state.root));
}

export function focusGroup(tag) {
  const meshes = state.meshesByGroup.get(tag);
  if (!meshes || !meshes.length) return;
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  frameBounds(box);
}

export function refreshTheme() {
  if (state.scene) state.scene.background = new THREE.Color(surface());
}
