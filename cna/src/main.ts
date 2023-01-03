import { Scribe, LogLevels } from "@lorekeepers-of-bellithriel/scribe";
import is from "@sindresorhus/is";
import esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs/promises";

// todo: move these types/enums/consts/functions into a separate package that's used by all cli-like apps
//#region temp config types
const LOB_CONFIG_FILE_ARG_NAME = "--config=";

const STANDARD_CONFIGURATION_FILES = [
    // programmatic config file
    "lob.config.js",
    // json config file
    "lob.json",
] as const;
type ConfigurationFiles = typeof STANDARD_CONFIGURATION_FILES[number];
const isConfigurationFiles = (value: unknown): value is ConfigurationFiles => {
    return STANDARD_CONFIGURATION_FILES.includes(value as ConfigurationFiles);
};

type ConfigurationFile = ConfigurationFiles | string;
const isConfigurationFile = (value: unknown): value is ConfigurationFile => {
    const val = value as ConfigurationFile;
    return isConfigurationFiles(val) || is.string(val);
};

type LobConfiguration = {
    incantations: Incantations;
};
const isLobConfiguration = (value: unknown): value is LobConfiguration => {
    const val = value as LobConfiguration;
    if (!is.nonEmptyObject(val)) return false;
    else if (!isIncantations(val.incantations)) return false;
    else return true;
};

type Incantations = {
    cna: CnaIncantation;
};
const isIncantations = (value: unknown): value is Incantations => {
    const val = value as Incantations;
    if (!is.nonEmptyObject(val)) return false;
    else if (!isCnaIncantation(val.cna)) return false;
    else return true;
};

type CnaIncantation = {
    rootDir: string;
};
const isCnaIncantation = (value: unknown): value is CnaIncantation => {
    const val = value as CnaIncantation;
    if (!is.nonEmptyObject(val)) return false;
    else if (!is.string(val.rootDir)) return false;
    else return true;
};

const fileExists = async (file: string): Promise<boolean> => {
    try {
        await fs.stat(file);
        return true;
    } catch (err) {
        // todo: remove error
        scribe.error(err);
        return false;
    }
};

const determineConfigurationFile = async (args: string[]): Promise<ConfigurationFile | null> => {
    const arg = args.find((arg) => arg.startsWith(LOB_CONFIG_FILE_ARG_NAME));
    if (!is.undefined(arg)) return arg.replace(LOB_CONFIG_FILE_ARG_NAME, "");
    for (const standardConfigFile of STANDARD_CONFIGURATION_FILES) {
        if (await fileExists(standardConfigFile)) return standardConfigFile;
    }
    return null;
};

const determineConfiguration = async (args: string[]): LobConfiguration => {
    const configFile = await determineConfigurationFile(args);
    // todo: implement
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

const determineAction = (args: string[]): Action | null => {
    for (const arg of args) if (isAction(arg)) return arg;
    return null;
};

const scribe = new Scribe({ level: LogLevels.All });

const setup = async () => {
    // todo: remove
    scribe.info("setup");
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
};

const dev = async () => {
    // todo: implement
    scribe.info("dev");
};

const build = async () => {
    // todo: implement
    scribe.info("build");
    try {
        const res = await esbuild.build({
            entryPoints: ["dev_cache/main.ts"],
            outfile: "dev_cache/main.js",
        });
        scribe.inspect("res", res);
    } catch (err) {
        scribe.error("build error", err);
    } finally {
        scribe.info("noice!");
    }
};

(async () => {
    const action = determineAction(process.argv);
    if (is.null_(action)) scribe.error("null action");
    else if (action === "setup") setup();
    else if (action === "dev") dev();
    else if (action === "build") build();
    else scribe.error(`unhandled action: ${action}`);
})();
