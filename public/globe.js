import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_TEXTURES = [
  {
    url: 'https://upload.wikimedia.org/wikipedia/commons/4/4d/Whole_world_-_land_and_oceans.jpg',
    minTextureSize: 8192,
    timeoutMs: 14000,
    label: '8K NASA Blue Marble',
  },
  {
    url: 'https://threejs.org/examples/textures/planets/earth_day_4096.jpg',
    minTextureSize: 4096,
    timeoutMs: 8000,
    label: '4K Earth',
  },
  {
    url: 'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
    minTextureSize: 2048,
    timeoutMs: 6000,
    label: '2K Earth',
  },
];

const EARTH_RADIUS = 1;
const SURFACE_EPSILON = 0.0022;
const DEFAULT_CAMERA_DISTANCE = 2.65;
const MIN_CAMERA_DISTANCE = 1.085;
const MAX_CAMERA_DISTANCE = 4.2;

const COLORS = {
  self: 0x34d399,
  opponent: 0x60a5fa,
  target: 0xfbbf24,
  pending: 0x34d399,
  submitted: 0x60a5fa,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLng(lng) {
  let value = lng;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

export function latLngToVector3(lat, lng, radius = 1) {
  const latRad = THREE.MathUtils.degToRad(clamp(Number(lat) || 0, -90, 90));
  const lngRad = THREE.MathUtils.degToRad(normalizeLng(Number(lng) || 0));
  const cosLat = Math.cos(latRad);
  return new THREE.Vector3(
    radius * cosLat * Math.cos(lngRad),
    radius * Math.sin(latRad),
    -radius * cosLat * Math.sin(lngRad),
  );
}

export function vector3ToLatLng(vector) {
  const v = vector.clone().normalize();
  return {
    lat: THREE.MathUtils.radToDeg(Math.asin(clamp(v.y, -1, 1))),
    lng: normalizeLng(THREE.MathUtils.radToDeg(Math.atan2(-v.z, v.x))),
  };
}

function disposeObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}

async function loadFirstTexture(renderer) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const maxTextureSize = renderer.capabilities.maxTextureSize || 4096;
  const candidates = EARTH_TEXTURES.filter((candidate) => candidate.minTextureSize <= maxTextureSize);
  const fallbackCandidates = candidates.length ? candidates : [EARTH_TEXTURES[EARTH_TEXTURES.length - 1]];

  for (const candidate of fallbackCandidates) {
    try {
      const texture = await Promise.race([
        loader.loadAsync(candidate.url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('texture timeout')), candidate.timeoutMs)),
      ]);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      texture.userData.sourceLabel = candidate.label;
      return texture;
    } catch {
      // Try the next resolution. The globe still works with a fallback material.
    }
  }
  return null;
}

