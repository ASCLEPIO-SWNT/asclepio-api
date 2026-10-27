import { applyDecorators } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { Throttled } from './throttled.decorator.js';

/** @Public() + límite de R39 (10 peticiones / 60 s por IP y endpoint) con 429 problem+json y Retry-After. */
export const PublicThrottled = () => applyDecorators(Public(), Throttled());
