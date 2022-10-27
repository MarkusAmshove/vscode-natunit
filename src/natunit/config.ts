import { workspace } from 'vscode';
export interface NatUnitConfig {
    readonly linuxScript: string;
    readonly windowsScript: string;
    readonly natparms: string[];
    readonly currentNatparm: string;
}

export let natunitConfig: NatUnitConfig;

export function reloadConfiguration() {
    const section = workspace.getConfiguration("natunit");
    const natparms = section.get<string[]>("natparms") || []
    natunitConfig = {
        linuxScript: section.get<string>("script.linux")!,
        windowsScript: section.get<string>("script.windows")!,
        natparms: natparms,
        currentNatparm: natparms.length > 0 ? natparms[0] : "No NATPARM",
    };
};

export function setNatparm(natparm: string) {
    natunitConfig = {
        ...natunitConfig,
        currentNatparm: natparm
    };
}