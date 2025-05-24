import logger from './logger.js';

interface ManifestInfo {
  mediaType: string;
  tag: string[];
  timeUploadedMs: string;
  timeCreatedMs: string;
  imageSizeBytes: string;
}

interface Manifest {
  [sha: string]: ManifestInfo;
}

interface ImageData {
  child: any[];
  manifest: Manifest;
  name: string;
  tags: string[];
}

/**
 * Retrieves the latest tag based on timeUploadedMs from the image data
 * @param imageData The image data containing manifests
 * @returns The latest tag or null if no tags are available
 */
export function getLatestImageTag(imageData: ImageData): string | null {
  let latestTimeMs = '0';
  let latestTag: string | null = null;

  // Iterate through all manifests
  Object.entries(imageData.manifest).forEach(([_, manifestInfo]) => {
    // Skip entries with empty tags
    if (manifestInfo.tag.length === 0 || manifestInfo.imageSizeBytes === '0') {
      return;
    }

    // Check if any tag matches the agents-v{num}.{num}.{num} pattern
    const validAgentTag = manifestInfo.tag.find((tag) =>
      /^agents-v\d+\.\d+\.\d+$/.test(tag)
    );

    // Skip if no valid agent tag found
    if (!validAgentTag) {
      return;
    }

    const timeUploaded = manifestInfo.timeUploadedMs;
    // Compare upload times and update if current is newer
    if (timeUploaded > latestTimeMs) {
      latestTimeMs = timeUploaded;
      latestTag = validAgentTag;
    }
  });

  return latestTag;
}

// curl -s https://gcr.io/v2/abacus-labs-dev/hyperlane-agent/tags/list
export async function fetchImageTags(): Promise<ImageData> {
  logger.info(`Fetching image tags from GCR...`);
  const resp = await fetch(
    'https://gcr.io/v2/abacus-labs-dev/hyperlane-agent/tags/list'
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch image data: ${resp.statusText}`);
  }

  const data = await resp.json();

  return {
    child: data.child || [],
    manifest: data.manifest as Manifest,
    name: data.name,
    tags: data.tags,
  };
}
