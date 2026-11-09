/** Provider identifiers used throughout the system */
export const PROVIDERS = {
  PROVIDER_A: 'provider-a' as const,
  PROVIDER_B: 'provider-b' as const,
};

/** Internal match ID */
export const INTERNAL_MATCH_ID = 'match-1001';

/** Provider-specific external match IDs */
export const PROVIDER_MATCH_IDS = {
  [PROVIDERS.PROVIDER_A]: 'a-match-1001',
  [PROVIDERS.PROVIDER_B]: 'b-match-1001',
};

/** Default match name */
export const DEFAULT_MATCH_NAME = 'India vs Australia — T20 World Cup 2026';

/** HTTP status codes */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;
