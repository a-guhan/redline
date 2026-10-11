import * as THREE from 'three';

const canvas = document.querySelector('#scene');
const mapCanvas = document.querySelector('#map');
const mapCtx = mapCanvas.getContext('2d');
const sim = document.querySelector('#simulator');
const intro = document.querySelector('#intro');
const modeKicker = document.querySelector('#mode-kicker');
const introTitle = document.querySelector('#intro-title');
const introCopy = document.querySelector('#intro-copy');
const launchButton = document.querySelector('#start-session');
const countdown = document.querySelector('#countdown');
const speedEl = document.querySelector('#speed');
const rpmEl = document.querySelector('#rpm');
const rpmFill = document.querySelector('#rpm-fill');
const gearEl = document.querySelector('#gear');
const lapEl = document.querySelector('#lap-count');
const sessionTimeEl = document.querySelector('#session-time');
const lastLapEl = document.querySelector('#last-lap');
const bestLapEl = document.querySelector('#best-lap');
const leanEl = document.querySelector('#lean');
const alertEl = document.querySelector('#corner-alert');
const cornerNameEl = document.querySelector('#corner-name');
const cornerClassEl = document.querySelector('#corner-class');
const brakeDistanceEl = document.querySelector('#brake-distance');
const coachTextEl = document.querySelector('#coach-text');
const sessionStateEl = document.querySelector('#session-state');
const statusEl = document.querySelector('#status-message');
const crashScreen = document.querySelector('#crash-screen');
const soundText = document.querySelector('#sound-text');
const throttleButton = document.querySelector('#throttle');
const brakeButton = document.querySelector('#brake');
const clamp = THREE.MathUtils.clamp;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9eb3c0);
scene.fog = new THREE.Fog(0x9eb3c0, 1200, 3600);
const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, .1, 3000);
scene.add(camera);
const pano = new THREE.TextureLoader().load('./assets/ladakh-dawn-v2.jpg', texture => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = texture;
  scene.environment = texture;
});
pano.colorSpace = THREE.SRGBColorSpace;
pano.mapping = THREE.EquirectangularReflectionMapping;
const hemi = new THREE.HemisphereLight(0xe1ebff, 0x645743, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd4a1, 2.4); sun.position.set(-195, 100, -260); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -230; sun.shadow.camera.right = 230; sun.shadow.camera.top = 230; sun.shadow.camera.bottom = -230; sun.shadow.bias = -.0004; scene.add(sun);
const fill = new THREE.DirectionalLight(0xb7d0df, .52); fill.position.set(100, 60, 100); scene.add(fill);

const TRACK_WIDTH = 10.5;
const SEGMENTS = 900;
const V = THREE.Vector3;
const trackScale = 4.6;
const trackPoints = [
  [-112, 0, -10], [-105, 0, -43], [-78, 0, -68], [-32, 0, -78], [18, 0, -72], [61, 0, -55],
  [83, 0, -28], [86, 0, 3], [72, 0, 24], [46, 0, 29], [28, 0, 17], [10, 0, 17],
  [-7, 0, 35], [8, 0, 58], [33, 0, 76], [21, 0, 91], [-20, 0, 91], [-60, 0, 75],
  [-91, 0, 51], [-111, 0, 26], [-105, 0, 5], [-84, 0, -1]
].map(p => new V(p[0] * trackScale, p[1], p[2] * trackScale));
// Start on the long straight so the rider has room to build speed before Turn 1.
trackPoints.push(...trackPoints.splice(0, 3));
const track = new THREE.CatmullRomCurve3(trackPoints, true, 'centripetal', .42);
track.arcLengthDivisions = 5000; track.updateArcLengths();
const trackLength = track.getLength();
document.querySelector('.track-label b').textContent = `${(trackLength / 1000).toFixed(1)} KM`;
const CURVATURE_STEP = 5;
const curveSamples = new Float32Array(Math.ceil(trackLength / CURVATURE_STEP));
for (let i = 0; i < curveSamples.length; i++) {
  const d = i * CURVATURE_STEP, delta = CURVATURE_STEP;
  const a = track.getTangentAt((((d - delta) % trackLength) + trackLength) % trackLength / trackLength);
  const b = track.getTangentAt(((d + delta) % trackLength) / trackLength);
  curveSamples[i] = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z) / (delta * 2);
}
const tempP = new V(), tempT = new V();
function trackFrame(distance) {
  const u = ((distance % trackLength) + trackLength) % trackLength / trackLength;
  const point = track.getPointAt(u, tempP).clone();
  const tangent = track.getTangentAt(u, tempT).clone().normalize();
  const side = new V(tangent.z, 0, -tangent.x).normalize();
  return { u, point, tangent, side };
}

// Terrain rises naturally away from the road corridor, giving the pass real depth.
const groundMat = new THREE.MeshStandardMaterial({ color: 0xb8b9b4, roughness: 1 });
function makeValleyTerrain() {
  const divisions = 208, span = 2600, half = span / 2;
  const path = Array.from({ length: 520 }, (_, i) => track.getPointAt(i / 520));
  const positions = new Float32Array((divisions + 1) ** 2 * 3), uvs = new Float32Array((divisions + 1) ** 2 * 2), indices = [];
  let vertex = 0;
  for (let z = 0; z <= divisions; z++) for (let x = 0; x <= divisions; x++) {
    const wx = x / divisions * span - half, wz = z / divisions * span - half;
    let nearest = Infinity;
    for (const p of path) { const dx = wx - p.x, dz = wz - p.z; nearest = Math.min(nearest, dx * dx + dz * dz); }
    const distance = Math.max(0, Math.sqrt(nearest) - 25);
    const rise = Math.min(105, Math.pow(distance / 820, 1.48) * 88);
    const ridgeMask = Math.min(1, distance / 70);
    const ridge = (Math.sin(wx * .012 + Math.sin(wz * .007) * 2.2) * Math.cos(wz * .01)
      + Math.sin((wx + wz) * .023) * .38 + Math.sin((wx - wz) * .037) * .18) * ridgeMask;
    const shoulder = .58 * (1 - Math.exp(-distance / 24));
    positions[vertex * 3] = wx;
    positions[vertex * 3 + 1] = -.12 + shoulder + rise + ridge * (1 + rise * .035);
    positions[vertex * 3 + 2] = wz;
    uvs[vertex * 2] = x / divisions;
    uvs[vertex * 2 + 1] = z / divisions;
    vertex++;
  }
  for (let z = 0; z < divisions; z++) for (let x = 0; x < divisions; x++) {
    const a = z * (divisions + 1) + x, b = a + 1, c = a + divisions + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const terrain = new THREE.Mesh(geometry, groundMat); terrain.receiveShadow = true; scene.add(terrain);
}
makeValleyTerrain();

function makeRibbon(inner, outer, y, material, name) {
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS, p = track.getPointAt(u), tangent = track.getTangentAt(u).normalize();
    const side = new V(tangent.z, 0, -tangent.x).normalize();
    const a = p.clone().addScaledVector(side, inner); const b = p.clone().addScaledVector(side, outer);
    positions.push(a.x, y, a.z, b.x, y, b.z); uvs.push(0, u * 60, 1, u * 60);
    if (i < SEGMENTS) { const n = i * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); mesh.name = name; mesh.receiveShadow = true; mesh.castShadow = false; scene.add(mesh); return mesh;
}
const textureLoader = new THREE.TextureLoader();
const pbrTexture = (folder, file, repeat, color = false) => {
  const texture = textureLoader.load(`./assets/${folder}/${file}.jpg`);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};
groundMat.map = pbrTexture('rocks-ground-01', 'diffuse', [150, 150], true);
groundMat.normalMap = pbrTexture('rocks-ground-01', 'normal', [150, 150]);
groundMat.normalScale.set(.62, .62);
groundMat.roughnessMap = pbrTexture('rocks-ground-01', 'roughness', [150, 150]);
groundMat.needsUpdate = true;
const asphaltMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .94, metalness: 0 });
asphaltMat.map = pbrTexture('asphalt-road', 'diffuse', [1.4, 8], true);
asphaltMat.normalMap = pbrTexture('asphalt-road', 'normal', [1.4, 8]);
asphaltMat.normalScale.set(.42, .42);
asphaltMat.roughnessMap = pbrTexture('asphalt-road', 'roughness', [1.4, 8]);
asphaltMat.needsUpdate = true;
makeRibbon(-TRACK_WIDTH / 2, TRACK_WIDTH / 2, .08, asphaltMat, 'Circuit asphalt');
const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x858781, roughness: .98 });
shoulderMat.map = pbrTexture('rocks-ground-01', 'diffuse', [.45, 5], true);
shoulderMat.normalMap = pbrTexture('rocks-ground-01', 'normal', [.45, 5]);
shoulderMat.normalScale.set(.4, .4);
makeRibbon(-TRACK_WIDTH / 2 - 1.45, -TRACK_WIDTH / 2 - .58, .045, shoulderMat, 'Stone shoulder left');
makeRibbon(TRACK_WIDTH / 2 + .58, TRACK_WIDTH / 2 + 1.45, .045, shoulderMat, 'Stone shoulder right');
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xc6c6bc, roughness: .84 });
makeRibbon(-TRACK_WIDTH / 2 + .12, -TRACK_WIDTH / 2 + .23, .105, edgeMat, 'Track edge left');
makeRibbon(TRACK_WIDTH / 2 - .23, TRACK_WIDTH / 2 - .12, .105, edgeMat, 'Track edge right');

