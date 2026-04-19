declare module 'satel-integra-integration-protocol' {
  export class FlagArrayAnswer {
    decode(frame: Buffer): boolean;
    readonly flags: boolean[];
  }

  export class ZonesViolationAnswer extends FlagArrayAnswer {}
  export class ZonesTamperAnswer extends FlagArrayAnswer {}
  export class ZonesAlarmAnswer extends FlagArrayAnswer {}
  export class ZonesTamperAlarmAnswer extends FlagArrayAnswer {}
  export class ZonesAlarmMemoryAnswer extends FlagArrayAnswer {}
  export class ZonesTamperAlarmMemoryAnswer extends FlagArrayAnswer {}
  export class ZonesBypassStatusAnswer extends FlagArrayAnswer {}
  export class ZonesNoViolationTroubleAnswer extends FlagArrayAnswer {}
  export class ZonesLongViolationTroubleAnswer extends FlagArrayAnswer {}
  export class ZonesIsolateStateAnswer extends FlagArrayAnswer {}
  export class ZonesMaskedAnswer extends FlagArrayAnswer {}
  export class ZonesMaskedMemoryAnswer extends FlagArrayAnswer {}
  export class OutputsStateAnswer extends FlagArrayAnswer {}
  export class ArmedPartitionsSuppressedAnswer extends FlagArrayAnswer {}
  export class ArmedPartitionsReallyAnswer extends FlagArrayAnswer {}
  export class PartitionsArmedInMode2Answer extends FlagArrayAnswer {}
  export class PartitionsArmedInMode3Answer extends FlagArrayAnswer {}
  export class PartitionsWith1stCodeEnteredAnswer extends FlagArrayAnswer {}
  export class PartitionsEntryTimeAnswer extends FlagArrayAnswer {}
  export class PartitionsExitTimeMoreThen10sAnswer extends FlagArrayAnswer {}
  export class PartitionsExitTimeLessThen10sAnswer extends FlagArrayAnswer {}
  export class PartitionsTemporaryBlockedAnswer extends FlagArrayAnswer {}
  export class PartitionsBlockedForGuardRoundAnswer extends FlagArrayAnswer {}
  export class PartitionsAlarmAnswer extends FlagArrayAnswer {}
  export class PartitionsFireAlarmAnswer extends FlagArrayAnswer {}
  export class PartitionsAlarmMemoryAnswer extends FlagArrayAnswer {}
  export class PartitionsFireAlarmMemoryAnswer extends FlagArrayAnswer {}

  export class NewDataAnswer extends FlagArrayAnswer {
    zonesViolationChanged(): boolean;
    zonesTamperChanged(): boolean;
    zonesAlarmChanged(): boolean;
    zonesTamperAlarmChanged(): boolean;
    zonesAlarmMemoryChanged(): boolean;
    zonesTamperAlarmMemoryChanged(): boolean;
    zonesBypassStatusChanged(): boolean;
    zonesNoViolationTroubleChanged(): boolean;
    zonesLongViolationTroubleChanged(): boolean;
    armedPartitionsSuppressedChanged(): boolean;
    armedPartitionsReallyChanged(): boolean;
    partitionsArmedInMode2Changed(): boolean;
    partitionsArmedInMode3Changed(): boolean;
    partitionsWith1stCodeEnteredChanged(): boolean;
    partitionsEntryTimeChanged(): boolean;
    partitionsExitTimeMoreThen10sChanged(): boolean;
    partitionsExitTimeLessThen10sChanged(): boolean;
    partitionsTemporaryBlockedChanged(): boolean;
    partitionsBlockedForGuardRoundChanged(): boolean;
    partitionsAlarmChanged(): boolean;
    partitionsFireAlarmChanged(): boolean;
    partitionsAlarmMemoryChanged(): boolean;
    partitionsFireAlarmMemoryChanged(): boolean;
    outputsStateChanged(): boolean;
    zonesIsolateStateChanged(): boolean;
    zonesMaskedChanged(): boolean;
    zonesMaskedMemoryChanged(): boolean;
  }

  export class CommandResultAnswer {
    decode(frame: Buffer): boolean;
    readonly resultCode: number;
    readonly resultMessage: string;
    static ResultCodes: {
      OK: number;
      UserCodeNotFound: number;
      NoAccess: number;
      UserDoesNotExist: number;
      UserAlreadyExists: number;
      WrongOrAlreadyExistingCode: number;
      TelephoneCodeAlreadyExists: number;
      ChangedCodeIsTheSame: number;
      OtherError: number;
      CannotArmButCanForceArm: number;
      CannotArm: number;
      CommandAccepted: number;
    };
  }

  export type SatelMessage =
    | FlagArrayAnswer
    | NewDataAnswer
    | CommandResultAnswer;

  export function decodeMessage(frame: Buffer): SatelMessage | null;

  export function encodeNewDataCommand(): Buffer;
  export function encodeZonesViolationCommand(): Buffer;
  export function encodeZonesViolation256Command(): Buffer;
  export function encodeZonesTamperCommand(): Buffer;
  export function encodeZonesTamper256Command(): Buffer;
  export function encodeZonesAlarmCommand(): Buffer;
  export function encodeZonesAlarm256Command(): Buffer;
  export function encodeOutputsStateCommand(): Buffer;
  export function encodeOutputsState256Command(): Buffer;
  export function encodeArmedPartitionsReallyCommand(): Buffer;
  export function encodeArmedPartitionsSuppressedCommand(): Buffer;
  export function encodePartitionsArmedInMode2Command(): Buffer;
  export function encodePartitionsArmedInMode3Command(): Buffer;
  export function encodePartitionsAlarmCommand(): Buffer;
  export function encodePartitionsAlarmMemoryCommand(): Buffer;
  export function encodePartitionsFireAlarmCommand(): Buffer;

  export function encodeArmInMode0Command(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeArmInMode1Command(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeArmInMode2Command(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeArmInMode3Command(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeDisarmCommand(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeClearAlarmCommand(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeForceArmInMode0Command(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeForceArmInMode1Command(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeForceArmInMode2Command(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeForceArmInMode3Command(prefixAndUserCode: string, partitions: boolean[]): Buffer;
  export function encodeOutputsOnCommand(prefixAndUserCode: string, outputs: boolean[]): Buffer;
  export function encodeOutputsOffCommand(prefixAndUserCode: string, outputs: boolean[]): Buffer;
  export function encodeOutputsSwitchCommand(prefixAndUserCode: string, outputs: boolean[]): Buffer;
}
