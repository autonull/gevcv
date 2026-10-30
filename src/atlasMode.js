import * as Cesium from 'cesium';

export const ATLAS_FLIGHT_SECONDS = 1.2;
const DEFAULT_EXIT_PITCH = Cesium.Math.toRadians(-35);

/**
 * Lock the camera to a flat, north-up view for raster browsing. Tilt and look
 * controls stay off until Atlas Mode exits, which restores the previous angles.
 */
export function createAtlasMode(viewer) {
  let active = false;
  let previous = null;

  function flyToAngles({ heading, pitch, roll }) {
    const carto = viewer.camera.positionCartographic;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        carto.height,
      ),
      orientation: { heading, pitch, roll },
      duration: ATLAS_FLIGHT_SECONDS,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  function set(enabled) {
    const next = Boolean(enabled);
    if (next === active) return active;
    const controller = viewer.scene.screenSpaceCameraController;
    if (next) {
      previous = {
        heading: viewer.camera.heading,
        pitch: viewer.camera.pitch,
        roll: viewer.camera.roll,
        enableTilt: controller.enableTilt,
        enableLook: controller.enableLook,
      };
      controller.enableTilt = false;
      controller.enableLook = false;
      flyToAngles({ heading: 0, pitch: -Math.PI / 2, roll: 0 });
    } else {
      if (previous) {
        controller.enableTilt = previous.enableTilt;
        controller.enableLook = previous.enableLook;
        flyToAngles({
          heading: previous.heading,
          pitch: previous.pitch,
          roll: previous.roll,
        });
      } else {
        flyToAngles({
          heading: 0,
          pitch: DEFAULT_EXIT_PITCH,
          roll: 0,
        });
      }
      previous = null;
    }
    active = next;
    return active;
  }

  return {
    set,
    toggle: () => set(!active),
    get active() {
      return active;
    },
    destroy() {
      if (active) set(false);
    },
  };
}