function makeCurb(sideSign) {
  const positions = [], colors = [], indices = [];
  const block = 3.8, count = Math.ceil(trackLength / block), startVertex = 0;
  for (let i = 0; i < count; i++) {
    const d0 = i * block, d1 = Math.min((i + 1) * block, trackLength);
    const f0 = trackFrame(d0), f1 = trackFrame(d1);
    const in0 = f0.point.clone().addScaledVector(f0.side, sideSign * (TRACK_WIDTH / 2 - .15));
    const out0 = f0.point.clone().addScaledVector(f0.side, sideSign * (TRACK_WIDTH / 2 + .62));
    const in1 = f1.point.clone().addScaledVector(f1.side, sideSign * (TRACK_WIDTH / 2 - .15));
    const out1 = f1.point.clone().addScaledVector(f1.side, sideSign * (TRACK_WIDTH / 2 + .62));
    positions.push(in0.x, .14, in0.z, out0.x, .14, out0.z, in1.x, .14, in1.z, out1.x, .14, out1.z);
    const onBend = Math.abs(curvatureAt((d0 + d1) * .5)) > .005;
    const c = onBend ? (i % 2 === 0 ? [.52, .15, .12] : [.72, .70, .64]) : [.38, .39, .37];
    for (let j = 0; j < 4; j++) colors.push(...c);
    const n = startVertex + i * 4; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.setIndex(indices); geo.computeVertexNormals();
const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .94, side: THREE.DoubleSide }); const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; scene.add(mesh);
}
makeCurb(-1); makeCurb(1);

// Broken white center guide is a practice reference, not a racing rule.
const guidePoints = [];
for (let d = 0; d < trackLength; d += 11) { const a = trackFrame(d).point, b = trackFrame(d + 3).point; guidePoints.push(a.clone().add(new V(0, .125, 0)), b.clone().add(new V(0, .125, 0))); }
const guideGeo = new THREE.BufferGeometry().setFromPoints(guidePoints);
const guideLine = new THREE.LineSegments(guideGeo, new THREE.LineDashedMaterial({ color: 0xe9e9db, dashSize: 3, gapSize: 5, transparent: true, opacity: .32 })); guideLine.computeLineDistances(); scene.add(guideLine);

// Trackside barriers and marker boards.
const dummy = new THREE.Object3D();
const railMaterial = new THREE.MeshStandardMaterial({ color: 0x999b96, roughness: .42, metalness: .58 });
const railGeo = new THREE.BoxGeometry(5.5, .12, .1);
const railPostGeo = new THREE.CylinderGeometry(.045, .055, .84, 8);
const railCapacity = Math.ceil(trackLength / 5.5);
const rails = new THREE.InstancedMesh(railGeo, railMaterial, railCapacity);
const railPosts = new THREE.InstancedMesh(railPostGeo, railMaterial, railCapacity);
let railCount = 0;
for (let d = 0; d < trackLength; d += 5.5) {
  const bend = curvatureAt(d);
  if (Math.abs(bend) < .0024) continue;
  const frame = trackFrame(d), outerSide = bend > 0 ? -1 : 1;
  const p = frame.point.clone().addScaledVector(frame.side, outerSide * (TRACK_WIDTH / 2 + 1.65));
  const yaw = Math.atan2(-frame.tangent.z, frame.tangent.x);
  dummy.position.set(p.x, .87, p.z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); rails.setMatrixAt(railCount, dummy.matrix);
  dummy.position.set(p.x, .42, p.z); dummy.updateMatrix(); railPosts.setMatrixAt(railCount, dummy.matrix); railCount++;
}
rails.count = railCount; rails.castShadow = true; rails.receiveShadow = true; scene.add(rails);
railPosts.count = railCount; railPosts.castShadow = true; scene.add(railPosts);
const boardMat = new THREE.MeshStandardMaterial({ color: 0xf4f2e8, roughness: .72 });
const boardRed = new THREE.MeshStandardMaterial({ color: 0xc54836, roughness: .75 });
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 256; boardCanvas.height = 128;
const bctx = boardCanvas.getContext('2d'); bctx.fillStyle = '#171d18'; bctx.fillRect(0, 0, 256, 128); bctx.fillStyle = '#d9ff36'; bctx.font = 'bold 42px monospace'; bctx.textAlign = 'center'; bctx.fillText('HIMALAYA', 128, 78);
const signMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(boardCanvas), roughness: .7, emissive: 0x202814 });
function addDistanceBoard(distance, label) {
  const f = trackFrame(distance), pos = f.point.clone().addScaledVector(f.side, TRACK_WIDTH / 2 + 2.2);
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, .18), boardMat); board.position.set(pos.x, 2.15, pos.z); board.rotation.y = Math.atan2(-f.tangent.z, f.tangent.x); board.castShadow = true; scene.add(board);
  const faceCanvas = document.createElement('canvas'); faceCanvas.width = 128; faceCanvas.height = 128; const c = faceCanvas.getContext('2d'); c.fillStyle = '#f2f0e7'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#101511'; c.font = 'bold 55px monospace'; c.textAlign = 'center'; c.fillText(String(label), 64, 83);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.22), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(faceCanvas) })); face.position.set(pos.x, 2.15, pos.z); face.rotation.y = board.rotation.y + Math.PI / 2; scene.add(face);
  const leg1 = new THREE.Mesh(new THREE.BoxGeometry(.12, 1.3, .12), boardRed); leg1.position.set(pos.x - .7, .75, pos.z); scene.add(leg1);
  const leg2 = leg1.clone(); leg2.position.x = pos.x + .7; scene.add(leg2);
}
let lastMarkerCorner = -Infinity, priorCurve = Math.abs(curvatureAt(0));
for (let d = 5; d < trackLength; d += 5) {
  const curveNow = Math.abs(curvatureAt(d));
  if (curveNow > .0068 && priorCurve <= .0068 && d - lastMarkerCorner > 145) {
    addDistanceBoard((d - 100 + trackLength) % trackLength, 100);
    addDistanceBoard((d - 50 + trackLength) % trackLength, 50);
    lastMarkerCorner = d;
  }
  priorCurve = curveNow;
}
const gantryFrame = trackFrame(trackLength - 25);
const gantry = new THREE.Group();
const gantryPoleMat = new THREE.MeshStandardMaterial({ color: 0x111714, metalness: .55, roughness: .45 });
const poleL = new THREE.Mesh(new THREE.BoxGeometry(.65, 10, .65), gantryPoleMat); poleL.position.set(-10.3, 5, 0); gantry.add(poleL);
const poleR = poleL.clone(); poleR.position.x = 10.3; gantry.add(poleR);
const beam = new THREE.Mesh(new THREE.BoxGeometry(21, 1.1, 1), gantryPoleMat); beam.position.y = 9.5; gantry.add(beam);
const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2), signMat); sign.position.set(0, 8.15, .58); gantry.add(sign);
for (let x = -4; x <= 4; x += 2) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(.28, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff322a })); lamp.position.set(x, 7.2, .65); gantry.add(lamp); }
gantry.position.copy(gantryFrame.point); gantry.position.y = 0; gantry.rotation.y = Math.atan2(-gantryFrame.side.z, gantryFrame.side.x); scene.add(gantry);

const kametTexture = new THREE.TextureLoader().load('./assets/bike/kamet-white-camo.jpg');
kametTexture.colorSpace = THREE.SRGBColorSpace;
kametTexture.wrapS = kametTexture.wrapT = THREE.RepeatWrapping;
kametTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
// The tank UVs run around the cross-section and along its length. Scale the paint
// slightly so the camo reads as tank graphics instead of a huge repeated print.
kametTexture.repeat.set(1, 1);

