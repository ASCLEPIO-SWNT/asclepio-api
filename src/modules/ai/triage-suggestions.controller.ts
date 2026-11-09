import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, StaffRoles } from '../../common/auth/decorators.js';
import type { StaffPrincipal } from '../../common/auth/principal.js';
import { UuidParamPipe } from '../../common/validation/uuid-param.pipe.js';
import {
  RequestTriageSuggestionDto,
  TriageSuggestionDto,
  TriageSuggestionListDto,
} from './dto/triage-suggestion.dto.js';
import { TriageSuggestionsService } from './triage-suggestions.service.js';

const PROPOSAL =
  'La sugerencia es una PROPUESTA, nunca una decisión: no cambia la atención ni asigna el nivel final (lo decide enfermería en F-05). suggestedLevel puede ser más grave que llmLevel porque los SafetyGuards (PROVISIONALES) solo suben la gravedad.';

/** Sugerencia de triage por LLM (F-04-api): NURSE la pide; NURSE y PHYSICIAN la leen. */
@ApiTags('triage-suggestions')
@Controller('encounters')
export class TriageSuggestionsController {
  constructor(private readonly suggestions: TriageSuggestionsService) {}

  @Post(':id/triage-suggestions')
  @StaffRoles('NURSE')
  @ApiOperation({
    summary: 'Pide una sugerencia de nivel de triage al LLM',
    description: `${PROPOSAL} Solo con la atención en WAITING_TRIAGE y al menos una toma de signos vitales (si no, 409). Responde 201 también si el LLM falla (status INVALID_OUTPUT, TIMEOUT o FAILED): la web ofrece el triage manual. Cada solicitud guarda una sugerencia nueva.`,
  })
  @ApiBody({
    required: false,
    description: 'Sin cuerpo o {}. Cualquier campo → 400.',
    schema: { type: 'object', additionalProperties: false, properties: {} },
  })
  @ApiCreatedResponse({ type: TriageSuggestionDto })
  request(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
    // El cuerpo solo se valida (R5: ninguno o {}); no se usa.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _body: RequestTriageSuggestionDto,
  ): Promise<TriageSuggestionDto> {
    return this.suggestions.request(principal, id);
  }

  @Get(':id/triage-suggestions')
  @StaffRoles('NURSE', 'PHYSICIAN')
  @ApiOperation({
    summary: 'Lista las sugerencias de la atención (la más reciente primero)',
    description: `${PROPOSAL} items[0] es la sugerencia vigente. Se puede leer en cualquier estado de la atención.`,
  })
  @ApiOkResponse({ type: TriageSuggestionListDto })
  list(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<TriageSuggestionListDto> {
    return this.suggestions.list(principal.tenantId, id);
  }
}
