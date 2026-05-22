import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  url: process.env.REDIS_URL,
  cacheTtl: parseInt(process.env.CACHE_TTL ?? '300000', 10),
}));