function makeBike(color, accent, isPlayer = false) {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: isPlayer ? 0xffffff : color, map: isPlayer ? kametTexture : null, metalness: .28, roughness: .4 });
  const trim = new THREE.MeshStandardMaterial({ color: accent, metalness: .35, roughness: .3, emissive: accent, emissiveIntensity: .12 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0d0c, roughness: .88 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c9791, metalness: .82, roughness: .25 });
  const suit = new THREE.MeshStandardMaterial({ color: isPlayer ? 0x202923 : color, roughness: .7 });
  const wheelGeo = new THREE.CylinderGeometry(.48, .48, .24, 24); wheelGeo.rotateZ(Math.PI / 2);
  const wheelFront = new THREE.Mesh(wheelGeo, rubber); wheelFront.position.set(0, .48, -1.15); wheelFront.castShadow = true; root.add(wheelFront);
  const wheelRear = new THREE.Mesh(wheelGeo, rubber); wheelRear.position.set(0, .48, 1.1); wheelRear.castShadow = true; root.add(wheelRear);
  for (const z of [-1.15, 1.1]) { const hub = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .28, 18), metal); hub.rotation.z = Math.PI / 2; hub.position.set(0, .48, z); root.add(hub); }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(.28, .36, 1.8), metal); frame.position.set(0, .73, .05); root.add(frame);
  const tank = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), paint); tank.scale.set(.64, .36, .85); tank.position.set(0, 1.04, .02); tank.castShadow = true; root.add(tank);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(.54, 1.15, 5), paint); tail.rotation.x = -Math.PI / 2; tail.scale.set(1, 1, .7); tail.position.set(0, .91, .96); tail.castShadow = true; root.add(tail);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), paint); nose.scale.set(.58, .35, .7); nose.position.set(0, 1.05, -1.02); nose.castShadow = true; root.add(nose);
  if (isPlayer) {
    const beak = new THREE.Mesh(new THREE.BoxGeometry(.48, .14, .92), paint); beak.position.set(0, .92, -1.48); beak.castShadow = true; root.add(beak);
    const screenShape = new THREE.Shape(); screenShape.moveTo(-.35, 0); screenShape.lineTo(-.29, .72); screenShape.lineTo(.29, .72); screenShape.lineTo(.35, 0); screenShape.closePath();
    const screen = new THREE.Mesh(new THREE.ShapeGeometry(screenShape), new THREE.MeshStandardMaterial({ color: 0x9eb3b1, transparent: true, opacity: .48, roughness: .2, side: THREE.DoubleSide }));
    screen.position.set(0, 1.24, -1.3); root.add(screen);
    bar([-.42, .78, -.58], [-.65, .72, -.98], .055, metal); bar([.42, .78, -.58], [.65, .72, -.98], .055, metal);
    bar([-.65, .72, -.98], [-.8, .72, -1.05], .035, metal); bar([.65, .72, -.98], [.8, .72, -1.05], .035, metal);
    const fender = new THREE.Mesh(new THREE.BoxGeometry(.52, .11, 1.05), paint); fender.position.set(0, .94, -1.48); fender.rotation.x = -.07; root.add(fender);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(.12, .045, 1.3), trim); stripe.position.set(0, 1.37, -.35); root.add(stripe);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(.72, .16, .85), rubber); seat.position.set(0, 1.02, .66); root.add(seat);
  function bar(a, b, radius, material) {
    const start = new V(...a), end = new V(...b), dir = new V().subVectors(end, start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 8), material);
    mesh.position.copy(start).add(end).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new V(0, 1, 0), dir.normalize()); root.add(mesh); return mesh;
  }
  bar([0, .65, 1.0], [-.42, 1.62, .15], .12, suit); bar([0, .65, 1.0], [.42, 1.62, .15], .12, suit);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(.29, 18, 14), new THREE.MeshStandardMaterial({ color: isPlayer ? 0xd9ff36 : 0xe0e1d8, metalness: .24, roughness: .24 })); helmet.position.set(0, 1.82, .17); helmet.scale.set(1, 1.06, .94); helmet.castShadow = true; root.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(.21, 16, 12), new THREE.MeshStandardMaterial({ color: 0x18272b, metalness: .6, roughness: .16 })); visor.scale.set(1, .57, .54); visor.position.set(0, 1.86, -.07); root.add(visor);
  bar([-.19, 1.43, .12], [-.55, 1.05, -.54], .085, suit); bar([.19, 1.43, .12], [.55, 1.05, -.54], .085, suit);
  bar([-.55, 1.05, -.54], [-.37, .9, -1.0], .075, suit); bar([.55, 1.05, -.54], [.37, .9, -1.0], .075, suit);
  bar([-.31, .49, .5], [-.48, .49, -.35], .12, suit); bar([.31, .49, .5], [.48, .49, -.35], .12, suit);
  const light = new THREE.Mesh(isPlayer ? new THREE.SphereGeometry(.25, 16, 12) : new THREE.BoxGeometry(.28, .13, .04), new THREE.MeshBasicMaterial({ color: isPlayer ? 0xe9ffb0 : 0xff6045 })); light.position.set(0, 1.05, isPlayer ? -1.68 : -1.66); root.add(light);
  const headlight = new THREE.PointLight(isPlayer ? 0xd9ffae : 0xff6045, 5, 18); headlight.position.set(0, 1.05, -1.8); root.add(headlight);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.8, 20), new THREE.MeshBasicMaterial({ color: 0x020403, transparent: true, opacity: .25 })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .03; root.add(shadow);
  root.userData.wheels = [wheelFront, wheelRear];
  root.traverse(obj => { if (obj.isMesh) { obj.castShadow = obj.castShadow ?? true; } });
  scene.add(root); return root;
}
const playerBike = makeBike(0xf0f1ec, 0x6e7771, true);
playerBike.visible = false;
function makeRiderCockpit() {
  const cockpit = new THREE.Group(); camera.add(cockpit);
  const cockpitUp = new V(0, 1, 0);
  const dark = new THREE.MeshStandardMaterial({ color: 0x171c1a, metalness: .25, roughness: .66 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0x87918c, metalness: .78, roughness: .3 });
  const pearl = new THREE.MeshStandardMaterial({ color: 0xf0f1ec, metalness: .22, roughness: .4 });
  const smoke = new THREE.MeshPhysicalMaterial({ color: 0x60756e, transparent: true, opacity: .34, roughness: .16, metalness: .05, side: THREE.DoubleSide, depthWrite: false, clearcoat: .9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x101312, roughness: .94 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x252c28, roughness: .82 });
  const knuckleMat = new THREE.MeshStandardMaterial({ color: 0x46504a, roughness: .72 });
  const ridingJacket = new THREE.MeshStandardMaterial({ color: 0x62695e, roughness: .88 });
  const bar = (a, b, radius, material) => {
    const start = new V(...a), end = new V(...b), direction = new V().subVectors(end, start);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material);
    tube.position.copy(start).add(end).multiplyScalar(.5); tube.quaternion.setFromUnitVectors(cockpitUp, direction.normalize()); cockpit.add(tube); return tube;
  };
  const tankSections = [
    [-2.12, .12, .09, -.78], [-1.98, .23, .17, -.77], [-1.79, .34, .235, -.79],
    [-1.56, .405, .285, -.86], [-1.34, .42, .29, -.94], [-1.13, .38, .255, -.99],
    [-.96, .30, .20, -1.01], [-.83, .18, .12, -1.0], [-.77, .10, .065, -1.0]
  ];
  const tankRadial = 32, tankVertices = [], tankUvs = [], tankIndices = [];
  tankSections.forEach(([z, width, height, centerY], row) => {
    for (let col = 0; col <= tankRadial; col++) {
      const angle = col / tankRadial * Math.PI * 2 + Math.PI;
      tankVertices.push(Math.sin(angle) * width, centerY + Math.cos(angle) * height, z);
      tankUvs.push(col / tankRadial, row / (tankSections.length - 1));
      if (row < tankSections.length - 1 && col < tankRadial) {
        const a = row * (tankRadial + 1) + col, b = a + 1, c = a + tankRadial + 1, d = c + 1;
        tankIndices.push(a, c, b, b, c, d);
      }
    }
  });
  const tankGeo = new THREE.BufferGeometry();
  tankGeo.setAttribute('position', new THREE.Float32BufferAttribute(tankVertices, 3));
  tankGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tankUvs, 2));
  tankGeo.setIndex(tankIndices); tankGeo.computeVertexNormals();
  const tank = new THREE.Mesh(tankGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: kametTexture, metalness: .1, roughness: .24, clearcoat: 1, clearcoatRoughness: .16, side: THREE.DoubleSide }));
  tank.position.y = .02; tank.castShadow = true; cockpit.add(tank);
  const tankCap = new THREE.Mesh(new THREE.CylinderGeometry(.068, .068, .018, 32), alloy); tankCap.position.set(0, -.575, -1.56); cockpit.add(tankCap);
  const capRing = new THREE.Mesh(new THREE.TorusGeometry(.06, .007, 8, 36), dark); capRing.rotation.x = Math.PI / 2; capRing.position.set(0, -.562, -1.56); cockpit.add(capRing);
  for (let bolt = 0; bolt < 6; bolt++) {
    const angle = bolt / 6 * Math.PI * 2, screw = new THREE.Mesh(new THREE.SphereGeometry(.008, 8, 6), pearl);
    screw.position.set(Math.cos(angle) * .052, -.55, -1.56 + Math.sin(angle) * .052); cockpit.add(screw);
  }
  const badgeCanvas = document.createElement('canvas'); badgeCanvas.width = 512; badgeCanvas.height = 128;
  const badgeCtx = badgeCanvas.getContext('2d'); badgeCtx.textAlign = 'center'; badgeCtx.fillStyle = '#35403d';
  badgeCtx.font = '700 42px Arial, sans-serif'; badgeCtx.fillText('ROYAL ENFIELD', 256, 54);
  badgeCtx.fillStyle = '#76807b'; badgeCtx.font = '500 21px Arial, sans-serif'; badgeCtx.fillText('H I M A L A Y A N   4 5 0', 256, 91);
  badgeCtx.fillStyle = '#9da49f'; badgeCtx.fillRect(104, 105, 304, 2);
  const badgeTexture = new THREE.CanvasTexture(badgeCanvas); badgeTexture.colorSpace = THREE.SRGBColorSpace;
  for (const side of [-1, 1]) {
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(.42, .105), new THREE.MeshStandardMaterial({ map: badgeTexture, transparent: true, roughness: .55, side: THREE.DoubleSide, depthWrite: false }));
    badge.position.set(side * .386, -.9, -1.48); badge.rotation.y = side * Math.PI / 2; cockpit.add(badge);
    const kneePad = new THREE.Mesh(new THREE.BoxGeometry(.018, .13, .34), rubber);
    kneePad.position.set(side * .335, -.99, -1.38); kneePad.rotation.y = side * .12; cockpit.add(kneePad);
  }
  const handleCurve = new THREE.CatmullRomCurve3([
    new V(-.82, -.405, -.92), new V(-.72, -.415, -.965), new V(-.52, -.39, -1.035),
    new V(-.32, -.365, -1.075), new V(0, -.36, -1.09), new V(.32, -.365, -1.075),
    new V(.52, -.39, -1.035), new V(.72, -.415, -.965), new V(.82, -.405, -.92)
  ]);
  cockpit.add(new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 64, .018, 10, false), dark));
  const handleCenterBrace = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .39, 12), alloy);
  handleCenterBrace.rotation.z = Math.PI / 2; handleCenterBrace.position.set(0, -.354, -1.086); cockpit.add(handleCenterBrace);
  const clampTop = new THREE.Mesh(new THREE.BoxGeometry(.27, .035, .105), alloy);
  clampTop.position.set(0, -.385, -1.075); cockpit.add(clampTop);
  for (const side of [-1, 1]) {
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(.037, .046, .13, 16), dark);
    riser.position.set(side * .28, -.435, -1.055); cockpit.add(riser);
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(.052, .052, .035, 18), alloy);
    clamp.position.set(side * .28, -.375, -1.055); cockpit.add(clamp);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .009, 6), dark);
    bolt.position.set(side * .28, -.354, -1.055); cockpit.add(bolt);
  }
  const leverMat = new THREE.MeshStandardMaterial({ color: 0xb7beb9, metalness: .84, roughness: .24 });
  const podMat = new THREE.MeshStandardMaterial({ color: 0x202522, metalness: .18, roughness: .72 });
  for (const side of [-1, 1]) {
    // Ribbed rubber grip, aligned over the bar ends, with metal collars at both ends.
    const gripCenter = side * .605;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(.047, .047, .27, 24), rubber);
    grip.rotation.z = Math.PI / 2; grip.position.set(gripCenter, -.414, -.974); cockpit.add(grip);
    for (let rib = 0; rib < 13; rib++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.0475, .0026, 6, 20), dark);
      ring.rotation.y = Math.PI / 2; ring.position.set(side * (.49 + rib * .019), -.414, -.974); cockpit.add(ring);
    }
    for (const x of [side * .47, side * .74]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(.052, .052, .012, 20), alloy);
      collar.rotation.z = Math.PI / 2; collar.position.set(x, -.414, -.974); cockpit.add(collar);
    }
    // Compact hand deflector and its steel stay, sized like an accessory rather than a fairing.
    const guardShape = new THREE.Shape();
    guardShape.moveTo(-.06, -.025); guardShape.quadraticCurveTo(-.085, .045, -.025, .056);
    guardShape.lineTo(.07, .039); guardShape.quadraticCurveTo(.095, .012, .07, -.037);
    guardShape.quadraticCurveTo(.005, -.07, -.06, -.025);
    const guardGeo = new THREE.ExtrudeGeometry(guardShape, { depth: .012, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .004, bevelThickness: .003 });
    const guard = new THREE.Mesh(guardGeo, podMat); guard.position.set(side * .735, -.39, -1.075); guard.rotation.z = side * .1; cockpit.add(guard);
    bar([side * .65, -.41, -.98], [side * .76, -.40, -1.08], .009, alloy);
    // Mirrors sit just above the bar on short swept stems.
    bar([side * .68, -.405, -.955], [side * .79, -.095, -.91], .009, dark);
    bar([side * .79, -.095, -.91], [side * .81, -.065, -.91], .011, alloy);
    const mirror = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), dark); mirror.scale.set(.073, .049, .022); mirror.position.set(side * .81, -.04, -.91); cockpit.add(mirror);
    const mirrorGlass = new THREE.Mesh(new THREE.CircleGeometry(.063, 28), new THREE.MeshPhysicalMaterial({ color: 0xaebbb5, metalness: .42, roughness: .2, clearcoat: 1 }));
    mirrorGlass.scale.set(1, .68, 1); mirrorGlass.position.set(side * .81, -.04, -.884); cockpit.add(mirrorGlass);
    // Forged clutch / front brake levers curve forward from the pivot.
    const leverPath = new THREE.CatmullRomCurve3([
      new V(side * .48, -.41, -1.005), new V(side * .46, -.405, -1.095),
      new V(side * .41, -.39, -1.21), new V(side * .35, -.37, -1.30)
    ]);
    cockpit.add(new THREE.Mesh(new THREE.TubeGeometry(leverPath, 18, .008, 8, false), leverMat));
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, .04, 16), alloy);
    pivot.rotation.z = Math.PI / 2; pivot.position.set(side * .48, -.405, -1.005); cockpit.add(pivot);
    // Distinct, compact switch pods; the right side carries the red engine stop switch.
    const switchPod = new THREE.Mesh(new THREE.BoxGeometry(.115, .078, .12), podMat);
    switchPod.position.set(side * .43, -.375, -.91); switchPod.rotation.z = side * .08; cockpit.add(switchPod);
    const topButton = new THREE.Mesh(new THREE.BoxGeometry(.038, .018, .028), side > 0 ? new THREE.MeshStandardMaterial({ color: 0xc43d31, roughness: .48 }) : alloy);
    topButton.position.set(side * .43, -.326, -.91); cockpit.add(topButton);
    for (let buttonIndex = 0; buttonIndex < 2; buttonIndex++) {
      const button = new THREE.Mesh(new THREE.BoxGeometry(.026, .012, .018), alloy);
      button.position.set(side * (.43 - buttonIndex * .028), -.355, -.84); cockpit.add(button);
    }
    if (side > 0) {
      const reservoir = new THREE.Mesh(new THREE.BoxGeometry(.10, .068, .15), podMat);
      reservoir.position.set(.34, -.325, -.91); cockpit.add(reservoir);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(.09, .012, .13), alloy);
      cap.position.set(.34, -.285, -.91); cockpit.add(cap);
    }
    const glove = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), gloveMat);
    glove.scale.set(.12, .058, .075); glove.position.set(side * .53, -.432, -.97); cockpit.add(glove);
    for (let finger = 0; finger < 4; finger++) {
      const digit = new THREE.Mesh(new THREE.CapsuleGeometry(.012, .047, 3, 8), gloveMat);
      digit.rotation.x = Math.PI / 2; digit.rotation.z = side * -.15;
      digit.position.set(side * (.49 + finger * .026), -.455, -.94); cockpit.add(digit);
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(.011, 12, 10), knuckleMat);
      knuckle.scale.set(1.1, .7, 1.2); knuckle.position.set(side * (.49 + finger * .026), -.418, -.94); cockpit.add(knuckle);
    }
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(.03, 16, 12), gloveMat);
    thumb.scale.set(1.1, .7, 1.1); thumb.position.set(side * .46, -.438, -1.005); cockpit.add(thumb);
    const armStart = new V(side * .88, -.8, -.42), armEnd = new V(side * .55, -.43, -.97);
    const armAxis = new V().subVectors(armEnd, armStart), arm = new THREE.Mesh(new THREE.CapsuleGeometry(.043, .42, 5, 12), ridingJacket);
    arm.position.copy(armStart).add(armEnd).multiplyScalar(.5); arm.quaternion.setFromUnitVectors(cockpitUp, armAxis.normalize()); cockpit.add(arm);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(.052, .056, .075, 16), dark);
    cuff.position.copy(armEnd).addScaledVector(armAxis, -.07); cuff.quaternion.setFromUnitVectors(cockpitUp, armAxis); cockpit.add(cuff);
  }
  const screenShape = new THREE.Shape(); screenShape.moveTo(-.43, -.32); screenShape.lineTo(-.37, .47); screenShape.quadraticCurveTo(-.34, .57, -.24, .59); screenShape.lineTo(.24, .59); screenShape.quadraticCurveTo(.34, .57, .37, .47); screenShape.lineTo(.43, -.32); screenShape.closePath();
  const screenGeo = new THREE.ShapeGeometry(screenShape, 16);
  const screenPos = screenGeo.attributes.position;
  for (let i = 0; i < screenPos.count; i++) {
    const x = screenPos.getX(i), y = screenPos.getY(i);
    screenPos.setZ(i, .075 * (x / .43) ** 2 - .018 * y);
  }
  screenGeo.computeVertexNormals();
  const screen = new THREE.Mesh(screenGeo, smoke); screen.scale.set(.82, .86, 1); screen.position.set(0, -.15, -1.52); cockpit.add(screen);
  const screenEdgePoints = screenShape.getPoints(48).map(p => new V(p.x * .82, -.15 + p.y * .86, -1.52 + .075 * (p.x / .43) ** 2 - .018 * p.y));
  cockpit.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(screenEdgePoints), new THREE.LineBasicMaterial({ color: 0x17201e, transparent: true, opacity: .9 })));
  bar([-.35, -.62, -1.51], [-.29, -.19, -1.51], .012, alloy);
  bar([.35, -.62, -1.51], [.29, -.19, -1.51], .012, alloy);
  for (const side of [-1, 1]) {
    const fork = bar([side * .34, -.56, -1.2], [side * .29, -.98, -2.08], .055, alloy);
    fork.material = new THREE.MeshStandardMaterial({ color: 0xb77938, metalness: .75, roughness: .26 });
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(.072, .072, .36, 12), dark); guard.position.set(side * .325, -.66, -1.4); guard.rotation.x = .42; cockpit.add(guard);
  }
  const fenderPositions = [], fenderUvs = [], fenderIndices = [], fenderRows = 14, fenderCols = 8;
  for (let row = 0; row <= fenderRows; row++) for (let col = 0; col <= fenderCols; col++) {
    const longitudinal = row / fenderRows * 2 - 1, lateral = col / fenderCols * 2 - 1;
    const z = -2.08 + longitudinal * .43, x = lateral * (.27 - Math.abs(longitudinal) * .055);
    const y = -.93 + longitudinal * longitudinal * .11 + lateral * lateral * .025;
    fenderPositions.push(x, y, z); fenderUvs.push(col / fenderCols, row / fenderRows);
    if (row < fenderRows && col < fenderCols) {
      const a = row * (fenderCols + 1) + col, b = a + 1, c = a + fenderCols + 1, d = c + 1;
      fenderIndices.push(a, b, c, b, d, c);
    }
  }
  const fenderGeo = new THREE.BufferGeometry();
  fenderGeo.setAttribute('position', new THREE.Float32BufferAttribute(fenderPositions, 3)); fenderGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fenderUvs, 2));
  fenderGeo.setIndex(fenderIndices); fenderGeo.computeVertexNormals();
  const frontFender = new THREE.Mesh(fenderGeo, new THREE.MeshPhysicalMaterial({ color: 0xf0f1ec, metalness: .15, roughness: .3, clearcoat: .8, side: THREE.DoubleSide })); cockpit.add(frontFender);
  const fenderTip = new THREE.Mesh(new THREE.BoxGeometry(.29, .025, .13), dark); fenderTip.position.set(0, -.95, -2.48); cockpit.add(fenderTip);
  const lampHousing = new THREE.Mesh(new THREE.CylinderGeometry(.205, .205, .12, 32), dark); lampHousing.rotation.x = Math.PI / 2; lampHousing.position.set(0, -.89, -2.16); cockpit.add(lampHousing);
  const lampLens = new THREE.Mesh(new THREE.CircleGeometry(.17, 32), new THREE.MeshPhysicalMaterial({ color: 0xeaf3e5, emissive: 0x19231b, roughness: .18, metalness: .12, clearcoat: 1 })); lampLens.position.set(0, -.89, -2.225); cockpit.add(lampLens);
  const lampRim = new THREE.Mesh(new THREE.TorusGeometry(.184, .012, 10, 48), alloy); lampRim.position.set(0, -.89, -2.231); cockpit.add(lampRim);
  for (const side of [-1, 1]) {
    const crashBarPath = new THREE.CatmullRomCurve3([
      new V(side * .38, -.62, -1.88), new V(side * .53, -.69, -1.67), new V(side * .59, -.91, -1.43),
      new V(side * .52, -1.10, -1.20), new V(side * .35, -1.08, -1.10)
    ]);
    cockpit.add(new THREE.Mesh(new THREE.TubeGeometry(crashBarPath, 36, .018, 8, false), dark));
    const forkCap = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .025, 24), alloy);
    forkCap.position.set(side * .34, -.555, -1.20); forkCap.rotation.x = Math.PI / 2; cockpit.add(forkCap);
  }
    const cluster = new THREE.Mesh(new THREE.CylinderGeometry(.072, .072, .065, 40), dark); cluster.rotation.x = Math.PI / 2; cluster.position.set(0, -.37, -.91); cockpit.add(cluster);
  const screenRim = new THREE.Mesh(new THREE.TorusGeometry(.061, .006, 8, 40), alloy); screenRim.position.set(0, -.37, -.871); cockpit.add(screenRim);
  const displayCanvas = document.createElement('canvas'); displayCanvas.width = 256; displayCanvas.height = 256;
  const displayCtx = displayCanvas.getContext('2d');
  const displayTexture = new THREE.CanvasTexture(displayCanvas); displayTexture.colorSpace = THREE.SRGBColorSpace;
  const display = new THREE.Mesh(new THREE.CircleGeometry(.054, 40), new THREE.MeshBasicMaterial({ map: displayTexture })); display.position.set(0, -.37, -.867); cockpit.add(display);
  const outerBezel = new THREE.Mesh(new THREE.TorusGeometry(.072, .006, 10, 48), dark); outerBezel.position.set(0, -.37, -.866); cockpit.add(outerBezel);
  let lastDisplaySpeed = -1;
  const updateDisplay = kmh => {
    if (kmh === lastDisplaySpeed) return; lastDisplaySpeed = kmh;
    displayCtx.fillStyle = '#08110f'; displayCtx.fillRect(0, 0, 256, 256); displayCtx.textAlign = 'center';
    displayCtx.beginPath(); displayCtx.arc(128, 128, 109, Math.PI * .76, Math.PI * 2.24); displayCtx.strokeStyle = '#54645a'; displayCtx.lineWidth = 5; displayCtx.stroke();
    for (let tick = 0; tick <= 8; tick++) {
      const angle = Math.PI * .76 + tick * Math.PI * 1.48 / 8, inner = 92, outer = tick % 2 ? 101 : 106;
      displayCtx.beginPath(); displayCtx.moveTo(128 + Math.cos(angle) * inner, 128 + Math.sin(angle) * inner);
      displayCtx.lineTo(128 + Math.cos(angle) * outer, 128 + Math.sin(angle) * outer);
      displayCtx.strokeStyle = tick > 6 ? '#d7a35b' : '#bac6ba'; displayCtx.lineWidth = tick % 2 ? 2 : 3; displayCtx.stroke();
      if (tick % 2 === 0) { displayCtx.fillStyle = '#bdc8bd'; displayCtx.font = '16px Arial'; displayCtx.fillText(String(tick), 128 + Math.cos(angle) * 78, 134 + Math.sin(angle) * 78); }
    }
    displayCtx.fillStyle = '#a8d297'; displayCtx.font = 'bold 17px Arial'; displayCtx.fillText('N', 83, 162);
    displayCtx.fillStyle = '#edf1e9'; displayCtx.font = 'bold 66px Arial'; displayCtx.fillText(String(kmh), 142, 151);
    displayCtx.fillStyle = '#b7c4b8'; displayCtx.font = '15px Arial'; displayCtx.fillText('km/h', 146, 173);
    displayCtx.fillStyle = '#e0e7dc'; displayCtx.font = 'bold 14px Arial'; displayCtx.fillText('ROYAL ENFIELD', 128, 213);
    displayTexture.needsUpdate = true;
  };
  updateDisplay(0);
  return updateDisplay;
}
const updateCockpitDisplay = makeRiderCockpit();
const racers = [
  { name: 'RAVI', bike: makeBike(0xe34c34, 0xf1c46c), distance: 18, phase: 1.4 },
  { name: 'AYA', bike: makeBike(0x287f8c, 0xff7449), distance: 38, phase: 4.2 }
];

