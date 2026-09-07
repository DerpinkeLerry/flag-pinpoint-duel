import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_TEXTURES = [
  'https://threejs.org/examples/textures/planets/earth_day_4096.jpg',
  'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
  'https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-2048.png',
];

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
  for (const url of EARTH_TEXTURES) {
    try {
      const texture = await Promise.race([
        loader.loadAsync(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('texture timeout')), 3500)),
      ]);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return texture;
    } catch {
      // Try the next mirror. The globe still works with a fallback material.
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
    this.resizeObserver = null;
    this.animationFrame = null;
    this.destroyed = false;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return this;
    this.initialized = true;
    this.setStatus('3D-Globus wird geladen…');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01040a);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
    this.camera.position.copy(latLngToVector3(18, -18, 2.65));

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.setAttribute('aria-label', '3D-Erde. Ziehen zum Drehen, scrollen oder mit zwei Fingern zoomen, antippen zum Setzen des Tipps.');
    this.container.prepend(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 4.2;
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

    const earthGeometry = new THREE.SphereGeometry(1, 96, 64);
    const earthMaterial = new THREE.MeshPhongMaterial({
      color: 0x164e63,
      shininess: 10,
      specular: new THREE.Color(0x29485c),
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
        this.setStatus('');
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
      const hit = this.raycaster.intersectObject(this.earth, false)[0];
      if (!hit) return;
      const localPoint = this.earth.worldToLocal(hit.point.clone());
      this.onSelect(vector3ToLatLng(localPoint));
    });
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.container.clientWidth || 800);
    const height = Math.max(1, this.container.clientHeight || 600);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  startRenderLoop() {
    const render = () => {
      if (this.destroyed) return;
      this.controls?.update();
      if (this.container.offsetParent !== null && this.container.clientWidth > 0 && this.container.clientHeight > 0) {
        this.renderer.render(this.scene, this.camera);
      }
      this.animationFrame = requestAnimationFrame(render);
    };
    render();
  }

  makeMarker(lat, lng, color, size = 0.035) {
    const group = new THREE.Group();
    const direction = latLngToVector3(lat, lng, 1).normalize();

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(size, 18, 14),
      new THREE.MeshBasicMaterial({ color, depthTest: true }),
    );
    dot.position.copy(direction.clone().multiplyScalar(1.035));
    group.add(dot);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(size * 1.25, size * 1.72, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    halo.position.copy(direction.clone().multiplyScalar(1.04));
    halo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    group.add(halo);
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
    this.guessMarkerGroup.add(this.makeMarker(lat, lng, submitted ? COLORS.submitted : COLORS.pending, 0.036));
  }

  setGuessSubmitted() {
    if (!this.guessMarkerGroup?.children.length) return;
    const current = this.guessMarkerGroup.children[0];
    const position = current.children?.[0]?.position?.clone();
    if (!position) return;
    const { lat, lng } = vector3ToLatLng(position);
    this.setGuessMarker(lat, lng, true);
  }

  clearRound() {
    this.clearGuessMarker();
    this.clearGroup(this.resultGroup);
  }

  resetView() {
    if (!this.camera || !this.controls) return;
    this.camera.position.copy(latLngToVector3(18, -18, 2.65));
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

  focusLatLng(lat, lng) {
    if (!this.camera || !this.controls) return;
    const direction = latLngToVector3(lat, lng, 1).normalize();
    this.camera.position.copy(direction.multiplyScalar(2.45));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  showRoundResult(payload, selfId) {
    if (!this.resultGroup) return;
    this.clearRound();
    const target = payload?.target;
    if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;

    this.resultGroup.add(this.makeMarker(target.lat, target.lng, COLORS.target, 0.045));
    for (const guess of payload.guesses || []) {
      if (!Number.isFinite(guess.lat) || !Number.isFinite(guess.lng)) continue;
      const isSelf = guess.playerId === selfId;
      const color = isSelf ? COLORS.self : COLORS.opponent;
      this.resultGroup.add(this.makeMarker(guess.lat, guess.lng, color, 0.035));
      this.addArc(guess.lat, guess.lng, target.lat, target.lng, color);
    }
    this.focusLatLng(target.lat, target.lng);
  }

  destroy() {
    this.destroyed = true;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}
