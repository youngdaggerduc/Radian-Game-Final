import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import './Game.css'
import {
  addLocalScore,
  clearLocalLeaderboard,
  fetchMergedLeaderboard,
  loadLocalLeaderboard,
  submitOnline,
} from './leaderboard'

const FOUNDATION_LABEL = { narrow: 'NARROW', standard: 'STANDARD', wide: 'WIDE' }
function formatDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return '' }
}

const TYPES = [
  'scaf_flat',
  'scaf_house',
  'scaf_ladder',
  'scaf_arch',
  'scaf_flag',
  'scaf_cabin',
  'scaf_double',
  'scaf_crane_arm',
  'scaf_sign',
  'scaf_water_tank',
  'scaf_rocket_pad',
]

const COLORS = [
  0xff3355, 0xff7700, 0xffe94d, 0x44ff77,
  0x00d4ff, 0x8855ff, 0xff55cc, 0x55ffee,
  0xff1166, 0xffcc00, 0x00ffbb, 0xdd33ff,
  0xff6600, 0x66ff33, 0x3388ff, 0xff0088,
]

// Per-piece difficulty bucket — drives the colored border on the next-piece preview
// so players can read what's coming at a glance.
const TYPE_DIFFICULTY = {
  scaf_flat:       'easy',
  scaf_house:      'easy',
  scaf_arch:       'med',
  scaf_cabin:      'med',
  scaf_double:     'med',
  scaf_water_tank: 'med',
  scaf_ladder:     'hard',
  scaf_flag:       'hard',
  scaf_crane_arm:  'hard',
  scaf_sign:       'hard',
  scaf_rocket_pad: 'hard',
}

// Score milestones — celebratory banner fires once per crossing.
const SCORE_MILESTONES = [2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000]

// Foundation choice — base scale + score multiplier.
const FOUNDATIONS = {
  narrow:   { scale: 0.65, mult: 2.0,  label: 'NARROW',   sub: '2× SCORE · BRUTAL' },
  standard: { scale: 1.0,  mult: 1.0,  label: 'STANDARD', sub: '1× SCORE · BALANCED' },
  wide:     { scale: 1.35, mult: 0.7,  label: 'WIDE',     sub: '0.7× SCORE · FRIENDLY' },
}

