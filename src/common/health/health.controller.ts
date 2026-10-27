import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';

export class HealthDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';

  @ApiProperty({
    description: 'Hora del servidor (UTC, ISO-8601)',
    example: '2026-10-26T19:42:00.000Z',
  })
  time: string;
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
