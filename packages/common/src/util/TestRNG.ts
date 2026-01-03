import type { RNG } from './RNG.js';
import { clamp } from 'es-toolkit';

const maxSafeInt = Number.MAX_SAFE_INTEGER;

const clamp01 = (value: number): number => clamp(value, 0, 1);

// 테스트에서 0/1만 고정으로 뽑기 위한 RNG
export class ConstantRNG implements RNG {
    private readonly bit: 0 | 1;

    public constructor(bit: 0 | 1) {
        this.bit = bit;
    }

    public getMaxInt(): number {
        return maxSafeInt;
    }

    public nextBytes(bytes: number): Uint8Array<ArrayBuffer> {
        if (bytes <= 0) {
            throw new Error('bytes must be positive');
        }
        const result = new Uint8Array(bytes);
        result.fill(this.bit === 0 ? 0x00 : 0xff);
        return result;
    }

    public nextBits(bits: number): Uint8Array<ArrayBuffer> {
        if (bits <= 0) {
            throw new Error('bits must be positive');
        }
        const bytes = (bits + 7) >> 3;
        const headBits = bits & 0x7;
        const result = this.nextBytes(bytes);

        if (headBits === 0) {
            return result;
        }

        result[bytes - 1]! &= 0xff >> (8 - headBits);
        return result;
    }

    public nextInt(max?: number): number {
        if (max === undefined || max === maxSafeInt) {
            return this.bit === 0 ? 0 : maxSafeInt;
        }
        if (max > maxSafeInt) {
            throw new Error('Over max int');
        }
        if (max === 0) {
            return 0;
        }
        if (max < 0) {
            return -this.nextInt(-max);
        }
        return this.bit === 0 ? 0 : max;
    }

    public nextFloat1(): number {
        return this.bit;
    }
}

// 중간값 고정 + bool은 0/1 교대로 뽑는 RNG
export class MidpointRNG implements RNG {
    private bitState: 0 | 1;

    public constructor(startBit: 0 | 1 = 0) {
        this.bitState = startBit;
    }

    public getMaxInt(): number {
        return maxSafeInt;
    }

    private nextBitRaw(): 0 | 1 {
        const value = this.bitState;
        this.bitState = value === 0 ? 1 : 0;
        return value;
    }

    public nextBytes(bytes: number): Uint8Array<ArrayBuffer> {
        if (bytes <= 0) {
            throw new Error('bytes must be positive');
        }
        return this.nextBits(bytes * 8);
    }

    public nextBits(bits: number): Uint8Array<ArrayBuffer> {
        if (bits <= 0) {
            throw new Error('bits must be positive');
        }
        const bytes = (bits + 7) >> 3;
        const result = new Uint8Array(bytes);

        for (let bitIdx = 0; bitIdx < bits; bitIdx += 1) {
            if (this.nextBitRaw() === 0) {
                continue;
            }
            const byteIdx = bitIdx >> 3;
            const offset = bitIdx & 0x7;
            result[byteIdx]! |= 1 << offset;
        }

        return result;
    }

    public nextInt(max?: number): number {
        if (max === undefined || max === maxSafeInt) {
            return Math.floor(maxSafeInt / 2);
        }
        if (max > maxSafeInt) {
            throw new Error('Over max int');
        }
        if (max === 0) {
            return 0;
        }
        if (max < 0) {
            return -this.nextInt(-max);
        }
        return Math.floor(max / 2);
    }

    public nextFloat1(): number {
        return 0.5;
    }
}

// 사인파 기반으로 주기/진폭을 조절하는 RNG
export class SineRNG implements RNG {
    private step = 0;
    private readonly period: number;
    private readonly amplitude: number;
    private readonly phase: number;

    public constructor(period = 32, amplitude = 0.5, phase = 0) {
        if (period <= 0) {
            throw new Error('period must be positive');
        }
        this.period = period;
        this.amplitude = amplitude;
        this.phase = phase;
    }

    public getMaxInt(): number {
        return maxSafeInt;
    }

    private nextWaveFloat(): number {
        const radians = this.phase + (this.step * 2 * Math.PI) / this.period;
        const value = 0.5 + this.amplitude * Math.sin(radians);
        this.step += 1;
        return clamp01(value);
    }

    public nextBytes(bytes: number): Uint8Array<ArrayBuffer> {
        if (bytes <= 0) {
            throw new Error('bytes must be positive');
        }
        const result = new Uint8Array(bytes);
        for (let idx = 0; idx < bytes; idx += 1) {
            const value = Math.floor(this.nextWaveFloat() * 256);
            result[idx] = value >= 256 ? 255 : value;
        }
        return result;
    }

    public nextBits(bits: number): Uint8Array<ArrayBuffer> {
        if (bits <= 0) {
            throw new Error('bits must be positive');
        }
        const bytes = (bits + 7) >> 3;
        const headBits = bits & 0x7;
        const result = this.nextBytes(bytes);

        if (headBits === 0) {
            return result;
        }
        result[bytes - 1]! &= 0xff >> (8 - headBits);
        return result;
    }

    public nextInt(max?: number): number {
        if (max === undefined || max === maxSafeInt) {
            const value = Math.floor(this.nextWaveFloat() * (maxSafeInt + 1));
            return value > maxSafeInt ? maxSafeInt : value;
        }
        if (max > maxSafeInt) {
            throw new Error('Over max int');
        }
        if (max === 0) {
            return 0;
        }
        if (max < 0) {
            return -this.nextInt(-max);
        }
        const value = Math.floor(this.nextWaveFloat() * (max + 1));
        return value > max ? max : value;
    }

    public nextFloat1(): number {
        return this.nextWaveFloat();
    }
}

// 지정한 수열을 반복 재생하는 테스트용 RNG
export class SequenceRNG implements RNG {
    private readonly sequence: number[];
    private idx = 0;

    public constructor(sequence: number[]) {
        if (sequence.length === 0) {
            throw new Error('sequence must not be empty');
        }
        this.sequence = sequence.map(clamp01);
    }

    public getMaxInt(): number {
        return maxSafeInt;
    }

    private nextValue(): number {
        const value = this.sequence[this.idx]!;
        this.idx = (this.idx + 1) % this.sequence.length;
        return value;
    }

    public nextBytes(bytes: number): Uint8Array<ArrayBuffer> {
        if (bytes <= 0) {
            throw new Error('bytes must be positive');
        }
        const result = new Uint8Array(bytes);
        for (let idx = 0; idx < bytes; idx += 1) {
            const value = Math.floor(this.nextValue() * 256);
            result[idx] = value >= 256 ? 255 : value;
        }
        return result;
    }

    public nextBits(bits: number): Uint8Array<ArrayBuffer> {
        if (bits <= 0) {
            throw new Error('bits must be positive');
        }
        const bytes = (bits + 7) >> 3;
        const headBits = bits & 0x7;
        const result = this.nextBytes(bytes);
        if (headBits === 0) {
            return result;
        }
        result[bytes - 1]! &= 0xff >> (8 - headBits);
        return result;
    }

    public nextInt(max?: number): number {
        if (max === undefined || max === maxSafeInt) {
            const value = Math.floor(this.nextValue() * (maxSafeInt + 1));
            return value > maxSafeInt ? maxSafeInt : value;
        }
        if (max > maxSafeInt) {
            throw new Error('Over max int');
        }
        if (max === 0) {
            return 0;
        }
        if (max < 0) {
            return -this.nextInt(-max);
        }
        const value = Math.floor(this.nextValue() * (max + 1));
        return value > max ? max : value;
    }

    public nextFloat1(): number {
        return this.nextValue();
    }
}
