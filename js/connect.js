import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const END = "__END__";

class AgentGraph {
  constructor() {
    this.nodes = {};
    this.edges = {};
    this.conditionalEdges = {};
    this.startNode = null;
  }
  addNode(name, fn) { this.nodes[name] = fn; return this; }
  addEdge(from, to) {
    if (from === "__start__") this.startNode = to;
    else this.edges[from] = to;
    return this;
  }
  addConditionalEdges(from, conditionFn, edgeMap) {
    this.conditionalEdges[from] = { conditionFn, edgeMap };
    return this;
  }
  compile() {
    return {
      invoke: async (initialState) => {
        let state = { ...initialState };
        let history = [];
        let currentNode = this.startNode;
        while (currentNode && currentNode !== END) {
          const nodeFn = this.nodes[currentNode];
          if (!nodeFn) break;

          const update = await nodeFn(state);

          if (update._back) {
            currentNode = history.pop() || this.startNode;
            continue;
          }

          history.push(currentNode);

          if (update.step) state.step = update.step;
          if (update.answers) state.answers = { ...state.answers, ...update.answers };

          if (this.conditionalEdges[currentNode]) {
            const router = this.conditionalEdges[currentNode];
            currentNode = router.edgeMap[router.conditionFn(state)] || END;
          } else {
            currentNode = this.edges[currentNode] || END;
          }
        }
        return state;
      }
    };
  }
}

/* ═══════════════════════════════════════════════════════════
   1. THREE.JS TOPOGRAPHIC MOUNTAIN — IMPROVED
   Key fixes vs. old version:
   · pathNode is a CHILD of mountain → rotates with it,
     no manual rotation compensation needed
   · FBM (5-octave fractal noise) for realistic ridges
   · Vertex colours: dark base → orange → maroon → snow peak
   · MeshStandardMaterial + directional lighting for depth
   · Trail line records form progress on the terrain
═══════════════════════════════════════════════════════════ */

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

// ── Camera ──────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 36, 50);
camera.lookAt(0, 6, 0);

// ── Renderer ─────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// ── Lighting & Environment ───────────────────────────────────
// Use linear fog so it only fades the far edges, keeping the mountain and birds perfectly clear
scene.fog = new THREE.Fog(0x0f0a08, 60, 105);

// Warm sun from the left gives the ridges depth
const ambientLight = new THREE.AmbientLight(0x180c04, 4);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffbb66, 3.5);
sunLight.position.set(-18, 40, 20);
scene.add(sunLight);

// Cool rim light from the right for contrast
const rimLight = new THREE.DirectionalLight(0x3322bb, 0.9);
rimLight.position.set(22, 8, -25);
scene.add(rimLight);

function applyThemeLighting(isLight) {
  if (isLight) {
    scene.fog.color.setHex(0xf5ede0);
    ambientLight.color.setHex(0xf5ede0);
    ambientLight.intensity = 2.0; // brighten a bit
    sunLight.color.setHex(0xffaa77);
    sunLight.intensity = 2.5;
    rimLight.intensity = 0.4;
  } else {
    scene.fog.color.setHex(0x0f0a08);
    ambientLight.color.setHex(0x180c04);
    ambientLight.intensity = 4;
    sunLight.color.setHex(0xffbb66);
    sunLight.intensity = 3.5;
    rimLight.intensity = 0.9;
  }
}
applyThemeLighting(document.documentElement.getAttribute('data-theme') === 'light');

// ── Fractal Brownian Motion noise ────────────────────────────
const noise2D = createNoise2D();

function fbm(x, z) {
  // 5 octaves — each halves amplitude, doubles frequency
  let v = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < 5; i++) {
    v += noise2D(x * freq * 0.068, z * freq * 0.068) * amp;
    max += amp;
    amp *= 0.50;
    freq *= 2.18;
  }
  return v / max; // normalised −1..1
}

// ── Terrain geometry ─────────────────────────────────────────
const SEG = 110;
const PLANE = 82;
const PEAK_H = 22;
const MAX_R = 31;

const geometry = new THREE.PlaneGeometry(PLANE, PLANE, SEG, SEG);
geometry.rotateX(-Math.PI / 2);

const posAttr = geometry.attributes.position;
const colorData = [];