export class GlobeController {
  constructor(container, { onSelect, statusElement } = {}) {
    this.container = container;
    this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
    this.statusElement = statusElement || null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.earth = null;
    this.markerGroup = null;
    this.guessMarkerGroup = null;
    this.resultGroup = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerStart = null;
    this.pointerMoved = false;
    this.selectionSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), EARTH_RADIUS);
    this.hitPoint = new THREE.Vector3();
    this.markerWorldPosition = new THREE.Vector3();
    this.resizeObserver = null;
    this.animationFrame = null;
    this.cameraTween = null;
    this.effects = [];
    this.destroyed = false;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return this;
    this.initialized = true;
    this.setStatus('3D-Globus wird geladen…');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01040a);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.004, 100);
    this.camera.position.copy(latLngToVector3(18, -18, DEFAULT_CAMERA_DISTANCE));

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.setAttribute('aria-label', '3D-Erde. Ziehen zum Drehen, scrollen oder mit zwei Fingern zoomen, antippen zum Setzen des Tipps.');
    this.container.prepend(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = MIN_CAMERA_DISTANCE;
    this.controls.maxDistance = MAX_CAMERA_DISTANCE;
    this.controls.rotateSpeed = 0.46;
    this.controls.zoomSpeed = 0.85;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xbad7ff, 0x07111c, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(3.5, 2.2, 4.5);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x5ea8ff, 0.7);
    rim.position.set(-4, 0.3, -3);
    this.scene.add(rim);

    this.addStars();

    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 256, 160);
    const earthMaterial = new THREE.MeshPhongMaterial({
      color: 0x164e63,
      shininess: 7,
      specular: new THREE.Color(0x1b3445),
    });
    this.earth = new THREE.Mesh(earthGeometry, earthMaterial);
    this.scene.add(this.earth);

    this.addAtmosphere();
    this.markerGroup = new THREE.Group();
    this.guessMarkerGroup = new THREE.Group();
    this.resultGroup = new THREE.Group();
    this.markerGroup.add(this.guessMarkerGroup, this.resultGroup);
    this.scene.add(this.markerGroup);

    this.bindPointerSelection();
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', () => this.resize(), { passive: true });
    }
    this.resize();
    this.startRenderLoop();

    loadFirstTexture(this.renderer).then((texture) => {
      if (this.destroyed) {
        texture?.dispose?.();
        return;
      }
      if (texture) {
        earthMaterial.map = texture;
        earthMaterial.color.setHex(0xffffff);
        earthMaterial.needsUpdate = true;
        this.setStatus(texture.userData.sourceLabel ? `${texture.userData.sourceLabel} geladen` : '');
        setTimeout(() => this.setStatus(''), 900);
      } else {
        this.setStatus('Erdtextur konnte nicht geladen werden – 3D-Auswahl bleibt aktiv.');
        setTimeout(() => this.setStatus(''), 3500);
      }
    });
    return this;
  }

  setStatus(message) {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.classList.toggle('hidden', !message);
  }

  addStars() {
    const positions = [];
    for (let i = 0; i < 1100; i += 1) {
      const radius = 8 + Math.random() * 22;
      const theta = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const xy = Math.sqrt(1 - z * z);
      positions.push(
        radius * xy * Math.cos(theta),
        radius * z,
        radius * xy * Math.sin(theta),
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.018,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.scene.add(new THREE.Points(geometry, material));
  }

  addAtmosphere() {
    const geometry = new THREE.SphereGeometry(1.035, 80, 48);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(max(0.0, 0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.2);
          gl_FragColor = vec4(0.20, 0.58, 1.0, 1.0) * intensity * 0.55;
        }
      `,
    });
    this.scene.add(new THREE.Mesh(geometry, material));
  }

  bindPointerSelection() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
      this.pointerMoved = false;
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointerStart) return;
      const distance = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
      if (distance > 7) this.pointerMoved = true;
    });
    canvas.addEventListener('pointercancel', () => {
      this.pointerStart = null;
      this.pointerMoved = false;
    });
    canvas.addEventListener('pointerup', (event) => {
      const wasTap = this.pointerStart && !this.pointerMoved;
      this.pointerStart = null;
      this.pointerMoved = false;
      if (!wasTap || !this.earth) return;

      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);

      // Intersect the mathematical sphere directly instead of the rendered triangle mesh.
      // This makes the selected latitude/longitude independent of mesh tessellation and exact
      // down to floating-point precision.
      const hit = this.raycaster.ray.intersectSphere(this.selectionSphere, this.hitPoint);
      if (!hit) return;
      this.onSelect(vector3ToLatLng(hit));
    });
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.container.clientWidth || 800);
    const height = Math.max(1, this.container.clientHeight || 600);
    const deviceRatio = window.devicePixelRatio || 1;
    const pixelBudget = 6_000_000;
    const budgetRatio = Math.sqrt(pixelBudget / Math.max(1, width * height));
    const pixelRatio = Math.max(1, Math.min(deviceRatio, 2.75, budgetRatio));

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  startRenderLoop() {
    const render = () => {
      if (this.destroyed) return;
      this.updateCameraTween();
      this.controls?.update();
      this.updateMarkerScales();
      this.updateEffects();
      if (this.container.offsetParent !== null && this.container.clientWidth > 0 && this.container.clientHeight > 0) {
        this.renderer.render(this.scene, this.camera);
      }
      this.animationFrame = requestAnimationFrame(render);
    };
    render();
  }

  updateMarkerScales() {
    if (!this.markerGroup || !this.camera || !this.renderer) return;
    const canvasHeight = Math.max(1, this.renderer.domElement.clientHeight || this.container.clientHeight || 600);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const perspectiveFactor = 2 * Math.tan(halfFov) / canvasHeight;

    this.markerGroup.traverse((object) => {
      if (!object.userData?.isPrecisionMarker) return;
      object.getWorldPosition(this.markerWorldPosition);
      const distance = Math.max(0.01, this.camera.position.distanceTo(this.markerWorldPosition));
      const worldRadius = distance * perspectiveFactor * object.userData.screenRadiusPx;
      object.scale.set(worldRadius, worldRadius, 1);
    });
  }

  makeMarker(lat, lng, color, screenRadiusPx = 5.5, { target = false } = {}) {
    const group = new THREE.Group();
    const safeLat = clamp(Number(lat) || 0, -90, 90);
    const safeLng = normalizeLng(Number(lng) || 0);
    const direction = latLngToVector3(safeLat, safeLng, EARTH_RADIUS).normalize();
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

    group.position.copy(direction.clone().multiplyScalar(EARTH_RADIUS + SURFACE_EPSILON));
    group.quaternion.copy(orientation);
    group.userData.isPrecisionMarker = true;
    group.userData.screenRadiusPx = screenRadiusPx;
    group.userData.lat = safeLat;
    group.userData.lng = safeLng;

    // Geometry is normalized to a one-unit radius. updateMarkerScales() converts that to a
    // constant on-screen size, so markers stay precise instead of becoming huge while zooming.
    const center = new THREE.Mesh(
      new THREE.CircleGeometry(target ? 0.22 : 0.18, 24),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: true, depthWrite: false }),
    );
    center.position.z = 0.00035;
    group.add(center);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(target ? 0.63 : 0.7, 1, 64),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: target ? 0.96 : 0.86,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      }),
    );
    ring.position.z = 0.0006;
    group.add(ring);

    const crossLength = 0.58;
    const gap = 0.28;
    const crossGeometry = new THREE.BufferGeometry();
    crossGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -crossLength, 0, 0, -gap, 0, 0,
      gap, 0, 0, crossLength, 0, 0,
      0, -crossLength, 0, 0, -gap, 0,
      0, gap, 0, 0, crossLength, 0,
    ], 3));
    const cross = new THREE.LineSegments(
      crossGeometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92, depthTest: true, depthWrite: false }),
    );
    cross.position.z = 0.0009;
    group.add(cross);

    return group;
  }

  clearGroup(group) {
    if (!group) return;
    while (group.children.length) {
      const child = group.children[group.children.length - 1];
      group.remove(child);
      disposeObject(child);
    }
  }

  clearGuessMarker() {
    this.clearGroup(this.guessMarkerGroup);
  }

  setGuessMarker(lat, lng, submitted = false) {
    if (!this.guessMarkerGroup) return;
    this.clearGuessMarker();
    this.guessMarkerGroup.add(this.makeMarker(lat, lng, submitted ? COLORS.submitted : COLORS.pending, 5.25));
  }

  setGuessSubmitted() {
    if (!this.guessMarkerGroup?.children.length) return;
    const current = this.guessMarkerGroup.children[0];
    const { lat, lng } = current.userData || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    this.setGuessMarker(lat, lng, true);
  }

  clearRound() {
    this.clearGuessMarker();
    this.clearGroup(this.resultGroup);
  }

  resetView() {
    if (!this.camera || !this.controls) return;
    this.camera.position.copy(latLngToVector3(18, -18, DEFAULT_CAMERA_DISTANCE));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  greatCirclePoint(a, b, t) {
    const dot = clamp(a.dot(b), -1, 1);
    if (dot > 0.9995) return a.clone().lerp(b, t).normalize();
    if (dot < -0.9995) {
      const helper = Math.abs(a.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const axis = a.clone().cross(helper).normalize();
      return a.clone().applyAxisAngle(axis, Math.PI * t).normalize();
    }
    const angle = Math.acos(dot);
    const sinAngle = Math.sin(angle);
    return a.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinAngle)
      .add(b.clone().multiplyScalar(Math.sin(t * angle) / sinAngle))
      .normalize();
  }

  addArc(fromLat, fromLng, toLat, toLng, color) {
    const a = latLngToVector3(fromLat, fromLng, 1).normalize();
    const b = latLngToVector3(toLat, toLng, 1).normalize();
    const points = [];
    const segments = 64;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const lift = 1.018 + Math.sin(Math.PI * t) * 0.075;
      points.push(this.greatCirclePoint(a, b, t).multiplyScalar(lift));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78 });
    this.resultGroup.add(new THREE.Line(geometry, material));
  }

  focusLatLng(lat, lng, { animate = true, distance = 1.72 } = {}) {
    if (!this.camera || !this.controls) return;
    const end = latLngToVector3(lat, lng, 1).normalize().multiplyScalar(distance);
    if (!animate) {
      this.camera.position.copy(end);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      return;
    }
    this.cameraTween = {
      start: this.camera.position.clone(),
      end,
      startedAt: performance.now(),
      duration: 900,
    };
  }

  updateCameraTween() {
    if (!this.cameraTween || !this.camera) return;
    const elapsed = performance.now() - this.cameraTween.startedAt;
    const t = clamp(elapsed / this.cameraTween.duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const startDir = this.cameraTween.start.clone().normalize();
    const endDir = this.cameraTween.end.clone().normalize();
    const radius = THREE.MathUtils.lerp(this.cameraTween.start.length(), this.cameraTween.end.length(), eased);
    this.camera.position.copy(this.greatCirclePoint(startDir, endDir, eased).multiplyScalar(radius));
    if (t >= 1) this.cameraTween = null;
  }

  addImpactPulse(lat, lng, color = COLORS.target) {
    if (!this.resultGroup) return;
    const direction = latLngToVector3(lat, lng, EARTH_RADIUS).normalize();
    const group = new THREE.Group();
    group.position.copy(direction.clone().multiplyScalar(EARTH_RADIUS + SURFACE_EPSILON * 1.4));
    group.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction));
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.023, 72),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    group.add(ring);
    this.resultGroup.add(group);
    this.effects.push({ object: group, material: ring.material, startedAt: performance.now(), duration: 1200 });
  }

  updateEffects() {
    if (!this.effects.length) return;
    const now = performance.now();
    this.effects = this.effects.filter((effect) => {
      const t = clamp((now - effect.startedAt) / effect.duration, 0, 1);
      const scale = 1 + t * 9;
      effect.object.scale.setScalar(scale);
      effect.material.opacity = 0.85 * (1 - t);
      if (t >= 1) {
        effect.object.parent?.remove(effect.object);
        disposeObject(effect.object);
        return false;
      }
      return true;
    });
  }

  showRoundResult(payload, selfId) {
    if (!this.resultGroup) return;
    this.clearRound();
    const target = payload?.target;
    if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;

    this.resultGroup.add(this.makeMarker(target.lat, target.lng, COLORS.target, 6.5, { target: true }));
    for (const guess of payload.guesses || []) {
      if (!Number.isFinite(guess.lat) || !Number.isFinite(guess.lng)) continue;
      const isSelf = guess.playerId === selfId;
      const color = isSelf ? COLORS.self : COLORS.opponent;
      this.resultGroup.add(this.makeMarker(guess.lat, guess.lng, color, 5));
      this.addArc(guess.lat, guess.lng, target.lat, target.lng, color);
    }
    this.addImpactPulse(target.lat, target.lng);
    this.focusLatLng(target.lat, target.lng, { animate: true, distance: 1.72 });
  }

  showMatchHistory(history, selfId, { allPlayers = false } = {}) {
    if (!this.resultGroup) return;
    this.clearRound();
    const rounds = Array.isArray(history) ? history : [];
    const selected = rounds.slice(-40);
    selected.forEach((round, roundIndex) => {
      const target = round?.target;
      if (Number.isFinite(target?.lat) && Number.isFinite(target?.lng)) {
        this.resultGroup.add(this.makeMarker(target.lat, target.lng, COLORS.target, 2.9, { target: true }));
      }
      (round?.guesses || []).filter((guess) => allPlayers || guess.playerId === selfId).forEach((guess, guessIndex) => {
        if (!Number.isFinite(guess.lat) || !Number.isFinite(guess.lng)) return;
        const palette = [COLORS.self, COLORS.opponent, 0xf472b6, 0xa78bfa, 0xfb923c, 0x22d3ee, 0xfacc15, 0xc084fc];
        const color = allPlayers ? palette[guessIndex % palette.length] : COLORS.self;
        const quality = Number.isFinite(guess.distanceKm) ? clamp(1 - guess.distanceKm / 6000, 0, 1) : 0;
        this.resultGroup.add(this.makeMarker(guess.lat, guess.lng, color, 2.4 + quality * 2.4));
      });
    });
    this.resetView();
  }

  destroy() {
    this.destroyed = true;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}