function addTrackside() {
  // Sparse high-desert rock fields replace planted conifer rows and race paddock props.
  const rockGeo = new THREE.IcosahedronGeometry(1, 2);
  const rockVertices = rockGeo.attributes.position;
  for (let i = 0; i < rockVertices.count; i++) {
    const x = rockVertices.getX(i), y = rockVertices.getY(i), z = rockVertices.getZ(i);
    const rough = 1 + .085 * Math.sin(x * 11 + y * 7 + z * 4) + .04 * Math.sin(x * 19 - z * 13);
    rockVertices.setXYZ(i, x * rough, y * rough, z * rough);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 380);
  const roadHazards = [];
  let n = 0, seed = 91073;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let d = 0; d < trackLength; d += 15) {
    const f = trackFrame(d);
    for (const side of [-1, 1]) {
      if (rand() < .46) continue;
      const pos = f.point.clone().addScaledVector(f.side, side * (TRACK_WIDTH / 2 + 16 + rand() * 90));
      const size = .5 + rand() * 3.8;
      dummy.position.set(pos.x, -size * .22, pos.z);
      dummy.rotation.set(rand(), rand() * 6, rand());
      dummy.scale.set(size * (1 + rand()), size * (.42 + rand() * .48), size * (.8 + rand()));
      dummy.updateMatrix(); rocks.setMatrixAt(n, dummy.matrix);
      const tint = .74 + rand() * .25;
      rocks.setColorAt(n++, new THREE.Color(tint * .96, tint, tint * 1.02));
    }
  }
  // A few loose boulders have rolled onto the outer edge of the asphalt. These
  // are intentionally visible hazards; the distant talus field stays scenery.
  for (let d = 92, hazardIndex = 0; d < trackLength; d += 188, hazardIndex++) {
    const f = trackFrame(d), side = hazardIndex % 2 ? -1 : 1;
    const offset = side * (4.45 + rand() * .55), size = .62 + rand() * .34;
    const pos = f.point.clone().addScaledVector(f.side, offset);
    dummy.position.set(pos.x, size * .42, pos.z);
    dummy.rotation.set(rand() * .35, rand() * Math.PI * 2, rand() * .3);
    dummy.scale.set(size * (1.05 + rand() * .25), size * (.48 + rand() * .2), size * (.82 + rand() * .22));
    dummy.updateMatrix(); rocks.setMatrixAt(n, dummy.matrix);
    const tint = .68 + rand() * .16; rocks.setColorAt(n++, new THREE.Color(tint * .96, tint, tint * 1.02));
    roadHazards.push({ distance: d, offset, radius: size * .57 + .48 });
  }
  rocks.count = n; rocks.receiveShadow = true; scene.add(rocks);

  // Occasional reflective snow poles are characteristic of a high mountain road.
  const postGeo = new THREE.CylinderGeometry(.055, .075, 1.5, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cb, roughness: .75 });
  const reflectorMat = new THREE.MeshBasicMaterial({ color: 0xe8b868 });
  for (let d = 0; d < trackLength; d += 58) {
    const f = trackFrame(d), p = f.point.clone().addScaledVector(f.side, TRACK_WIDTH / 2 + 2.7);
    const post = new THREE.Mesh(postGeo, postMat); post.position.set(p.x, .7, p.z); scene.add(post);
    const reflector = new THREE.Mesh(new THREE.BoxGeometry(.17, .11, .04), reflectorMat);
    reflector.position.set(p.x, 1.03, p.z); reflector.rotation.y = Math.atan2(-f.tangent.z, f.tangent.x); scene.add(reflector);
  }
  return roadHazards;
}
const roadHazards = addTrackside();

