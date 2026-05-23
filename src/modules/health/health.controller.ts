import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import type Redis from 'ioredis';
import { Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.redis.ping();
      return indicator.up();
    } catch {
      return indicator.down({ message: 'Redis ping failed' });
    }
  }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOkResponse({ description: 'All systems healthy' })
  @ApiServiceUnavailableResponse({ description: 'One or more systems degraded' })
  check() {
    return this.health.check([() => this.redisIndicator.isHealthy('redis')]);
  }
}
