import { Module } from '@nestjs/common';
import { PatientsService } from './patients.service.js';

@Module({ providers: [PatientsService], exports: [PatientsService] })
export class PatientsModule {}