async function loadRideEngine() {
  const response = await fetch('./assets/ride_engine.wasm');
  if (!response.ok) throw new Error(`Rust ride engine could not be loaded (${response.status}). Start the game with just run.`);
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const wasm = instance.exports;
  wasm.engine_init(trackLength, 1);
  const transfer = (values, setter) => {
    const packed = Float32Array.from(values), pointer = wasm.engine_alloc_f32(packed.length);
    new Float32Array(wasm.memory.buffer, pointer, packed.length).set(packed);
    wasm[setter](pointer, packed.length);
    wasm.engine_free_f32(pointer, packed.length);
  };
  transfer(curveSamples, 'engine_set_curvature');
  transfer(roadHazards.flatMap(hazard => [hazard.distance, hazard.offset, hazard.radius]), 'engine_set_hazards');
  wasm.engine_set_best_lap(Number(localStorage.getItem('redline-best-lap')) || 0);
  return wasm;
}
const rideEngine = await loadRideEngine();

let running = false, countingDown = false, crashed = false, freedomMode = true;
let speed = 0, playerDistance = 0, laneOffset = 0, steerInput = 0, throttleInput = false, brakeInput = false;
const steerSources = new Map();
function refreshSteeringInput() {
  const left = [...steerSources.values()].some(value => value < 0), right = [...steerSources.values()].some(value => value > 0);
  steerInput = left === right ? 0 : left ? -1 : 1;
}
let bikeLean = 0;
let sessionTime = 0, lapStartedAt = 0, lastLapSeconds = null, bestLapSeconds = Number(localStorage.getItem('redline-best-lap') || 0);
let cameraInitialized = false, previousFrame = performance.now(), soundEnabled = true;
let audioContext = null, engineOsc1 = null, engineOsc2 = null, engineGain = null, windGain = null, windFilter = null;
let crashSpeed = 0;
const tmpPos = new V(), tmpTan = new V(), cameraGoal = new V(), lookGoal = new V();
const upAxis = new V(0, 1, 0), rollAxis = new V(0, 0, 1), bankQuaternion = new THREE.Quaternion();
const trackMinX = Math.min(...trackPoints.map(p => p.x)) - 15, trackMaxX = Math.max(...trackPoints.map(p => p.x)) + 15;
const trackMinZ = Math.min(...trackPoints.map(p => p.z)) - 15, trackMaxZ = Math.max(...trackPoints.map(p => p.z)) + 15;

