import {
  confusionMatrix,
  mean,
  median,
  p90,
  percent,
  round1,
  round3,
  type LevelPair,
  weightedKappa,
} from './report-stats.js';

describe('report-stats (F-07-api)', () => {
  it('R6: median y p90 (rango más cercano, posición ceil(0,9·n)) con n = 0, 1, 2, 10 y 11', () => {
    // n = 0 → null.
    expect(median([])).toBeNull();
    expect(p90([])).toBeNull();
    // n = 1.
    expect(median([7])).toBe(7);
    expect(p90([7])).toBe(7);
    // n = 2: mediana = promedio de los dos centrales; p90 = posición ceil(1,8) = 2.
    expect(median([2.5, 2])).toBe(2.3); // (2 + 2,5) / 2 = 2,25 → 2,3
    expect(p90([2.5, 2])).toBe(2.5);
    // n = 10 (desordenado): mediana = (5 + 6) / 2 = 5,5; p90 = posición ceil(9) = 9 → 9.
    const ten = [10, 3, 7, 1, 9, 2, 8, 4, 6, 5];
    expect(median(ten)).toBe(5.5);
    expect(p90(ten)).toBe(9);
    // n = 11: mediana = el sexto (6); p90 = posición ceil(9,9) = 10 → 10.
    const eleven = [11, ...ten];
    expect(median(eleven)).toBe(6);
    expect(p90(eleven)).toBe(10);
    // No modifica la entrada.
    expect(ten[0]).toBe(10);
    // Media con 1 decimal.
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 2])).toBe(1.7);
  });

  it('R8: weightedKappa cuadrático: acuerdo perfecto → 1, caso calculado a mano → 0,778 y menos de 2 pares → null', () => {
    expect(
      weightedKappa([
        [1, 1],
        [2, 2],
        [3, 3],
        [5, 5],
      ]),
    ).toBe(1);
    expect(weightedKappa([])).toBeNull();
    expect(weightedKappa([[2, 3]])).toBeNull();
    // Acuerdo esperado 1 (todas las sugerencias y todos los finales en el mismo nivel): Σ w·E = 0 → null.
    expect(
      weightedKappa([
        [3, 3],
        [3, 3],
      ]),
    ).toBeNull();

    /*
     * Caso calculado a mano. Pares (sugerido, final), n = 6:
     *   (1,1) (2,2) (2,3) (3,3) (3,3) (4,3)
     * Pesos de desacuerdo w_ij = (i − j)²  (equivale a los pesos de acuerdo 1 − (i − j)² / 16).
     *
     * Matriz observada O[sugerido][final]:
     *            f=1  f=2  f=3  f=4  f=5 | fila r_i
     *   s=1        1    0    0    0    0 |  1
     *   s=2        0    1    1    0    0 |  2
     *   s=3        0    0    2    0    0 |  2
     *   s=4        0    0    1    0    0 |  1
     *   s=5        0    0    0    0    0 |  0
     *   col c_j    1    1    4    0    0 |  n = 6
     *
     * Σ w·O = w(2,3)·1 + w(4,3)·1 = 1 + 1 = 2.
     *
     * Esperada E_ij = r_i·c_j / n; Σ w·E = (1/6)·Σ_i r_i·Σ_j c_j·(i − j)²:
     *   i=1: r=1 · (1·0 + 1·1 + 4·4) = 1 · 17 = 17
     *   i=2: r=2 · (1·1 + 1·0 + 4·1) = 2 · 5  = 10
     *   i=3: r=2 · (1·4 + 1·1 + 4·0) = 2 · 5  = 10
     *   i=4: r=1 · (1·9 + 1·4 + 4·1) = 1 · 17 = 17
     *   i=5: r=0                              =  0
     *   total = 54 → Σ w·E = 54 / 6 = 9.
     *
     * κ_w = 1 − Σ w·O / Σ w·E = 1 − 2 / 9 = 0,7777… → 0,778 (3 decimales).
     */
    const pairs: LevelPair[] = [
      [1, 1],
      [2, 2],
      [2, 3],
      [3, 3],
      [3, 3],
      [4, 3],
    ];
    expect(weightedKappa(pairs)).toBe(0.778);
    expect(confusionMatrix(pairs)).toEqual([
      [1, 0, 0, 0, 0],
      [0, 1, 1, 0, 0],
      [0, 0, 2, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0],
    ]);

    // Desacuerdo total en los extremos: (1,5) y (5,1). O: Σ w·O = 16 + 16 = 32; r = c = (1,0,0,0,1);
    // Σ w·E = (1/2)·(1·(0 + 16) + 1·(16 + 0)) = 16 → κ = 1 − 32/16 = −1.
    expect(
      weightedKappa([
        [1, 5],
        [5, 1],
      ]),
    ).toBe(-1);
    // Matriz 5×5 vacía sin pares.
    expect(confusionMatrix([])).toEqual(
      Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]),
    );
  });

  it('R10: percent con denominador 0 → null y redondeo a 1 decimal; el kappa a 3', () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(3, 0)).toBeNull();
    expect(percent(0, 5)).toBe(0);
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(1, 6)).toBe(16.7);
    expect(percent(5, 5)).toBe(100);
    expect(round1(2.25)).toBe(2.3);
    expect(round1(2.24)).toBe(2.2);
    expect(round1(-1.25)).toBe(-1.2);
    expect(round3(7 / 9)).toBe(0.778);
    expect(round3(2 / 3)).toBe(0.667);
  });
});
