import { REDACTED, redact } from './redaction.js';

const R = REDACTED;
const PATIENT = {
  fullName: 'José Ana del Río Peña',
  documentNumber: '1032456789',
};

describe('redact (PA-F04-7, D8)', () => {
  it('R9: reemplaza el nombre completo por una sola marca', () => {
    expect(
      redact('Refiere José Ana del Río Peña que le duele el pecho', PATIENT),
    ).toBe(`Refiere ${R} que le duele el pecho`);
  });

  it('R9: reemplaza cada palabra del nombre de 3 o más letras, sin distinguir mayúsculas ni tildes', () => {
    expect(redact('JOSE trae dolor; su hija llama a jose', PATIENT)).toBe(
      `${R} trae dolor; su hija llama a ${R}`,
    );
    expect(redact('la señora PEÑA y el señor pena; Rio y RÍO', PATIENT)).toBe(
      `la señora ${R} y el señor ${R}; ${R} y ${R}`,
    );
    expect(redact('Ana', PATIENT)).toBe(R);
  });

  it('R9: no reemplaza conectores (del, las, los, san) ni palabras de 1–2 letras', () => {
    const p = {
      fullName: 'Luz de las Mercedes San Juan del Mar',
      documentNumber: null,
    };
    expect(
      redact('dolor de pecho en las mañanas, del lado izquierdo, san', p),
    ).toBe('dolor de pecho en las mañanas, del lado izquierdo, san');
    expect(redact('luz Mercedes juan MAR', p)).toBe(`${R} ${R} ${R} ${R}`);
  });

  it('R9: solo palabra completa: "Ana" no toca "anamnesis" ni "Peña" toca "peñasco"', () => {
    expect(redact('anamnesis incompleta, cayó de un peñasco', PATIENT)).toBe(
      'anamnesis incompleta, cayó de un peñasco',
    );
  });

  it('R9: reemplaza el documento aunque lleve separadores ".", "-" o espacios', () => {
    for (const text of [
      'documento 1032456789',
      'documento 1.032.456.789',
      'documento 1-032-456-789',
      'documento 1 032 456 789',
    ]) {
      expect(redact(text, PATIENT)).toBe(`documento ${R}`);
    }
    // Otra cifra que contiene el documento como parte de un número mayor no se toca.
    expect(redact('lote 91032456789', PATIENT)).toBe('lote 91032456789');
  });

  it('R9: una atención NN (sin nombre ni documento) se envía sin reemplazos', () => {
    const text = 'José, 1032456789, dolor torácico';
    expect(redact(text, { fullName: null, documentNumber: null })).toBe(text);
  });

  it('R9: conserva el resto del texto exactamente (tildes, mayúsculas y signos)', () => {
    expect(
      redact('Dolor TORÁCICO opresivo (8/10) desde las 19:42, José.', PATIENT),
    ).toBe(`Dolor TORÁCICO opresivo (8/10) desde las 19:42, ${R}.`);
  });
});
