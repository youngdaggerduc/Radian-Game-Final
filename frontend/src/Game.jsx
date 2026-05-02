import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import './Game.css'

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

export default function Game() {
  const canvasRef = useRef(null)
  const nextCanvasRef = useRef(null)
  const scoreRef = useRef(null)
  const heightNumRef = useRef(null)
  const comboTextRef = useRef(null)
  const balanceNeedleRef = useRef(null)
  const finalScoreRef = useRef(null)

  const [showStart, setShowStart] = useState(true)
  const [showGameOver, setShowGameOver] = useState(false)

  // Mutable refs the engine writes into; exposed to React via the start handler
  const engineRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
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

    const onResize = () => {
      W = window.innerWidth
      H = window.innerHeight
      renderer.setSize(W, H)
      camera.aspect = W / H
      camera.updateProjectionMatrix()
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

    // World — ground disc
    {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(11, 13, 1.4, 40),
        toonMat(0x2d0d5c)
      )
      disc.position.y = -0.7
      disc.receiveShadow = true
      outline(disc, 1.015)
      scene.add(disc)

      for (let i = 0; i < 20; i++) {
        const ang = (i / 20) * Math.PI * 2
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 0.05, 1.8),
          toonMat(i % 2 === 0 ? 0x3d1570 : 0x4a1a88)
        )
        tile.position.set(Math.cos(ang) * 7, 0.02, Math.sin(ang) * 7)
        tile.rotation.y = ang
        scene.add(tile)
      }

      const gridMat = new THREE.MeshBasicMaterial({ color: 0x6633aa, transparent: true, opacity: 0.25 })
      for (let i = -6; i <= 6; i += 1.5) {
        const lh = new THREE.Mesh(new THREE.BoxGeometry(22, 0.03, 0.03), gridMat)
        lh.position.set(0, 0.02, i)
        scene.add(lh)
        const lv = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 22), gridMat)
        lv.position.set(i, 0.02, 0)
        scene.add(lv)
      }
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
    }
    const towerGroup = new THREE.Group()
    scene.add(towerGroup)

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

    const glowTex = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const cx = c.getContext('2d')
      const g = cx.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0.0, 'rgba(220,140,255,0.95)')
      g.addColorStop(0.35, 'rgba(170, 60,230,0.55)')
      g.addColorStop(1.0, 'rgba(120,  0,180,0.0)')
      cx.fillStyle = g
      cx.fillRect(0, 0, 128, 128)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()

    function spawnProjectile() {
      const group = new THREE.Group()

      // Purple radial glow behind the logo (additive).
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xcc66ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }))
      glow.scale.set(3.4, 3.4, 1)
      glow.position.z = -0.05
      group.add(glow)

      // The logo itself.
      const logo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: logoTex,
        transparent: true,
        depthWrite: false,
      }))
      logo.scale.set(1.5, 1.5, 1)
      group.add(logo)

      const dir = Math.random() < 0.5 ? -1 : 1
      // Spawn off the side of the screen at the swing band height.
      group.position.set(
        dir * -22,
        state.swingHeight + (Math.random() - 0.5) * 1.4,
        0
      )
      scene.add(group)

      state.projectiles.push({
        mesh: group,
        glow,
        vx: dir * (0.18 + Math.random() * 0.07),
        vy: 0,
        wobblePhase: Math.random() * Math.PI * 2,
        life: 600,
        radius: 0.7,
      })
    }

    function projectileHitsPiece(pj, piece) {
      const px = piece.position.x
      const py = piece.position.y
      const hw = piece.userData.pw / 2 + pj.radius
      const hh = piece.userData.ph / 2 + pj.radius
      return (
        Math.abs(pj.mesh.position.x - px) < hw &&
        Math.abs(pj.mesh.position.y - py) < hh
      )
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
      state.screenShake = Math.max(state.screenShake, 0.45)
      spawnBurst(pj.mesh.position.x, pj.mesh.position.y, 0, 16, [0xcc66ff, 0xff88ff, 0xffffff, 0x9966ff])
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
      const type = state.nextType || TYPES[Math.floor(Math.random() * TYPES.length)]
      state.nextType = TYPES[Math.floor(Math.random() * TYPES.length)]
      drawNextPiece(state.nextType)
      state.currentPiece = makePiece(type)
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
      if (perf) { pts += 70; state.combo++ }
      else if (good) { pts += 20; state.combo = Math.max(0, state.combo - 1) }
      else { state.combo = 0; pts = Math.max(5, pts - 20) }
      if (state.combo >= 2) pts = Math.round(pts * (1 + state.combo * 0.4))
      state.score += pts

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
      if (perf) {
        spawnStarBurst(lx, state.towerHeight + ph / 2, 0)
        state.screenShake = 0.7
        state.camDolly = 1.0
        state.flash = 0.7
      }
      else if (isMiss) { state.screenShake = 0.5 }
      else { state.screenShake = 0.25 }

      p.position.set(lx, state.towerHeight + ph / 2, 0)
      state.towerHeight += ph
      state.stackedPieces.push(p)
      towerGroup.add(p)
      updateTowerGlow()

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

    function startGame() {
      for (const p of state.stackedPieces) towerGroup.remove(p)
      state.stackedPieces = []
      for (const fp of state.fallingPieces) scene.remove(fp.mesh)
      state.fallingPieces = []
      for (const pj of state.projectiles) scene.remove(pj.mesh)
      state.projectiles = []
      state.projectileTimer = 360 + Math.random() * 240 // grace period at start
      state.towerHeight = 0
      state.towerLeanX = 0
      state.towerVelocity = 0
      state.towerAngle = 0
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
      camera.position.set(0, 3, 28)
      camera.lookAt(0, 7, 0)
      if (scoreRef.current) scoreRef.current.textContent = '0'
      if (heightNumRef.current) heightNumRef.current.textContent = '0'
      if (comboTextRef.current) comboTextRef.current.style.opacity = '0'
      setShowStart(false)
      setShowGameOver(false)
      state.gameActive = true
      state.nextType = TYPES[Math.floor(Math.random() * TYPES.length)]
      const base = makePiece('scaf_flat')
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
      state.dropVel = 0
      state.currentPiece = null
      setTimeout(spawnNext, 450)
    }

    engineRef.current = { startGame }

    // Input
    const onKey = (e) => {
      if (e.code === 'Space') { e.preventDefault(); drop() }
    }
    const onPointer = () => drop()
    document.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onPointer)

    // Main loop
    let raf = 0
    let cancelled = false
    function animate() {
      if (cancelled) return
      raf = requestAnimationFrame(animate)
      state.frameN++

      // Swing
      if (state.currentPiece && state.gameActive) {
        state.swingAngle += state.swingSpeed
        const sx = Math.sin(state.swingAngle) * state.swingAmp
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
      }

      // Drop
      if (state.dropPiece) {
        state.dropVel += 0.055
        state.dropPiece.position.y -= state.dropVel
        if (state.frameN % 3 === 0) {
          spawnBurst(state.dropPiece.position.x, state.dropPiece.position.y + state.dropPiece.userData.ph * 0.5, 0, 3, [0xcc88ff, 0xffffff, 0xff88ff])
        }
        const land = state.towerHeight + state.dropPiece.userData.ph / 2
        if (state.dropPiece.position.y <= land) {
          state.dropPiece.position.y = land
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
        state.towerAngle += state.towerVelocity
      }
      towerGroup.rotation.z = state.towerAngle * (Math.PI / 180)
      // Topple threshold: forgiving at start (32°), tightens 5° per tier, never below 14°.
      const toppleThresh = Math.max(14, 32 - tier * 5)
      if (state.gameActive && Math.abs(state.towerAngle) > toppleThresh) triggerGameOver()

      // Balance needle
      const leanNorm = Math.max(0, Math.min(1, 0.5 + state.towerLeanX / 10))
      if (balanceNeedleRef.current) balanceNeedleRef.current.style.left = (leanNorm * 100) + '%'

      // Projectile spawn timer — only while the round is active.
      if (state.gameActive) {
        state.projectileTimer -= 1
        if (state.projectileTimer <= 0) {
          spawnProjectile()
          // Cooldown shortens as the tower grows.
          const tier = Math.floor(state.stackedPieces.length / 25)
          state.projectileTimer = Math.max(60, 240 - tier * 30) + Math.random() * 120
        }
      }

      // Update projectiles — drift across, sine wobble, hit-test the swinging piece.
      for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const pj = state.projectiles[i]
        pj.mesh.position.x += pj.vx
        pj.mesh.position.y += pj.vy + Math.sin((state.frameN + pj.wobblePhase * 60) * 0.06) * 0.025
        // Slight pulsing glow.
        const pulse = 3.4 + Math.sin(state.frameN * 0.1 + pj.wobblePhase) * 0.25
        pj.glow.scale.set(pulse, pulse, 1)
        pj.life--

        if (pj.life <= 0 || Math.abs(pj.mesh.position.x) > 28) {
          scene.remove(pj.mesh)
          state.projectiles.splice(i, 1)
          continue
        }

        if (state.gameActive && state.currentPiece && projectileHitsPiece(pj, state.currentPiece)) {
          onProjectileHit(pj)
          scene.remove(pj.mesh)
          state.projectiles.splice(i, 1)
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

      // Camera — follow the action: stay close, rise with the tower
      const focusY = state.swingHeight > 0
        ? state.swingHeight - 3
        : state.towerHeight + 2
      const camYTarget = Math.max(4, focusY)
      // Perfect-drop dolly: punch in then ease out.
      if (state.camDolly > 0) {
        state.camDolly *= 0.88
        if (state.camDolly < 0.01) state.camDolly = 0
      }
      const camZTarget = 24 - state.camDolly * 6
      const camLerp = state.camDolly > 0.05 ? 0.18 : 0.08
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
          if (finalScoreRef.current) finalScoreRef.current.textContent = state.score
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
    engineRef.current?.startGame()
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
      </div>

      {showStart && (
        <div className="screen" id="start-screen">
          <div className="screen-title">Radian<br /><span className="yl">Tower</span><br />Stacker</div>
          <div className="screen-sub">Stack crazy scaffold pieces!</div>
          <button className="big-btn" onClick={handleStart}>Play</button>
        </div>
      )}
      {showGameOver && (
        <div className="screen" id="gameover-screen">
          <div className="screen-title">Tower<br /><span className="yl">Toppled!</span></div>
          <div id="final-score-num" ref={finalScoreRef}>0</div>
          <div className="screen-sub">Height Reached</div>
          <button className="big-btn" onClick={handleStart}>Try Again</button>
        </div>
      )}
    </div>
  )
}