// Elevation palette
const C_BASE = new THREE.Color(0x120804); // deep dark soil
const C_ROCK = new THREE.Color(0xd4622a); // accent orange — mid-slope
const C_HIGH = new THREE.Color(0x7b1c1c); // maroon         — upper ridge
const C_PEAK = new THREE.Color(0xfff4ec); // near-white snow

for (let i = 0; i < posAttr.count; i++) {
  const x = posAttr.getX(i);
  const z = posAttr.getZ(i);
  const dist = Math.sqrt(x * x + z * z);

  let y;
  if (dist < MAX_R) {
    const nd = dist / MAX_R;
    const falloff = Math.pow(Math.cos(nd * Math.PI / 2), 1.65); // smooth bell
    y = PEAK_H * falloff + fbm(x, z) * 3.8;
    if (y < 0) y = 0;
  } else {
    // Gentle foothills at edges
    y = Math.max(0, fbm(x, z) * 1.1);
  }

  posAttr.setY(i, y);

  // Map height → colour
  const t = Math.min(y / PEAK_H, 1);
  let col;
  if (t < 0.25) col = C_BASE.clone().lerp(C_ROCK, t / 0.25);
  else if (t < 0.70) col = C_ROCK.clone().lerp(C_HIGH, (t - 0.25) / 0.45);
  else col = C_HIGH.clone().lerp(C_PEAK, (t - 0.70) / 0.30);

  colorData.push(col.r, col.g, col.b);
}

geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorData, 3));
geometry.computeVertexNormals();

// ── Solid terrain ────────────────────────────────────────────
const terrainMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.87,
  metalness: 0.04,
  transparent: true,
  opacity: 0.84,
});
const mountain = new THREE.Mesh(geometry, terrainMat);
scene.add(mountain);

// ── Wireframe overlay (child of mountain → shares its rotation) ──
const wireMat = new THREE.MeshBasicMaterial({
  color: 0xd4622a,
  wireframe: true,
  transparent: true,
  opacity: 0.07,
});
mountain.add(new THREE.Mesh(geometry, wireMat));

// ── Height sampler (mirrors the vertex loop) ─────────────────
function getTerrainY(x, z) {
  const dist = Math.sqrt(x * x + z * z);
  if (dist >= MAX_R) return Math.max(0, fbm(x, z) * 1.1);
  const nd = dist / MAX_R;
  const falloff = Math.pow(Math.cos(nd * Math.PI / 2), 1.65);
  return Math.max(0, PEAK_H * falloff + fbm(x, z) * 3.8);
}

// ── Waypoints in mountain LOCAL space: base (front) → summit ─
// Each form step advances the ball one waypoint higher.
// Being children of the mountain, all positions are local —
// the mountain can rotate freely with zero compensation code.
const elevationPoints = [
  { x: 2.5, z: 23 }, // 0  Start    — base of mountain
  { x: -3.5, z: 16 }, // 1  Intent   — first question answered
  { x: 4.0, z: 10 }, // 2  Branch   — path chosen
  { x: -2.0, z: 4 }, // 3  Sub-step — qualifier answered
  { x: 1.0, z: -2 }, // 4  Form     — filling in details
  { x: 0.0, z: -9 }, // 5  Summit   — submitted
];

function localPos(pt) {
  return new THREE.Vector3(pt.x, getTerrainY(pt.x, pt.z) + 0.68, pt.z);
}

// ── Path node — CHILD of mountain ────────────────────────────
// Because it is a child, pathNode.position is in LOCAL space.
// When mountain.rotation.y changes, the node moves with it.
// No applyAxisAngle() trickery required.
const nodeGeom = new THREE.SphereGeometry(0.46, 24, 24);
const nodeMat = new THREE.MeshStandardMaterial({
  color: 0xffcc44,
  emissive: 0xff9900,
  emissiveIntensity: 1.6,
  roughness: 0.18,
  metalness: 0.45,
});
const pathNode = new THREE.Mesh(nodeGeom, nodeMat);
mountain.add(pathNode); // ← attached to mountain, not scene

// Soft glow halo around the node
const glowGeom = new THREE.SphereGeometry(1.15, 16, 16);
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa22, transparent: true, opacity: 0.16 });
const glowNode = new THREE.Mesh(glowGeom, glowMat);
pathNode.add(glowNode);

