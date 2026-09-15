import metadata from '../../package.json' with { type: 'json' };

// Public product identity only. Never derive protocol/storage names from branding.
export const PRODUCT_NAME = metadata.name;
export const PRODUCT_VERSION = metadata.version;
