import { Scribe, LogLevels } from "@lorekeepers-of-bellithriel/scribe";
import { Except, MergeExclusive, PartialDeep, TsConfigJson, ValueOf } from "type-fest";
import lodashMerge from "lodash.merge";
import is from "@sindresorhus/is";
import fs from "node:fs/promises";
import esb from "esbuild";
import path from "node:path";
import {
    parse as JsoncParse,
    ParseError as JsoncParseError,
    printParseErrorCode as getJsoncErrorCode,
    //
} from "jsonc-parser";
import originalGlob from "glob";
import { promisify } from "util";
// import ts from "typescript";
import { createProject, ts } from "@ts-morph/bootstrap";

const glob = promisify(originalGlob);

const jsonStringify = (json: Record<string, unknown>): string => {
    return JSON.stringify(json, undefined, 4);
};

// todo: move these types/enums/consts/functions into a separate package that's used by all lob cli-like apps (like incantations)
//#region temp config types

//#region lib
const LOB_CONFIG_FILE_ARG_NAME = "--config=";

enum StandardConfigurationFiles {
    Programmatic = "lob.config.js",
    Json = "lob.json",
}
export const isStandardConfigurationFiles = (value: unknown): value is StandardConfigurationFiles => {
    return Object.values(StandardConfigurationFiles).includes(value as StandardConfigurationFiles);
};

type NonEmptyStringArray = [string, ...string[]];
export const isNonEmptyStringArray = (value: unknown): value is NonEmptyStringArray => {
    return is.array(value, is.string) && value.length > 0;
};
//#endregion

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
                root: ".",
                source: "main.ts",
                dist: ".",
            },
        },
    };
};
type RawLobConfiguration = PartialDeep<LobConfiguration>;
const isRawLobConfiguration = (value: unknown): value is RawLobConfiguration => {
    const val = value as RawLobConfiguration;
    if (!is.plainObject(val)) return false;
    else if (!is.any([is.undefined, isRawIncantations], val.incantations)) return false;
    else return true;
};

type Incantations = {
    cna: CnaIncantation;
};
type RawIncantations = PartialDeep<Incantations>;
const isRawIncantations = (value: unknown): value is RawIncantations => {
    const val = value as RawIncantations;
    if (!is.plainObject(val)) return false;
    else if (!is.any([is.undefined, isRawCnaIncantation], val.cna)) return false;
    else return true;
};

type CnaIncantationSource = string | NonEmptyStringArray;
export const isCnaIncantationSource = (value: unknown): value is CnaIncantationSource => {
    return is.string(value) || isNonEmptyStringArray(value);
};
type CnaIncantation = {
    root: string;
    source: CnaIncantationSource;
    dist: string;
};
type RawCnaIncantation = PartialDeep<CnaIncantation>;
const isRawCnaIncantation = (value: unknown): value is RawCnaIncantation => {
    const val = value as RawCnaIncantation;
    if (!is.plainObject(val)) return false;
    else if (!is.any([is.undefined, is.string], val.root)) return false;
    else if (!is.any([is.undefined, isCnaIncantationSource], val.source)) return false;
    else if (!is.any([is.undefined, is.string], val.dist)) return false;
    else return true;
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
        let config: unknown;
        try {
            const buf = await fs.readFile(file);
            const errors: JsoncParseError[] = [];
            const raw = buf.toString();
            config = JsoncParse(raw, errors, {
                allowTrailingComma: true,
            });
            if (errors.length !== 0) {
                for (const e of errors) {
                    const code = getJsoncErrorCode(e.error);
                    let line = 1;
                    let column = 1;
                    for (let i = 0; i < raw.length; i++) {
                        if (i === e.offset) break;
                        if (raw[i] === "\n") {
                            line++;
                            column = 1;
                        } else {
                            column++;
                        }
                    }
                    scribe.error(prefix, `${code} at line ${line} and column ${column}`);
                }
                return null;
            }
        } catch (err) {
            scribe.error(prefix, err);
            return null;
        }
        if (!isRawLobConfiguration(config)) {
            scribe.error(prefix, "incorrect json configuration file structure in", file);
            return null;
        }
        const def = defaultLobConfiguration();
        return lodashMerge(def, config);
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

const TS_CONFIG_JSON_FILE_NAME = "tsconfig.json";
const MAIN_TS_CONFIG_JSON: TsConfigJson = {
    compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Node",
        lib: ["ESNext"],
        strict: true,
        importHelpers: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noImplicitAny: true,
        noImplicitReturns: true,
        resolveJsonModule: true,
        // todo: test and either enable later or remove completely
        // allowJs: true,
        // todo: enable this option when cna-incantation is used to develop itself
        // noEmit: true,
        declaration: true,
        emitDeclarationOnly: true,
        declarationMap: true,
        isolatedModules: true,
        types: ["node"],
        baseUrl: "..",
        paths: {
            "@/*": ["*"],
        },
    },
    include: ["../**/*"],
    exclude: ["../dist"],
};
const SUB_TS_CONFIG_JSON: TsConfigJson = {
    extends: `./${MAIN_DIR_NAME}/${TS_CONFIG_JSON_FILE_NAME}`,
};

