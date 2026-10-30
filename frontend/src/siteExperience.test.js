import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createSiteExperience } from './siteExperience.js'

function fixture(reduced = false) {
  globalThis.window = { matchMedia: () => ({ matches: reduced }) }
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x0b1220, 0.018)
  const towerGroup = new THREE.Group()
  scene.add(towerGroup)
  const camera = new THREE.PerspectiveCamera()
  const texture = new THREE.Texture()
  const workers = [new THREE.Group()]
  const siteSpots = [{ target: new THREE.Object3D() }]
  const effect = createSiteExperience({ scene, towerGroup, camera, smokeTex: texture, glowTex: texture, workers, siteSpots })
  const piece = new THREE.Object3D()
  piece.userData = { pw: 6, pd: 4, ph: 2 }
  const state = { stackedPieces: [piece], currentPiece: piece, gameActive: true, towerHeight: 2, flash: 0, combo: 6 }
  return { scene, towerGroup, texture, workers, effect, state, color: new THREE.Color() }
}

test('landing edge matches footprint; effects keep a bounded scene across repeated runs', () => {
  const f = fixture()
  let initialCount = 0
  f.scene.traverse(() => initialCount++)
  for (let run = 0; run < 5; run++) {
    f.effect.reset()
    f.effect.land(true, 0, 2)
    f.effect.prize(2)
    for (let tick = 0; tick < 180; tick++) f.effect.update(f.state, f.color)
    assert.equal(f.towerGroup.children[0].scale.x, 6)
    assert.equal(f.towerGroup.children[0].position.z, 2.08)
    let count = 0
    f.scene.traverse(() => count++)
    assert.equal(count, initialCount)
  }
  f.effect.dispose()
})

test('altitude reveals stars and moon, fog follows sky, reset returns to yard', () => {
  const f = fixture()
  f.state.stackedPieces = Array(101).fill(f.state.currentPiece)
  for (let i = 0; i < 500; i++) f.effect.update(f.state, f.color)
  const root = f.scene.children.find(c => c !== f.towerGroup)
  const stars = root.children.find(c => c.isPoints)
  const moon = root.children.find(c => c.isMesh)
  assert.ok(stars.material.opacity > 0.7)
  assert.ok(moon.material.opacity > 0.7)
  assert.ok(f.scene.fog.color.equals(f.color))
  f.effect.reset()
  assert.equal(stars.material.opacity, 0)
  assert.equal(moon.material.opacity, 0)
  f.effect.dispose()
})

test('reduced motion suppresses celebration and crew motion; disposal preserves borrowed textures', () => {
  const f = fixture(true)
  let textureDisposed = false, disposedGeometries = 0
  f.texture.addEventListener('dispose', () => { textureDisposed = true })
  f.scene.traverse(o => { o.geometry?.addEventListener('dispose', () => disposedGeometries++) })
  f.effect.prize(2)
  f.effect.land(true, 0, 2)
  f.effect.update(f.state, f.color)
  assert.equal(f.workers[0].position.y, 0)
  assert.equal(f.workers[0].rotation.z, 0)
  const root = f.scene.children.find(c => c !== f.towerGroup)
  assert.equal(root.children.filter(c => c.isPoints).at(-1).material.opacity, 0)
  f.effect.dispose()
  assert.equal(f.towerGroup.children.length, 0)
  assert.equal(f.scene.children.length, 1)
  assert.equal(textureDisposed, false)
  assert.ok(disposedGeometries >= 4)
})