function buildEngineSound() {
  if (!soundEnabled) return;
  const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
  if (!audioContext) {
    audioContext = new Audio(); engineOsc1 = audioContext.createOscillator(); engineOsc2 = audioContext.createOscillator();
    const filter = audioContext.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 860; filter.Q.value = .7;
    engineGain = audioContext.createGain(); engineGain.gain.value = 0;
    // A long-stroke single cylinder fires once every two crank revolutions.
    // A pulse-rich waveform and octave layer give the engine its uneven thump.
    const real = new Float32Array(12), imag = new Float32Array(12);
    for (let harmonic = 1; harmonic < imag.length; harmonic++) {
      imag[harmonic] = 1 / harmonic * (harmonic % 2 ? 1 : .48);
    }
    engineOsc1.setPeriodicWave(audioContext.createPeriodicWave(real, imag));
    engineOsc2.type = 'triangle'; engineOsc1.frequency.value = 11; engineOsc2.frequency.value = 33;
    engineOsc1.connect(filter); engineOsc2.connect(filter); filter.connect(engineGain); engineGain.connect(audioContext.destination);
    const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate); const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = (Math.random() * 2 - 1) * .38;
    const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.loop = true; windFilter = audioContext.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 350;
    windGain = audioContext.createGain(); windGain.gain.value = 0; noise.connect(windFilter); windFilter.connect(windGain); windGain.connect(audioContext.destination);
    engineOsc1.start(); engineOsc2.start(); noise.start();
  }
  audioContext.resume(); engineGain.gain.setTargetAtTime(.07, audioContext.currentTime, .18); windGain.gain.setTargetAtTime(.018, audioContext.currentTime, .2);
}
function setSound(enabled) {
  soundEnabled = enabled; soundText.textContent = enabled ? 'SOUND ON' : 'SOUND OFF';
  if (audioContext && engineGain) { const t = audioContext.currentTime; engineGain.gain.setTargetAtTime(enabled && running && !crashed ? .16 : 0, t, .12); windGain.gain.setTargetAtTime(enabled && running && !crashed ? .02 : 0, t, .12); if (enabled) audioContext.resume(); }
}
document.querySelector('#sound-toggle').addEventListener('click', () => setSound(!soundEnabled));
function playImpact() {
  if (!soundEnabled || !audioContext) return;
  const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.type = 'triangle'; osc.frequency.setValueAtTime(130, audioContext.currentTime); osc.frequency.exponentialRampToValueAtTime(37, audioContext.currentTime + .22); gain.gain.setValueAtTime(.2, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .24); osc.connect(gain); gain.connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + .25);
}

function curvatureAt(distance) {
  const sample = (((distance % trackLength) + trackLength) % trackLength) / CURVATURE_STEP;
  const i = Math.floor(sample), f = sample - i;
  return THREE.MathUtils.lerp(curveSamples[i % curveSamples.length], curveSamples[(i + 1) % curveSamples.length], f);
}
function showCrash(reason, message) {
  if (crashed) return;
  crashed = true; running = false; crashSpeed = rideEngine.engine_crash_speed(); speed = 0;
  steerSources.clear(); refreshSteeringInput(); throttleInput = false; brakeInput = false;
  crashScreen.classList.add('visible'); document.querySelector('#crash-title').textContent = reason;
  document.querySelector('#crash-detail').textContent = message;
  document.querySelector('#crash-speed').textContent = `${String(Math.round(crashSpeed)).padStart(3, '0')} KM/H`;
  document.querySelector('#crash-time').textContent = formatTime(sessionTime - lapStartedAt);
  sessionStateEl.textContent = 'SESSION STOPPED'; statusEl.textContent = 'RESET TO TRY THAT CORNER AGAIN';
  if (engineGain && audioContext) engineGain.gain.setTargetAtTime(0, audioContext.currentTime, .04);
  playImpact(); if (navigator.vibrate) navigator.vibrate([60, 30, 90]);
  playerBike.rotation.z = steerInput * .35 + .8; playerBike.rotation.x = .2;
}
function resetAtCheckpoint() {
  rideEngine.engine_reset();
  playerDistance = rideEngine.engine_distance(); laneOffset = rideEngine.engine_lane(); speed = rideEngine.engine_speed(); crashed = false; running = true;
  steerSources.clear(); refreshSteeringInput(); throttleInput = false; brakeInput = false;
  crashScreen.classList.remove('visible'); sessionStateEl.textContent = 'GREEN FLAG'; statusEl.textContent = 'RESET YOUR LINE. BRAKE BEFORE TURN IN.';
  coachTextEl.textContent = 'Try braking earlier, then release smoothly as you lean toward the apex.';
  lastLapSeconds = null; lapStartedAt = sessionTime; cameraInitialized = false;
  if (soundEnabled) buildEngineSound();
}
document.querySelector('#retry').addEventListener('click', () => {
  if (sessionStateEl.textContent === 'CHEQUERED FLAG') window.location.reload();
  else resetAtCheckpoint();
});
document.querySelector('#restart').addEventListener('click', event => { event.preventDefault(); window.location.reload(); });

