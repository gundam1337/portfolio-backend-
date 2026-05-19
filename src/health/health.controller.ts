import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Service is healthy',
    schema: {
      example: { status: 'ok' },
    },
  })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
