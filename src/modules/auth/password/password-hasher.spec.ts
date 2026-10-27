import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();
  const password = 'DEV-clave-segura-123';

  it('R27: guarda scrypt con sal aleatoria por contraseña y formato autodescriptivo (N=2^17, r=8, p=1)', async () => {
    const a = await hasher.hash(password);
    const b = await hasher.hash(password);
    expect(a).not.toBe(b);
    expect(a).not.toContain(password);
    const parts = a.split('$');
    expect(parts.slice(0, 4)).toEqual(['scrypt', '131072', '8', '1']);
    expect(Buffer.from(parts[4], 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[5], 'base64')).toHaveLength(64);
  });

  it('R27: verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const stored = await hasher.hash(password);
    await expect(hasher.verify(password, stored)).resolves.toBe(true);
    await expect(hasher.verify(password + 'x', stored)).resolves.toBe(false);
  });

  it('R27: un hash mal formado nunca verifica', async () => {
    await expect(hasher.verify(password, 'texto-plano')).resolves.toBe(false);
    await expect(
      hasher.verify(password, 'scrypt$abc$8$1$AAAA$AAAA'),
    ).resolves.toBe(false);
  });

  it('R4: verifyDummy calcula un scrypt completo y siempre devuelve false (iguala tiempos con cuentas inexistentes)', async () => {
    await expect(hasher.verifyDummy(password)).resolves.toBe(false);
  });
});
