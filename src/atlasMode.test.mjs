import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { ATLAS_FLIGHT_SECONDS, createAtlasMode } from './atlasMode.js';

function fakeViewer() {
  const flights = [];
  const controller = { enableTilt: true, enableLook: true };
  const camera = {
    positionCartographic: {
      longitude: Cesium.Math.toRadians(-97.74),
      latitude: Cesium.Math.toRadians(30.27),
      height: 600,
    },
    heading: 0.3,
    pitch: Cesium.Math.toRadians(-30),
    roll: 0.1,
    flyTo(options) {
      flights.push(options);
    },
  };
  return { camera, scene: { screenSpaceCameraController: controller }, flights };
}

test('Atlas Mode locks a flat north-up camera and restores on exit', () => {
  const viewer = fakeViewer();
  const controller = viewer.scene.screenSpaceCameraController;
  const atlas = createAtlasMode(viewer);

  assert.equal(atlas.set(true), true);
  assert.equal(atlas.active, true);
  assert.equal(controller.enableTilt, false);
  assert.equal(controller.enableLook, false);
  assert.equal(viewer.flights.length, 1);
  assert.equal(viewer.flights[0].orientation.heading, 0);
  assert.equal(viewer.flights[0].orientation.pitch, -Math.PI / 2);
  assert.equal(viewer.flights[0].duration, ATLAS_FLIGHT_SECONDS);

  assert.equal(atlas.set(false), false);
  assert.equal(controller.enableTilt, true);
  assert.equal(controller.enableLook, true);
  assert.equal(viewer.flights[1].orientation.heading, 0.3);
  assert.equal(viewer.flights[1].orientation.pitch, Cesium.Math.toRadians(-30));
});

test('destroying an active Atlas Mode restores the controller', () => {
  const viewer = fakeViewer();
  const atlas = createAtlasMode(viewer);
  atlas.set(true);
  atlas.destroy();
  assert.equal(atlas.active, false);
  assert.equal(viewer.scene.screenSpaceCameraController.enableTilt, true);
});
