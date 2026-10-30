import { createApplicationControls } from '../app/controls.js';
import { getStandaloneCatalog } from './catalog.js';
export function createStandaloneControls(options) {
  const { loaderStatus, ...rest } = options;
  return createApplicationControls({
    catalog: options?.catalog ?? getStandaloneCatalog(),
    ...rest,
  });
}
