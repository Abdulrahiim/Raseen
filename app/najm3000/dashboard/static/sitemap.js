import * as THREE from '/static/vendor/three.module.js';
import { GLTFLoader } from '/static/vendor/GLTFLoader.js';

const TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION =
  'Imagery &copy; Esri, Maxar, Earthstar Geographics | Markers &amp; 3D: simulated values';

const SHOW_3D_FROM_ZOOM = 14.2;
const BLOCK_FIELD_M = 240;
const ROW_PITCH_M = 7.0;
const ROW_WIDTH_M = 2.4;
const PANEL_HEIGHT_M = 2.2;
const SKID_LENGTH_M = 30;

const state = {
  map: null,
  site: null,
  ready: false,
  onSelect: null,
  three: null,
  rows: null,
  skids: [],
  blockOrder: [],
  positions: new Map(),
  lastBlocks: [],
  lastMode: 'output',
  tooltip: null,
};

const severityHex = { critical: 0xd03b3b, serious: 0xec835a, warning: 0xfab219 };

function outputHex(fraction) {
  const steps = [0x24344d, 0x2a4a75, 0x2f5f9e, 0x3576c8, 0x3987e5, 0x6aa8ee];
  return steps[
    Math.min(steps.length - 1, Math.max(0, Math.round(fraction * (steps.length - 1))))
  ];
}

function deviationHex(deviation) {
  if (deviation === null || deviation === undefined) return 0x8a8a86;
  if (deviation <= -5) return 0xd03b3b;
  if (deviation <= -3) return 0xec835a;
  if (deviation <= -1.5) return 0xfab219;
  return 0x0ca30c;
}

export function isMapReady() {
  return state.ready;
}

function blockId(n) {
  return `BLK_${String(n).padStart(4, '0')}`;
}

/* ── the Three.js custom layer ────────────────────────────────────────── */

function buildThreeLayer(site) {
  const centre = maplibregl.MercatorCoordinate.fromLngLat(
    [
      (site.bounds.west + site.bounds.east) / 2,
      (site.bounds.south + site.bounds.north) / 2,
    ],
    0,
  );
  const metre = centre.meterInMercatorCoordinateUnits();

  const localOf = (lon, lat) => {
    const m = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);
    return {
      x: (m.x - centre.x) / metre,
      z: (m.y - centre.y) / metre,
    };
  };

  return {
    id: 'stations-3d',
    type: 'custom',
    renderingMode: '3d',

    onAdd(map, gl) {
      const scene = new THREE.Scene();
      const camera = new THREE.Camera();

      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8);
      sun.position.set(300, 600, 200);
      scene.add(sun);

      // Field dimensions per block, from the KML linework assigned to it.
      // Blocks whose hull collapsed (sparse CAD) fall back to the median.
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const dims = new Map(
        (site.blocks ?? []).map((b) => [
          b.n,
          {
            w: clamp(b.w > 20 ? b.w : BLOCK_FIELD_M, 80, 520),
            h: clamp(b.h > 20 ? b.h : BLOCK_FIELD_M, 80, 300),
          },
        ]),
      );

      const plan = site.mvps.map((point) => {
        const d = dims.get(point.n) ?? { w: BLOCK_FIELD_M, h: BLOCK_FIELD_M };
        return { point, d, rows: Math.max(4, Math.floor(d.w / ROW_PITCH_M)) };
      });
      const count = plan.reduce((sum, p) => sum + p.rows, 0);

      const rowGeometry = new THREE.BoxGeometry(
        ROW_WIDTH_M,
        0.12,
        BLOCK_FIELD_M,
      );
      rowGeometry.rotateX(THREE.MathUtils.degToRad(-12));
      const rowMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.35,
        roughness: 0.45,
      });
      const rows = new THREE.InstancedMesh(rowGeometry, rowMaterial, count);
      rows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const dummy = new THREE.Object3D();
      const ranges = [];
      let cursor = 0;
      for (const { point, d, rows: rowCount } of plan) {
        const local = localOf(point.lon, point.lat);
        state.positions.set(blockId(point.n), local);
        state.blockOrder.push(blockId(point.n));
        ranges.push({ start: cursor, count: rowCount });
        for (let r = 0; r < rowCount; r += 1) {
          const offsetX = (r - (rowCount - 1) / 2) * ROW_PITCH_M;
          dummy.position.set(local.x + offsetX, PANEL_HEIGHT_M / 2, local.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, d.h / BLOCK_FIELD_M);
          dummy.updateMatrix();
          rows.setMatrixAt(cursor, dummy.matrix);
          rows.setColorAt(cursor, new THREE.Color(0x2a4a75));
          cursor += 1;
        }
      }
      rows.instanceMatrix.needsUpdate = true;
      scene.add(rows);
      state.rows = { mesh: rows, ranges };

      new GLTFLoader().load('/static/models/skid_unit.glb', (gltf) => {
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const scale = SKID_LENGTH_M / Math.max(size.x, size.z, 1);
        const centreOffset = box.getCenter(new THREE.Vector3());

        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          child.updateWorldMatrix(true, false);
          const geometry = child.geometry.clone();
          geometry.applyMatrix4(child.matrixWorld);
          geometry.translate(-centreOffset.x, -box.min.y, -centreOffset.z);
          geometry.scale(scale, scale, scale);
          const instanced = new THREE.InstancedMesh(
            geometry,
            child.material.clone(),
            site.mvps.length,
          );
          site.mvps.forEach((point, index) => {
            const local = state.positions.get(blockId(point.n));
            dummy.position.set(local.x, 0, local.z + BLOCK_FIELD_M / 2 + 12);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            instanced.setMatrixAt(index, dummy.matrix);
          });
          instanced.instanceMatrix.needsUpdate = true;
          scene.add(instanced);
          state.skids.push(instanced);
        });
        applyColours(state.lastBlocks, state.lastMode);
      });

      state.three = {
        scene,
        camera,
        renderer: new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true,
        }),
        centre,
        metre,
      };
      state.three.renderer.autoClear = false;
    },

    render(gl, matrix) {
      if (!state.three || state.map.getZoom() < SHOW_3D_FROM_ZOOM) return;
      const { scene, camera, renderer, centre, metre } = state.three;
      const rotation = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 0, 0),
        Math.PI / 2,
      );
      const local = new THREE.Matrix4()
        .makeTranslation(centre.x, centre.y, centre.z)
        .scale(new THREE.Vector3(metre, -metre, metre))
        .multiply(rotation);
      camera.projectionMatrix = new THREE.Matrix4()
        .fromArray(matrix)
        .multiply(local);
      renderer.resetState();
      renderer.render(scene, camera);
      state.map.triggerRepaint();
    },
  };
}

