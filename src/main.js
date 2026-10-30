import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { t } from './i18n/index.js';

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration:
    import.meta.env.DEV || import.meta.env.VITE_QA_HANDLE === '1',
});

application.start().catch((error) => {
  console.error("God's Eye View initialization failed:", error);
  document.body.textContent = t('Error: {message}', {
    message: describeError(error),
  });
  document.body.style.color = '#ff4444';
});

export { application };
