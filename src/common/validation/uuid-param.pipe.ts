import {
  Injectable,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';
import { isUuid } from '../uuid.js';

/** Id de la ruta: si no es un UUID responde 404 con el mismo cuerpo que "no existe" (design.md, F-02). */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUuid(value)) throw new NotFoundException('El recurso no existe.');
    return value;
  }
}