// ── Progress trail ───────────────────────────────────────────
// A polyline that draws through every waypoint visited so far.
const MAX_TRAIL = elevationPoints.length;
const trailBuf = new Float32Array(MAX_TRAIL * 3);
const trailGeom = new THREE.BufferGeometry();
trailGeom.setAttribute('position', new THREE.BufferAttribute(trailBuf, 3));
trailGeom.setDrawRange(0, 1);

const trailLine = new THREE.Line(trailGeom, new THREE.LineBasicMaterial({
  color: 0xffcc44,
  transparent: true,
  opacity: 0.50,
}));
mountain.add(trailLine);

// State
let targetLocalPos = localPos(elevationPoints[0]);
pathNode.position.copy(targetLocalPos);

const visitedPts = [elevationPoints[0]];

function refreshTrail() {
  for (let i = 0; i < visitedPts.length; i++) {
    const lp = localPos(visitedPts[i]);
    trailBuf[i * 3] = lp.x;
    trailBuf[i * 3 + 1] = lp.y;
    trailBuf[i * 3 + 2] = lp.z;
  }
  trailGeom.attributes.position.needsUpdate = true;
  trailGeom.setDrawRange(0, visitedPts.length);
}
refreshTrail();

// Called by each form step — advances the ball up the mountain
function updateMountainPath(stepIndex) {
  if (stepIndex < 0 || stepIndex >= elevationPoints.length) return;
  const pt = elevationPoints[stepIndex];
  targetLocalPos = localPos(pt);
  if (!visitedPts.some(p => p.x === pt.x && p.z === pt.z)) {
    visitedPts.push(pt);
    refreshTrail();
  }
}

// ── Trees (children of mountain → rotate with terrain) ───────
const foliageMat = new THREE.MeshStandardMaterial({
  color:       0x2a5c12,
  roughness:   0.90,
  metalness:   0,
  transparent: true,
  opacity:     0.95,
});
const trunkMat = new THREE.MeshStandardMaterial({
  color:     0x5c3010,
  roughness: 1.0,
  metalness: 0,
});

// Fixed-seed positions [angle_rad, radius] — deterministic, no Math.random()
const TREE_SEEDS = [
  [0.30,  9], [0.82, 14], [1.28, 11], [1.75, 17], [2.10,  8],
  [2.55, 13], [3.02, 10], [3.50, 16], [3.98,  9], [4.40, 12],
  [4.88, 15], [5.22,  8], [5.68, 11], [0.10, 19], [1.02, 20],
  [2.30, 18], [3.80, 19], [5.05, 17], [6.02, 10], [0.62,  7],
  [2.80,  7], [4.60,  8],
];

for (const [angle, radius] of TREE_SEEDS) {
  const tx = Math.cos(angle) * radius;
  const tz = Math.sin(angle) * radius;
  const groundY = getTerrainY(tx, tz);

  if (groundY < 1.2 || groundY > 10) continue; // only mid-low slopes

  // Deterministic height variation from seed values
  const h = 0.9 + ((angle * 7 + radius * 3) % 10) * 0.13;

  const treeGroup = new THREE.Group();
  treeGroup.position.set(tx, groundY, tz);
  treeGroup.rotation.y = angle * 2.4; // varied facing per tree

  // Trunk
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.105, h * 0.36, 5),
    trunkMat
  );
  trunk.position.y = h * 0.18;
  treeGroup.add(trunk);

  // Wide lower canopy
  const cone1 = new THREE.Mesh(
    new THREE.ConeGeometry(h * 0.52, h * 0.72, 6),
    foliageMat
  );
  cone1.position.y = h * 0.60;
  treeGroup.add(cone1);

  // Tighter upper spire
  const cone2 = new THREE.Mesh(
    new THREE.ConeGeometry(h * 0.34, h * 0.58, 6),
    foliageMat
  );
  cone2.position.y = h * 1.00;
  treeGroup.add(cone2);

  mountain.add(treeGroup);
}

// ── Bird flock (world space — orbits freely) ─────────────────
// 4 birds in a loose asymmetric V. flockRoot orbits the mountain;
// each bird is positioned in flockRoot's local space so the
// V naturally faces the direction of travel.
const flockRoot = new THREE.Group();
scene.add(flockRoot);