document.querySelectorAll('[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    freedomMode = button.dataset.mode === 'freedom';
    rideEngine.engine_set_mode(freedomMode ? 1 : 0);
    document.querySelectorAll('[data-mode]').forEach(option => {
      const selected = option === button;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
    modeKicker.textContent = freedomMode ? 'LADAKH PASS / FREEDOM RIDE' : 'LADAKH PASS / FIRST SESSION';
    lapEl.innerHTML = '01<span>/ 03</span>';
    introTitle.innerHTML = freedomMode ? 'RIDE WITHOUT<br/><em>A CEILING.</em>' : 'RIDE THE<br/><em>RACING LINE.</em>';
    introCopy.innerHTML = freedomMode
      ? 'No speed limiter. Three laps to the flag.<br/>You, the circuit, and Ravi and Aya.'
      : 'Three timed laps. Learn the line, brake before turn-in,<br/>and build speed with a 282 km/h limiter.';
    launchButton.innerHTML = freedomMode
      ? '<span>▶</span> START FREEDOM RIDE <b>↗</b>'
      : '<span>▶</span> ENTER THE CIRCUIT <b>↗</b>';
  });
});

function setInputButtons() {
  const bindHold = (button, setter) => {
    const down = e => { e.preventDefault(); setter(true); button.classList.add('held'); button.setPointerCapture?.(e.pointerId); };
    const up = () => { setter(false); button.classList.remove('held'); };
    button.addEventListener('pointerdown', down); for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, up);
  };
  bindHold(throttleButton, v => throttleInput = v); bindHold(brakeButton, v => brakeInput = v);
  document.querySelectorAll('[data-steer]').forEach(button => {
    const value = Number(button.dataset.steer);
    const down = e => { e.preventDefault(); steerSources.set(button, value); refreshSteeringInput(); button.classList.add('held'); button.setPointerCapture?.(e.pointerId); };
    const up = () => { steerSources.delete(button); refreshSteeringInput(); button.classList.remove('held'); };
    button.addEventListener('pointerdown', down); for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, up);
  });
}
setInputButtons();
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(key)) event.preventDefault();
  if (key === 'a' || key === 'arrowleft') { steerSources.set(key, -1); refreshSteeringInput(); }
  if (key === 'd' || key === 'arrowright') { steerSources.set(key, 1); refreshSteeringInput(); }
  if (key === 'w' || key === 'arrowup') throttleInput = true;
  if (key === 's' || key === 'arrowdown' || key === ' ') brakeInput = true;
});
window.addEventListener('keyup', event => {
  const key = event.key.toLowerCase();
  if (key === 'a' || key === 'arrowleft') { steerSources.delete(key); refreshSteeringInput(); }
  if (key === 'd' || key === 'arrowright') { steerSources.delete(key); refreshSteeringInput(); }
  if (key === 'w' || key === 'arrowup') throttleInput = false;
  if (key === 's' || key === 'arrowdown' || key === ' ') brakeInput = false;
});
window.addEventListener('blur', () => { steerSources.clear(); refreshSteeringInput(); throttleInput = false; brakeInput = false; });

document.querySelector('#start-session').addEventListener('click', () => {
  if (running || countingDown) return;
  buildEngineSound(); countingDown = true; intro.classList.add('hidden');
  const steps = ['3', '2', '1', 'GO']; let n = 0;
  const next = () => {
    countdown.textContent = steps[n]; countdown.classList.remove('show'); void countdown.offsetWidth; countdown.classList.add('show');
    if (steps[n] === 'GO') {
      countingDown = false; running = true; crashed = false;
      rideEngine.engine_set_best_lap(bestLapSeconds || 0); rideEngine.engine_start();
      sessionTime = rideEngine.engine_session_time(); lapStartedAt = 0; playerDistance = rideEngine.engine_distance();
      sim.classList.add('racing');
      sessionStateEl.textContent = freedomMode ? 'FREEDOM RIDE' : 'GREEN FLAG';
      statusEl.textContent = freedomMode ? 'OPEN GRID · NO SPEED LIMIT' : 'RIDE THE LINE. WATCH YOUR BRAKING POINTS.';
      coachTextEl.textContent = freedomMode
        ? 'Open throttle and race Ravi and Aya. The circuit still rewards a clean line.'
        : 'Approach the first corner. Brake before turn in, then release smoothly.';
      if (navigator.vibrate) navigator.vibrate(45); return;
    }
    n++; window.setTimeout(next, 720);
  };
  next();
});

