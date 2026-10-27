import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PatientAccountsService } from '../src/modules/auth/patient-accounts.service.js';
import { PatientsService } from '../src/modules/patients/patients.service.js';
import { TenancyService } from '../src/modules/tenancy/tenancy.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { createApp } from './e2e-app.js';
import { F02Fixtures } from './int/f02-fixtures.js';

describe('F-02: métodos de apoyo de tenancy, users, auth y patients (integración)', () => {
  let app: INestApplication<App>;
  let fx: F02Fixtures;
  let a: { id: string; siteId: string; siteName: string };
  let b: { id: string; siteId: string; siteName: string };

  beforeAll(async () => {
    app = await createApp();
    fx = new F02Fixtures(app);
    a = await fx.tenant('f02-support-a');
    b = await fx.tenant('f02-support-b');
  });
  afterAll(() => app.close());

  it('R15: TenancyService.findSiteInTenant devuelve la sede solo si es del tenant (null si es de otro, no existe o no es UUID) y findSiteNames resuelve nombres del tenant', async () => {
    const tenancy = app.get(TenancyService);
    await expect(tenancy.findSiteInTenant(a.id, a.siteId)).resolves.toEqual({
      id: a.siteId,
      name: a.siteName,
    });
    await expect(tenancy.findSiteInTenant(a.id, b.siteId)).resolves.toBeNull();
    await expect(
      tenancy.findSiteInTenant(a.id, '00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeNull();
    await expect(tenancy.findSiteInTenant(a.id, 'no-uuid')).resolves.toBeNull();
    const names = await tenancy.findSiteNames(a.id, [a.siteId, b.siteId]);
    expect([...names.entries()]).toEqual([[a.siteId, a.siteName]]);
  });

  it('R42: UsersService.findNames resuelve el nombre del personal del tenant e ignora el de otro tenant', async () => {
    const ua = await fx.staff(a.id);
    const ub = await fx.staff(b.id);
    const names = await app.get(UsersService).findNames(a.id, [ua.id, ub.id]);
    expect([...names.entries()]).toEqual([[ua.id, ua.fullName]]);
  });

  it('R18: PatientAccountsService.markIdentityVerified verifica la cuenta una sola vez (changed) y findIdentityFlags devuelve el flag por paciente del tenant', async () => {
    const accounts = app.get(PatientAccountsService);
    const prisma = fx.prisma;
    const p = await fx.patientUser(a.id);
    const other = await fx.patientUser(b.id);
    await expect(
      accounts.findIdentityFlags(a.id, [p.patientId, other.patientId]),
    ).resolves.toEqual(new Map([[p.patientId, false]]));

    const first = await prisma.$transaction((tx) =>
      accounts.markIdentityVerified(a.id, p.patientId, tx),
    );
    expect(first).toEqual({ accountId: p.accountId, changed: true });
    const again = await prisma.$transaction((tx) =>
      accounts.markIdentityVerified(a.id, p.patientId, tx),
    );
    expect(again).toEqual({ accountId: p.accountId, changed: false });
    // Otro tenant: no la encuentra ni la modifica.
    await expect(
      prisma.$transaction((tx) =>
        accounts.markIdentityVerified(a.id, other.patientId, tx),
      ),
    ).resolves.toBeNull();
    await expect(
      accounts.findIdentityFlags(a.id, [p.patientId]),
    ).resolves.toEqual(new Map([[p.patientId, true]]));
  });

  it('R18: PatientsService.findById, findManyByIds y markIdentityVerified respetan el tenant y fijan identity_verified_at solo si era NULL', async () => {
    const patients = app.get(PatientsService);
    const pa = await fx.patient(a.id);
    const pb = await fx.patient(b.id);
    const nn = await fx.patient(a.id, {
      documentType: null,
      documentNumber: null,
      fullName: null,
      birthDate: null,
      estimatedAgeYears: 30,
    });
    await expect(patients.findById(a.id, pa.id)).resolves.toMatchObject({
      id: pa.id,
      documentType: 'CC',
      birthDate: '1970-01-01',
      estimatedAgeYears: null,
      sex: 'M',
      isNN: false,
    });
    await expect(patients.findById(a.id, pb.id)).resolves.toBeNull();
    await expect(patients.findById(a.id, 'no-uuid')).resolves.toBeNull();
    const many = await patients.findManyByIds(a.id, [pa.id, pb.id, nn.id]);
    expect([...many.keys()].sort()).toEqual([pa.id, nn.id].sort());
    expect(many.get(nn.id)).toMatchObject({
      documentType: null,
      documentNumber: null,
      fullName: null,
      birthDate: null,
      estimatedAgeYears: 30,
      isNN: true,
    });

    const at = new Date('2026-10-26T15:00:00Z');
    await expect(
      fx.prisma.$transaction((tx) =>
        patients.markIdentityVerified(a.id, pa.id, at, tx),
      ),
    ).resolves.toBe(true);
    await expect(
      fx.prisma.$transaction((tx) =>
        patients.markIdentityVerified(a.id, pa.id, new Date(), tx),
      ),
    ).resolves.toBe(false);
    await expect(
      fx.prisma.$transaction((tx) =>
        patients.markIdentityVerified(a.id, pb.id, at, tx),
      ),
    ).resolves.toBe(false);
    const row = await fx.prisma.patient.findUniqueOrThrow({
      where: { id: pa.id },
    });
    expect(row.identityVerifiedAt).toEqual(at);
  });
});