const wingMat = new THREE.MeshBasicMaterial({ color: 0x3a1a08, side: THREE.DoubleSide });
const bodyMat = new THREE.MeshBasicMaterial({ color: 0x1e0e04 });

// Builds one curved half-wing as a Bezier-outlined shape,
// laid flat in the XZ plane. dir=-1 → left, dir=+1 → right.
function makeCurvedWingGeom(span, chord, dir) {
  const d = dir;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  // leading edge sweeps forward and out
  shape.bezierCurveTo(d * span * 0.28, chord * 0.22, d * span * 0.68, chord * 0.12, d * span, 0);
  // trailing edge curves back to root
  shape.bezierCurveTo(d * span * 0.62, -chord * 0.52, d * span * 0.22, -chord * 0.72, 0, -chord * 0.28);
  shape.closePath();
  const geom = new THREE.ShapeGeometry(shape, 10);
  geom.rotateX(-Math.PI / 2); // lay in XZ plane; chord becomes depth in -Z
  return geom;
}

const WING_SPAN  = 2.6;
const WING_CHORD = 0.58;

// Loose, slightly asymmetric V — more natural than a perfect mirror
const FORMATION = [
  { x:  0.0, z:  0.0 }, // lead
  { x: -3.2, z:  2.8 }, // left
  { x:  3.0, z:  3.2 }, // right (staggered slightly further)
  { x: -5.8, z:  5.6 }, // far left (flocks skew naturally)
];

const birds = FORMATION.map((f, i) => {
  const bird = new THREE.Group();
  bird.position.set(f.x, 0, f.z);
  bird._phase = (i / FORMATION.length) * Math.PI * 0.55; // stagger flap phase

  // Tiny elongated body gives each bird a silhouette centre
  const bodyGeom = new THREE.SphereGeometry(0.16, 6, 4);
  bodyGeom.scale(1, 0.65, 2.0);
  bird.add(new THREE.Mesh(bodyGeom, bodyMat));

  // Wing groups — rotating the group pivots at the body root
  const lGroup = new THREE.Group();
  lGroup.add(new THREE.Mesh(makeCurvedWingGeom(WING_SPAN, WING_CHORD, -1), wingMat));
  bird._lGroup = lGroup;
  bird.add(lGroup);

  const rGroup = new THREE.Group();
  rGroup.add(new THREE.Mesh(makeCurvedWingGeom(WING_SPAN, WING_CHORD,  1), wingMat));
  bird._rGroup = rGroup;
  bird.add(rGroup);

  flockRoot.add(bird);
  return bird;
});

let flockAngle = Math.PI; // start on far side so it flies into view

// ── Animation loop ───────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // Slow, majestic rotation
  mountain.rotation.y = t * 0.025;

  // Breathing glow on the node
  const pulse = 1 + Math.sin(t * 2.6) * 0.22;
  glowNode.scale.setScalar(pulse);
  glowMat.opacity = 0.10 + Math.sin(t * 2.6) * 0.06;

  // Smooth lerp to target — stays in local space, zero drift
  pathNode.position.lerp(targetLocalPos, 0.038);

  // Subtle camera sway
  camera.position.y = 36 + Math.sin(t * 0.17) * 0.7;
  camera.lookAt(0, 6, 0);

  // ── Flock ─────────────────────────────────────────────────
  // Orbit radius & height in world space (mountain peak ≈ Y 22)
  flockAngle += 0.0018;
  const FR = 23;
  flockRoot.position.set(
    Math.cos(flockAngle) * FR,
    30 + Math.sin(t * 0.28) * 1.8, // gentle altitude drift
    Math.sin(flockAngle) * FR
  );
  // Face tangent to orbit so lead bird points forward
  flockRoot.rotation.y = -(flockAngle + Math.PI / 2);

  // Wing flap: curved wings rotate around Z at body root
  // left tip up → rotation.z negative; right tip up → positive
  for (const bird of birds) {
    const flap = Math.sin(t * 3.2 + bird._phase) * 0.44;
    bird._lGroup.rotation.z = -flap;
    bird._rGroup.rotation.z =  flap;
  }

  renderer.render(scene, camera);
}
animate();