function applyColours(blocks, mode) {
  state.lastBlocks = blocks;
  state.lastMode = mode;
  if (!state.rows || !blocks.length) return;

  const peak = Math.max(...blocks.map((b) => b.ac_power_w), 1);
  const byId = new Map(blocks.map((b) => [b.block_id, b]));
  const colour = new THREE.Color();

  state.blockOrder.forEach((id, blockIndex) => {
    const block = byId.get(id);
    let hex = 0x2a4a75;
    if (block) {
      if (block.fault_severity) hex = severityHex[block.fault_severity] ?? hex;
      else if (mode === 'deviation') hex = deviationHex(block.deviation_percent);
      else hex = outputHex(Math.max(0, block.ac_power_w) / peak);
    }
    colour.setHex(hex);
    const range = state.rows.ranges[blockIndex];
    for (let r = 0; r < range.count; r += 1) {
      state.rows.mesh.setColorAt(range.start + r, colour);
    }
  });
  if (state.rows.mesh.instanceColor) state.rows.mesh.instanceColor.needsUpdate = true;
}

/* ── public surface (same as the Leaflet version) ─────────────────────── */

export async function initSiteMap(mountId, onSelect) {
  if (state.ready) return true;
  if (typeof maplibregl === 'undefined') return false;
  state.onSelect = onSelect;

  let site;
  try {
    site = await (await fetch('/static/models/site.json')).json();
  } catch (error) {
    return false;
  }
  state.site = site;

  state.map = new maplibregl.Map({
    container: mountId,
    style: {
      version: 8,
      sources: {
        esri: {
          type: 'raster',
          tiles: [TILE_URL],
          tileSize: 256,
          attribution: ATTRIBUTION,
          maxzoom: 18,
        },
      },
      layers: [{ id: 'imagery', type: 'raster', source: 'esri' }],
    },
    center: [
      (site.bounds.west + site.bounds.east) / 2,
      (site.bounds.south + site.bounds.north) / 2,
    ],
    zoom: 12,
    pitch: 0,
    maxPitch: 70,
    attributionControl: { compact: false },
  });
  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));

  await new Promise((resolve) => {
    if (state.map.isStyleLoaded()) { resolve(); return; }
    state.map.once('style.load', resolve);
    setTimeout(resolve, 8000);
  });

  state.map.addSource('mvps', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: site.mvps.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { block_id: blockId(p.n), n: p.n, colour: '#8fbaea', ring: '#10131a' },
      })),
    },
  });
  state.map.addLayer({
    id: 'mvps-circles',
    type: 'circle',
    source: 'mvps',
    maxzoom: 13.2,
    paint: {
      'circle-radius': 5,
      'circle-color': ['get', 'colour'],
      'circle-stroke-color': ['get', 'ring'],
      'circle-stroke-width': 1.5,
    },
  });

  state.map.addSource('outline', {
    type: 'geojson',
    promoteId: 'b',
    data: {
      type: 'FeatureCollection',
      features: site.lines.map((line, index) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: line.pts.map(([lat, lon]) => [lon, lat]),
        },
        properties: { b: line.b ?? -1 - index },
      })),
    },
  });

  state.map.addLayer({
    id: 'block-glow',
    type: 'line',
    source: 'outline',
    paint: {
      'line-color': ['coalesce', ['feature-state', 'colour'], '#ffffff'],
      'line-width': 11,
      'line-blur': 7,
      'line-opacity': ['coalesce', ['feature-state', 'glow'], 0],
    },
  });
  state.map.addLayer({
    id: 'outline-lines',
    type: 'line',
    source: 'outline',
    paint: {
      'line-color': ['coalesce', ['feature-state', 'colour'], '#ffffff'],
      'line-opacity': 0.75,
      'line-width': 1.1,
    },
  });

  for (const zone of site.zones) {
    const el = document.createElement('div');
    el.className = 'zone-label';
    el.textContent = zone.name;
    new maplibregl.Marker({ element: el }).setLngLat([zone.lon, zone.lat]).addTo(state.map);
  }

  state.map.addLayer(buildThreeLayer(site));

  state.tooltip = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
  });

  state.map.on('mousemove', 'mvps-circles', (event) => {
    state.map.getCanvas().style.cursor = 'pointer';
    const feature = event.features[0];
    state.tooltip
      .setLngLat(event.lngLat)
      .setHTML(`<b>MVPS ${String(feature.properties.n).padStart(4, '0')}</b>`)
      .addTo(state.map);
  });
  state.map.on('mouseleave', 'mvps-circles', () => {
    state.map.getCanvas().style.cursor = '';
    state.tooltip.remove();
  });

  state.map.on('click', (event) => {
    const nearest = nearestBlock(event.lngLat);
    if (nearest) state.onSelect(nearest);
  });

  state.ready = true;
  window.__siteMap = state.map;
  return true;
}

