import { describe, expect, it } from 'vitest';
import { DetectorVoz, a16k, codificarWav, textoParaVoz } from '../src/index.ts';

describe('voz de Jarvis', () => {
  it('prepara la respuesta para leerla en voz alta', () => {
    expect(textoParaVoz('El disponible (caja y bancos) al 2026-10-02 es $ 60.167.700.'))
      .toBe('El disponible (caja y bancos) al 2 de octubre de 2026 es 60167700 pesos.');
    expect(textoParaVoz('Saldo: -$ 1.234,50 · ver FV-000002')).toBe('Saldo: menos 1234 pesos con 50 centavos. ver FV número 2');
    expect(textoParaVoz('**IVA** por pagar $120.000,00')).toBe('IVA por pagar 120000 pesos');
    expect(textoParaVoz('Período 2026-13-01')).toBe('Período 2026-13-01'); // no es fecha
  });

  it('baja el audio a 16 kHz y lo codifica en WAV PCM de 16 bits', () => {
    const tono = new Float32Array(48000).map((_, i) => Math.sin((i / 48000) * 2 * Math.PI * 440) * 0.5);
    const m = a16k(tono, 48000);
    expect(m.length).toBe(16000);
    const wav = codificarWav(m);
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 16))).toBe('WAVEfmt ');
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([1, 16000, 16, 32000]);
    expect(wav.length).toBe(44 + 32000);
    expect(codificarWav(new Float32Array([2, -2]))).toEqual(codificarWav(new Float32Array([1, -1]))); // recorta
  });

  it('detecta el final de la pregunta por el silencio, o cancela si nadie habla', () => {
    const bloque = (a: number) => new Float32Array(1600).fill(a); // 100 ms a 16 kHz
    const d = new DetectorVoz();
    const pasos: string[] = [];
    for (let i = 0; i < 3; i++) pasos.push(d.procesar(bloque(0.002), 100)); // ruido de fondo
    for (let i = 0; i < 20; i++) pasos.push(d.procesar(bloque(0.2), 100)); // 2 s hablando
    for (let i = 0; i < 12; i++) pasos.push(d.procesar(bloque(0.002), 100)); // 1,2 s de silencio
    expect(pasos.at(2)).toBe('esperando');
    expect(pasos.at(10)).toBe('hablando');
    expect(pasos.at(-2)).toBe('hablando');
    expect(pasos.at(-1)).toBe('fin');
    // Una pausa corta en medio de la frase no la corta
    const p = new DetectorVoz();
    for (const a of [0.002, 0.002, 0.002, 0.3, 0.3, 0.3, 0.002, 0.002, 0.002, 0.002, 0.3]) p.procesar(bloque(a), 100);
    expect(p.estado).toBe('hablando');
    const nadie = new DetectorVoz({ esperaMaxima: 2000 });
    for (let i = 0; i < 25; i++) nadie.procesar(bloque(0.003), 100);
    expect(nadie.estado).toBe('sin-voz');
    // Ruido de fondo alto (oficina): el umbral se adapta
    const oficina = new DetectorVoz();
    for (let i = 0; i < 10; i++) oficina.procesar(bloque(0.03), 100);
    expect(oficina.estado).toBe('esperando');
  });
});