function updateRider(mesh, distance, offset, bank = 0, dt = 0) {
  const f = trackFrame(distance), pos = f.point.clone().addScaledVector(f.side, offset);
  mesh.position.set(pos.x, .08, pos.z);
  const yaw = Math.atan2(-f.tangent.x, -f.tangent.z);
  mesh.quaternion.setFromAxisAngle(upAxis, yaw);
  bankQuaternion.setFromAxisAngle(rollAxis, bank);
  mesh.quaternion.multiply(bankQuaternion);
  const wheelSpin = distance * 2.1;
  for (const wheel of mesh.userData.wheels) wheel.rotation.x = wheelSpin;
  return { f, pos };
}
function updatePhysics(dt) {
  rideEngine.engine_set_input(steerInput, throttleInput ? 1 : 0, brakeInput ? 1 : 0);
  rideEngine.engine_step(dt);
  speed = rideEngine.engine_speed(); playerDistance = rideEngine.engine_distance(); laneOffset = rideEngine.engine_lane();
  sessionTime = rideEngine.engine_session_time();
  const lapNow = rideEngine.engine_lap(), eventCode = rideEngine.engine_event();
  lapEl.innerHTML = `${String(Math.min(lapNow, 3)).padStart(2, '0')}<span>/ 03</span>`;

  if (eventCode === 1 || eventCode === 6) {
    lastLapSeconds = rideEngine.engine_last_lap(); lapStartedAt = sessionTime;
    lastLapEl.textContent = formatTime(lastLapSeconds);
    bestLapSeconds = rideEngine.engine_best_lap();
    if (bestLapSeconds) localStorage.setItem('redline-best-lap', String(bestLapSeconds));
    bestLapEl.textContent = bestLapSeconds ? formatTime(bestLapSeconds) : '--:--.--';
    coachTextEl.textContent = freedomMode ? 'Lap complete. Two laps to the flag.' : 'Lap complete. Smooth inputs beat desperate ones. Go again.';
  }

  const cornerDistance = rideEngine.engine_corner_distance();
  const cornerCurve = rideEngine.engine_corner_curvature();
  const corner = cornerDistance >= 0 ? {
    distance: cornerDistance,
    curvature: Math.abs(cornerCurve),
    direction: cornerCurve > 0 ? 'LEFT' : 'RIGHT',
    safeKmh: rideEngine.engine_corner_safe_kmh(),
    name: `TURN ${String(Math.floor(((playerDistance + cornerDistance) % trackLength) / 70) + 1).padStart(2, '0')} / ${Math.abs(cornerCurve) > .024 ? 'HAIRPIN' : 'SWEEPER'}`
  } : null;
  if (eventCode === 2) {
    const turn = corner?.direction.toLowerCase() || 'next';
    showCrash('TOO MUCH SPEED.', `You entered the ${turn} turn at ${Math.round(rideEngine.engine_crash_speed())} km/h. Brake before leaning into the corner.`); return;
  }
  if (eventCode === 3) { showCrash('OFF THE CIRCUIT.', 'You ran over the curb and left the racing surface. Keep your line between the white edges.'); return; }
  if (eventCode === 4) { showCrash('CONTACT WITH A RIDER.', 'You overlapped another bike. Leave a full bike width when you pass.'); return; }
  if (eventCode === 5) { showCrash('ROCK STRIKE.', 'A loose boulder has rolled onto the track edge. Keep clear of the debris and choose your line early.'); return; }
  if (eventCode === 6) { showFinish(); return; }

  if (corner) {
    cornerNameEl.textContent = corner.name;
    const safe = Math.min(corner.safeKmh, 165) / 3.6;
    const brakeNeed = Math.max(0, (speed * speed - safe * safe) / (2 * 8.5));
    const brakeSoon = corner.distance <= brakeNeed + 17 && speed * 3.6 > corner.safeKmh;
    alertEl.classList.toggle('visible', corner.distance < 105);
    cornerClassEl.textContent = brakeSoon ? 'BRAKE NOW' : 'UPCOMING CORNER';
    brakeDistanceEl.textContent = brakeSoon ? 'BRAKE NOW' : `${Math.round(corner.distance)} M`;
    alertEl.classList.toggle('danger', brakeSoon);
    if (corner.distance < 110 && brakeSoon) coachTextEl.textContent = `Brake now. Aim for ${Math.round(corner.safeKmh)} km/h, then release as you turn ${corner.direction.toLowerCase()}.`;
    else if (corner.distance < 110) coachTextEl.textContent = `Turn ${corner.direction.toLowerCase()} ahead. Set your speed before you lean.`;
  } else {
    alertEl.classList.remove('visible'); brakeDistanceEl.textContent = 'CLEAR';
    cornerClassEl.textContent = 'UPCOMING CORNER'; coachTextEl.textContent = 'Straight ahead. Get back on the throttle and close the gap.';
  }
}
function showFinish() {
  running = false; crashScreen.classList.add('visible');
  document.querySelector('.crash-stamp').textContent = 'CHEQUERED FLAG';
  document.querySelector('.crash-kicker').textContent = freedomMode ? 'THREE LAPS / OPEN GRID' : 'THREE LAPS / A CIRCUIT LEARNED';
  document.querySelector('#crash-title').textContent = freedomMode ? 'YOU OWNED THE PASS.' : 'YOU FOUND YOUR LINE.';
  document.querySelector('#crash-detail').textContent = freedomMode ? 'Three unrestricted laps, one clean finish. The mountain is yours.' : 'Every lap made the corner feel a little more familiar. Take that confidence to the real circuit.';
  document.querySelector('#retry').textContent = freedomMode ? 'RACE THE PASS AGAIN' : 'RIDE THE CIRCUIT AGAIN';
  document.querySelector('#crash-speed').textContent = `${Math.round(speed * 3.6)} KM/H`;
  document.querySelector('#crash-time').textContent = formatTime(sessionTime);
  sessionStateEl.textContent = 'CHEQUERED FLAG'; statusEl.textContent = freedomMode ? 'FREEDOM RACE COMPLETE' : 'THREE LAPS COMPLETE';
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--.--';
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60), cs = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
function updateScene(dt) {
  // Bank into the circuit's curve, with extra lean following the rider's steering input.
  const curveBank = -Math.atan((speed * speed * curvatureAt(playerDistance)) / 9.81);
  const steerBank = -steerInput * clamp(speed / 24, 0, 1) * .62;
  const targetLean = clamp(curveBank + steerBank, -.78, .78);
  bikeLean = THREE.MathUtils.damp(bikeLean, targetLean, 5.5, dt);
  const player = updateRider(playerBike, playerDistance, laneOffset, bikeLean, dt);
  const t = player.f.tangent;
  cameraGoal.copy(player.pos).addScaledVector(t, .22).add(new V(0, 1.76, 0));
  lookGoal.copy(player.pos).addScaledVector(t, 32).add(new V(0, 1.76, 0));
  if (!cameraInitialized) { camera.position.copy(cameraGoal); cameraInitialized = true; }
  camera.position.lerp(cameraGoal, 1 - Math.exp(-dt * 7));
  camera.lookAt(lookGoal);
  camera.rotateZ(bikeLean * .38);
  const fov = 72 + Math.min(speed / 48, 1) * 16; if (Math.abs(camera.fov - fov) > .15) { camera.fov = fov; camera.updateProjectionMatrix(); }
  for (const [index, rider] of racers.entries()) {
    rider.distance = rideEngine.engine_racer_distance(index);
    const lane = rideEngine.engine_racer_lane(index);
    const state = updateRider(rider.bike, rider.distance, lane, -Math.sin(sessionTime * .4 + rider.phase) * .1, dt);
    rider.bike.visible = Math.abs(rider.distance - playerDistance) < trackLength * .48;
    const delta = ((rider.distance - playerDistance + trackLength / 2) % trackLength + trackLength) % trackLength - trackLength / 2;
    const gapEl = document.querySelector(rider.name === 'RAVI' ? '#ravi-gap' : '#aya-gap');
    gapEl.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} M`;
  }
  const sorted = [...racers.map(r => r.distance), playerDistance].sort((a, b) => b - a);
  const place = sorted.indexOf(playerDistance) + 1; document.querySelector('#player-rank').textContent = `P${place}`;
  const kmh = Math.round(speed * 3.6); speedEl.textContent = String(kmh).padStart(3, '0');
  updateCockpitDisplay(kmh);
  const gear = speed < 8 ? 1 : speed < 15 ? 2 : speed < 23 ? 3 : speed < 31 ? 4 : speed < 40 ? 5 : 6;
  const gearRatio = [390, 270, 195, 155, 128, 112][gear - 1];
  const rpm = Math.round(clamp(1250 + speed * gearRatio + (throttleInput && speed < 3 ? 700 : 0), 1250, 7600));
  rpmEl.textContent = rpm.toLocaleString('en-US'); rpmFill.style.width = `${clamp((rpm - 1200) / 7600 * 100, 0, 100)}%`;
  gearEl.textContent = String(gear);
  const leanDegrees = Math.round(Math.abs(bikeLean) * 180 / Math.PI);
  leanEl.textContent = `${String(leanDegrees).padStart(2, '0')}°${leanDegrees ? (bikeLean < 0 ? ' R' : ' L') : ''}`;
  sessionTimeEl.textContent = formatTime(sessionTime - lapStartedAt);
  updateMap(player);
  if (audioContext && soundEnabled) {
    const firingHz = rpm / 120, now = audioContext.currentTime;
    engineOsc1.frequency.setTargetAtTime(firingHz, now, .055); engineOsc2.frequency.setTargetAtTime(firingHz * 3, now, .055);
    engineGain.gain.setTargetAtTime(running ? (throttleInput ? .16 : speed > 2 ? .075 : .035) : 0, now, .08);
    windFilter.frequency.setTargetAtTime(260 + speed * 17, now, .1); windGain.gain.setTargetAtTime(running ? .008 + speed / 6200 : 0, now, .12);
  }
}
function mapPoint(worldX, worldZ) {
  const pad = 14, w = mapCanvas.width - pad * 2, h = mapCanvas.height - pad * 2;
  const scale = Math.min(w / (trackMaxX - trackMinX), h / (trackMaxZ - trackMinZ));
  return [pad + (worldX - trackMinX) * scale + (w - (trackMaxX - trackMinX) * scale) / 2,
    pad + (trackMaxZ - worldZ) * scale + (h - (trackMaxZ - trackMinZ) * scale) / 2];
}
function updateMap(player) {
  const w = mapCanvas.width, h = mapCanvas.height; mapCtx.clearRect(0, 0, w, h);
  mapCtx.lineJoin = 'round'; mapCtx.lineCap = 'round'; mapCtx.beginPath();
  for (let i = 0; i <= 240; i++) { const p = track.getPointAt(i / 240); const [x, y] = mapPoint(p.x, p.z); if (!i) mapCtx.moveTo(x, y); else mapCtx.lineTo(x, y); }
  mapCtx.strokeStyle = 'rgba(0,0,0,.55)'; mapCtx.lineWidth = 15; mapCtx.stroke();
  mapCtx.strokeStyle = '#89948a'; mapCtx.lineWidth = 7; mapCtx.stroke();
  mapCtx.setLineDash([5, 6]); mapCtx.strokeStyle = 'rgba(239,243,232,.44)'; mapCtx.lineWidth = 1.1; mapCtx.stroke(); mapCtx.setLineDash([]);
  for (const [index, rider] of racers.entries()) {
    const lane = rideEngine.engine_racer_lane(index);
    const f = trackFrame(rider.distance), pos = f.point.clone().addScaledVector(f.side, lane), [x, y] = mapPoint(pos.x, pos.z);
    mapCtx.beginPath(); mapCtx.fillStyle = rider.name === 'RAVI' ? '#d9ff36' : '#ff7449'; mapCtx.arc(x, y, 4.3, 0, Math.PI * 2); mapCtx.fill();
  }
  const [px, py] = mapPoint(player.pos.x, player.pos.z); mapCtx.beginPath(); mapCtx.fillStyle = '#ffffff'; mapCtx.arc(px, py, 5.2, 0, Math.PI * 2); mapCtx.fill(); mapCtx.strokeStyle = '#d9ff36'; mapCtx.lineWidth = 2; mapCtx.stroke();
  mapCtx.beginPath(); mapCtx.fillStyle = 'rgba(217,255,54,.15)'; mapCtx.arc(px, py, 10, 0, Math.PI * 2); mapCtx.fill();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previousFrame) / 1000, .08); previousFrame = now;
  if (running && !crashed) updatePhysics(dt);
  updateScene(dt);
  renderer.render(scene, camera);
}
updateScene(.016); renderer.render(scene, camera); requestAnimationFrame(animate);
if (bestLapSeconds) bestLapEl.textContent = formatTime(bestLapSeconds);