// ── Resize ───────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Theme sync ───────────────────────────────────────────────
const themeObserver = new MutationObserver(() => {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  wireMat.color.setHex(light ? 0x7b1c1c : 0xd4622a);
  applyThemeLighting(light);
});
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ═══════════════════════════════════════════════════════════
   2. CUSTOM AGENT STATE MACHINE
═══════════════════════════════════════════════════════════ */

const contentEl = document.getElementById('agent-content');
let userInputResolver = null;

function waitForUserInput() {
  return new Promise(resolve => { userInputResolver = resolve; });
}

window.submitAnswer = (val) => {
  if (userInputResolver) { userInputResolver(val); userInputResolver = null; }
};

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE   = /^https?:\/\/.+/;

window.submitForm = () => {
  const nameEl  = document.getElementById('user-name');
  const reachEl = document.getElementById('user-reach');
  const msgEl   = document.getElementById('user-msg');
  const linksEl = document.getElementById('user-links');
  const errorEl = document.getElementById('form-error');

  const name    = nameEl?.value?.trim()  || '';
  const reach   = reachEl?.value?.trim() || '';
  const message = msgEl?.value?.trim()   || '';
  const links   = linksEl?.value?.trim() || '';

  const isEmailField = reachEl?.type === 'email';

  let err = '';
  if (!name)    err = 'Your name is required.';
  else if (!reach) err = 'How to reach you is required.';
  else if (isEmailField && !EMAIL_RE.test(reach))
    err = 'Please enter a valid email address.';
  else if (!isEmailField && !EMAIL_RE.test(reach) && !URL_RE.test(reach))
    err = 'Please enter a valid email or URL (e.g. https://linkedin.com/in/…).';
  else if (!message) err = 'A message is required.';
  else if (links && !URL_RE.test(links)) err = 'Links must start with https://.';

  if (err) {
    if (errorEl) { errorEl.textContent = err; errorEl.style.display = 'block'; }
    return;
  }
  if (errorEl) errorEl.style.display = 'none';
  submitAnswer({ name, reach, message, links });
};

function renderUI(html) {
  contentEl.style.opacity = '0';
  setTimeout(() => { contentEl.innerHTML = html; contentEl.style.opacity = '1'; }, 200);
}

async function sendToFormspree(payload) {
  const formspreeUrl = "https://formspree.io/f/mrejrebe";
  renderUI(`<div class="terminal-loader">Sending...</div>`);
  let ok = false;
  try {
    const res = await fetch(formspreeUrl, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: payload.body, email: payload.email, _replyto: payload.email })
    });
    ok = res.ok;
  } catch {
    ok = false;
  }

  if (ok) {
    updateMountainPath(5);
    renderUI(`
      <div class="success-message">
        <svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <div class="agent-question">Message sent.</div>
        <p style="color:var(--text-muted);line-height:1.6;">I'll be in touch. You can also find me on
          <a href="https://linkedin.com/in/robertohenriquez" target="_blank" style="color:var(--accent);">LinkedIn</a>.
        </p>
        <button class="agent-btn" style="margin-top:20px;justify-content:center;" onclick="window.location.href='index.html'">Back to portfolio</button>
      </div>`);
    return true;
  }

  renderUI(`
    <div class="agent-question">Something went wrong.</div>
    <p style="color:var(--text-muted);">The message could not be delivered. Please reach out directly on
      <a href="https://linkedin.com/in/robertohenriquez" target="_blank" style="color:var(--accent);">LinkedIn</a>.
    </p>
    <button class="back-btn" style="margin-top:20px;" onclick="submitAnswer('__BACK__')">← Go Back</button>`);
  const back = await waitForUserInput();
  if (back === '__BACK__') return false;
  return false;
}

// ── SHARED FORMS ──────────────────────────────────────────────

