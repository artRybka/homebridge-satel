import {
  ArmedPartitionsReallyAnswer,
  CommandResultAnswer,
  NewDataAnswer,
  OutputsStateAnswer,
  PartitionsAlarmAnswer,
  PartitionsArmedInMode2Answer,
  PartitionsArmedInMode3Answer,
  ZonesViolationAnswer,
  encodeArmedPartitionsReallyCommand,
  encodeArmInMode0Command,
  encodeArmInMode1Command,
  encodeArmInMode2Command,
  encodeArmInMode3Command,
  encodeClearAlarmCommand,
  encodeDisarmCommand,
  encodeNewDataCommand,
  encodeOutputsOffCommand,
  encodeOutputsOnCommand,
  encodeOutputsStateCommand,
  encodeOutputsState256Command,
  encodePartitionsAlarmCommand,
  encodePartitionsArmedInMode2Command,
  encodePartitionsArmedInMode3Command,
  encodeZonesViolationCommand,
  encodeZonesViolation256Command,
  type FlagArrayAnswer,
  type SatelMessage,
} from 'satel-integra-integration-protocol';
import type { ArmMode } from '../types';
import type { SatelConnection } from './connection';

export type EntityWidth = 128 | 256;

export interface SatelCommandsOptions {
  connection: SatelConnection;
  userCode: string;
  entityWidth: EntityWidth;
}

export class SatelCommandError extends Error {
  constructor(
    readonly operation: string,
    readonly resultCode: number,
    message: string,
  ) {
    super(`Satel rejected ${operation}: ${message} (0x${resultCode.toString(16)})`);
  }
}

export class SatelCommands {
  private readonly prefixAndUserCode: string;

  constructor(private readonly opts: SatelCommandsOptions) {
    this.prefixAndUserCode = padUserCode(opts.userCode);
  }

  get entityWidth(): EntityWidth {
    return this.opts.entityWidth;
  }

  async arm(partitionIds: number[], mode: ArmMode): Promise<void> {
    const encoders = [
      encodeArmInMode0Command,
      encodeArmInMode1Command,
      encodeArmInMode2Command,
      encodeArmInMode3Command,
    ] as const;
    const frame = encoders[mode](this.prefixAndUserCode, partitionsMask(partitionIds));
    await this.sendAndCheck(frame, `arm(mode=${mode})`);
  }

  async disarm(partitionIds: number[]): Promise<void> {
    const frame = encodeDisarmCommand(this.prefixAndUserCode, partitionsMask(partitionIds));
    await this.sendAndCheck(frame, 'disarm');
  }

  async clearAlarm(partitionIds: number[]): Promise<void> {
    const frame = encodeClearAlarmCommand(this.prefixAndUserCode, partitionsMask(partitionIds));
    await this.sendAndCheck(frame, 'clearAlarm');
  }

  async outputsOn(outputIds: number[]): Promise<void> {
    const frame = encodeOutputsOnCommand(this.prefixAndUserCode, outputsMask(outputIds, this.opts.entityWidth));
    await this.sendAndCheck(frame, 'outputsOn');
  }

  async outputsOff(outputIds: number[]): Promise<void> {
    const frame = encodeOutputsOffCommand(this.prefixAndUserCode, outputsMask(outputIds, this.opts.entityWidth));
    await this.sendAndCheck(frame, 'outputsOff');
  }

  async readNewData(): Promise<NewDataAnswer> {
    const msg = await this.opts.connection.sendCommand(encodeNewDataCommand());
    if (!(msg instanceof NewDataAnswer)) {
      throw new Error(`Unexpected reply to NewData: ${describe(msg)}`);
    }
    return msg;
  }

  async readPartitionsArmed(): Promise<Set<number>> {
    const msg = await this.opts.connection.sendCommand(encodeArmedPartitionsReallyCommand());
    assertKind(msg, ArmedPartitionsReallyAnswer, 'ArmedPartitionsReally');
    return flagsToIdSet(msg.flags);
  }

  async readPartitionsAlarm(): Promise<Set<number>> {
    const msg = await this.opts.connection.sendCommand(encodePartitionsAlarmCommand());
    assertKind(msg, PartitionsAlarmAnswer, 'PartitionsAlarm');
    return flagsToIdSet(msg.flags);
  }

  async readPartitionsArmedInMode2(): Promise<Set<number>> {
    const msg = await this.opts.connection.sendCommand(encodePartitionsArmedInMode2Command());
    assertKind(msg, PartitionsArmedInMode2Answer, 'PartitionsArmedInMode2');
    return flagsToIdSet(msg.flags);
  }

  async readPartitionsArmedInMode3(): Promise<Set<number>> {
    const msg = await this.opts.connection.sendCommand(encodePartitionsArmedInMode3Command());
    assertKind(msg, PartitionsArmedInMode3Answer, 'PartitionsArmedInMode3');
    return flagsToIdSet(msg.flags);
  }

  async readOutputsState(): Promise<Set<number>> {
    const encoder = this.opts.entityWidth === 256 ? encodeOutputsState256Command : encodeOutputsStateCommand;
    const msg = await this.opts.connection.sendCommand(encoder());
    assertKind(msg, OutputsStateAnswer, 'OutputsState');
    return flagsToIdSet(msg.flags);
  }

  async readZonesViolation(): Promise<Set<number>> {
    const encoder = this.opts.entityWidth === 256 ? encodeZonesViolation256Command : encodeZonesViolationCommand;
    const msg = await this.opts.connection.sendCommand(encoder());
    assertKind(msg, ZonesViolationAnswer, 'ZonesViolation');
    return flagsToIdSet(msg.flags);
  }

  private async sendAndCheck(frame: Buffer, op: string): Promise<void> {
    const msg = await this.opts.connection.sendCommand(frame);
    if (!(msg instanceof CommandResultAnswer)) {
      throw new Error(`Unexpected reply to ${op}: ${describe(msg)}`);
    }
    const { resultCode, resultMessage } = msg;
    const { OK, CommandAccepted } = CommandResultAnswer.ResultCodes;
    if (resultCode !== OK && resultCode !== CommandAccepted) {
      throw new SatelCommandError(op, resultCode, resultMessage);
    }
  }
}

export function chooseEntityWidth(maxId: number): EntityWidth {
  return maxId > 128 ? 256 : 128;
}

export function padUserCode(code: string): string {
  if (!/^[0-9a-fA-F]{1,16}$/.test(code)) {
    throw new Error('User code must be 1–16 hex characters (digits, typically).');
  }
  return (code + 'F'.repeat(16)).substring(0, 16);
}

function partitionsMask(ids: number[]): boolean[] {
  const mask = new Array<boolean>(32).fill(false);
  for (const id of ids) {
    if (id >= 1 && id <= 32) mask[id - 1] = true;
  }
  return mask;
}

function outputsMask(ids: number[], width: EntityWidth): boolean[] {
  const mask = new Array<boolean>(width).fill(false);
  for (const id of ids) {
    if (id >= 1 && id <= width) mask[id - 1] = true;
  }
  return mask;
}

function flagsToIdSet(flags: boolean[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) out.add(i + 1);
  }
  return out;
}

function assertKind<T extends FlagArrayAnswer>(
  msg: SatelMessage,
  ctor: new () => T,
  name: string,
): asserts msg is T {
  if (!(msg instanceof ctor)) {
    throw new Error(`Unexpected reply; expected ${name}, got ${describe(msg)}`);
  }
}

function describe(msg: SatelMessage): string {
  return (msg as { constructor: { name: string } }).constructor.name;
}
