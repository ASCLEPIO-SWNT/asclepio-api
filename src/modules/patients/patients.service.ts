import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type PrismaTx,
} from '../../common/prisma/prisma.service.js';

export type PatientSex = 'M' | 'F' | 'X';

/** Dueño de patients. Mínimo de F-01 (alta y login del paciente); F-02 lo amplía. */
@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByDocument(
    tenantId: string,
    documentType: string,
    documentNumber: string,
    tx?: PrismaTx,
  ): Promise<{ id: string } | null> {
    return (tx ?? this.prisma).patient.findUnique({
      where: {
        tenantId_documentType_documentNumber: {
          tenantId,
          documentType,
          documentNumber,
        },
      },
      select: { id: true },
    });
  }

  /** birthDate es una fecha civil YYYY-MM-DD (columna date). */
  async create(
    data: {
      tenantId: string;
      documentType: string;
      documentNumber: string;
      fullName: string;
      birthDate: string;
      sex: PatientSex;
    },
    tx?: PrismaTx,
  ): Promise<{ id: string }> {
    return (tx ?? this.prisma).patient.create({
      data: { ...data, birthDate: new Date(`${data.birthDate}T00:00:00Z`) },
      select: { id: true },
    });
  }
}