async function collectDetails(state) {
  const context = state.answers;
  const placeholder = context.intent === 'role'
    ? "Tell me about the role, team, and what you're looking for..."
    : "Describe the project, expected scope, and what you need from me...";

  let prev = { name: '', reach: '', message: '', links: '' };

  while (true) {
    updateMountainPath(4);
    renderUI(`
      <div class="agent-question">Last step — a few details.</div>
      <div class="form-group">
        <input  type="text"  id="user-name"  class="input-field" placeholder="Your name *" value="${escHtml(prev.name)}">
        <input  type="email" id="user-reach" class="input-field" placeholder="Your email *" value="${escHtml(prev.reach)}">
        <textarea            id="user-msg"   class="input-field" placeholder="${placeholder} *" rows="4">${escHtml(prev.message)}</textarea>
        <input  type="text"  id="user-links" class="input-field" placeholder="Relevant links (optional)" value="${escHtml(prev.links)}">
        <p id="form-error" style="color:var(--accent);font-size:13px;margin:-4px 0;display:none;"></p>
        <button class="agent-btn" style="justify-content:center;" onclick="submitForm()">Send message</button>
        <button class="back-btn" onclick="submitAnswer('__BACK__')">← Go Back</button>
      </div>`);

    const contact = await waitForUserInput();
    if (contact === '__BACK__') return { _back: true };
    prev = contact;

    const body = `
## New enquiry

**Intent:** ${context.intent}
**Sub-type:** ${context.subtype || 'N/A'}
**Budget / Timeline:** ${context.budget || context.timeline || 'N/A'}

**Name:** ${contact.name}
**Reach:** ${contact.reach}

**Details:**
${contact.message}

**Links:** ${contact.links || 'N/A'}`;

    const sent = await sendToFormspree({ body, email: contact.reach });
    if (sent) return { step: 'done' };
    // on failure the error UI showed — user clicked "← Go Back" → loop re-shows form
  }
}

async function lightForm(state) {
  let prev = { name: '', reach: '', message: '', links: '' };

  while (true) {
    updateMountainPath(4);
    renderUI(`
      <div class="agent-question">Drop me a note.</div>
      <div class="form-group">
        <input type="text" id="user-name"  class="input-field" placeholder="Your name *" value="${escHtml(prev.name)}">
        <input type="text" id="user-reach" class="input-field" placeholder="Email or LinkedIn URL *" value="${escHtml(prev.reach)}">
        <textarea          id="user-msg"   class="input-field" placeholder="What's on your mind? *" rows="4">${escHtml(prev.message)}</textarea>
        <input type="text" id="user-links" class="input-field" placeholder="Relevant links (optional)" value="${escHtml(prev.links)}">
        <p id="form-error" style="color:var(--accent);font-size:13px;margin:-4px 0;display:none;"></p>
        <button class="agent-btn" style="justify-content:center;" onclick="submitForm()">Send message</button>
        <button class="back-btn" onclick="submitAnswer('__BACK__')">← Go Back</button>
      </div>`);

    const contact = await waitForUserInput();
    if (contact === '__BACK__') return { _back: true };
    prev = contact;

    const body = `
## New message

**Intent:** ${state.answers.intent}${state.answers.subtype ? '\n**Type:** ' + state.answers.subtype : ''}

**Name:** ${contact.name}
**Reach:** ${contact.reach}

**Message:**
${contact.message}

**Links:** ${contact.links || 'N/A'}`;

    const sent = await sendToFormspree({ body, email: contact.reach });
    if (sent) return { step: 'done' };
    // on failure the error UI showed — user clicked "← Go Back" → loop re-shows form
  }
}

// ── BRANCH: ROLE OPPORTUNITY ──────────────────────────────────

async function askRoleType(state) {
  updateMountainPath(2);
  renderUI(`
    <div class="agent-question">What kind of role?</div>
    <div class="agent-options">
      <button class="agent-btn" onclick="submitAnswer('Full-time AI Engineering')">Full-time AI Engineering</button>
      <button class="agent-btn" onclick="submitAnswer('Technical PM / Leadership')">Technical PM / Leadership</button>
      <button class="agent-btn" onclick="submitAnswer('Founding team / Early stage')">Founding team / Early stage</button>
      <button class="back-btn" onclick="submitAnswer('__BACK__')">← Go Back</button>
    </div>`);
  const subtype = await waitForUserInput();
  if (subtype === '__BACK__') return { _back: true };
  return { answers: { subtype }, step: 'collect_details' };
}

// ── BRANCH: CONSULTING ────────────────────────────────────────

