import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldErrorDto {
  @ApiProperty() field: string;
  @ApiProperty() message: string;
}

/** Error en application/problem+json (RFC 9457). */
export class ProblemDetailsDto {
  @ApiProperty({ example: 'about:blank' }) type: string;
  @ApiProperty({ example: 'Not Found' }) title: string;
  @ApiProperty({ example: 404 }) status: number;
  @ApiPropertyOptional() detail?: string;
  @ApiPropertyOptional({ example: '/api/v1/encounters/123' }) instance?: string;
  @ApiPropertyOptional({ type: [FieldErrorDto] }) errors?: FieldErrorDto[];
}