// todo: remove
// const MAIN_TS_COMPILER_OPTIONS: ts.CompilerOptions = {
//     target: ts.ScriptTarget.ESNext,
//     module: ts.ModuleKind.ESNext,
//     moduleResolution: ts.ModuleResolutionKind.NodeJs,
//     lib: ["ESNext"],
//     strict: true,
//     importHelpers: true,
//     skipLibCheck: true,
//     esModuleInterop: true,
//     noImplicitAny: true,
//     noImplicitReturns: true,
//     resolveJsonModule: true,
//     declaration: true,
//     emitDeclarationOnly: true,
//     isolatedModules: true,
//     declarationMap: true,
//     types: ["node"],
//     baseUrl: "..",
//     paths: {
//         "@/*": ["*"],
//     },
// };

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
    const infoFile = path.join(MAIN_DIR_NAME, INFO_FILE_NAME);
    // todo: when package json name/version/description/other injection is implemented
    // todo: and cna-incantation is used to create itself, add the name and version
    // todo: to the data below \/_\/_\/
    const infoFileData = `name: \nversion: \n`;
    const mainTsConfigJsonFile = path.join(MAIN_DIR_NAME, TS_CONFIG_JSON_FILE_NAME);
    const mainTsConfigJsonData = jsonStringify(MAIN_TS_CONFIG_JSON);
    const subTsConfigJsonFile = TS_CONFIG_JSON_FILE_NAME;
    const subTsConfigJsonData = jsonStringify(SUB_TS_CONFIG_JSON);
    try {
        await fs.mkdir(MAIN_DIR_NAME, { recursive: true });
        await fs.writeFile(infoFile, infoFileData);
        await fs.writeFile(mainTsConfigJsonFile, mainTsConfigJsonData);
        await fs.writeFile(subTsConfigJsonFile, subTsConfigJsonData);
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
    const root = config.incantations.cna.root;
    const source = config.incantations.cna.source;
    const dist = config.incantations.cna.dist;
    let entryPoints: NonEmptyStringArray;
    const resolveGlobPattern = async (source: string): Promise<NonEmptyStringArray | null> => {
        const pattern = `${root}/${source}`;
        if (source.includes("*")) {
            const matches = await glob(pattern);
            if (!isNonEmptyStringArray(matches)) {
                scribe.error(prefix, `no files match the pattern '${pattern}'`);
                return null;
            }
            return matches;
        } else {
            return [pattern];
        }
    };
    if (is.string(source)) {
        const files = await resolveGlobPattern(source);
        if (is.null_(files)) return;
        entryPoints = files;
    } else {
        let i = 0;
        const files = await resolveGlobPattern(source[i]);
        if (is.null_(files)) return;
        entryPoints = files;
        while (++i < source.length) {
            const files = await resolveGlobPattern(source[i]);
            if (is.null_(files)) return;
            entryPoints.push(...files);
        }
        // remove duplicates
        entryPoints = [...new Set(entryPoints)] as NonEmptyStringArray;
    }
    const outdir = path.join(root, dist);
    // todo: remove
    scribe.inspect("entry points", entryPoints);
    try {
        const esbRes = await esb.build({
            entryPoints: entryPoints,
            outdir: outdir,
            bundle: true,
            minify: true,
            treeShaking: true,
            sourcemap: "external",
            outExtension: { ".js": ".cjs" },
            // watch: true,
        });
        // todo: remove
        scribe.inspect("res", esbRes);
        // todo: create types
        compile();
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

// todo: remove
const compile = async () => {
    const project = await createProject();
};
// const kappaCompile = (fileNames: string[], options: ts.CompilerOptions): void => {
//     // Create a Program with an in-memory emit
//     const createdFiles: Record<string, any> = {};
//     const host = ts.createCompilerHost({});
//     host.writeFile = (fileName: string, contents: string) => (createdFiles[fileName] = contents);
//     // Prepare and emit the d.ts files
//     const program = ts.createProgram(fileNames, options, host);
//     program.emit();
//     // Loop through all the input files
//     fileNames.forEach((file) => {
//         scribe.info("file", file);
//         const dts = file.replace(".js", ".d.ts");
//         scribe.info("dts", createdFiles[dts]);
//     });
// };