function nearestBlock(lngLat) {
  let best = null;
  let bestDistance = Infinity;
  for (const point of state.site.mvps) {
    const dx = (point.lon - lngLat.lng) * 111320 * Math.cos((point.lat * Math.PI) / 180);
    const dy = (point.lat - lngLat.lat) * 111320;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = blockId(point.n);
    }
  }
  return bestDistance < 400 ? best : null;
}

let glowTimer = null;

function setLineStates(blocks, mode) {
  const peak = Math.max(...blocks.map((b) => b.ac_power_w), 1);
  let anyGlow = false;
  for (const block of blocks) {
    const n = Number(block.block_id.replace('BLK_', ''));
    let colour = '#ffffff';
    let glow = 0;
    if (block.fault_severity) {
      colour = `#${(severityHex[block.fault_severity] ?? 0xfab219)
        .toString(16).padStart(6, '0')}`;
      glow = 0.85;
      anyGlow = true;
    } else if (mode === 'deviation') {
      colour = `#${deviationHex(block.deviation_percent).toString(16).padStart(6, '0')}`;
    } else {
      colour = `#${outputHex(Math.max(0, block.ac_power_w) / peak)
        .toString(16).padStart(6, '0')}`;
    }
    state.map.setFeatureState({ source: 'outline', id: n }, { colour, glow });
  }

  if (anyGlow && !glowTimer) {
    let tick = 0;
    glowTimer = setInterval(() => {
      tick += 1;
      const pulse = 0.5 + 0.45 * Math.sin(tick / 3.2);
      if (state.map.getLayer('block-glow')) {
        state.map.setPaintProperty('block-glow', 'line-opacity', [
          '*',
          ['coalesce', ['feature-state', 'glow'], 0],
          pulse,
        ]);
      }
    }, 120);
  } else if (!anyGlow && glowTimer) {
    clearInterval(glowTimer);
    glowTimer = null;
  }
}

export function updateSiteMap(blocks, mode) {
  if (!state.ready) return;
  setLineStates(blocks, mode);

  const peak = Math.max(...blocks.map((b) => b.ac_power_w), 1);
  const source = state.map.getSource('mvps');
  if (source) {
    source.setData({
      type: 'FeatureCollection',
      features: state.site.mvps.map((p) => {
        const block = blocks.find((b) => b.block_id === blockId(p.n));
        let colour = '#8fbaea';
        let ring = '#10131a';
        if (block) {
          colour =
            mode === 'deviation'
              ? `#${deviationHex(block.deviation_percent).toString(16).padStart(6, '0')}`
              : `#${outputHex(Math.max(0, block.ac_power_w) / peak).toString(16).padStart(6, '0')}`;
          if (block.fault_severity) {
            ring = `#${(severityHex[block.fault_severity] ?? 0).toString(16).padStart(6, '0')}`;
          }
        }
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { block_id: blockId(p.n), n: p.n, colour, ring },
        };
      }),
    });
  }
  applyColours(blocks, mode);
}

export function focusSiteBlock(blockId_) {
  if (!state.ready) return;
  const n = Number(blockId_.replace('BLK_', ''));
  const point = state.site.mvps.find((p) => p.n === n);
  if (!point) return;
  state.map.flyTo({
    center: [point.lon, point.lat],
    zoom: Math.max(state.map.getZoom(), 15.2),
    pitch: 55,
    duration: 2200,
    essential: true,
  });
}

export function invalidateMapSize() {
  if (state.map) state.map.resize();
}
