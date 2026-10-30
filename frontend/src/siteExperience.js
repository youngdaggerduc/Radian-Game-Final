import * as THREE from 'three'

// All motion advances once per physics tick. Resources are allocated once, reused,
// and disposed by this owner; borrowed textures remain owned by the game.
export function createSiteExperience({ scene, towerGroup, camera, smokeTex, glowTex, workers, siteSpots }) {
  const root = new THREE.Group()
  scene.add(root)
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const materials = []
  const geometries = []
  const mat = options => { const m = new THREE.MeshBasicMaterial(options); materials.push(m); return m }
  const geo = g => { geometries.push(g); return g }
  const sprite = (map, color, opacity = 0) => {
    const m = new THREE.SpriteMaterial({ map, color, opacity, transparent: true, depthWrite: false, fog: false })
    materials.push(m)
    const s = new THREE.Sprite(m)
    root.add(s)
    return s
  }
  const edge = new THREE.Mesh(geo(new THREE.BoxGeometry(1, 0.065, 0.08)), mat({ color: 0xffd75e }))
  towerGroup.add(edge)
  const halo = sprite(glowTex, 0xffe2b0, 0.16)
  const dust = Array.from({ length: 6 }, () => sprite(smokeTex, 0xb4a28c))
  const clouds = Array.from({ length: 6 }, (_, i) => {
    const s = sprite(smokeTex, 0x8eabc5)
    s.scale.set(24 + i * 2, 8, 1)
    return s
  })
  const starPositions = new Float32Array(180 * 3)
  for (let i = 0; i < 180; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 150
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 100
    starPositions[i * 3 + 2] = -35 - Math.random() * 25
  }
  const starGeo = geo(new THREE.BufferGeometry())
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMat = new THREE.PointsMaterial({ color: 0xdce8ff, size: 0.22, transparent: true, opacity: 0, depthWrite: false, fog: false })
  materials.push(starMat)
  const stars = new THREE.Points(starGeo, starMat)
  root.add(stars)
  const moon = new THREE.Mesh(geo(new THREE.CircleGeometry(4, 32)), mat({ color: 0xf5e6c8, transparent: true, opacity: 0, fog: false, depthWrite: false }))
  root.add(moon)
  // A bounded pool of celebration particles stays behind the tower plane.
  const fireGeo = geo(new THREE.BufferGeometry())
  const firePositions = new Float32Array(72 * 3)
  fireGeo.setAttribute('position', new THREE.BufferAttribute(firePositions, 3))
  const fireMat = new THREE.PointsMaterial({ color: 0xffd75e, size: 0.28, transparent: true, opacity: 0, depthWrite: false })
  materials.push(fireMat)
  const fireworks = new THREE.Points(fireGeo, fireMat)
  root.add(fireworks)
  const baseSpotX = siteSpots.map(s => s.target.position.x)
  const skyColors = [0x0b1220, 0x17283b, 0x233c59, 0x101a36, 0x050913].map(c => new THREE.Color(c))
  const sky = skyColors[0].clone()
  const targetSky = sky.clone()
  const storm = new THREE.Color(0x1a1018)
  const dead = new THREE.Color(0x060608)
  const white = new THREE.Color(0xffffff)
  let altitude = 0, cheer = 0, celebrate = 0, dustFrames = 0, tick = 0
  let dustX = 0, dustY = 0, celebrationY = 0
  const reset = () => {
    altitude = 0; cheer = 0; celebrate = 0; dustFrames = 0; tick = 0
    sky.copy(skyColors[0]); edge.visible = false; halo.visible = false
    fireMat.opacity = 0; starMat.opacity = 0; moon.material.opacity = 0
    for (const s of [...dust, ...clouds]) s.material.opacity = 0
    workers.forEach(w => { w.position.y = 0; w.rotation.z = 0 })
    siteSpots.forEach((s, i) => { s.target.position.x = baseSpotX[i] })
  }
  return {
    reset,
    get reducedMotion() { return motion.matches },
    land(perfect, x, y) { if (perfect) cheer = Math.max(cheer, 36); dustFrames = perfect ? 0 : 28; dustX = x; dustY = y },
    prize(y) { celebrate = 150; celebrationY = y; cheer = 90 },
    update(state, outColor) {
      tick++
      const reduced = motion.matches
      altitude += (Math.max(0, state.stackedPieces.length - 1) - altitude) * 0.025
      const stops = [0, 15, 35, 60, 90]
      let zone = 0
      while (zone < 3 && altitude >= stops[zone + 1]) zone++
      const mix = THREE.MathUtils.clamp((altitude - stops[zone]) / (stops[zone + 1] - stops[zone]), 0, 1)
      targetSky.copy(skyColors[zone]).lerp(skyColors[zone + 1], mix)
      if (state.chaosMode) targetSky.lerp(state.condemnedMode ? dead : storm, 0.4)
      sky.lerp(targetSky, 0.04)
      outColor.copy(sky)
      if (!reduced) outColor.lerp(white, Math.min(0.08, state.flash * 0.1))
      scene.fog.color.copy(outColor)
      stars.position.y = camera.position.y + 5
      starMat.opacity = THREE.MathUtils.clamp((altitude - 45) / 35, 0, 0.8)
      moon.position.set(16, camera.position.y + 12, -42)
      moon.quaternion.copy(camera.quaternion)
      moon.material.opacity = THREE.MathUtils.clamp((altitude - 75) / 20, 0, 0.85)
      clouds.forEach((s, i) => {
        s.position.set((i - 2.5) * 13 + (reduced ? 0 : Math.sin(tick * 0.002 + i) * 2), camera.position.y + (35 - altitude) * 1.4 + i % 2 * 3, -24)
        s.material.opacity = Math.max(0, 1 - Math.abs(altitude - 35) / 25) * 0.22
      })
      const prev = state.stackedPieces.at(-1)
      edge.visible = state.gameActive && !!prev && !state.toppling
      if (prev) { edge.position.set(prev.position.x, state.towerHeight + 0.06, prev.userData.pd / 2 + 0.08); edge.scale.x = prev.userData.pw }
      halo.visible = state.gameActive && !!state.currentPiece
      if (state.currentPiece) {
        halo.position.copy(state.currentPiece.position)
        halo.position.z = -1
        halo.scale.set(state.currentPiece.userData.pw + 2, state.currentPiece.userData.ph + 2, 1)
      }
      if (cheer > 0) cheer--
      workers.forEach((w, i) => {
        w.position.y = !reduced && cheer > 0 ? Math.abs(Math.sin(cheer * 0.18 + i * 0.3)) * 0.35 : 0
        w.rotation.z = !reduced && state.gameActive && state.combo >= 5 ? Math.sin(tick * 0.12 + i) * 0.07 : 0
      })
      if (dustFrames > 0) dustFrames--
      dust.forEach((s, i) => {
        const age = 28 - dustFrames
        s.material.opacity = reduced ? 0 : dustFrames / 28 * 0.22
        s.position.set(dustX + (i - 2.5) * (0.35 + age * 0.02), dustY + age * 0.015, 0.7)
        s.scale.setScalar(0.6 + age * 0.025)
      })
      if (celebrate > 0) celebrate--
      fireMat.opacity = !reduced && celebrate > 0 ? Math.min(1, celebrate / 30) : 0
      if (celebrate > 0 && !reduced) {
        const age = (150 - celebrate) % 50
        const side = Math.floor((150 - celebrate) / 50) % 2 ? -1 : 1
        for (let i = 0; i < 72; i++) {
          const angle = i * Math.PI * 2 / 72
          firePositions[i * 3] = side * 9 + Math.cos(angle) * age * 0.09
          firePositions[i * 3 + 1] = celebrationY + 8 + Math.sin(angle) * age * 0.09 - age * age * 0.0015
          firePositions[i * 3 + 2] = -12 - (i % 4)
        }
        fireGeo.attributes.position.needsUpdate = true
      }
      siteSpots.forEach((s, i) => {
        const x = celebrate > 0 && !reduced ? Math.sin(celebrate * 0.035 + i * Math.PI) * 8 : baseSpotX[i]
        s.target.position.x += (x - s.target.position.x) * 0.08
      })
    },
    dispose() { scene.remove(root); towerGroup.remove(edge); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()) },
  }
}
