// DI injection token for the ioredis client.
// Using a string token (rather than the Redis class itself) keeps every
// consumer decoupled from the concrete ioredis import.
export const REDIS_CLIENT = 'REDIS_CLIENT' as const;