async function askScope(state) {
  updateMountainPath(2);
  renderUI(`
    <div class="agent-question">What's the scope?</div>
    <div class="agent-options">
      <button class="agent-btn" onclick="submitAnswer('Prototype / MVP')">Prototype / MVP (under 2 months)</button>
      <button class="agent-btn" onclick="submitAnswer('Production system')">Production system build</button>
      <button class="agent-btn" onclick="submitAnswer('Technical advisory')">Ongoing technical advisory</button>
      <button class="back-btn" onclick="submitAnswer('__BACK__')">← Go Back</button>
    </div>`);
  const subtype = await waitForUserInput();
  if (subtype === '__BACK__') return { _back: true };
  return { answers: { subtype }, step: 'ask_budget' };
}

async function askBudget(state) {
  updateMountainPath(3);
  renderUI(`
    <div class="agent-question">Rough budget range?</div>
    <div class="agent-options">
      <button class="agent-btn" onclick="submitAnswer('Under €5k')">Under €5k</button>
      <button class="agent-btn" onclick="submitAnswer('€5k to €20k')">€5k to €20k</button>
      <button class="agent-btn" onclick="submitAnswer('€20k+')">€20k+</button>
      <button class="agent-btn" onclick="submitAnswer('Not sure yet')">Not sure yet</button>
      <button class="back-btn" onclick="submitAnswer('__BACK__')">← Go Back</button>
    </div>`);
  const budget = await waitForUserInput();
  if (budget === '__BACK__') return { _back: true };
  return { answers: { budget }, step: 'collect_details' };
}

// ── BRANCH: COLLAB ────────────────────────────────────────────

async function askProjectType(state) {
  updateMountainPath(2);
  renderUI(`
    <div class="agent-question">What are you building?</div>
    <div class="agent-options">
      <button class="agent-btn" onclick="submitAnswer('Open-source AI tooling')">Open-source AI tooling</button>
      <button class="agent-btn" onclick="submitAnswer('Research / academic')">Research / academic project</button>
      <button class="agent-btn" onclick="submitAnswer('Startup side project')">Startup or side project</button>
      <button class="back-btn" onclick="submitAnswer('__BACK__')">← Go Back</button>
    </div>`);
  const subtype = await waitForUserInput();
  if (subtype === '__BACK__') return { _back: true };
  return { answers: { subtype }, step: 'light_form' };
}

// ── ROOT NODE ─────────────────────────────────────────────────

async function askIntent(state) {
  updateMountainPath(1);
  renderUI(`
    <div class="agent-question">What brings you here?</div>
    <div class="agent-options">
      <button class="agent-btn" onclick="submitAnswer('role')">I have a role opportunity</button>
      <button class="agent-btn" onclick="submitAnswer('consulting')">I need help building something</button>
      <button class="agent-btn" onclick="submitAnswer('collab')">Open-source / side project collab</button>
      <button class="agent-btn" onclick="submitAnswer('hi')">Just saying hi</button>
    </div>`);
  const intent = await waitForUserInput();
  const stepMap = { role: 'ask_role_type', consulting: 'ask_scope', collab: 'ask_project_type', hi: 'light_form' };
  return { answers: { intent }, step: stepMap[intent] };
}

// ── GRAPH ─────────────────────────────────────────────────────

const workflow = new AgentGraph()
  .addNode("askIntent", askIntent)
  .addNode("askRoleType", askRoleType)
  .addNode("askScope", askScope)
  .addNode("askBudget", askBudget)
  .addNode("askProjectType", askProjectType)
  .addNode("collectDetails", collectDetails)
  .addNode("lightForm", lightForm)

  .addEdge("__start__", "askIntent")

  .addConditionalEdges("askIntent", s => s.step, {
    ask_role_type: "askRoleType",
    ask_scope: "askScope",
    ask_project_type: "askProjectType",
    light_form: "lightForm"
  })

  .addConditionalEdges("askRoleType", s => s.step, { collect_details: "collectDetails" })
  .addConditionalEdges("askScope", s => s.step, { ask_budget: "askBudget" })
  .addConditionalEdges("askBudget", s => s.step, { collect_details: "collectDetails" })
  .addConditionalEdges("askProjectType", s => s.step, { light_form: "lightForm" })

  .addEdge("collectDetails", END)
  .addEdge("lightForm", END);

const app = workflow.compile();

contentEl.style.transition = 'opacity 0.2s';
setTimeout(() => { app.invoke({ step: 'init', answers: {} }); }, 800);
