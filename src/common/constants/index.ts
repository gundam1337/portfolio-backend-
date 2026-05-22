export const CACHE_TTL_DEFAULT = 300_000;

export const THROTTLE_MINUTE_TTL = 60_000;
export const THROTTLE_HOUR_TTL = 3_600_000;

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
