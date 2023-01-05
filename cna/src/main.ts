import { Scribe, LogLevels } from "@lorekeepers-of-bellithriel/scribe";
import { MergeExclusive, RequireAtLeastOne } from "type-fest";
import lodashMerge from "lodash.merge";
import is from "@sindresorhus/is";
import fs from "node:fs/promises";
import esbuild from "esbuild";
import path from "node:path";

// todo: move these types/enums/consts/functions into a separate package that's used by all cli-like apps
//#region temp config types
const LOB_CONFIG_FILE_ARG_NAME = "--config=";

enum StandardConfigurationFiles {
    Programmatic = "lob.config.js",
    Json = "lob.json",
}
export const isStandardConfigurationFiles = (value: unknown): value is StandardConfigurationFiles => {
    return Object.values(StandardConfigurationFiles).includes(value as StandardConfigurationFiles);
};

type StandardConfigurationFile = { standard: StandardConfigurationFiles };
type CustomConfigurationFile = { custom: string };
type ConfigurationFile = MergeExclusive<StandardConfigurationFile, CustomConfigurationFile>;

type LobConfiguration = {
    incantations: Incantations;
};
const defaultLobConfiguration = (): LobConfiguration => {
    return {
        incantations: {
            cna: {
                source: ".",
                dist: ".",
            },
        },
    };
};
type RawLobConfiguration = RequireAtLeastOne<{
    incantations: RawIncantations;
}>;
const isRawLobConfiguration = (value: unknown): value is RawLobConfiguration => {
    const val = value as RawLobConfiguration;
    if (!is.nonEmptyObject(val)) return false;
    let count = 0;
    if (!is.undefined(val.incantations)) {
        if (!isRawIncantations(val.incantations)) return false;
        count++;
    }
    return count !== 0;
};

type Incantations = {
    cna: CnaIncantation;
};
type RawIncantations = RequireAtLeastOne<{
    cna: RawCnaIncantation;
}>;
const isRawIncantations = (value: unknown): value is RawIncantations => {
    const val = value as RawIncantations;
    if (!is.nonEmptyObject(val)) return false;
    let count = 0;
    if (!is.undefined(val.cna)) {
        if (!isRawCnaIncantation(val.cna)) return false;
        count++;
    }
    return count !== 0;
};

type CnaIncantation = {
    source: string;
    dist: string;
};
type RawCnaIncantation = RequireAtLeastOne<CnaIncantation>;
const isRawCnaIncantation = (value: unknown): value is RawCnaIncantation => {
    const val = value as RawCnaIncantation;
    if (!is.nonEmptyObject(val)) return false;
    let count = 0;
    if (!is.undefined(val.source)) {
        if (!is.string(val.source)) return false;
        count++;
    }
    if (!is.undefined(val.dist)) {
        if (!is.string(val.dist)) return false;
        count++;
    }
    return count !== 0;
};

const fileExists = async (file: string): Promise<boolean> => {
    try {
        await fs.stat(file);
        return true;
    } catch (err) {
        return false;
    }
};

const determineConfigurationFile = async (args: string[]): Promise<ConfigurationFile | null> => {
    const arg = args.find((arg) => arg.startsWith(LOB_CONFIG_FILE_ARG_NAME));
    if (!is.undefined(arg)) return { custom: arg.replace(LOB_CONFIG_FILE_ARG_NAME, "") };
    for (const standardConfigFile of Object.values(StandardConfigurationFiles)) {
        if (await fileExists(standardConfigFile)) return { standard: standardConfigFile };
    }
    return null;
};

const determineConfiguration = async (args: string[]): Promise<LobConfiguration | null> => {
    const configFile = await determineConfigurationFile(args);
    // no config file available, use default configuration
    if (is.null_(configFile)) return defaultLobConfiguration();
    const prefix = "could not determine configuration";
    const file = path.resolve(configFile.custom === undefined ? configFile.standard : configFile.custom);
    if (file.endsWith(".js")) {
        scribe.error(prefix, "programmatic configuration file is not supported yet, try using a json configuration file instead");
        return null;
    } else if (file.endsWith(".json")) {
        let raw: unknown;
        try {
            const buf = await fs.readFile(file);
            raw = JSON.parse(buf.toString());
        } catch (err) {
            scribe.error(prefix, err);
            return null;
        }
        if (!isRawLobConfiguration(raw)) {
            scribe.error(prefix, "incorrect json configuration file structure in", file);
            return null;
        }
        const def = defaultLobConfiguration();
        return lodashMerge(def, raw);
    } else {
        scribe.error(prefix, "unknown configuration file extension in", file);
        return null;
    }
};
//#endregion

const ACTIONS = [
    "setup",
    "dev",
    "build",
    //
] as const;
type Action = typeof ACTIONS[number];
const isAction = (value: unknown): value is Action => {
    return ACTIONS.includes(value as Action);
};

const MAIN_DIR_NAME = ".lob";
const INFO_FILE_NAME = "info.yaml";

type ActionFunction = (config: LobConfiguration) => void;

const determineAction = (args: string[]): Action | null => {
    for (const arg of args) if (isAction(arg)) return arg;
    scribe.error("null action");
    return null;
};

const scribe = new Scribe({ level: LogLevels.All });

const setup: ActionFunction = async (config) => {
    // todo: remove
    scribe.info("setup");
    const prefix = "setup:";
    // creating the main directory that will host
    // all the necessary files during development
    const name = path.join(MAIN_DIR_NAME, INFO_FILE_NAME);
    // todo: when package json name/version/description/other injection is implemented
    // todo: and cna-incantation is used to create itself, add the name and version
    // todo: to the data below \/_\/_\/
    const data = `name: \nversion: \n`;
    try {
        await fs.mkdir(MAIN_DIR_NAME, { recursive: true });
        await fs.writeFile(name, data);
    } catch (err) {
        scribe.error("error during setup", err);
    }
    // todo: force type module in package.json
};

const dev: ActionFunction = async (config) => {
    // todo: remove
    scribe.info("dev");
    const prefix = "dev:";
};

const build: ActionFunction = async (config) => {
    // todo: remove
    scribe.info("build");
    const prefix = "build:";
    const source = path.resolve(config.incantations.cna.source);
    const dist = path.resolve(config.incantations.cna.dist);
    // todo: remove
    scribe.inspect("source", source);
    try {
        const res = await esbuild.build({
            entryPoints: [source],
            outdir: dist,
        });
        scribe.inspect("res", res);
    } catch (err) {
        scribe.error("build error", err);
    } finally {
        scribe.info("noice!");
    }
};

(async () => {
    const config = await determineConfiguration(process.argv);
    if (is.null_(config)) return;
    const action = determineAction(process.argv);
    if (is.null_(action)) return;
    else if (action === "setup") setup(config);
    else if (action === "dev") dev(config);
    else if (action === "build") build(config);
    else scribe.error(`unhandled action: ${action}`);
})();