export default function Game() {
  const canvasRef = useRef(null)
  const nextCanvasRef = useRef(null)
  const scoreRef = useRef(null)
  const heightNumRef = useRef(null)
  const comboTextRef = useRef(null)
  const balanceNeedleRef = useRef(null)
  const [showStart, setShowStart] = useState(true)
  const [showGameOver, setShowGameOver] = useState(false)
  const [showPause, setShowPause] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [foundation, setFoundation] = useState('standard')
  const [fov, setFov] = useState(65)
  // Recap is set once when the game-over delay completes — using state so the
  // values are present at the time the game-over JSX mounts (refs were null
  // because the divs hadn't rendered yet, leaving the recap stuck at zeros).
  const [recap, setRecap] = useState({ score: 0, floors: 0, perfects: 0, maxCombo: 0, tier: 0, foundation: 'standard' })
  // Set when the most recent run is recorded into the leaderboard so we can
  // highlight that row in the leaderboard view.
  const [lastEntryId, setLastEntryId] = useState(null)
  // Active player profile — collected on first visit (name, email, phone) and
  // sticky across runs. Persisted to localStorage so booth visitors don't have
  // to retype between attempts. `null` until they've filled the form.
  const [player, setPlayer] = useState(() => {
    try {
      const raw = localStorage.getItem('radian_player')
      if (raw) return JSON.parse(raw)
      // Backwards-compat: pull a legacy name-only entry into the new shape.
      const legacy = localStorage.getItem('radian_player_name')
      if (legacy) return { name: legacy, email: '', phone: '' }
      return null
    } catch { return null }
  })

  // Mutable refs the engine writes into; exposed to React via the start handler
  const engineRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.setClearColor(0x120228)

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x120228, 0.018)

    let W = window.innerWidth
    let H = window.innerHeight
    renderer.setSize(W, H)

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 400)
    camera.position.set(0, 3, 28)
    camera.lookAt(0, 6, 0)

    // Aspect-aware framing: pull the camera back on narrow / portrait viewports so
    // the swing arc and tower base stay on screen. aspectScale is 1.0 at 16:9,
    // grows up to 1.6 as the viewport gets narrower than that, and never shrinks
    // below 0.9 (ultrawide). Read by the animate loop's camZTarget.
    const computeAspectScale = (w, h) => {
      const a = w / h
      const ref = 16 / 9
      // Below ref → narrower → larger scale (further back).
      return Math.max(0.9, Math.min(1.6, ref / a))
    }
    const onResize = () => {
      W = window.innerWidth
      H = window.innerHeight
      renderer.setSize(W, H)
      camera.aspect = W / H
      camera.updateProjectionMatrix()
      state.aspectScale = computeAspectScale(W, H)
    }
    window.addEventListener('resize', onResize)

    // Lights
    scene.add(new THREE.AmbientLight(0xbb66ff, 0.65))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6)
    keyLight.position.set(12, 35, 22)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(2048, 2048)
    Object.assign(keyLight.shadow.camera, {
      near: 0.5, far: 120, left: -25, right: 25, top: 80, bottom: -10,
    })
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xff44ff, 0.45)
    fillLight.position.set(-12, 8, -5)
    scene.add(fillLight)
    const rimLight = new THREE.DirectionalLight(0x44ffff, 0.3)
    rimLight.position.set(6, 4, -12)
    scene.add(rimLight)

    // Helpers
    const rc = () => COLORS[Math.floor(Math.random() * COLORS.length)]
    const toonMat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts })
    const outline = (mesh, s = 1.07) => {
      const m = new THREE.Mesh(
        mesh.geometry.clone(),
        new THREE.MeshBasicMaterial({ color: 0x110022, side: THREE.BackSide })
      )
      m.scale.setScalar(s)
      mesh.add(m)
    }
    const box = (w, h, d, col) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(col))
      m.castShadow = true
      outline(m)
      return m
    }
    const cyl = (rt, rb, h, segs, col) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), toonMat(col))
      m.castShadow = true
      outline(m)
      return m
    }
    const cone = (r, h, segs, col) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, segs), toonMat(col))
      m.castShadow = true
      outline(m)
      return m
    }
    const sphere = (r, col) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), toonMat(col))
      m.castShadow = true
      outline(m)
      return m
    }

    const pole = (x, y, z, h, col) => {
      const p = cyl(0.16, 0.19, h, 6, col)
      p.position.set(x, y + h / 2, z)
      return p
    }
    const ledger = (x, y, z, w, col) => {
      const l = box(w, 0.18, 0.18, col)
      l.position.set(x, y, z)
      return l
    }
    const transom = (x, y, z, d, col) => {
      const t = box(0.18, 0.18, d, col)
      t.position.set(x, y, z)
      return t
    }
    const board = (x, y, z, w, d, col) => {
      const b = box(w, 0.25, d, col)
      b.position.set(x, y, z)
      return b
    }
    const diag = (x, y, z, w, h, col) => {
      const len = Math.sqrt(w * w + h * h)
      const b = box(len, 0.15, 0.15, col)
      b.position.set(x + w / 2, y + h / 2, z)
      b.rotation.z = Math.atan2(h, w)
      return b
    }

    function makePiece(type) {
      const g = new THREE.Group()
      let a = rc(), b = rc(), c = rc()
      while (b === a) b = rc()
      while (c === a || c === b) c = rc()
      let pw = 4.4, ph = 2, pd = 2.6

      if (type === 'scaf_flat') {
        for (const [x, z] of [[-2, 1], [2, 1], [-2, -1], [2, -1]]) g.add(pole(x, 0, z, 2.2, a))
        g.add(ledger(0, 2.2, 1, 4.3, b)); g.add(ledger(0, 2.2, -1, 4.3, b))
        for (const x of [-1.8, 0, 1.8]) g.add(transom(x, 2.2, 0, 2.2, b))
        for (const x of [-1.4, -0.5, 0.4, 1.3]) g.add(board(x, 2.35, 0, 0.75, 2.1, c))
        g.add(ledger(0, 1.1, 1, 4.3, a)); g.add(ledger(0, 1.1, -1, 4.3, a))
        g.add(diag(-2, 0, 1, 4, 2.2, c)); g.add(diag(-2, 0, -1, 4, 2.2, c))
        pw = 4.4; ph = 2.5; pd = 2.2
      } else if (type === 'scaf_house') {
        for (const [x, z] of [[-2, 1], [2, 1], [-2, -1], [2, -1]]) g.add(pole(x, 0, z, 2.8, a))
        g.add(ledger(0, 2.8, 1, 4.3, b)); g.add(ledger(0, 2.8, -1, 4.3, b))
        g.add(ledger(0, 1.4, 1, 4.3, a)); g.add(ledger(0, 1.4, -1, 4.3, a))
        for (const x of [-1.5, 0, 1.5]) g.add(transom(x, 2.8, 0, 2.2, b))
        for (const x of [-1.4, -0.5, 0.4, 1.3]) g.add(board(x, 2.95, 0, 0.75, 2.1, c))
        const walls = box(2.8, 1.6, 2, b); walls.position.set(0, 3.75, 0); g.add(walls)
        for (const x of [-0.8, 0.8]) {
          const win = box(0.5, 0.5, 2.05, c); win.position.set(x, 3.8, 0); g.add(win)
        }
        const rL = box(3.2, 0.22, 2.2, c); rL.rotation.z = Math.PI / 5; rL.position.set(-0.55, 4.95, 0); g.add(rL)
        const rR = box(3.2, 0.22, 2.2, c); rR.rotation.z = -Math.PI / 5; rR.position.set(0.55, 4.95, 0); g.add(rR)
        const chimney = box(0.45, 0.9, 0.45, a); chimney.position.set(1.1, 5.5, 0.4); g.add(chimney)
        pw = 4.4; ph = 5.8; pd = 2.2
      } else if (type === 'scaf_ladder') {
        for (const [x, z] of [[-1.6, 1], [1.6, 1], [-1.6, -1], [1.6, -1]]) g.add(pole(x, 0, z, 5, a))
        for (const y of [1.2, 2.5, 3.8]) {
          g.add(ledger(0, y, 1, 3.5, b)); g.add(ledger(0, y, -1, 3.5, b))
          for (const x of [-1.2, 0, 1.2]) g.add(transom(x, y, 0, 2.2, b))
        }
        for (const x of [-1.1, -0.3, 0.5, 1.3]) g.add(board(x, 5.12, 0, 0.7, 2.1, c))
        g.add(ledger(1.9, 2.5, 0, 0.13, c))
        const lrL = cyl(0.07, 0.07, 5, 5, c); lrL.position.set(1.85, 2.5, 0.45); g.add(lrL)
        const lrR = cyl(0.07, 0.07, 5, 5, c); lrR.position.set(1.85, 2.5, -0.45); g.add(lrR)
        for (let y = 0.5; y < 5; y += 0.7) {
          const rung = box(0.12, 0.12, 1, c); rung.position.set(1.85, y, 0); g.add(rung)
        }
        g.add(diag(-1.6, 0, 1, 3.2, 5, a))
        pw = 3.8; ph = 5.3; pd = 2.2
      } else if (type === 'scaf_arch') {
        for (const [x, z] of [[-2.2, 1], [2.2, 1], [-2.2, -1], [2.2, -1]]) g.add(pole(x, 0, z, 4, a))
        g.add(ledger(0, 4, 1, 4.6, b)); g.add(ledger(0, 4, -1, 4.6, b))
        g.add(ledger(0, 2, 1, 4.6, a)); g.add(ledger(0, 2, -1, 4.6, a))
        for (const x of [-1.8, -0.6, 0.6, 1.8]) g.add(board(x, 4.15, 0, 1, 2.2, c))
        for (let i = 0; i <= 7; i++) {
          const ang = (i / 7) * Math.PI
          const r = 2.1
          const seg = cyl(0.13, 0.13, 0.9, 6, b)
          seg.position.set(Math.cos(ang) * r, Math.sin(ang) * r + 4.15, 0)
          seg.rotation.z = -ang + Math.PI / 2
          g.add(seg)
        }
        g.add(diag(-2.2, 0, 1, 4.4, 4, c)); g.add(diag(-2.2, 0, -1, 4.4, 4, c))
        pw = 4.6; ph = 6.3; pd = 2.2
      } else if (type === 'scaf_flag') {
        for (const [x, z] of [[-1.8, 0.9], [1.8, 0.9], [-1.8, -0.9], [1.8, -0.9]]) g.add(pole(x, 0, z, 2.2, a))
        g.add(ledger(0, 2.2, 0.9, 3.8, b)); g.add(ledger(0, 2.2, -0.9, 3.8, b))
        for (const x of [-1.2, 0, 1.2]) g.add(transom(x, 2.2, 0, 1.9, b))
        for (const x of [-1.1, -0.3, 0.5, 1.2]) g.add(board(x, 2.36, 0, 0.65, 1.8, c))
        g.add(ledger(0, 1.1, 0.9, 3.8, a)); g.add(ledger(0, 1.1, -0.9, 3.8, a))
        const mast = cyl(0.1, 0.14, 5.5, 6, b); mast.position.set(-0.6, 4.95, 0); g.add(mast)
        const flag = box(1.8, 1.0, 0.12, c); flag.position.set(0.3, 7, 0); g.add(flag)
        const stripe = box(1.82, 0.3, 0.13, a); stripe.position.set(0.3, 7.35, 0); g.add(stripe)
        const ball = sphere(0.2, c); ball.position.set(-0.6, 7.85, 0); g.add(ball)
        g.add(diag(-0.6, 2.2, 0, 1.2, 5.5, a))
        pw = 3.8; ph = 8.0; pd = 1.9
      } else if (type === 'scaf_cabin') {
        for (const [x, z] of [[-2, 1], [2, 1], [-2, -1], [2, -1]]) g.add(pole(x, 0, z, 2.5, a))
        g.add(ledger(0, 2.5, 1, 4.3, b)); g.add(ledger(0, 2.5, -1, 4.3, b))
        g.add(ledger(0, 1.25, 1, 4.3, a)); g.add(ledger(0, 1.25, -1, 4.3, a))
        for (const x of [-1.5, 0, 1.5]) g.add(transom(x, 2.5, 0, 2.2, b))
        for (const x of [-1.4, -0.5, 0.4, 1.3]) g.add(board(x, 2.65, 0, 0.75, 2.1, c))
        const hut = box(3.2, 1.8, 2, b); hut.position.set(0, 3.55, 0); g.add(hut)
        const door = box(0.6, 1.1, 2.05, a); door.position.set(0.8, 3.15, 0); g.add(door)
        const window_ = box(0.65, 0.55, 2.05, c); window_.position.set(-0.7, 3.6, 0); g.add(window_)
        const roof = box(3.4, 0.2, 2.2, c); roof.position.y = 4.55; g.add(roof)
        g.add(diag(-2, 0, 1, 4, 2.5, c)); g.add(diag(-2, 0, -1, 4, 2.5, c))
        pw = 4.4; ph = 4.7; pd = 2.2
      } else if (type === 'scaf_double') {
        for (const [x, z] of [[-2.2, 1], [2.2, 1], [-2.2, -1], [2.2, -1]]) g.add(pole(x, 0, z, 4.5, a))
        for (const y of [2, 4.5]) {
          g.add(ledger(0, y, 1, 4.7, b)); g.add(ledger(0, y, -1, 4.7, b))
          for (const x of [-1.8, -0.6, 0.6, 1.8]) g.add(transom(x, y, 0, 2.2, b))
          for (const x of [-1.5, -0.6, 0.3, 1.2]) g.add(board(x, y + 0.15, 0, 0.75, 2.1, c))
        }
        g.add(ledger(0, 1, 1, 4.7, a)); g.add(ledger(0, 3.2, 1, 4.7, a))
        g.add(ledger(0, 1, -1, 4.7, a)); g.add(ledger(0, 3.2, -1, 4.7, a))
        for (let i = 0; i < 5; i++) {
          const step = board(-1.8 + i * 0.7, 2.2 + i * 0.46, 0, 0.6, 2, c)
          step.rotation.z = Math.atan2(2.4, 3.5)
          g.add(step)
        }
        g.add(diag(-2.2, 0, 1, 4.4, 4.5, c)); g.add(diag(-2.2, 0, -1, 4.4, 4.5, c))
        pw = 4.6; ph = 4.7; pd = 2.2
      } else if (type === 'scaf_crane_arm') {
        for (const [x, z] of [[-1.8, 0.9], [1.8, 0.9], [-1.8, -0.9], [1.8, -0.9]]) g.add(pole(x, 0, z, 2.2, a))
        g.add(ledger(0, 2.2, 0.9, 3.8, b)); g.add(ledger(0, 2.2, -0.9, 3.8, b))
        for (const x of [-1.2, 0, 1.2]) g.add(transom(x, 2.2, 0, 1.9, b))
        for (const x of [-1.1, -0.3, 0.5, 1.2]) g.add(board(x, 2.36, 0, 0.65, 1.8, c))
        g.add(ledger(0, 1.1, 0.9, 3.8, a)); g.add(ledger(0, 1.1, -0.9, 3.8, a))
        for (const [cx, cz] of [[0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]]) {
          const cp = cyl(0.1, 0.1, 4.5, 5, b); cp.position.set(cx, 4.45, cz); g.add(cp)
        }
        for (const y of [3, 4, 5, 6]) {
          const lash = box(0.65, 0.12, 0.65, a); lash.position.set(0, y, 0); g.add(lash)
        }
        const jib = box(4, 0.18, 0.18, c); jib.position.set(1.5, 6.8, 0); g.add(jib)
        const cjib = box(1.4, 0.18, 0.18, a); cjib.position.set(-1.1, 6.8, 0); g.add(cjib)
        const hook = sphere(0.28, c); hook.position.set(3, 5.6, 0); g.add(hook)
        const hcable = cyl(0.06, 0.06, 1.3, 4, b); hcable.position.set(3, 6.25, 0); g.add(hcable)
        pw = 4; ph = 7; pd = 1.9
      } else if (type === 'scaf_sign') {
        for (const [x, z] of [[-2, 0.8], [2, 0.8], [-2, -0.8], [2, -0.8]]) g.add(pole(x, 0, z, 5.5, a))
        g.add(ledger(0, 2.5, 0.8, 4.3, a)); g.add(ledger(0, 2.5, -0.8, 4.3, a))
        for (const x of [-1.5, 0, 1.5]) g.add(transom(x, 2.5, 0, 1.7, a))
        for (const x of [-1.4, -0.5, 0.4, 1.3]) g.add(board(x, 2.65, 0, 0.75, 1.6, c))
        g.add(ledger(0, 1.2, 0.8, 4.3, b)); g.add(ledger(0, 1.2, -0.8, 4.3, b))
        const frame = box(4.4, 2.4, 0.18, b); frame.position.set(0, 4.7, 0); g.add(frame)
        const panel = box(4, 2, 0.22, c); panel.position.set(0, 4.7, 0.1); g.add(panel)
        const stripe2 = box(4.1, 0.45, 0.23, a); stripe2.position.set(0, 4.4, 0.1); g.add(stripe2)
        for (const x of [-2, 2]) {
          const br = box(0.15, 0.15, 0.9, a); br.position.set(x, 4.7, 0.5); g.add(br)
        }
        pw = 4.4; ph = 5.9; pd = 1.8
      } else if (type === 'scaf_water_tank') {
        for (const [x, z] of [[-1.6, 0.9], [1.6, 0.9], [-1.6, -0.9], [1.6, -0.9]]) g.add(pole(x, 0, z, 4, a))
        for (const y of [1.5, 3]) {
          g.add(ledger(0, y, 0.9, 3.4, b)); g.add(ledger(0, y, -0.9, 3.4, b))
          for (const x of [-1.1, 0, 1.1]) g.add(transom(x, y, 0, 1.9, b))
        }
        for (const x of [-1.1, -0.3, 0.5, 1.2]) g.add(board(x, 3.15, 0, 0.65, 1.8, c))
        g.add(ledger(0, 0.75, 0.9, 3.4, a)); g.add(ledger(0, 2.2, 0.9, 3.4, a))
        g.add(ledger(0, 0.75, -0.9, 3.4, a)); g.add(ledger(0, 2.2, -0.9, 3.4, a))
        const tank = cyl(1.1, 1.1, 1.6, 14, b); tank.position.set(0, 4.8, 0); g.add(tank)
        const lid = cyl(1.2, 1.2, 0.14, 14, c); lid.position.set(0, 5.65, 0); g.add(lid)
        const pipe = cyl(0.15, 0.15, 0.9, 6, a); pipe.position.set(0.9, 4.3, 0); g.add(pipe)
        g.add(diag(-1.6, 0, 0.9, 3.2, 4, c))
        pw = 3.6; ph = 5.8; pd = 2
      } else if (type === 'scaf_rocket_pad') {
        for (const [x, z] of [[-2, 1], [2, 1], [-2, -1], [2, -1]]) g.add(pole(x, 0, z, 2.8, a))
        g.add(ledger(0, 2.8, 1, 4.3, b)); g.add(ledger(0, 2.8, -1, 4.3, b))
        g.add(ledger(0, 1.4, 1, 4.3, a)); g.add(ledger(0, 1.4, -1, 4.3, a))
        for (const x of [-1.5, 0, 1.5]) g.add(transom(x, 2.8, 0, 2.2, b))
        for (const x of [-1.4, -0.5, 0.4, 1.3]) g.add(board(x, 2.95, 0, 0.75, 2.1, c))
        const arm1 = box(1.4, 0.15, 0.15, a); arm1.position.set(-0.5, 3.7, 0); arm1.rotation.z = 0.4; g.add(arm1)
        const arm2 = box(1.4, 0.15, 0.15, a); arm2.position.set(0.5, 3.7, 0); arm2.rotation.z = -0.4; g.add(arm2)
        const rbody = cyl(0.6, 0.75, 3, 10, b); rbody.position.set(0, 5.3, 0); g.add(rbody)
        const rnose = cone(0.6, 1.4, 10, c); rnose.position.set(0, 7.4, 0); g.add(rnose)
        for (let i = 0; i < 3; i++) {
          const ang = (i / 3) * Math.PI * 2
          const fin = box(0.18, 1, 0.5, c)
          fin.position.set(Math.cos(ang) * 0.8, 3.9, Math.sin(ang) * 0.8)
          fin.rotation.y = ang
          g.add(fin)
        }
        const win = sphere(0.24, a); win.position.set(0.55, 5.5, 0.55); g.add(win)
        pw = 4.4; ph = 8.1; pd = 2.2
      }

      g.userData.pw = pw
      g.userData.ph = ph
      g.userData.pd = pd
      return g
    }

    // ── Branded prop builders (workers, hats, flags, vehicle, etc.) ──
    function makeHardHat(color = 0xffcc00) {
      const g = new THREE.Group()
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        toonMat(color)
      )
      outline(dome, 1.07); dome.castShadow = true; g.add(dome)
      const brim = cyl(0.58, 0.58, 0.06, 16, color); brim.position.y = 0.0; g.add(brim)
      const band = cyl(0.46, 0.46, 0.08, 16, 0x222233); band.position.y = 0.12; g.add(band)
      // Tiny RADIAN crest centered on the brim front
      const crest = box(0.18, 0.10, 0.02, 0xffe94d); crest.position.set(0, 0.18, 0.42); g.add(crest)
      return g
    }

    function makeFlag(color) {
      const g = new THREE.Group()
      const flagPole = cyl(0.04, 0.04, 1.4, 6, 0xddddee)
      flagPole.position.y = 0.7; g.add(flagPole)
      const cloth = box(0.7, 0.45, 0.04, color)
      cloth.position.set(0.4, 1.15, 0); g.add(cloth)
      const tip = sphere(0.08, 0xffe94d); tip.position.y = 1.4; g.add(tip)
      g.userData.cloth = cloth
      return g
    }

    function makeFloorNumber(n) {
      const c = document.createElement('canvas')
      c.width = 256; c.height = 128
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, 256, 128)
      ctx.font = '900 96px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.lineWidth = 10; ctx.strokeStyle = '#1a0a44'
      ctx.strokeText(String(n), 128, 64)
      ctx.fillStyle = '#ffe94d'
      ctx.fillText(String(n), 128, 64)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.7),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      )
      return plane
    }

    function makeWorker(shirtColor, x, z, hatColor = 0xffcc00) {
      const g = new THREE.Group()
      const legL = box(0.18, 0.7, 0.18, 0x113355); legL.position.set(-0.13, 0.35, 0); g.add(legL)
      const legR = box(0.18, 0.7, 0.18, 0x113355); legR.position.set( 0.13, 0.35, 0); g.add(legR)
      const body = box(0.55, 0.7, 0.32, shirtColor); body.position.set(0, 1.05, 0); g.add(body)
      const armL = box(0.13, 0.6, 0.13, shirtColor); armL.position.set(-0.36, 1.05, 0); g.add(armL)
      const armR = box(0.13, 0.6, 0.13, shirtColor); armR.position.set( 0.36, 1.05, 0); g.add(armR)
      // Head pivot — rotates so the worker can look up at the tower
      const headPivot = new THREE.Group()
      headPivot.position.set(0, 1.4, 0); g.add(headPivot)
      const head = box(0.32, 0.32, 0.32, 0xffd6a0); head.position.y = 0.16; headPivot.add(head)
      const hat = makeHardHat(hatColor); hat.position.y = 0.36; hat.scale.setScalar(0.5); headPivot.add(hat)
      g.position.set(x, 0, z)
      g.userData.head = headPivot
      g.userData.phase = Math.random() * Math.PI * 2
      return g
    }

    function makeBrandedTruck() {
      const g = new THREE.Group()
      // Cab (front)
      const cab = box(2.0, 1.5, 1.9, 0xffe94d); cab.position.set(-1.6, 1.05, 0); g.add(cab)
      // Cargo box (rear) — white so the brand panel reads
      const cargo = box(3.4, 1.9, 2.0, 0xffffff); cargo.position.set(0.7, 1.25, 0); g.add(cargo)
      // RADIAN side panels (both sides)
      const sCanvas = document.createElement('canvas')
      sCanvas.width = 512; sCanvas.height = 256
      const sctx = sCanvas.getContext('2d')
      sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, 512, 256)
      sctx.fillStyle = '#660099'
      sctx.font = '900 130px "Segoe UI", sans-serif'
      sctx.textAlign = 'center'; sctx.textBaseline = 'middle'
      sctx.fillText('RADIAN', 256, 110)
      sctx.fillStyle = '#1a0a44'
      sctx.font = '800 50px "Segoe UI", sans-serif'
      sctx.fillText('SCAFFOLDING CO.', 256, 200)
      const sTex = new THREE.CanvasTexture(sCanvas)
      sTex.colorSpace = THREE.SRGBColorSpace
      const panelMat = new THREE.MeshBasicMaterial({ map: sTex })
      const panelF = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), panelMat)
      panelF.position.set(0.7, 1.25, 1.01); g.add(panelF)
      const panelB = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), panelMat)
      panelB.position.set(0.7, 1.25, -1.01); panelB.rotation.y = Math.PI; g.add(panelB)
      // Windshield
      const ws = box(0.5, 0.7, 1.6, 0x44ddff)
      ws.position.set(-0.7, 1.55, 0); g.add(ws)
      // Wheels — both sides
      for (const x of [-1.7, 1.4]) {
        for (const z of [-0.95, 0.95]) {
          const wheel = cyl(0.4, 0.4, 0.25, 12, 0x111111)
          wheel.rotation.x = Math.PI / 2
          wheel.position.set(x, 0.4, z); g.add(wheel)
          const hub = cyl(0.18, 0.18, 0.27, 8, 0x666666)
          hub.rotation.x = Math.PI / 2
          hub.position.set(x, 0.4, z); g.add(hub)
        }
      }
      return g
    }

    function makeBlueprintTable() {
      const g = new THREE.Group()
      const top = box(1.7, 0.08, 1.05, 0x553311); top.position.y = 0.85; g.add(top)
      for (const [x, z] of [[-0.75, -0.42], [0.75, -0.42], [-0.75, 0.42], [0.75, 0.42]]) {
        const leg = cyl(0.06, 0.06, 0.85, 4, 0x442200); leg.position.set(x, 0.42, z); g.add(leg)
      }
      // Blueprint sheet on the table top
      const sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.9),
        new THREE.MeshBasicMaterial({ color: 0x1f4488, side: THREE.DoubleSide })
      )
      sheet.rotation.x = -Math.PI / 2
      sheet.position.set(0, 0.9, 0); g.add(sheet)
      // White grid lines on the blueprint
      const lineMat = new THREE.MeshBasicMaterial({ color: 0xeeeeff, transparent: true, opacity: 0.5 })
      for (let i = -2; i <= 2; i++) {
        const lh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.005, 0.015), lineMat)
        lh.position.set(0, 0.905, i * 0.18); g.add(lh)
        const lv = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.005, 0.85), lineMat)
        lv.position.set(i * 0.28, 0.905, 0); g.add(lv)
      }
      // Rolled-up plan beside the sheet
      const roll = cyl(0.09, 0.09, 0.7, 8, 0xeeeedd)
      roll.rotation.z = Math.PI / 2
      roll.position.set(0.4, 0.96, 0.3); g.add(roll)
      // Coffee mug (foreman's, naturally)
      const mug = cyl(0.10, 0.10, 0.18, 8, 0xffffff)
      mug.position.set(-0.6, 1.00, 0.3); g.add(mug)
      return g
    }

    function makeToolbox() {
      const g = new THREE.Group()
      const body = box(0.85, 0.4, 0.45, 0xff3344); body.position.y = 0.22; g.add(body)
      const lid = box(0.9, 0.08, 0.5, 0xcc1122); lid.position.y = 0.46; g.add(lid)
      const handle = cyl(0.04, 0.04, 0.55, 4, 0x222222)
      handle.rotation.z = Math.PI / 2; handle.position.y = 0.58; g.add(handle)
      const latch = box(0.08, 0.08, 0.04, 0xffe94d); latch.position.set(0, 0.4, 0.24); g.add(latch)
      return g
    }

    function makeWheelbarrow() {
      const g = new THREE.Group()
      const tray = box(1.2, 0.1, 0.7, 0x2255cc); tray.position.y = 0.55; g.add(tray)
      const back = box(1.2, 0.4, 0.04, 0x2255cc); back.position.set(0, 0.75, -0.34); g.add(back)
      const front = box(1.2, 0.25, 0.04, 0x2255cc); front.position.set(0, 0.67, 0.34); g.add(front)
      const sideL = box(0.04, 0.4, 0.7, 0x2255cc); sideL.position.set(-0.6, 0.75, 0); g.add(sideL)
      const sideR = box(0.04, 0.4, 0.7, 0x2255cc); sideR.position.set( 0.6, 0.75, 0); g.add(sideR)
      // Handles extending backward
      const hL = cyl(0.04, 0.04, 1.4, 5, 0x553311)
      hL.rotation.x = Math.PI / 2; hL.position.set(-0.45, 0.55, -0.85); g.add(hL)
      const hR = cyl(0.04, 0.04, 1.4, 5, 0x553311)
      hR.rotation.x = Math.PI / 2; hR.position.set( 0.45, 0.55, -0.85); g.add(hR)
      // Wheel
      const wheel = cyl(0.32, 0.32, 0.16, 12, 0x111111)
      wheel.rotation.x = Math.PI / 2; wheel.position.set(0, 0.32, 0.45); g.add(wheel)
      // Legs at the back
      const legL = box(0.08, 0.5, 0.08, 0x553311); legL.position.set(-0.5, 0.25, -0.55); g.add(legL)
      const legR = box(0.08, 0.5, 0.08, 0x553311); legR.position.set( 0.5, 0.25, -0.55); g.add(legR)
      // A pile of "rubble" inside
      for (let i = 0; i < 5; i++) {
        const r = box(0.18 + Math.random() * 0.12, 0.14, 0.18, 0x886633)
        r.position.set((Math.random() - 0.5) * 0.7, 0.7, (Math.random() - 0.5) * 0.4)
        r.rotation.y = Math.random() * Math.PI; g.add(r)
      }
      return g
    }

    function makeSandbagPile() {
      const g = new THREE.Group()
      const positions = [
        [-0.4, 0.15, 0, 0],
        [ 0.4, 0.15, 0, 0.1],
        [ 0.0, 0.15, 0.5, -0.2],
        [-0.2, 0.45, 0.2, 0.05],
        [ 0.2, 0.45, 0.2, -0.1],
        [ 0.0, 0.75, 0.2, 0],
      ]
      for (const [x, y, z, ry] of positions) {
        const bag = box(0.7, 0.28, 0.45, 0xa67442)
        bag.position.set(x, y, z); bag.rotation.y = ry
        g.add(bag)
      }
      return g
    }

    // World — Radian construction site
    {
      // Asphalt pad the tower rises from
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(11, 13, 1.4, 40),
        toonMat(0x1a1a22)
      )
      disc.position.y = -0.7
      disc.receiveShadow = true
      outline(disc, 1.015)
      scene.add(disc)

      // Painted concrete slab directly under the tower
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(5.2, 5.2, 0.08, 32),
        toonMat(0x4a4a55)
      )
      pad.position.y = 0.02
      scene.add(pad)

      // Yellow site striping radiating from pad
      const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.55 })
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 0.35), stripeMat)
        stripe.position.set(Math.cos(ang) * 6.4, 0.03, Math.sin(ang) * 6.4)
        stripe.rotation.y = -ang
        scene.add(stripe)
      }

      // Safety fence ring (chain link posts + cross rail)
      const fenceR = 9.2
      const postCount = 18
      for (let i = 0; i < postCount; i++) {
        const ang = (i / postCount) * Math.PI * 2
        const post = cyl(0.08, 0.08, 1.5, 5, 0xff6600)
        post.position.set(Math.cos(ang) * fenceR, 0.75, Math.sin(ang) * fenceR)
        scene.add(post)
      }
      // Top + bottom rails approximated as a thin torus
      for (const yPos of [0.25, 1.35]) {
        const rail = new THREE.Mesh(
          new THREE.TorusGeometry(fenceR, 0.05, 4, 40),
          toonMat(0xff7711)
        )
        rail.rotation.x = Math.PI / 2
        rail.position.y = yPos
        scene.add(rail)
      }

      // Traffic cones around the slab
      const conePositions = [
        [3.8, 0, 2.4], [-3.8, 0, 2.4], [3.8, 0, -2.4], [-3.8, 0, -2.4],
        [0, 0, 4.6], [0, 0, -4.6],
      ]
      for (const [x, , z] of conePositions) {
        const cBase = box(0.7, 0.08, 0.7, 0x222222)
        cBase.position.set(x, 0.08, z)
        scene.add(cBase)
        const cBody = cone(0.32, 1.0, 8, 0xff5500)
        cBody.position.set(x, 0.6, z)
        scene.add(cBody)
        const stripe = cyl(0.27, 0.30, 0.14, 8, 0xffffff)
        stripe.position.set(x, 0.55, z)
        scene.add(stripe)
      }

      // Wooden pallet
      {
        const palletGroup = new THREE.Group()
        for (let i = 0; i < 4; i++) {
          const plank = box(2.0, 0.08, 0.32, 0xa67442)
          plank.position.set(0, 0.18, -0.6 + i * 0.4)
          palletGroup.add(plank)
        }
        for (const x of [-0.8, 0, 0.8]) {
          const beam = box(0.3, 0.18, 1.6, 0x8a5a30)
          beam.position.set(x, 0.09, 0)
          palletGroup.add(beam)
        }
        // Stack of bricks/material on the pallet
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            const brick = box(0.55, 0.25, 0.4, 0xcc4422)
            brick.position.set(-0.7 + c * 0.6, 0.4 + r * 0.28, 0)
            palletGroup.add(brick)
          }
        }
        palletGroup.position.set(-7, 0, 4.5)
        palletGroup.rotation.y = -0.4
        scene.add(palletGroup)
      }

      // Dumpster
      {
        const dump = new THREE.Group()
        const body = box(2.4, 1.2, 1.4, 0x228855)
        body.position.y = 0.65
        dump.add(body)
        const lid = box(2.4, 0.1, 1.4, 0x196644)
        lid.position.y = 1.32
        lid.rotation.x = -0.15
        dump.add(lid)
        const wheel1 = cyl(0.18, 0.18, 0.15, 8, 0x111111)
        wheel1.rotation.z = Math.PI / 2
        wheel1.position.set(-1.0, 0.18, 0.5)
        dump.add(wheel1)
        const wheel2 = wheel1.clone()
        wheel2.position.set(1.0, 0.18, 0.5)
        dump.add(wheel2)
        dump.position.set(7.2, 0, 4.0)
        dump.rotation.y = -0.6
        scene.add(dump)
      }

      // RADIAN site sign — branded board on two posts
      {
        const sign = new THREE.Group()
        const postL = cyl(0.10, 0.12, 2.4, 6, 0x553311); postL.position.set(-1.6, 1.2, 0); sign.add(postL)
        const postR = cyl(0.10, 0.12, 2.4, 6, 0x553311); postR.position.set( 1.6, 1.2, 0); sign.add(postR)
        // Board
        const board = box(3.6, 1.4, 0.12, 0xffe94d)
        board.position.y = 2.0
        sign.add(board)
        // RADIAN text rendered to a canvas texture
        const sCanvas = document.createElement('canvas')
        sCanvas.width = 512; sCanvas.height = 200
        const sctx = sCanvas.getContext('2d')
        sctx.fillStyle = '#ffe94d'; sctx.fillRect(0, 0, 512, 200)
        sctx.fillStyle = '#1a0a44'
        sctx.font = '900 130px "Segoe UI", sans-serif'
        sctx.textAlign = 'center'; sctx.textBaseline = 'middle'
        sctx.fillText('RADIAN', 256, 80)
        sctx.fillStyle = '#660099'
        sctx.font = '800 38px "Segoe UI", sans-serif'
        sctx.fillText('SCAFFOLDING', 256, 158)
        const sTex = new THREE.CanvasTexture(sCanvas)
        sTex.colorSpace = THREE.SRGBColorSpace
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(3.4, 1.3),
          new THREE.MeshBasicMaterial({ map: sTex })
        )
        face.position.set(0, 2.0, 0.07)
        sign.add(face)
        sign.position.set(0, 0, -8.5)
        sign.rotation.y = 0.18
        scene.add(sign)
      }

      // Branded delivery truck — parked off-site
      {
        const truck = makeBrandedTruck()
        truck.position.set(-9.2, 0, -3.8)
        truck.rotation.y = 0.55
        scene.add(truck)
      }

      // Foreman's blueprint table near the sign
      {
        const tbl = makeBlueprintTable()
        tbl.position.set(-3.2, 0, -7.0)
        tbl.rotation.y = -0.25
        scene.add(tbl)
      }

      // Scattered jobsite props
      {
        const tb = makeToolbox(); tb.position.set(7.6, 0, -3.0); tb.rotation.y = -1.0; scene.add(tb)
        const wb = makeWheelbarrow(); wb.position.set(-7.0, 0, 0.5); wb.rotation.y = -1.4; scene.add(wb)
        const sb = makeSandbagPile(); sb.position.set(7.0, 0, 1.5); sb.rotation.y = 0.6; scene.add(sb)
      }
    }

    // ── Caution tape strung between the safety-fence posts (sways in the animate loop) ──
    const tapeSegments = []
    {
      const fenceR = 9.2
      const postCount = 18
      for (let i = 0; i < postCount; i++) {
        const a1 = (i / postCount) * Math.PI * 2
        const a2 = ((i + 1) / postCount) * Math.PI * 2
        const x1 = Math.cos(a1) * fenceR, z1 = Math.sin(a1) * fenceR
        const x2 = Math.cos(a2) * fenceR, z2 = Math.sin(a2) * fenceR
        const dx = x2 - x1, dz = z2 - z1
        const len = Math.sqrt(dx * dx + dz * dz)
        // Two-tone tape: yellow body with a black diagonal stripe vibe via two segments
        const tape = box(len * 0.95, 0.14, 0.04, 0xffe94d)
        tape.position.set((x1 + x2) / 2, 1.7, (z1 + z2) / 2)
        tape.rotation.y = -Math.atan2(dz, dx)
        scene.add(tape)
        tapeSegments.push({ mesh: tape, baseY: 1.7, phase: i * 0.42 })
      }
    }

    // ── Spotlight poles — two corners of the site, real lights pointing at the tower ──
    const siteSpots = []
    {
      const positions = [
        [ 9.5, 9.5],
        [-9.5, 9.5],
      ]
      for (const [px, pz] of positions) {
        const pl = cyl(0.20, 0.24, 9, 6, 0x444450); pl.position.set(px, 4.5, pz); scene.add(pl)
        const housing = box(0.85, 0.55, 0.85, 0x222230); housing.position.set(px, 9.0, pz); scene.add(housing)
        // Lens pointed roughly at the tower base
        const ang = Math.atan2(-pz, -px)
        const lens = box(0.65, 0.45, 0.12, 0xffffaa)
        lens.position.set(px + Math.cos(ang) * 0.45, 9.0, pz + Math.sin(ang) * 0.45)
        lens.rotation.y = ang
        scene.add(lens)
        // Real spotlight (no shadow casting — keeps frame cost down)
        const spot = new THREE.SpotLight(0xfff0c8, 1.4, 70, Math.PI / 7, 0.45, 1.2)
        spot.position.set(px, 8.8, pz)
        spot.target.position.set(0, 6, 0)
        scene.add(spot); scene.add(spot.target)
        // Translucent visible cone so the beam reads in the dark scene
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(2.4, 12, 16, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffeeaa, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false })
        )
        // Cone default points +y; we want it to aim from light toward target
        cone.position.set(px * 0.5, 4.2, pz * 0.5)
        cone.lookAt(0, 6, 0)
        cone.rotateX(Math.PI / 2)
        scene.add(cone)
        siteSpots.push({ light: spot, target: spot.target, cone })
      }
    }

    // ── Floating dust motes / welding sparks drifting up through the scene ──
    const sparkCount = 90
    const sparkVel = new Float32Array(sparkCount)
    let sparks
    {
      const pos = new Float32Array(sparkCount * 3)
      for (let i = 0; i < sparkCount; i++) {
        pos[i * 3]     = (Math.random() - 0.5) * 36
        pos[i * 3 + 1] = Math.random() * 30
        pos[i * 3 + 2] = (Math.random() - 0.5) * 36 - 4
        sparkVel[i] = 0.018 + Math.random() * 0.045
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      sparks = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: 0xffcc66, size: 0.22, transparent: true, opacity: 0.75, depthWrite: false,
        })
      )
      scene.add(sparks)
    }

    // ── Worker silhouettes — gradually look up at the growing tower ──
    const workers = []
    {
      const w1 = makeWorker(0xff5544, -6.4, 5.0, 0xffcc00); w1.rotation.y = -0.7; workers.push(w1); scene.add(w1)
      const w2 = makeWorker(0x3399ff,  6.6, 4.6, 0xff8800); w2.rotation.y =  0.9; workers.push(w2); scene.add(w2)
      const w3 = makeWorker(0xffe94d, -2.2, -6.2, 0xffffff); w3.rotation.y =  Math.PI; workers.push(w3); scene.add(w3)
    }

    // Glow ring
    {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(9.5, 11.5, 48),
        new THREE.MeshBasicMaterial({ color: 0x7733ff, side: THREE.DoubleSide, transparent: true, opacity: 0.18 })
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.05
      scene.add(ring)
      const ring2 = new THREE.Mesh(
        new THREE.RingGeometry(0, 9.5, 48),
        new THREE.MeshBasicMaterial({ color: 0x4411aa, side: THREE.DoubleSide, transparent: true, opacity: 0.12 })
      )
      ring2.rotation.x = -Math.PI / 2
      ring2.position.y = 0.04
      scene.add(ring2)
    }

    // Stars
    {
      const pos = []
      for (let i = 0; i < 500; i++) {
        pos.push((Math.random() - 0.5) * 280, Math.random() * 100 + 8, (Math.random() - 0.5) * 280)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      scene.add(new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.7 })
      ))
    }

    // Crane arm
    const craneGroup = new THREE.Group()
    scene.add(craneGroup)
    let craneCable = null
    function buildCrane(y) {
      while (craneGroup.children.length) craneGroup.remove(craneGroup.children[0])
      const postH = 4
      const post = cyl(0.18, 0.22, postH, 7, 0x9966ff)
      post.position.y = y + postH / 2
      craneGroup.add(post)
      const arm = box(14, 0.2, 0.2, 0x9966ff)
      arm.position.y = y + postH
      craneGroup.add(arm)
      const capL = sphere(0.28, 0xcc88ff); capL.position.set(-7, y + postH, 0); craneGroup.add(capL)
      const capR = sphere(0.28, 0xcc88ff); capR.position.set(7, y + postH, 0); craneGroup.add(capR)
      craneCable = cyl(0.05, 0.05, 1, 4, 0xdd99ff)
      craneGroup.add(craneCable)
    }

    // Particles
    let particles = []
    function spawnBurst(x, y, z, n, cols) {
      for (let i = 0; i < n; i++) {
        const r = Math.random() * 0.22 + 0.08
        const m = new THREE.Mesh(
          Math.random() < 0.5 ? new THREE.SphereGeometry(r, 6, 4) : new THREE.BoxGeometry(r * 2, r * 2, r * 2),
          new THREE.MeshToonMaterial({ color: cols[Math.floor(Math.random() * cols.length)] })
        )
        m.position.set(
          x + (Math.random() - 0.5) * 2.5,
          y + (Math.random() - 0.5) * 1,
          z + (Math.random() - 0.5) * 1.5
        )
        const v = new THREE.Vector3(
          (Math.random() - 0.5) * 0.28,
          Math.random() * 0.35 + 0.1,
          (Math.random() - 0.5) * 0.18
        )
        scene.add(m)
        particles.push({
          mesh: m, vel: v, life: 1,
          spin: new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15),
        })
      }
    }
    function spawnStarBurst(x, y, z) {
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2
        const r = Math.random() * 0.15 + 0.12
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), new THREE.MeshToonMaterial({ color: 0xffe94d }))
        m.position.set(x, y, z)
        const speed = Math.random() * 0.3 + 0.15
        const v = new THREE.Vector3(Math.cos(ang) * speed, Math.sin(ang) * speed + 0.1, (Math.random() - 0.5) * 0.2)
        scene.add(m)
        particles.push({ mesh: m, vel: v, life: 1.4, spin: new THREE.Vector3(0, 0, 0) })
      }
    }

    // Next-piece preview
    const nextCtx = nextCanvasRef.current.getContext('2d')
    function drawNextPiece(type) {
      const ctx = nextCtx
      ctx.clearRect(0, 0, 88, 88)
      ctx.fillStyle = 'rgba(30,0,60,0.88)'
      ctx.fillRect(0, 0, 88, 88)

      function poles(xs, y0, y1, col) {
        ctx.strokeStyle = col || '#8855ff'; ctx.lineWidth = 2
        for (const x of xs) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke() }
      }
      function hbar(x0, x1, y, col) {
        ctx.strokeStyle = col || '#ff7700'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke()
      }
      function plank(x0, x1, y, col) {
        ctx.fillStyle = col || '#ffe94d'
        ctx.fillRect(x0, y - 3, x1 - x0, 6)
      }
      function dline(x0, y0, x1, y1, col) {
        ctx.strokeStyle = col || '#44ffcc'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
      }

      const shapes = {
        scaf_flat: () => {
          poles([18, 70], 68, 20, '#8855ff')
          hbar(14, 74, 20, '#ff7700'); hbar(14, 74, 44, '#ff7700')
          plank(16, 72, 20, '#ffe94d')
          dline(18, 44, 70, 20, '#44ffcc')
        },
        scaf_house: () => {
          poles([18, 70], 75, 28, '#8855ff')
          hbar(14, 74, 28, '#ff7700'); hbar(14, 74, 52, '#ff7700')
          plank(16, 72, 28, '#ffe94d')
          ctx.strokeStyle = '#ff55cc'; ctx.lineWidth = 2
          ctx.strokeRect(26, 10, 36, 18)
          ctx.beginPath(); ctx.moveTo(44, 4); ctx.lineTo(22, 10); ctx.lineTo(66, 10); ctx.closePath(); ctx.stroke()
        },
        scaf_ladder: () => {
          poles([18, 66], 78, 14, '#8855ff')
          for (const y of [28, 44, 60]) hbar(14, 70, y, '#ff7700')
          plank(16, 68, 14, '#ffe94d')
          ctx.strokeStyle = '#44ff77'; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(72, 14); ctx.lineTo(72, 78); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(80, 14); ctx.lineTo(80, 78); ctx.stroke()
          for (let y = 22; y < 78; y += 10) { ctx.beginPath(); ctx.moveTo(72, y); ctx.lineTo(80, y); ctx.stroke() }
        },
        scaf_arch: () => {
          poles([14, 74], 76, 20, '#8855ff')
          hbar(10, 78, 20, '#ff7700'); hbar(10, 78, 48, '#ff7700')
          plank(12, 76, 20, '#ffe94d')
          ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2.5
          ctx.beginPath(); ctx.arc(44, 20, 30, Math.PI, 0); ctx.stroke()
        },
        scaf_flag: () => {
          poles([16, 66], 76, 28, '#8855ff')
          hbar(12, 70, 28, '#ff7700'); hbar(12, 70, 52, '#ff7700')
          plank(14, 68, 28, '#ffe94d')
          ctx.strokeStyle = '#ff7700'; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(30, 28); ctx.lineTo(30, 6); ctx.stroke()
          ctx.fillStyle = '#ff3355'; ctx.fillRect(30, 6, 22, 12)
          ctx.fillStyle = '#ffe94d'; ctx.fillRect(30, 12, 22, 5)
        },
        scaf_cabin: () => {
          poles([16, 72], 76, 28, '#8855ff')
          hbar(12, 76, 28, '#ff7700'); hbar(12, 76, 52, '#ff7700')
          plank(14, 74, 28, '#ffe94d')
          ctx.fillStyle = '#4422aa'; ctx.fillRect(22, 10, 44, 18)
          ctx.strokeStyle = '#ff55cc'; ctx.lineWidth = 2; ctx.strokeRect(22, 10, 44, 18)
          ctx.fillStyle = '#00d4ff'; ctx.fillRect(30, 14, 10, 8)
          ctx.fillStyle = '#ff7700'; ctx.fillRect(48, 16, 8, 12)
        },
        scaf_double: () => {
          poles([16, 72], 78, 16, '#8855ff')
          for (const y of [16, 42, 66]) { hbar(12, 76, y, '#ff7700'); plank(14, 74, y, '#ffe94d') }
          dline(16, 66, 72, 42, '#44ffcc')
          dline(16, 42, 72, 16, '#44ffcc')
        },
        scaf_crane_arm: () => {
          poles([16, 66], 76, 28, '#8855ff')
          hbar(12, 70, 28, '#ff7700'); hbar(12, 70, 52, '#ff7700')
          plank(14, 68, 28, '#ffe94d')
          ctx.strokeStyle = '#ff7700'; ctx.lineWidth = 2
          ctx.beginPath(); ctx.moveTo(40, 28); ctx.lineTo(40, 8); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(40, 8); ctx.lineTo(72, 16); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(40, 8); ctx.lineTo(24, 14); ctx.stroke()
          ctx.fillStyle = '#ff3355'; ctx.beginPath(); ctx.arc(68, 22, 5, 0, Math.PI * 2); ctx.fill()
        },
        scaf_sign: () => {
          poles([16, 72], 78, 28, '#8855ff')
          hbar(12, 76, 28, '#ff7700'); hbar(12, 76, 54, '#ff7700')
          plank(14, 74, 28, '#ffe94d')
          ctx.fillStyle = '#3322aa'; ctx.fillRect(18, 8, 52, 20)
          ctx.strokeStyle = '#ff55cc'; ctx.lineWidth = 2; ctx.strokeRect(18, 8, 52, 20)
          ctx.fillStyle = '#ffe94d'; ctx.fillRect(20, 10, 48, 8)
        },
        scaf_water_tank: () => {
          poles([18, 70], 74, 24, '#8855ff')
          for (const y of [24, 48]) hbar(14, 74, y, '#ff7700')
          plank(16, 72, 24, '#ffe94d')
          ctx.fillStyle = '#0088cc'
          ctx.beginPath(); ctx.arc(44, 12, 14, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = '#44ffcc'; ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(44, 12, 14, 0, Math.PI * 2); ctx.stroke()
        },
        scaf_rocket_pad: () => {
          poles([16, 72], 74, 28, '#8855ff')
          hbar(12, 76, 28, '#ff7700'); hbar(12, 76, 52, '#ff7700')
          plank(14, 74, 28, '#ffe94d')
          ctx.fillStyle = '#ff3355'
          ctx.beginPath(); ctx.moveTo(44, 4); ctx.lineTo(38, 18); ctx.lineTo(50, 18); ctx.closePath(); ctx.fill()
          ctx.fillStyle = '#00d4ff'; ctx.fillRect(39, 18, 10, 12)
          ctx.fillStyle = '#ff7700'; ctx.fillRect(36, 28, 5, 5); ctx.fillRect(47, 28, 5, 5)
        },
      }
      ;(shapes[type] || (() => { plank(14, 74, 44, '#ffe94d'); poles([18, 70], 74, 22, '#8855ff'); hbar(14, 74, 22, '#ff7700') }))()

      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.font = 'bold 8px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(type.replace('scaf_', '').replace(/_/g, ' ').toUpperCase(), 44, 85)
    }

    // Game state
    const state = {
      gameActive: false,
      score: 0,
      combo: 0,
      stackedPieces: [],
      towerHeight: 0,
      towerLeanX: 0,
      towerVelocity: 0,
      towerAngle: 0,
      // Exponential moving average of recent per-piece offsets (relX = lx - prevX).
      // Tracks "directional bias of recent stacking" — positive = drifting right,
      // negative = drifting left. EMA (α=0.3) means one corrective stack visibly
      // moves the signal, instead of being diluted across a 10-wide window. Using
      // relX (not absolute lx) means a centered stack on a drifted tower reads as
      // 0 bias — the angular lean physics already handles existing tower tilt;
      // this signal is about whether the player is making it WORSE.
      avgDrift: 0,
      // Cached aspect scale (>1 = pull camera further back). Updated on resize.
      aspectScale: 1,
      // ESC pause flag — gameplay updates skip while true; renderer keeps drawing.
      paused: false,
      currentPiece: null,
      nextType: null,
      swingAngle: 0,
      swingSpeed: 0.022,
      swingAmp: 5.8,
      swingHeight: 0,
      dropping: false,
      dropPiece: null,
      dropVel: 0,
      screenShake: 0,
      shakeX: 0,
      gameOverDelay: 0,
      frameN: 0,
      fallingPieces: [],
      camDolly: 0,
      flash: 0,
      projectiles: [],
      projectileTimer: 240,
      projectileWarnings: [],
      shockwaves: [],
      biasWarnCooldown: 0,
      tier: 0,
      perfectCount: 0,
      maxCombo: 0,
      tierReached: 0,
      framesSinceLand: 0,
      lastLandedPiece: null,
      lastLandedSquash: 0,

      // Foundation choice + derived score multiplier
      foundation: 'standard',
      scoreMult: 1.0,

      // Score milestones — index of next milestone to award
      milestoneIdx: 0,

      // Time-slow on near-miss drops (frames remaining)
      timeSlow: 0,

      // Wind gusts
      wind: { active: false, dir: 0, frames: 0, offset: 0, timer: 1200, telegraphFrames: 0 },

      // Power-ups (collected by the swinging piece passing through)
      powerups: [],
      powerupTimer: 900,
      // Active buffs
      buffWide: false,         // next spawned piece is widened
      buffFreeze: 0,           // frames swing is frozen
      buffAutoPerfect: false,  // next drop snaps to perfect X

      // Checkpoint floors (50/100/150) — set true when crossed, consumed in spawnNext
      checkpointPending: false,
    }
    state.aspectScale = computeAspectScale(W, H)
    const towerGroup = new THREE.Group()
    scene.add(towerGroup)

    const TIER_NAMES = [
      'GROUND FLOOR', 'LOW-RISE', 'MID-RISE', 'HIGH-RISE', 'TOWER CREW',
      'SKYLINE', 'SUPERSTRUCTURE', 'LANDMARK', 'MONUMENT', 'RADIAN LEGEND',
    ]

    // Arcade tier-up banner — fires when stackedPieces crosses a 25-floor boundary.
    function spawnTierBanner(tier) {
      const el = document.createElement('div')
      el.className = 'tier-banner'
      const name = TIER_NAMES[Math.min(tier, TIER_NAMES.length - 1)]
      el.innerHTML = `TIER ${tier}<span class="sub">${name}</span>`
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 1500)
      // Punchy feedback so the difficulty step lands.
      state.screenShake = Math.max(state.screenShake, 0.6)
      state.flash = Math.max(state.flash, 0.45)
    }

    // Score milestone banner (cyan) — separate styling from tier banner.
    function spawnMilestoneBanner(score) {
      const el = document.createElement('div')
      el.className = 'tier-banner milestone'
      el.innerHTML = `${score.toLocaleString()}<span class="sub">RADIANS EARNED</span>`
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 1500)
      state.screenShake = Math.max(state.screenShake, 0.5)
      state.flash = Math.max(state.flash, 0.35)
    }

    // Checkpoint banner — when a 50/100/150 floor is crossed and a wide piece is queued.
    function spawnCheckpointBanner(floor) {
      const el = document.createElement('div')
      el.className = 'tier-banner checkpoint'
      el.innerHTML = `CHECKPOINT — FLOOR ${floor}<span class="sub">BIG PIECE INCOMING</span>`
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 1500)
      state.flash = Math.max(state.flash, 0.4)
    }

    // Wind warning popup — fires once when a gust starts to blow.
    function spawnWindWarning(dir) {
      const el = document.createElement('div')
      const side = dir > 0 ? 'left' : 'right' // tape on the *origin* side
      el.className = 'bias-warn wind ' + side
      const arrow = dir > 0 ? '→ → →' : '← ← ←'
      el.innerHTML = `<span class="arrow">${arrow}</span> WIND <span class="arrow">${arrow}</span>`
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 900)
    }

    // Arcade-style "STACK LEFT!" / "STACK RIGHT!" warning when cumulative bias is past
    // its threshold. dir = -1 means tower is leaning left → tells player to stack right.
    function spawnBiasWarning(dir) {
      const el = document.createElement('div')
      const side = dir < 0 ? 'right' : 'left' // pop-up sits on the *safe* side
      el.className = 'bias-warn ' + side
      const label = dir < 0 ? 'STACK RIGHT!' : 'STACK LEFT!'
      const arrow = dir < 0 ? '→' : '←'
      el.innerHTML = dir < 0
        ? `${label} <span class="arrow">${arrow}</span>`
        : `<span class="arrow">${arrow}</span> ${label}`
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 720)
    }

    function spawnPtsPopup(pts, kind, comboVal) {
      const el = document.createElement('div')
      el.className = 'pts-popup'
      const cx = window.innerWidth / 2 + (Math.random() - 0.5) * 120
      const cy = window.innerHeight / 2 + (Math.random() - 0.5) * 60
      el.style.left = cx + 'px'
      el.style.top = cy + 'px'
      if (kind === 'perfect') {
        el.style.fontSize = '38px'
        el.style.color = '#ffffff'
        el.style.textShadow = '0 0 30px #ff88ff, 0 0 12px #ff44ff'
        el.textContent = '★ PERFECT! +' + pts
      } else if (kind === 'combo') {
        el.style.fontSize = '30px'
        el.style.color = '#ff44ff'
        el.style.textShadow = '0 0 24px #ff00ff'
        el.textContent = comboVal + '× COMBO +' + pts
      } else if (kind === 'miss') {
        el.style.fontSize = '22px'
        el.style.color = '#ff4444'
        el.style.textShadow = '0 0 16px #ff0000'
        el.textContent = 'WOBBLY!'
      } else {
        el.style.fontSize = '28px'
        el.style.color = '#ffe94d'
        el.style.textShadow = '0 0 20px #ffaa00'
        el.textContent = '+' + pts
      }
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 900)
    }

    // ── PROJECTILES ─────────────────────────────────────────
    // Logo sprite + canvas-generated purple radial glow.
    const texLoader = new THREE.TextureLoader()
    const logoTex = texLoader.load('/logo.png')
    logoTex.colorSpace = THREE.SRGBColorSpace

    // Bigger, brighter glow — this is the company logo, it should be the most
    // visually loud thing on screen short of the tower itself.
    const glowTex = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 256
      const cx = c.getContext('2d')
      const g = cx.createRadialGradient(128, 128, 0, 128, 128, 128)
      g.addColorStop(0.0, 'rgba(255,200,255,1.0)')
      g.addColorStop(0.20, 'rgba(230,150,255,0.90)')
      g.addColorStop(0.50, 'rgba(170, 60,230,0.55)')
      g.addColorStop(1.0, 'rgba(120,  0,180,0.0)')
      cx.fillStyle = g
      cx.fillRect(0, 0, 256, 256)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()

    // Helper: convert a world-space Y to a screen-space Y (in pixels) using the
    // current camera. Used for telegraph placement so the arrow always points at
    // where the projectile will actually appear, regardless of camera height.
    function worldYToScreenY(worldY) {
      const v = new THREE.Vector3(0, worldY, 0)
      v.project(camera)
      return ((1 - v.y) / 2) * window.innerHeight
    }

    // Telegraph: drop a pulsing arrow on the screen edge AT the exact world Y the
    // projectile will spawn at, then actually spawn the projectile after `lead` frames.
    // Locking absY here (instead of recomputing from state.swingHeight at spawn time)
    // keeps the warning honest if the swing band moves between warning and spawn.
    function spawnProjectileWarning() {
      const dir = Math.random() < 0.5 ? -1 : 1
      const yOff = (Math.random() - 0.5) * 1.4
      const absY = state.swingHeight + yOff
      const el = document.createElement('div')
      el.className = 'proj-warn ' + (dir < 0 ? 'left' : 'right')
      // CSS-drawn triangle (border trick) — guaranteed look across platforms,
      // unlike a unicode arrow glyph that font-fallback can swap out.
      el.innerHTML = '<div class="tri"></div><div class="incoming">INCOMING</div>'
      // Project world Y → screen Y so the arrow lines up vertically with the actual shot.
      const screenY = worldYToScreenY(absY)
      el.style.top = Math.max(60, Math.min(window.innerHeight - 80, screenY)) + 'px'
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 750)
      state.projectileWarnings.push({
        dir,
        absY, // committed world Y — used by spawnProjectile, not recomputed
        framesLeft: 45, // ~0.75s lead
      })
    }

    function spawnProjectile(dir, absY) {
      const group = new THREE.Group()

      // Outer halo — extra glow ring so the logo really pops, even at fast speeds.
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xff66ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }))
      halo.scale.set(6.5, 6.5, 1)
      halo.position.z = -0.1
      group.add(halo)

      // Inner glow.
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xcc66ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }))
      glow.scale.set(4.5, 4.5, 1)
      glow.position.z = -0.05
      group.add(glow)

      // The logo itself — bumped up so the brand reads at a glance.
      const logo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: logoTex,
        transparent: true,
        depthWrite: false,
      }))
      logo.scale.set(2.4, 2.4, 1)
      group.add(logo)

      // Spawn off the side of the screen at the committed Y from the warning.
      group.position.set(dir * -22, absY, 0)
      scene.add(group)

      state.projectiles.push({
        mesh: group,
        glow,
        halo,
        logo,
        vx: dir * (0.18 + Math.random() * 0.07),
        vy: 0,
        wobblePhase: Math.random() * Math.PI * 2,
        life: 280, // tight safety net; actual cleanup happens on |x| > 28
        radius: 0.95, // slightly larger to match the bigger sprite
        trail: [], // logo ghost copies, fade out behind the main sprite
      })
    }

    // Rotation-aware hit test. The swinging piece visibly rotates ±0.22 rad from the
    // swing and another ±0.25 rad from prior projectile hits, so an axis-aligned AABB
    // misses real visual hits. Transform the projectile into the piece's local frame
    // and do the AABB check there.
    function projectileHitsPiece(pj, piece) {
      const dx = pj.mesh.position.x - piece.position.x
      const dy = pj.mesh.position.y - piece.position.y
      const a = -piece.rotation.z
      const c = Math.cos(a), s = Math.sin(a)
      const lx = dx * c - dy * s
      const ly = dx * s + dy * c
      const hw = piece.userData.pw / 2 + pj.radius
      const hh = piece.userData.ph / 2 + pj.radius
      return Math.abs(lx) < hw && Math.abs(ly) < hh
    }

    // Expanding purple shockwave ring on impact — distinct from landing particles
    // so the player instantly reads "I got hit" instead of "I landed."
    function spawnShockwave(x, y) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.85, 32),
        new THREE.MeshBasicMaterial({
          color: 0xff44ff,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
      ring.position.set(x, y, 0)
      scene.add(ring)
      state.shockwaves.push({ mesh: ring, life: 1 })
    }

    function disposeProjectile(pj) {
      scene.remove(pj.mesh)
      for (const t of pj.trail) scene.remove(t.sprite)
      pj.trail.length = 0
    }

    function onProjectileHit(pj) {
      // Bump the swing — perturb phase, widen amp briefly, kick visible rotation.
      const dir = Math.sign(pj.vx) || 1
      state.swingAngle += dir * 0.55
      state.swingAmp = Math.min(8.5, state.swingAmp + 0.6)
      if (state.currentPiece) {
        state.currentPiece.rotation.z += dir * 0.25
        state.currentPiece.rotation.x = (Math.random() - 0.5) * 0.4
      }
      state.screenShake = Math.max(state.screenShake, 0.55)
      spawnShockwave(pj.mesh.position.x, pj.mesh.position.y)
      spawnBurst(pj.mesh.position.x, pj.mesh.position.y, 0, 22, [0xcc66ff, 0xff88ff, 0xffffff, 0x9966ff, 0xff44ff])
    }

    // ── POWER-UPS ─────────────────────────────────────────
    // Three pickup types drift across the swing arc; the swinging piece collides with them.
    //   wide   — next piece spawns 1.5× wider for one drop      (gold)
    //   freeze — swing pauses for 3 seconds                     (cyan)
    //   auto   — next drop snaps to perfect X centerline        (magenta)
    const POWERUP_TYPES = ['wide', 'freeze', 'auto']
    const POWERUP_COLORS = { wide: 0xffe94d, freeze: 0x00d4ff, auto: 0xff44ff }
    function makePowerup(type) {
      const g = new THREE.Group()
      const col = POWERUP_COLORS[type]
      // Glowing core sphere
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 14, 10),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 })
      )
      g.add(core)
      // Outer halo via additive sprite
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: col, transparent: true, opacity: 0.85, depthWrite: false,
      }))
      halo.scale.set(3.2, 3.2, 1)
      g.add(halo)
      // Letter on the core (W / F / A) drawn to a small canvas
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, 128, 128)
      ctx.font = '900 96px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.lineWidth = 8; ctx.strokeStyle = '#1a0a44'
      ctx.fillStyle = '#ffffff'
      const letter = type === 'wide' ? 'W' : type === 'freeze' ? 'F' : 'A'
      ctx.strokeText(letter, 64, 64); ctx.fillText(letter, 64, 64)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
      }))
      label.scale.set(1.0, 1.0, 1)
      label.position.z = 0.02
      g.add(label)
      g.userData.type = type
      g.userData.core = core
      g.userData.halo = halo
      return g
    }
    function spawnPowerup() {
      const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
      const dir = Math.random() < 0.5 ? -1 : 1
      const yOff = (Math.random() - 0.5) * 4
      const absY = state.swingHeight + yOff
      const startX = dir < 0 ? 22 : -22
      const mesh = makePowerup(type)
      mesh.position.set(startX, absY, 0)
      scene.add(mesh)
      state.powerups.push({
        mesh,
        type,
        vx: -dir * 0.10, // slow enough to be catchable
        baseY: absY,
        phase: Math.random() * Math.PI * 2,
        life: 720, // ~12s onscreen if untouched
      })
    }
    function disposePowerup(pu) {
      scene.remove(pu.mesh)
    }
    function powerupHitsPiece(pu, piece) {
      const px = pu.mesh.position.x
      const py = pu.mesh.position.y
      const piX = piece.position.x, piY = piece.position.y
      const pw = piece.userData.pw, ph = piece.userData.ph
      // Generous radial test — power-ups should be easy to grab.
      const dx = px - piX, dy = py - piY
      return Math.abs(dx) < pw / 2 + 0.5 && Math.abs(dy) < ph / 2 + 0.5
    }
    function onPowerupCollect(pu) {
      const at = pu.mesh.position
      spawnBurst(at.x, at.y, 0, 26, [POWERUP_COLORS[pu.type], 0xffffff, 0xffe94d])
      state.flash = Math.max(state.flash, 0.45)
      if (pu.type === 'wide')   state.buffWide = true
      if (pu.type === 'freeze') state.buffFreeze = 180 // 3s @ 60fps
      if (pu.type === 'auto')   state.buffAutoPerfect = true
      // Floating label so the player knows what they grabbed.
      const el = document.createElement('div')
      el.className = 'pts-popup'
      el.style.left = (window.innerWidth / 2) + 'px'
      el.style.top = (window.innerHeight / 2 - 80) + 'px'
      el.style.fontSize = '32px'
      el.style.color = '#ffffff'
      el.style.textShadow = `0 0 20px #${POWERUP_COLORS[pu.type].toString(16).padStart(6, '0')}`
      el.textContent = pu.type === 'wide'   ? '+ WIDE PIECE'
                     : pu.type === 'freeze' ? '+ FREEZE 3s'
                     :                        '+ AUTO PERFECT'
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 900)
    }

    // Combo glow — tint every stacked piece's emissive by current combo level.
    function updateTowerGlow() {
      const level = Math.min(1, state.combo / 8) // saturate at combo 8
      const r = 0.55 * level
      const g = 0.10 * level
      const b = 0.75 * level
      for (const piece of state.stackedPieces) {
        piece.traverse((obj) => {
          if (obj.isMesh && obj.material && obj.material.emissive) {
            obj.material.emissive.setRGB(r, g, b)
          }
        })
      }
    }

    function spawnNext() {
      if (state.currentPiece) {
        scene.remove(state.currentPiece)
        state.currentPiece = null
      }
      let type = state.nextType || TYPES[Math.floor(Math.random() * TYPES.length)]
      // Checkpoint floors override the next piece with a forgiving wide flat — a breather + victory moment.
      if (state.checkpointPending) {
        state.checkpointPending = false
        type = 'scaf_flat'
      }
      state.nextType = TYPES[Math.floor(Math.random() * TYPES.length)]
      drawNextPiece(state.nextType)
      // Color-code the next-preview border by piece difficulty (easy/med/hard).
      if (nextCanvasRef.current) {
        const diff = TYPE_DIFFICULTY[state.nextType] || 'med'
        nextCanvasRef.current.classList.remove('diff-easy', 'diff-med', 'diff-hard')
        nextCanvasRef.current.classList.add('diff-' + diff)
      }
      state.currentPiece = makePiece(type)
      // Scale buffs (one-shot): checkpoint takes precedence over WIDE pickup.
      let scaleBoost = 0
      if (state.pendingCheckpointScale) {
        scaleBoost = state.pendingCheckpointScale
        state.pendingCheckpointScale = 0
      } else if (state.buffWide) {
        scaleBoost = 1.5
        state.buffWide = false
      }
      if (scaleBoost) {
        state.currentPiece.scale.set(scaleBoost, 1, scaleBoost)
        state.currentPiece.userData.pw *= scaleBoost
        state.currentPiece.userData.pd *= scaleBoost
      }
      // Don't reset swingAngle — let phase continue so player can't time a guaranteed perfect.
      // Add a small random kick to make the rhythm unpredictable.
      state.swingAngle += 0.7 + Math.random() * Math.PI
      const pieceHalf = state.currentPiece.userData.ph / 2
      // Lift the swinging piece well above the tower top — leaves vertical space
      // between the stack and the crane for future projectiles.
      state.swingHeight = state.towerHeight + pieceHalf + 7
      const sx0 = Math.sin(state.swingAngle) * state.swingAmp
      state.currentPiece.position.set(sx0, state.swingHeight, 0)
      scene.add(state.currentPiece)
      buildCrane(state.swingHeight + pieceHalf + 0.3)
    }

    function landPiece(p) {
      const lx = p.position.x
      const ph = p.userData.ph
      const newW = p.userData.pw
      const prev = state.stackedPieces[state.stackedPieces.length - 1]
      const prevX = prev ? prev.position.x : 0
      const prevW = prev ? prev.userData.pw : 5.2

      // Center-to-center offset — this is what governs lean.
      const relX = lx - prevX

      // Footprint overlap on the X axis.
      const overlap = Math.max(
        0,
        Math.min(prevX + prevW / 2, lx + newW / 2) -
          Math.max(prevX - prevW / 2, lx - newW / 2)
      )

      // No contact at all → piece falls off the side and the game ends.
      // (You cannot stack on air.)
      if (overlap < 0.15) {
        const dir = Math.sign(relX) || 1
        state.fallingPieces.push({
          mesh: p,
          vx: dir * 0.28,
          vy: 0.05,
          rotV: dir * 0.06,
        })
        const tier = Math.floor((state.stackedPieces.length + 1) / 25)
        const heightFactor = 1 + tier * 0.55
        // The tower lurches hard in the direction of the missed piece.
        state.towerLeanX += dir * 7 * heightFactor
        state.towerVelocity += dir * 1.4 * heightFactor
        spawnPtsPopup(0, 'miss')
        triggerGameOver()
        return
      }

      // Hangoff fraction (relative to new piece width) — used for scoring.
      const hangoffAbs = Math.max(0, Math.abs(relX) + newW / 2 - prevW / 2)
      const overhang = Math.min(1, hangoffAbs / Math.max(newW, 0.5))

      const tier = Math.floor((state.stackedPieces.length + 1) / 25)
      const isMiss = overhang > 0.55
      const heightFactor = 1 + tier * 0.55

      // Lean is driven by the center-to-center offset between the new piece
      // and the one below — exactly the "how far off centre" feel.
      state.towerLeanX += relX * (0.28 + tier * 0.08) * heightFactor
      state.towerVelocity += relX * (0.085 + tier * 0.03) * heightFactor

      const perf = overhang < 0.08
      const good = overhang < 0.30
      let pts = Math.max(5, Math.round((1 - Math.min(overhang, 1)) * 130) + 10)
      if (perf) { pts += 70; state.combo++; state.perfectCount++ }
      else if (good) { pts += 20; state.combo = Math.max(0, state.combo - 1) }
      else { state.combo = 0; pts = Math.max(5, pts - 20) }
      if (state.combo >= 2) pts = Math.round(pts * (1 + state.combo * 0.4))
      // Foundation score multiplier — narrow base earns 2×, wide earns 0.7×.
      pts = Math.max(1, Math.round(pts * state.scoreMult))
      if (state.combo > state.maxCombo) state.maxCombo = state.combo
      state.score += pts

      // Score milestone banner — single banner per crossing.
      while (state.milestoneIdx < SCORE_MILESTONES.length &&
             state.score >= SCORE_MILESTONES[state.milestoneIdx]) {
        spawnMilestoneBanner(SCORE_MILESTONES[state.milestoneIdx])
        state.milestoneIdx++
      }

      const sc = scoreRef.current
      if (sc) {
        sc.textContent = state.score
        sc.classList.remove('pop')
        void sc.offsetWidth
        sc.classList.add('pop')
        setTimeout(() => sc.classList.remove('pop'), 180)
      }

      const floors = state.stackedPieces.length + 1
      const hn = heightNumRef.current
      if (hn) {
        hn.textContent = floors
        hn.classList.remove('pop')
        void hn.offsetWidth
        hn.classList.add('pop')
        setTimeout(() => hn.classList.remove('pop'), 180)
      }

      if (perf) spawnPtsPopup(pts, 'perfect')
      else if (state.combo >= 2) spawnPtsPopup(pts, 'combo', state.combo)
      else if (isMiss) spawnPtsPopup(pts, 'miss')
      else spawnPtsPopup(pts, 'normal')

      if (state.combo >= 2) {
        const el = comboTextRef.current
        if (el) {
          el.textContent = `${state.combo}× COMBO!`
          el.style.opacity = '1'
          clearTimeout(el._t)
          el._t = setTimeout(() => { el.style.opacity = '0' }, 900)
        }
      }

      const burst = [0xffe94d, 0xff44ff, 0x44ffcc, 0xff4444, 0x44ff77]
      spawnBurst(lx, state.towerHeight + ph / 2, 0, perf ? 30 : isMiss ? 8 : 18, burst)
      // Combo-scaled shake — bigger combos rumble harder.
      const comboShake = Math.min(0.55, state.combo * 0.06)
      if (perf) {
        spawnStarBurst(lx, state.towerHeight + ph / 2, 0)
        state.screenShake = 0.7 + comboShake
        state.camDolly = 1.0
        state.flash = 0.7
      }
      else if (isMiss) { state.screenShake = 0.5 + comboShake * 0.4 }
      else { state.screenShake = 0.25 + comboShake * 0.6 }

      p.position.set(lx, state.towerHeight + ph / 2, 0)
      state.towerHeight += ph
      state.stackedPieces.push(p)
      towerGroup.add(p)

      // ── Tower decorations: stencils every 5 floors, flags every 10, hard-hat every 25 ──
      const floorN = state.stackedPieces.length
      if (floorN % 5 === 0) {
        const stencil = makeFloorNumber(floorN)
        // Mount on the front face of the piece, facing camera
        stencil.position.set(0, 0, p.userData.pd / 2 + 0.06)
        p.add(stencil)
      }
      if (floorN % 10 === 0) {
        // Alternate sides each 10-floor checkpoint, alternate colors each 20
        const flag = makeFlag(floorN % 20 === 0 ? 0xff44ff : 0xffe94d)
        const side = (floorN % 20 === 0) ? 1 : -1
        flag.position.set(side * (p.userData.pw / 2 - 0.2), p.userData.ph / 2, 0)
        p.add(flag)
      }
      if (floorN % 25 === 0) {
        // Topping-out tradition — hard hat lands on the milestone floor
        const hat = makeHardHat()
        hat.position.set(0, p.userData.ph / 2 + 0.45, 0)
        p.add(hat)
        spawnStarBurst(lx, state.towerHeight + 0.5, 0)
      }

      // Directional-bias EMA — feeds the warning + topple pressure in the animate loop.
      // We track relX (per-piece offset from the piece below), not absolute lx, so
      // "stack left to recover" reads as immediately corrective even on a drifted tower.
      // EMA α=0.3 means a single leftward stack moves the signal ~30% toward that sample —
      // responsive enough that the HUD reacts within 1–2 lands.
      const DRIFT_ALPHA = 0.3
      state.avgDrift = state.avgDrift * (1 - DRIFT_ALPHA) + relX * DRIFT_ALPHA
      updateTowerGlow()

      // Squash-on-land — kick scale to flat-and-wide, animate loop lerps it back.
      p.scale.set(1.18, 0.72, 1.18)
      state.lastLandedPiece = p
      state.lastLandedSquash = 1
      state.framesSinceLand = 0

      // Tier change detection — pop the milestone banner once per crossing.
      const newTier = Math.floor(state.stackedPieces.length / 25)
      if (newTier > state.tier) {
        state.tier = newTier
        state.tierReached = newTier
        spawnTierBanner(newTier)
      }

      // Checkpoint floors — at 50/100/150 we queue an oversized forgiving piece.
      if (floorN === 50 || floorN === 100 || floorN === 150) {
        state.pendingCheckpointScale = 2.4
        spawnCheckpointBanner(floorN)
      }

      // Smooth per-floor swing scaling — faster ramp than before.
      const f = state.stackedPieces.length
      state.swingSpeed = Math.min(0.095, 0.028 + f * 0.0013)
      state.swingAmp = Math.min(8.2, 5.8 + f * 0.04)
    }

    function triggerGameOver() {
      state.gameActive = false
      state.toppling = true
      if (state.dropPiece) { scene.remove(state.dropPiece); state.dropPiece = null }
      if (state.currentPiece) { scene.remove(state.currentPiece); state.currentPiece = null }
      // Hide the crane during the fall so it doesn't hover over the toppling tower.
      while (craneGroup.children.length) craneGroup.remove(craneGroup.children[0])
      craneCable = null
      spawnBurst(0, state.towerHeight / 2, 0, 80, [0xff3355, 0xff7700, 0xffe94d, 0xff00ff, 0x44ffcc])
      state.screenShake = 2.5
      // Wait long enough for the tower to actually fall before showing the screen.
      state.gameOverDelay = 160
    }

    function startGame(foundation = 'standard') {
      for (const p of state.stackedPieces) towerGroup.remove(p)
      state.stackedPieces = []
      for (const fp of state.fallingPieces) scene.remove(fp.mesh)
      state.fallingPieces = []
      for (const pj of state.projectiles) disposeProjectile(pj)
      state.projectiles = []
      for (const sw of state.shockwaves) scene.remove(sw.mesh)
      state.shockwaves = []
      for (const pu of state.powerups) disposePowerup(pu)
      state.powerups = []
      state.projectileTimer = 480 + Math.random() * 360 // generous grace period at start
      state.powerupTimer = 900 + Math.random() * 600
      state.towerHeight = 0
      state.towerLeanX = 0
      state.towerVelocity = 0
      state.towerAngle = 0
      state.avgDrift = 0
      state.biasWarnCooldown = 0
      state.tier = 0
      state.perfectCount = 0
      state.maxCombo = 0
      state.tierReached = 0
      state.framesSinceLand = 0
      state.lastLandedPiece = null
      state.lastLandedSquash = 0
      state.projectileWarnings = []
      // Foundation choice + score multiplier
      const fnd = FOUNDATIONS[foundation] || FOUNDATIONS.standard
      state.foundation = foundation
      state.scoreMult = fnd.mult
      // Reset milestones / buffs / wind / time-slow / checkpoint
      state.milestoneIdx = 0
      state.timeSlow = 0
      state.wind = { active: false, dir: 0, frames: 0, offset: 0, timer: 1200 + Math.random() * 600, telegraphFrames: 0 }
      state.buffWide = false
      state.buffFreeze = 0
      state.buffAutoPerfect = false
      state.checkpointPending = false
      state.pendingCheckpointScale = 0
      towerGroup.rotation.z = 0
      state.score = 0
      state.combo = 0
      state.swingSpeed = 0.028
      state.swingAmp = 5.8
      state.swingAngle = Math.random() * Math.PI * 2
      state.dropping = false
      state.toppling = false
      state.camDolly = 0
      state.flash = 0
      state.dropPiece = null
      state.gameOverDelay = 0
      // Initial camera placement — Z scales with viewport aspect so the start
      // shot is framed consistently across screen shapes. The animate loop will
      // ease toward its dynamic target from here.
      camera.position.set(0, 3, (22 + 5.8 * 0.6) * state.aspectScale)
      camera.lookAt(0, 4, 0)
      if (scoreRef.current) scoreRef.current.textContent = '0'
      if (heightNumRef.current) heightNumRef.current.textContent = '0'
      if (comboTextRef.current) comboTextRef.current.style.opacity = '0'
      setShowStart(false)
      setShowGameOver(false)
      state.gameActive = true
      state.nextType = TYPES[Math.floor(Math.random() * TYPES.length)]
      const base = makePiece('scaf_flat')
      // Apply foundation scale to the base — narrow base = harder, wide = easier landing target.
      base.scale.set(fnd.scale, 1, fnd.scale)
      base.userData.pw *= fnd.scale
      base.userData.pd *= fnd.scale
      base.position.y = base.userData.ph / 2
      state.towerHeight = base.userData.ph
      state.stackedPieces.push(base)
      towerGroup.add(base)
      spawnNext()
    }

    function drop() {
      if (!state.currentPiece || !state.gameActive) return
      if (state.dropping) return
      state.dropping = true
      state.dropPiece = state.currentPiece
      // Snap rotation upright so the falling piece's visual footprint matches its scored x position.
      state.dropPiece.rotation.z = 0
      state.dropPiece.rotation.y = 0
      // AUTO-PERFECT buff — snap X to the previous piece's center so the land scores perfect.
      if (state.buffAutoPerfect) {
        state.buffAutoPerfect = false
        const prev = state.stackedPieces[state.stackedPieces.length - 1]
        if (prev) state.dropPiece.position.x = prev.position.x
      } else {
        // Predict overhang for the near-miss time-slow effect.
        const prev = state.stackedPieces[state.stackedPieces.length - 1]
        if (prev) {
          const lx = state.dropPiece.position.x
          const newW = state.dropPiece.userData.pw
          const prevX = prev.position.x, prevW = prev.userData.pw
          const relX = lx - prevX
          const hangoffAbs = Math.max(0, Math.abs(relX) + newW / 2 - prevW / 2)
          const overhang = Math.min(1, hangoffAbs / Math.max(newW, 0.5))
          // Sweet spot: clearly going to score but barely — drop falls in slow-mo to dramatize the moment.
          if (overhang > 0.40 && overhang < 0.55) state.timeSlow = 36
        }
      }
      state.dropVel = 0
      state.currentPiece = null
      setTimeout(spawnNext, 450)
    }

    // Compose a shareable PNG: game canvas snapshot + branding + recap stats.
    function generateScoreCard() {
      const W = 800, H = 1100
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const ctx = c.getContext('2d')
      // Background gradient — match the in-game purple
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, '#180530')
      grad.addColorStop(1, '#3a0a55')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
      // Header bar
      ctx.fillStyle = '#ffe94d'
      ctx.font = '900 64px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('RADIAN', W / 2, 70)
      ctx.fillStyle = '#aa88dd'
      ctx.font = '800 22px "Segoe UI", sans-serif'
      ctx.fillText('SCAFFOLDING · TOWER STACKER', W / 2, 115)
      // Game-canvas snapshot (the WebGL canvas was rendered with preserveDrawingBuffer)
      try {
        ctx.drawImage(canvas, 40, 150, W - 80, 460)
      } catch {
        // If the snapshot fails for any reason, fall through with a flat panel
        ctx.fillStyle = '#240540'
        ctx.fillRect(40, 150, W - 80, 460)
      }
      // Big score
      ctx.fillStyle = '#ffe94d'
      ctx.font = '900 100px "Segoe UI", sans-serif'
      ctx.fillText(state.score.toLocaleString(), W / 2, 700)
      ctx.fillStyle = '#aa88dd'
      ctx.font = '800 18px "Segoe UI", sans-serif'
      ctx.fillText('FINAL SCORE', W / 2, 760)
      // Recap row
      const stats = [
        { num: String(state.stackedPieces.length), lbl: 'FLOORS', col: '#44ffcc' },
        { num: String(state.perfectCount),         lbl: 'PERFECTS', col: '#ffe94d' },
        { num: state.maxCombo + '×',               lbl: 'BEST COMBO', col: '#ff44ff' },
        { num: String(state.tierReached),          lbl: 'TIER', col: '#00d4ff' },
      ]
      const colW = (W - 80) / stats.length
      stats.forEach((s, i) => {
        const cx = 40 + colW * (i + 0.5)
        ctx.fillStyle = s.col
        ctx.font = '900 56px "Segoe UI", sans-serif'
        ctx.fillText(s.num, cx, 860)
        ctx.fillStyle = '#aa88dd'
        ctx.font = '800 14px "Segoe UI", sans-serif'
        ctx.fillText(s.lbl, cx, 910)
      })
      // Foundation + date
      ctx.fillStyle = '#ffffff'
      ctx.font = '700 18px "Segoe UI", sans-serif'
      const fnd = FOUNDATIONS[state.foundation] || FOUNDATIONS.standard
      ctx.fillText(`${fnd.label} FOUNDATION · ${new Date().toLocaleDateString()}`, W / 2, 970)
      // Footer CTA
      ctx.fillStyle = '#ffe94d'
      ctx.font = '900 26px "Segoe UI", sans-serif'
      ctx.fillText('RADIAN SCAFFOLDING', W / 2, 1030)
      ctx.fillStyle = '#aa88dd'
      ctx.font = '700 16px "Segoe UI", sans-serif'
      ctx.fillText('Built to stand. Built to stack.', W / 2, 1062)
      // Trigger download
      const link = document.createElement('a')
      link.download = `radian-stacker-${state.score}-${Date.now()}.png`
      link.href = c.toDataURL('image/png')
      link.click()
    }

    // Camera FOV setter — driven by the settings slider. Clamped to a sane range
    // so extreme values don't break the framing math (which assumes 65° baseline).
    function setCameraFov(deg) {
      // Clamped 50–80 — wider/narrower than this either crowds the framing
      // (low) or makes projectiles enter too early on the sides (high).
      const v = Math.max(50, Math.min(80, deg))
      camera.fov = v
      camera.updateProjectionMatrix()
    }
    function setPaused(p) { state.paused = !!p }
    // React-side run-end listener — fires once when the game-over delay expires,
    // carrying the recap payload. Used to persist scores to the leaderboard.
    let onRunEnd = null

    engineRef.current = { startGame, generateScoreCard, setCameraFov, setPaused }
    engineRef.current.setRunEndListener = (fn) => { onRunEnd = fn }

    // Input
    const onKey = (e) => {
      if (e.code === 'Escape') {
        // ESC opens / closes the pause menu — only when a run is in progress
        // (don't interfere with the start or game-over overlays).
        if (state.gameActive || state.paused) {
          e.preventDefault()
          const next = !state.paused
          state.paused = next
          if (typeof onPauseChange === 'function') onPauseChange(next)
        }
        return
      }
      if (e.code === 'Space') {
        if (state.paused) return
        e.preventDefault(); drop()
      }
    }
    // Bridge the ESC key to React via a closure the component sets below.
    let onPauseChange = null
    engineRef.current.setPauseListener = (fn) => { onPauseChange = fn }
    const onPointer = () => { if (!state.paused) drop() }
    document.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // Main loop
    let raf = 0
    let cancelled = false
    function animate() {
      if (cancelled) return
      raf = requestAnimationFrame(animate)
      // While paused: keep rendering the current frame so the background looks
      // alive behind the menu, but skip every gameplay update.
      if (state.paused) {
        renderer.render(scene, camera)
        return
      }
      state.frameN++

      // ── Worksite ambience: tape sway, bg crane drift, dust motes, worker head-tilt, spotlight follow ──
      for (const t of tapeSegments) {
        t.mesh.position.y = t.baseY + Math.sin(state.frameN * 0.045 + t.phase) * 0.10
        t.mesh.rotation.z = Math.sin(state.frameN * 0.030 + t.phase) * 0.05
      }
      // Dust motes / sparks drift up, wrap when they exit the top
      {
        const arr = sparks.geometry.attributes.position.array
        for (let i = 0; i < sparkCount; i++) {
          arr[i * 3 + 1] += sparkVel[i]
          arr[i * 3]     += Math.sin(state.frameN * 0.012 + i) * 0.006
          if (arr[i * 3 + 1] > 32) {
            arr[i * 3]     = (Math.random() - 0.5) * 36
            arr[i * 3 + 1] = -2
            arr[i * 3 + 2] = (Math.random() - 0.5) * 36 - 4
          }
        }
        sparks.geometry.attributes.position.needsUpdate = true
      }
      // Workers: gradually tilt heads up as the tower grows, plus subtle idle wobble
      for (const w of workers) {
        const target = -Math.min(1.0, state.swingHeight * 0.022)
                     + Math.sin(state.frameN * 0.012 + w.userData.phase) * 0.06
        w.userData.head.rotation.x += (target - w.userData.head.rotation.x) * 0.03
      }
      // Spotlight targets ride up with the tower so the cones keep illuminating the action
      for (const s of siteSpots) {
        const ty = Math.max(6, state.swingHeight * 0.65)
        s.target.position.y += (ty - s.target.position.y) * 0.04
      }

      // Wind gusts — telegraphed sustained drift on the swing X.
      // Smoothly ease the wind offset toward target so onset/decay feel like air, not a snap.
      {
        const w = state.wind
        if (state.gameActive) {
          if (w.telegraphFrames > 0) w.telegraphFrames--
          if (w.active) {
            w.frames--
            if (w.frames <= 0) w.active = false
          } else if (w.telegraphFrames === 0) {
            w.timer--
            if (w.timer <= 0 && state.stackedPieces.length >= 8) {
              w.dir = Math.random() < 0.5 ? -1 : 1
              w.telegraphFrames = 50
              spawnWindWarning(w.dir)
              // Schedule the actual gust to start after the telegraph window
              setTimeout(() => {
                if (cancelled) return
                w.active = true
                w.frames = 220 + Math.floor(Math.random() * 100) // ~3.5–5.3s
              }, 800)
              // Reset cooldown — next gust 18–32s away
              w.timer = 1080 + Math.floor(Math.random() * 840)
            }
          }
        }
        const target = w.active ? w.dir * 2.6 : 0
        w.offset += (target - w.offset) * 0.04
      }

      // Swing
      if (state.currentPiece && state.gameActive) {
        // Freeze buff suspends the swing; phase doesn't advance.
        if (state.buffFreeze > 0) {
          state.buffFreeze--
        } else {
          state.swingAngle += state.swingSpeed
        }
        const sx = Math.sin(state.swingAngle) * state.swingAmp + state.wind.offset
        state.currentPiece.position.set(sx, state.swingHeight, 0)
        state.currentPiece.rotation.z = Math.sin(state.swingAngle) * 0.22
        state.currentPiece.rotation.y = state.frameN * 0.01
        if (craneCable && craneGroup.children.length >= 2) {
          const armY = craneGroup.children[1].position.y
          const pieceTopY = state.swingHeight + state.currentPiece.userData.ph * 0.5 + 0.1
          const cableLen = Math.max(0.1, armY - pieceTopY)
          craneCable.scale.y = cableLen
          craneCable.position.set(sx, pieceTopY + cableLen / 2, 0)
        }
        // Trail wisp — small fading particle behind the swinging piece, opposite swing dir.
        if (state.frameN % 4 === 0) {
          const swingDir = Math.cos(state.swingAngle)
          spawnBurst(
            sx - swingDir * 0.6,
            state.swingHeight - state.currentPiece.userData.ph * 0.35,
            0,
            1,
            [0xcc88ff, 0xff88ff, 0xffe94d]
          )
        }
        // Freeze visual pulse — extra ghost wisp around the piece while frozen.
        if (state.buffFreeze > 0 && state.frameN % 2 === 0) {
          spawnBurst(sx, state.swingHeight, 0, 2, [0x00d4ff, 0xaaffff, 0xffffff])
        }
      }

      // Squash-on-land — ease the most recently landed piece back to identity scale.
      if (state.lastLandedPiece && state.lastLandedSquash > 0) {
        state.lastLandedSquash *= 0.82
        if (state.lastLandedSquash < 0.01) {
          state.lastLandedPiece.scale.set(1, 1, 1)
          state.lastLandedSquash = 0
          state.lastLandedPiece = null
        } else {
          const t = state.lastLandedSquash
          state.lastLandedPiece.scale.set(
            1 + 0.18 * t,
            1 - 0.28 * t,
            1 + 0.18 * t,
          )
        }
      }

      // Combo decay — stalling kills the combo so the player has to keep moving.
      if (state.gameActive && state.combo > 0) {
        state.framesSinceLand++
        if (state.framesSinceLand > 240) { // ~4s without a successful land
          state.combo = 0
          if (comboTextRef.current) comboTextRef.current.style.opacity = '0'
        }
      }

      // Drop — falls in slow-mo when state.timeSlow is active (set on near-miss in drop()).
      if (state.dropPiece) {
        const slowMul = state.timeSlow > 0 ? 0.42 : 1
        if (state.timeSlow > 0) state.timeSlow--
        state.dropVel += 0.055 * slowMul
        state.dropPiece.position.y -= state.dropVel * slowMul
        if (state.frameN % 3 === 0) {
          spawnBurst(state.dropPiece.position.x, state.dropPiece.position.y + state.dropPiece.userData.ph * 0.5, 0, 3, [0xcc88ff, 0xffffff, 0xff88ff])
        }
        const land = state.towerHeight + state.dropPiece.userData.ph / 2
        if (state.dropPiece.position.y <= land) {
          state.dropPiece.position.y = land
          state.timeSlow = 0
          const p = state.dropPiece
          state.dropPiece = null
          state.dropping = false
          if (state.gameActive) landPiece(p)
        }
      }

      // Tower physics — stepped tier (every 25 floors)
      const tier = Math.floor((state.stackedPieces.length || 1) / 25)
      const hFactor = 1 + tier * 0.55
      if (state.toppling) {
        // No restoring force, no damping — gravity-style angular accel so the tower actually falls.
        const dir = Math.sign(state.towerAngle) || Math.sign(state.towerLeanX) || 1
        state.towerVelocity += dir * 0.14 * (1 + tier * 0.4)
        state.towerAngle += state.towerVelocity
      } else {
        state.towerLeanX *= 0.992
        state.towerVelocity += state.towerLeanX * (0.008 + tier * 0.003) * hFactor
        state.towerVelocity -= state.towerAngle * (0.0035 - Math.min(0.0025, tier * 0.0008)) // strong restoring at low tiers, weakens with height
        state.towerVelocity *= 0.965
        // Windowed cumulative-bias pressure with smooth height scaling.
        //   At low towers, balance barely matters (huge tolerance, weak push) so early
        //   pieces feel forgiving and arcade-y.
        //   At tall towers, balance dominates: tolerance shrinks fast, the topple force
        //   ramps up, and the warning band feels physically tense.
        // Two thresholds:
        //   warnBiasThresh — earlier line; pop the "STACK X!" warning so the player has
        //                    time to recover BEFORE the tower starts toppling.
        //   toppleBiasThresh — the actual line where bias starts pushing the tower over.
        // avgDrift is an EMA of recent relX values — one corrective stack visibly recovers.
        const avgDrift = state.avgDrift
        const flrs = state.stackedPieces.length || 1
        // Smooth 0 → 1 ramp over the first ~70 floors. Continues to influence beyond
        // through the additive tier tightening below.
        const heightT = Math.min(1, flrs / 70)
        // Tolerance: starts at ~2.6 (very forgiving) and tightens toward 0.35 by floor 70.
        // Tier adds an extra bite past every 25-floor milestone so high-tier play feels brutal.
        const toppleBiasThresh = Math.max(0.25, 2.6 - heightT * 2.25 - tier * 0.08)
        const warnBiasThresh = toppleBiasThresh * 0.55
        const absDrift = Math.abs(avgDrift)
        const dir = Math.sign(avgDrift) || 1

        // Early-warning pop-ups + needle color flip — fires well before topple pressure.
        if (absDrift > warnBiasThresh) {
          state.biasWarnCooldown -= 1
          if (state.biasWarnCooldown <= 0) {
            spawnBiasWarning(dir)
            // Cadence speeds up as we approach the topple line — calm at first, frantic near it.
            const urgency = Math.min(1,
              (absDrift - warnBiasThresh) / Math.max(0.01, toppleBiasThresh - warnBiasThresh))
            state.biasWarnCooldown = Math.max(35, 95 - urgency * 60)
          }
          // Light shake while in the warning band — also scales with height so altitude bites.
          state.screenShake = Math.max(
            state.screenShake,
            (0.08 + heightT * 0.18) + (absDrift - warnBiasThresh) * 0.4,
          )
        } else {
          state.biasWarnCooldown = 0
        }

        // Actual topple pressure — only above the topple threshold. Force ramps with
        // height: low towers get a gentle nudge, tall towers get hammered.
        const excess = absDrift - toppleBiasThresh
        if (excess > 0) {
          const heightForce = 0.4 + heightT * 1.6 // 0.4× at floor 0, 2.0× at floor 70+
          state.towerVelocity += dir * excess * (0.014 + tier * 0.007) * hFactor * heightForce
          state.screenShake = Math.max(
            state.screenShake,
            Math.min(0.85, excess * 0.5 + tier * 0.05 + heightT * 0.2),
          )
        }
        state.towerAngle += state.towerVelocity
      }
      towerGroup.rotation.z = state.towerAngle * (Math.PI / 180)
      // Topple threshold: forgiving at start (32°), tightens 5° per tier, never below 14°.
      const toppleThresh = Math.max(14, 32 - tier * 5)
      if (state.gameActive && Math.abs(state.towerAngle) > toppleThresh) triggerGameOver()

      // Balance needle — combines instantaneous lean with the windowed-bias average so
      // the meter reflects both failure modes. Color-flips at the WARNING threshold,
      // not the topple threshold, so the player gets visual lead time too.
      {
        const avgDrift = state.avgDrift
        const leanContrib = state.towerLeanX / 10
        const biasContrib = avgDrift / 3
        const leanNorm = Math.max(0, Math.min(1, 0.5 + leanContrib + biasContrib))
        if (balanceNeedleRef.current) {
          balanceNeedleRef.current.style.left = (leanNorm * 100) + '%'
          const flrs = state.stackedPieces.length || 1
          const heightT = Math.min(1, flrs / 70)
          const toppleBiasThresh = Math.max(0.25, 2.6 - heightT * 2.25 - tier * 0.08)
          const warnBiasThresh = toppleBiasThresh * 0.55
          balanceNeedleRef.current.classList.toggle(
            'bias-warn-needle',
            Math.abs(avgDrift) > warnBiasThresh,
          )
        }
      }

      // Projectile telegraph + spawn — schedule a warning, fire the projectile when its lead expires.
      // Cooldown is rare + heavily randomized: long gaps with occasional bursts, never spam.
      if (state.gameActive) {
        state.projectileTimer -= 1
        if (state.projectileTimer <= 0) {
          spawnProjectileWarning()
          const t = Math.floor(state.stackedPieces.length / 25)
          // Floor 0:    320 + random*360 = 5.3–11.3s between shots
          // Tier 4+:    220 + random*360 = 3.7–9.7s
          // Tier 8+:    180 + random*360 = 3.0–9.0s (capped — never faster than this)
          state.projectileTimer = Math.max(180, 320 - t * 25) + Math.random() * 360
        }
        for (let i = state.projectileWarnings.length - 1; i >= 0; i--) {
          const w = state.projectileWarnings[i]
          w.framesLeft--
          if (w.framesLeft <= 0) {
            spawnProjectile(w.dir, w.absY)
            state.projectileWarnings.splice(i, 1)
          }
        }
      }

      // Update projectiles — drift across, sine wobble, trail ghosts, hit-test the swinging piece.
      for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const pj = state.projectiles[i]
        pj.mesh.position.x += pj.vx
        pj.mesh.position.y += pj.vy + Math.sin((state.frameN + pj.wobblePhase * 60) * 0.06) * 0.025

        // Pulsing glow + halo — extra visibility for the company logo.
        const pulse = 4.5 + Math.sin(state.frameN * 0.1 + pj.wobblePhase) * 0.35
        pj.glow.scale.set(pulse, pulse, 1)
        if (pj.halo) {
          const haloPulse = 6.5 + Math.sin(state.frameN * 0.07 + pj.wobblePhase) * 0.55
          pj.halo.scale.set(haloPulse, haloPulse, 1)
        }

        // Trail — drop a fading logo ghost every 3 frames behind the projectile.
        if (state.frameN % 3 === 0) {
          const ghost = new THREE.Sprite(new THREE.SpriteMaterial({
            map: logoTex,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
          }))
          ghost.scale.set(2.0, 2.0, 1)
          ghost.position.copy(pj.mesh.position)
          ghost.position.z = -0.02
          scene.add(ghost)
          pj.trail.push({ sprite: ghost, opacity: 0.55 })
        }
        // Fade & shrink existing trail ghosts.
        for (let j = pj.trail.length - 1; j >= 0; j--) {
          const tr = pj.trail[j]
          tr.opacity -= 0.07
          if (tr.opacity <= 0) {
            scene.remove(tr.sprite)
            pj.trail.splice(j, 1)
          } else {
            tr.sprite.material.opacity = tr.opacity
            tr.sprite.scale.multiplyScalar(0.96)
          }
        }

        pj.life--
        if (pj.life <= 0 || Math.abs(pj.mesh.position.x) > 28) {
          disposeProjectile(pj)
          state.projectiles.splice(i, 1)
          continue
        }

        if (state.gameActive && state.currentPiece && projectileHitsPiece(pj, state.currentPiece)) {
          onProjectileHit(pj)
          disposeProjectile(pj)
          state.projectiles.splice(i, 1)
        }
      }

      // ── Power-ups: spawn timer, drift, pulse, hit-test against the swinging piece ──
      if (state.gameActive) {
        state.powerupTimer -= 1
        if (state.powerupTimer <= 0 && state.powerups.length === 0) {
          spawnPowerup()
          // Fairly rare: 18–32s between pickups
          state.powerupTimer = 1080 + Math.floor(Math.random() * 840)
        }
      }
      for (let i = state.powerups.length - 1; i >= 0; i--) {
        const pu = state.powerups[i]
        pu.mesh.position.x += pu.vx
        pu.mesh.position.y = pu.baseY + Math.sin((state.frameN + pu.phase * 60) * 0.05) * 0.35
        // Spin + pulsing halo
        pu.mesh.rotation.y += 0.04
        const halo = pu.mesh.userData.halo
        const haloPulse = 3.2 + Math.sin(state.frameN * 0.1 + pu.phase) * 0.55
        halo.scale.set(haloPulse, haloPulse, 1)
        pu.life--
        if (pu.life <= 0 || Math.abs(pu.mesh.position.x) > 26) {
          disposePowerup(pu)
          state.powerups.splice(i, 1)
          continue
        }
        if (state.currentPiece && powerupHitsPiece(pu, state.currentPiece)) {
          onPowerupCollect(pu)
          disposePowerup(pu)
          state.powerups.splice(i, 1)
        }
      }

      // Shockwave rings — expand and fade after projectile impacts.
      for (let i = state.shockwaves.length - 1; i >= 0; i--) {
        const sw = state.shockwaves[i]
        sw.life -= 0.04
        sw.mesh.scale.multiplyScalar(1.18)
        sw.mesh.material.opacity = Math.max(0, sw.life * 0.95)
        if (sw.life <= 0) {
          scene.remove(sw.mesh)
          state.shockwaves.splice(i, 1)
        }
      }

      // Pieces that missed the stack — physics-fall them off the tower.
      for (let i = state.fallingPieces.length - 1; i >= 0; i--) {
        const fp = state.fallingPieces[i]
        fp.vy -= 0.045
        fp.mesh.position.x += fp.vx
        fp.mesh.position.y += fp.vy
        fp.mesh.rotation.z += fp.rotV
        fp.mesh.rotation.x += fp.rotV * 0.4
        if (fp.mesh.position.y < -40) {
          scene.remove(fp.mesh)
          state.fallingPieces.splice(i, 1)
        }
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life -= 0.025
        p.vel.y -= 0.013
        p.mesh.position.add(p.vel)
        p.mesh.rotation.x += p.spin.x
        p.mesh.rotation.y += p.spin.y
        p.mesh.rotation.z += p.spin.z
        p.mesh.material.opacity = Math.max(0, p.life)
        p.mesh.material.transparent = true
        if (p.life <= 0) {
          scene.remove(p.mesh)
          particles.splice(i, 1)
        }
      }

      // Camera — adaptive framing.
      //   Y: trails BELOW the swinging piece so the dropper sits in the upper
      //      portion of the frame. Early on the camera rides lower (showing more
      //      of the base + construction site); as the tower grows it tracks the
      //      swing tightly so the player isn't looking at empty space.
      //   Z: scales with swing amp (wider arcs need more room) AND with viewport
      //      aspect (narrower screens pull camera back further). Prevents the
      //      swinging piece from exiting the frame on portrait / split-view layouts.
      //   LookAt: always aimed at the swing area so the dropper stays in view.
      // Perfect-drop dolly: punch in then ease out.
      if (state.camDolly > 0) {
        state.camDolly *= 0.88
        if (state.camDolly < 0.01) state.camDolly = 0
      }
      const ampRoom = state.swingAmp * 0.6      // wider swing → further back
      const heightRoom = Math.min(1, state.stackedPieces.length / 70) * 4
      const baseZ = 22 + ampRoom + heightRoom
      // FOV compensation: changing FOV is a "lens character" choice, NOT a
      // difficulty knob. Pull the camera back at low FOV / push in at high FOV
      // so the visible world width at the tower stays ~constant. 65° = 1.0.
      const fovScale = Math.tan((65 * Math.PI / 180) / 2) /
                       Math.tan((camera.fov * Math.PI / 180) / 2)
      const camZTarget = baseZ * state.aspectScale * fovScale - state.camDolly * 6
      const camLerp = state.camDolly > 0.05 ? 0.18 : 0.08
      // Camera Y lead — how far below the swinging piece the camera sits.
      // Early game: bigger lead (camera lower) so foundation + props stay framed.
      // Tall game: smaller lead so the dropper doesn't drift to the top edge.
      const yLeadBlend = Math.min(1, state.stackedPieces.length / 40)
      const yLead = 7 - yLeadBlend * 4   // 7 early → 3 by floor 40
      const focusY = state.swingHeight > 0
        ? state.swingHeight - yLead
        : state.towerHeight + 2
      const camYTarget = Math.max(4, focusY)
      camera.position.y += (camYTarget - camera.position.y) * 0.08
      camera.position.z += (camZTarget - camera.position.z) * camLerp
      const lookAt = state.swingHeight > 0
        ? state.swingHeight - 1
        : state.towerHeight + 2
      camera.lookAt(state.shakeX, lookAt, 0)

      // Shake
      if (state.screenShake > 0) {
        state.shakeX = (Math.random() - 0.5) * state.screenShake * 0.4
        camera.position.x = state.shakeX
        state.screenShake -= 0.055
        if (state.screenShake <= 0) {
          state.screenShake = 0
          camera.position.x = 0
          state.shakeX = 0
        }
      }

      // BG breathe + perfect-drop flash
      if (state.flash > 0) {
        state.flash *= 0.85
        if (state.flash < 0.02) state.flash = 0
      }
      if (state.frameN % 2 === 0) {
        const t = state.frameN * 0.003
        const baseR = 0.10 + Math.sin(t) * 0.03
        const baseG = 0.02
        const baseB = 0.28 + Math.sin(t * 0.7) * 0.06
        const f = state.flash
        renderer.setClearColor(new THREE.Color(
          baseR + (1 - baseR) * f,
          baseG + (1 - baseG) * f,
          baseB + (1 - baseB) * f,
        ))
      }

      // Game-over delay
      if (state.gameOverDelay > 0) {
        state.gameOverDelay--
        if (state.gameOverDelay === 0) {
          // Push the recap into React state — at this point the game-over JSX
          // hasn't mounted yet, so refs would be null. State works because the
          // values render with the screen on the very next reconcile pass.
          const r = {
            score: state.score,
            floors: state.stackedPieces.length,
            perfects: state.perfectCount,
            maxCombo: state.maxCombo,
            tier: state.tierReached,
            foundation: state.foundation || 'standard',
          }
          setRecap(r)
          if (typeof onRunEnd === 'function') onRunEnd(r)
          setShowGameOver(true)
        }
      }

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onPointer)
      renderer.dispose()
      engineRef.current = null
    }
  }, [])

  const handleStart = () => {
    if (!player) return  // form is gating the Play button; this is a safety net
    setShowPause(false)
    setShowSettings(false)
    engineRef.current?.startGame(foundation)
  }
  const handleSaveCard = () => {
    engineRef.current?.generateScoreCard()
  }
  const handleResume = () => {
    setShowPause(false)
    setShowSettings(false)
    engineRef.current?.setPaused(false)
  }
  const handleReset = () => {
    setShowPause(false)
    setShowSettings(false)
    engineRef.current?.setPaused(false)
    engineRef.current?.startGame(foundation)
  }
  const handleQuit = () => {
    setShowPause(false)
    setShowSettings(false)
    setShowGameOver(false)
    engineRef.current?.setPaused(false)
    setShowStart(true)
  }

  // Bridge: ESC handler inside the engine flips state.paused — mirror it into React.
  useEffect(() => {
    const eng = engineRef.current
    if (!eng?.setPauseListener) return
    eng.setPauseListener((paused) => {
      setShowPause(paused)
      if (!paused) setShowSettings(false)
    })
    return () => eng.setPauseListener?.(null)
  }, [])

  // Apply FOV slider changes to the live camera.
  useEffect(() => {
    engineRef.current?.setCameraFov?.(fov)
  }, [fov])

  // Persist the active player so they don't have to re-enter on every run.
  useEffect(() => {
    try {
      if (player) localStorage.setItem('radian_player', JSON.stringify(player))
      else localStorage.removeItem('radian_player')
    } catch { /* noop */ }
  }, [player])

  // When a run ends, push the score + player profile into the leaderboard.
  // Local write is synchronous; backend POST is fire-and-forget. Profile is
  // read from a ref so the run-end callback always sees the current value.
  const playerRef = useRef(player)
  useEffect(() => { playerRef.current = player }, [player])
  useEffect(() => {
    const eng = engineRef.current
    if (!eng?.setRunEndListener) return
    eng.setRunEndListener((r) => {
      if (!r || r.score <= 0) return
      const p = playerRef.current || {}
      const entry = {
        ...r,
        name: (p.name || 'ANON').trim() || 'ANON',
        email: (p.email || '').trim(),
        phone: (p.phone || '').trim(),
      }
      const { id } = addLocalScore(entry)
      setLastEntryId(id)
      // Best-effort sync — failure is silent.
      submitOnline(entry)
    })
    return () => eng.setRunEndListener?.(null)
  }, [])

  const handleNewUser = () => {
    setPlayer(null)
    setShowGameOver(false)
    setShowPause(false)
    setShowLeaderboard(false)
    engineRef.current?.setPaused(false)
    setShowStart(true)
  }

  return (
    <div className="rts-root">
      <canvas id="canvas" ref={canvasRef} />

      <div id="hud">
        <div id="score-panel">
          <div className="game-title">Radian Tower Stacker</div>
          <div id="score" ref={scoreRef}>0</div>
          <div id="pts-label">Height</div>
          <div id="combo-text" ref={comboTextRef}>COMBO!</div>
        </div>
        <div id="height-badge">
          <div id="height-num" ref={heightNumRef}>0</div>
          <div id="height-lbl">Height</div>
        </div>
        <div id="next-wrap">
          <div id="next-label">Next</div>
          <canvas id="next-canvas" ref={nextCanvasRef} width="88" height="88" />
        </div>
        <div id="balance-wrap">
          <div id="balance-label">Balance</div>
          <div id="balance-track">
            <div id="balance-fill"></div>
            <div id="balance-needle" ref={balanceNeedleRef}></div>
          </div>
        </div>
        <div id="hint"><span className="key">SPACE</span> to drop · tap anywhere</div>

        <div id="brand-mark">
          <img src="/logo.png" alt="Radian" />
          <div className="brand-text">
            <div className="brand-name">RADIAN</div>
            <div className="brand-sub">Scaffolding</div>
          </div>
        </div>
      </div>

      {showStart && (
        <div className="screen" id="start-screen">
          <div className="brand-block">
            <img className="brand-logo" src="/logo.png" alt="Radian" />
            <div className="brand-wordmark">RADIAN</div>
            <div className="brand-tagline">Scaffolding · Built to Stand</div>
          </div>
          <div className="screen-title">Tower<br /><span className="yl">Stacker</span></div>
          <div className="screen-sub">Stack the scaffold · Beat the wobble · Build the skyline</div>

          {!player ? (
            <PlayerForm onSubmit={(p) => setPlayer(p)} />
          ) : (
            <>
              <div className="player-greeting">
                Welcome, <span className="yl">{player.name}</span>
                <button className="link-btn" onClick={() => setPlayer(null)}>Not you?</button>
              </div>
              <div className="foundation-picker">
                <div className="foundation-label">Choose your foundation</div>
                <div className="foundation-row">
                  {Object.entries(FOUNDATIONS).map(([key, fnd]) => (
                    <button
                      key={key}
                      className={'foundation-btn' + (foundation === key ? ' selected' : '')}
                      onClick={() => setFoundation(key)}
                    >
                      <div className="foundation-name">{fnd.label}</div>
                      <div className="foundation-sub">{fnd.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="start-actions">
                <button className="big-btn" onClick={handleStart}>Play</button>
                <button className="big-btn secondary" onClick={() => setShowLeaderboard(true)}>Leaderboard</button>
              </div>
            </>
          )}
          <div className="brand-footer">A Radian Scaffolding experience</div>
        </div>
      )}
      {showPause && (
        <div className="screen" id="pause-screen">
          <div className="brand-block small">
            <img className="brand-logo" src="/logo.png" alt="Radian" />
            <div className="brand-wordmark">RADIAN</div>
          </div>
          <div className="screen-title">{showSettings ? <>Set<span className="yl">tings</span></> : <>Pa<span className="yl">used</span></>}</div>
          {!showSettings && (
            <div className="pause-actions">
              <button className="big-btn" onClick={handleResume}>Resume</button>
              <button className="big-btn secondary" onClick={() => setShowSettings(true)}>Settings</button>
              <button className="big-btn secondary" onClick={handleReset}>Reset Run</button>
              <button className="big-btn secondary" onClick={handleQuit}>Quit to Menu</button>
            </div>
          )}
          {showSettings && (
            <div className="settings-panel">
              <div className="setting-row">
                <label className="setting-label" htmlFor="fov-slider">
                  Field of View
                  <span className="setting-value">{fov}°</span>
                </label>
                <input
                  id="fov-slider"
                  type="range"
                  min="50"
                  max="80"
                  step="1"
                  value={fov}
                  onChange={(e) => setFov(parseInt(e.target.value, 10))}
                />
                <div className="setting-hint">Lens character only — framing stays consistent across the range</div>
              </div>
              <div className="settings-actions">
                <button className="big-btn secondary" onClick={() => setFov(65)}>Reset Default</button>
                <button className="big-btn" onClick={() => setShowSettings(false)}>Back</button>
              </div>
            </div>
          )}
          <div className="screen-sub">ESC to {showSettings ? 'go back' : 'resume'}</div>
        </div>
      )}
      {showGameOver && (
        <div className="screen" id="gameover-screen">
          <div className="brand-block small">
            <img className="brand-logo" src="/logo.png" alt="Radian" />
            <div className="brand-wordmark">RADIAN</div>
          </div>
          <div className="screen-title">Tower<br /><span className="yl">Toppled!</span></div>
          <div id="final-score-num">{recap.score}</div>
          <div className="screen-sub">Final Score</div>
          <div className="recap">
            <div className="stat">
              <div className="stat-num">{recap.floors}</div>
              <div className="stat-lbl">Floors Built</div>
            </div>
            <div className="stat">
              <div className="stat-num gold">{recap.perfects}</div>
              <div className="stat-lbl">★ Perfects</div>
            </div>
            <div className="stat">
              <div className="stat-num pink">{recap.maxCombo}×</div>
              <div className="stat-lbl">Best Combo</div>
            </div>
            <div className="stat">
              <div className="stat-num cyan">{recap.tier}</div>
              <div className="stat-lbl">Tier Reached</div>
            </div>
          </div>
          {player && (
            <div className="player-greeting small">
              Saved as <span className="yl">{player.name}</span>
            </div>
          )}
          <div className="gameover-actions">
            <button className="big-btn" onClick={handleStart}>Build Again</button>
            <button className="big-btn secondary" onClick={() => setShowLeaderboard(true)}>Leaderboard</button>
            <button className="big-btn secondary" onClick={handleSaveCard}>Save Score Card</button>
            <button className="big-btn secondary" onClick={handleNewUser}>New User</button>
          </div>
          <div className="brand-footer">
            Want a real tower that stays up? <span className="cta">Radian Scaffolding</span>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <LeaderboardScreen
          onClose={() => setShowLeaderboard(false)}
          highlightId={lastEntryId}
        />
      )}
    </div>
  )
}

// Leaderboard modal — pulls local + (best-effort) online entries and renders a
// ranked table. Highlights the row matching `highlightId` so a player who just
// finished a run can spot themselves.
function LeaderboardScreen({ onClose, highlightId }) {
  const [entries, setEntries] = useState(() => loadLocalLeaderboard())
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchMergedLeaderboard(50).then((res) => {
      if (cancelled) return
      setEntries(res.entries)
      setOnline(res.online)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const [showClearPrompt, setShowClearPrompt] = useState(false)
  const [clearCode, setClearCode] = useState('')
  const [clearError, setClearError] = useState('')

  const handleClear = () => {
    // Passcode-gated to prevent a random booth visitor from wiping the board.
    // Code is 00005 — written here in plain text because this is a kiosk app
    // running on a trusted machine, not a security boundary.
    if (clearCode !== '00005') {
      setClearError('Incorrect passcode.')
      return
    }
    clearLocalLeaderboard()
    setEntries([])
    setShowClearPrompt(false)
    setClearCode('')
    setClearError('')
  }

  return (
    <div className="screen" id="leaderboard-screen">
      <div className="brand-block small">
        <img className="brand-logo" src="/logo.png" alt="Radian" />
        <div className="brand-wordmark">RADIAN</div>
      </div>
      <div className="screen-title">Leader<span className="yl">board</span></div>
      <div className="leaderboard-status">
        {loading
          ? 'Loading…'
          : online
            ? 'Showing local + online scores'
            : 'Showing local scores only (offline)'}
      </div>

      <div className="leaderboard-table">
        <div className="leaderboard-row leaderboard-head">
          <div className="lb-rank">#</div>
          <div className="lb-name">Player</div>
          <div className="lb-score">Score</div>
          <div className="lb-floors">Floors</div>
          <div className="lb-foundation">Base</div>
          <div className="lb-date">Date</div>
        </div>
        {entries.length === 0 && !loading && (
          <div className="leaderboard-empty">No scores yet — be the first!</div>
        )}
        {entries.slice(0, 20).map((e, i) => (
          <div
            key={e.id || `${e.name}-${e.score}-${i}`}
            className={'leaderboard-row' + (e.id === highlightId ? ' highlight' : '')}
          >
            <div className="lb-rank">{i + 1}</div>
            <div className="lb-name">{e.name}</div>
            <div className="lb-score">{e.score.toLocaleString()}</div>
            <div className="lb-floors">{e.floors}</div>
            <div className="lb-foundation">{FOUNDATION_LABEL[e.foundation] || e.foundation}</div>
            <div className="lb-date">{formatDate(e.date)}</div>
          </div>
        ))}
      </div>

      <div className="leaderboard-actions">
        <button className="big-btn" onClick={onClose}>Back</button>
        {!showClearPrompt && (
          <button
            className="big-btn secondary"
            onClick={() => { setShowClearPrompt(true); setClearError('') }}
          >Clear Local</button>
        )}
      </div>

      {showClearPrompt && (
        <div className="clear-prompt">
          <div className="clear-prompt-label">Enter admin passcode to clear local leaderboard</div>
          <input
            className="clear-prompt-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="•••••"
            value={clearCode}
            onChange={(e) => { setClearCode(e.target.value); setClearError('') }}
            autoFocus
          />
          {clearError && <div className="clear-prompt-error">{clearError}</div>}
          <div className="clear-prompt-actions">
            <button className="big-btn" onClick={handleClear}>Confirm Clear</button>
            <button
              className="big-btn secondary"
              onClick={() => { setShowClearPrompt(false); setClearCode(''); setClearError('') }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// First-time registration form. Required: name. Email and phone are also
// required for booth lead capture but format-validated lightly so a fat-finger
// doesn't lock the player out (we accept any @ + dot for email; any 7+ digits
// for phone). On submit the parent persists the profile to localStorage.
function PlayerForm({ onSubmit }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const cleanName = name.trim()
    const cleanEmail = email.trim()
    const cleanPhone = phone.trim()
    if (!cleanName) return setError('Please enter your name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError('Please enter a valid email.')
    const digits = cleanPhone.replace(/\D/g, '')
    if (digits.length < 7) return setError('Please enter a valid phone number.')
    setError('')
    onSubmit({ name: cleanName.toUpperCase().slice(0, 20), email: cleanEmail, phone: cleanPhone })
  }

  return (
    <form className="player-form" onSubmit={handleSubmit}>
      <div className="player-form-title">Register to Play</div>
      <div className="player-form-sub">We'll save your score under this profile</div>
      <div className="player-form-row">
        <label className="player-form-label" htmlFor="pf-name">Name</label>
        <input
          id="pf-name"
          className="player-form-input"
          type="text"
          maxLength="20"
          autoComplete="name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="player-form-row">
        <label className="player-form-label" htmlFor="pf-email">Email</label>
        <input
          id="pf-email"
          className="player-form-input"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="player-form-row">
        <label className="player-form-label" htmlFor="pf-phone">Phone</label>
        <input
          id="pf-phone"
          className="player-form-input"
          type="tel"
          autoComplete="tel"
          placeholder="555-123-4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      {error && <div className="player-form-error">{error}</div>}
      <button className="big-btn" type="submit">Continue</button>
      <div className="player-form-footer">
        Your details stay with Radian Scaffolding for this conference.
      </div>
    </form>
  )
}
