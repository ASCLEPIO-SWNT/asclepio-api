import { Module } from '@nestjs/common';
import { PasswordHasher } from './password-hasher.js';

/** Módulo pequeño para reutilizar el hasher en los scripts CLI sin cargar el resto de auth (JWT, guard). */
@Module({ providers: [PasswordHasher], exports: [PasswordHasher] })
export class PasswordModule {}
