import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PublicThrottled } from '../../common/throttle/public-throttled.decorator.js';
import { ConsentService } from './consent.service.js';

export class ConsentDto {
  @ApiProperty({ example: '2026-10-v1' }) version: string;
  @ApiProperty({ description: 'Texto del consentimiento (Markdown).' })
  text: string;
}

@ApiTags('public')
@Controller('public/consent')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  /** Versión vigente y texto del consentimiento de tratamiento de datos (R38, Ley 1581). */
  @Get()
  @PublicThrottled()
  @ApiOkResponse({ type: ConsentDto })
  get(): ConsentDto {
    return this.consent.current();
  }
}
