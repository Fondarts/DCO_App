declare module "mogrt" {
  export class Mogrt {
    constructor(filename: string);
    init(): Promise<void>;
    isAfterEffects(): boolean;
    isPremiere(): boolean;
    getEssentialFields(flattened?: boolean): unknown;
    getManifest(flattened?: boolean): Promise<Record<string, unknown>>;
    extractTo(toPath: string): Promise<string[]>;
  }
}
