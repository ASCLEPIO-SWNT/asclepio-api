// npm run users:create -- --email <email> --full-name <nombre> --role <ROL> --tenant <IPS>
// La contraseña se lee por la entrada estándar (nunca por argumento, D20). Idempotente por email (R41).
import { isEmail } from 'class-validator';
import { isStaffRole, STAFF_ROLES } from '../common/auth/principal.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { PASSWORD_MAX, PASSWORD_MIN } from '../modules/auth/dto/auth.dto.js';
import { PasswordHasher } from '../modules/auth/password/password-hasher.js';
import { TenancyService } from '../modules/tenancy/tenancy.service.js';
import { UsersService } from '../modules/users/users.service.js';
import {
  CliError,
  out,
  parseCliArgs,
  readPassword,
  requireDevPrefix,
  runCli,
} from './cli.js';

void runCli(async (context) => {
  const args = parseCliArgs(['email', 'full-name', 'role', 'tenant'] as const);
  const email = args.email?.trim() ?? '';
  const fullName = args['full-name']?.trim() ?? '';
  const role = args.role?.trim() ?? '';
  const tenantName = args.tenant?.trim() ?? '';
  if (!email || !fullName || !role || !tenantName) {
    throw new CliError(
      'Faltan argumentos: --email, --full-name, --role y --tenant son obligatorios.',
    );
  }
  if (!isEmail(email)) throw new CliError('El email no es válido.');
  if (!isStaffRole(role)) {
    throw new CliError(`El rol debe ser uno de: ${STAFF_ROLES.join(', ')}.`);
  }
  requireDevPrefix('--full-name', fullName);
  requireDevPrefix('--tenant', tenantName);
  const password = await readPassword('Contraseña: ');
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new CliError(
      `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`,
    );
  }

  const app = await context();
  const users = app.get(UsersService);
  if (await users.existsByEmail(email)) {
    out('El usuario ya existe: no se ha creado ni modificado nada.');
    return;
  }
  const passwordHash = await app.get(PasswordHasher).hash(password);
  const tenancy = app.get(TenancyService);
  const audit = app.get(AuditService);
  const result = await app.get(PrismaService).$transaction(async (tx) => {
    const tenant = await tenancy.findOrCreateByName(tenantName, tx);
    const user = await users.create(
      { tenantId: tenant.id, email, passwordHash, fullName, role },
      tx,
    );
    await audit.record(
      {
        action: 'USER_CREATED',
        actorType: 'SYSTEM',
        actorId: null,
        tenantId: tenant.id,
        entity: 'user',
        entityId: user.id,
      },
      tx,
    );
    return {
      userId: user.id,
      tenantId: tenant.id,
      tenantCreated: tenant.created,
    };
  });
  // Solo ids: nada de email, nombre ni contraseña en la salida (R27, R35).
  out(
    `Usuario creado: id ${result.userId}, IPS ${result.tenantId}${result.tenantCreated ? ' (IPS nueva)' : ''}.`,
  );
});
