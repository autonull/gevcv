/**
 * @module geojsonlWorker
 * Web Worker for parsing large GeoJSONL files off the main thread.
 * Receives: { type: 'parse', url: string, layerId: string }
 * Sends: { type: 'progress', loaded: number, total: number, layerId: string }
 * Sends: { type: 'result', features: Array, layerId: string }
 * Sends: { type: 'error', message: string, layerId: string }
 */

const CHUNK_SIZE = 64 * 1024; // 64KB chunks

function parseGeojsonLines(text) {
  return String(text)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function fetchAndParse(url, layerId, postMessage) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const features = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    loaded += value.length;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        try {
          features.push(JSON.parse(trimmed));
        } catch (e) {
          console.warn(`Failed to parse line in ${layerId}:`, e);
        }
      }
    }

    if (total > 0) {
      postMessage({ type: 'progress', loaded, total, layerId, featureCount: features.length });
    }
  }

  // Process remaining buffer
  if (buffer.trim().length > 0) {
    try {
      features.push(JSON.parse(buffer.trim()));
    } catch (e) {
      console.warn(`Failed to parse final line in ${layerId}:`, e);
    }
  }

  postMessage({ type: 'result', features, layerId });
}

self.onmessage = async (event) => {
  const { type, url, layerId } = event.data;
  if (type === 'parse') {
    try {
      await fetchAndParse(url, layerId, self.postMessage);
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message, layerId });
    }
  }
};