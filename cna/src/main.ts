import { Scribe, LogLevels } from "@lorekeepers-of-bellithriel/scribe";
import { MergeExclusive, PartialDeep, TsConfigJson } from "type-fest";
import lodashMerge from "lodash.merge";
import is from "@sindresorhus/is";
import fs from "node:fs/promises";
import { promisify } from "util";
import path from "node:path";
import ts from "typescript";
import esb from "esbuild";
import glob from "glob";
import {
    printParseErrorCode as getJsoncErrorCode,
    ParseError as JsoncParseError,
    parse as JsoncParse,
    //
} from "jsonc-parser";

const listFiles = promisify(glob);

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
                container: false,
                bin: false,
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
    container: boolean;
    bin: boolean;
};
type RawCnaIncantation = PartialDeep<CnaIncantation>;
const isRawCnaIncantation = (value: unknown): value is RawCnaIncantation => {
    const val = value as RawCnaIncantation;
    if (!is.plainObject(val)) return false;
    else if (!is.any([is.undefined, is.string], val.root)) return false;
    else if (!is.any([is.undefined, isCnaIncantationSource], val.source)) return false;
    else if (!is.any([is.undefined, is.string], val.dist)) return false;
    else if (!is.any([is.undefined, is.boolean], val.container)) return false;
    else if (!is.any([is.undefined, is.boolean], val.bin)) return false;
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

const determineConfiguration = async (options: Options): Promise<LobConfiguration | null> => {
    // no config file available, use default configuration
    if (is.null_(options.configFile)) return defaultLobConfiguration();
    const prefix = "could not determine configuration";
    const file = path.resolve(
        options.configFile.custom === undefined
            ? options.configFile.standard //
            : options.configFile.custom
    );
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

const DEBUG_MODES = ["db", "debug-mode", "debugMode"];
const isDebugMode = (value: unknown): boolean => {
    for (const debugMode of DEBUG_MODES) {
        if (value === debugMode) return true;
        else if (value === debugMode.toLowerCase()) return true;
        else if (value === debugMode.toUpperCase()) return true;
        else continue;
    }
    return false;
};

type Options = {
    action: Action;
    debugMode: boolean;
    configFile: ConfigurationFile | null;
};

const MAIN_DIR_NAME = ".lob";
const CACHE_DIR_NAME = "cache";
const ESM_DIR_NAME = "esm";
const CJS_DIR_NAME = "cjs";
const INFO_FILE_NAME = "info.yaml";

const TYPESCRIPT_DIAGNOSTICS_CUSTOM_NEW_LINE_TOKEN = "\n\t";

const TS_CONFIG_JSON_FILE_NAME = "tsconfig.json";
const mainTsConfigJson = (): TsConfigJson => ({
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
        isolatedModules: true,
        types: ["node"],
        baseUrl: "..",
        paths: {
            // todo: add more conventions here, like `components` etc
            "@/*": ["*"],
        },
    },
    include: ["../**/*"],
    exclude: ["../dist"],
});
const subTsConfigJson = (): TsConfigJson => ({
    extends: `./${MAIN_DIR_NAME}/${TS_CONFIG_JSON_FILE_NAME}`,
});

const DOCKERFILE_FILE_NAME = "dockerfile";
const mainDockerfileFile = (name: string): string => `FROM node

# app lives here
WORKDIR /${name}

# project dependencies
COPY ./.yarn/releases ./.yarn/releases
COPY ./package.json ./
COPY ./.yarnrc.yml ./
COPY ./yarn.lock ./

# project (compiled) source
COPY ./${MAIN_DIR_NAME}/${CACHE_DIR_NAME}/${ESM_DIR_NAME} ./kernel/js

# install dependencies
RUN corepack enable
RUN yarn plugin import workspace-tools
RUN yarn workspaces focus --production

# run the app
ENTRYPOINT ["node", "kernel/js/main.js"]
`;

type UsefulPackageJsonInfo = {
    name: string;
    version: string;
};
const readUsefulPackageJsonInfo = async (): Promise<UsefulPackageJsonInfo | null> => {
    const prefix = "read useful package json info:";
    let packageJson: Record<string, unknown>;
    try {
        const raw = await fs.readFile("package.json");
        const parsed = JSON.parse(raw.toString());
        if (!is.nonEmptyObject(parsed)) {
            scribe.error(prefix, "package json is not a non-empty object");
            return null;
        }
        packageJson = parsed;
    } catch (err) {
        scribe.error(prefix, err);
        return null;
    }
    const name = packageJson.name;
    if (!is.string(name)) {
        scribe.error(prefix, `name is not a string (${name})`);
        return null;
    }
    const version = packageJson.version;
    if (!is.string(version)) {
        scribe.error(prefix, `version is not a string (${version})`);
        return null;
    }
    return { name, version };
};

const determineOptions = async (args: string[]): Promise<Options | null> => {
    let debugMode: boolean = false;
    let action: Action | null = null;
    let configFile: ConfigurationFile | null = null;
    for (const arg of args) {
        if (isDebugMode(arg)) debugMode = true;
        else if (isAction(arg)) action = arg;
        else if (arg.startsWith(LOB_CONFIG_FILE_ARG_NAME)) {
            configFile = { custom: arg.replace(LOB_CONFIG_FILE_ARG_NAME, "") };
        }
    }
    if (debugMode) scribe.configure({ level: LogLevels.All });
    if (!action) {
        scribe.error("null action");
        return null;
    }
    if (!configFile) {
        for (const standardConfigFile of Object.values(StandardConfigurationFiles)) {
            if (await fileExists(standardConfigFile)) {
                configFile = { standard: standardConfigFile };
                break;
            }
        }
    }
    return { debugMode, action, configFile };
};

type ActionFunction = (config: LobConfiguration, usefulPackageJsonInfo: UsefulPackageJsonInfo) => Promise<void>;

type TsCommons = {
    compilerOptions: ts.CompilerOptions;
};

const scribe = new Scribe({ level: LogLevels.None });

const setup: ActionFunction = async (config, usefulPackageJsonInfo) => {
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
    const mainTsConfigJsonData = jsonStringify(mainTsConfigJson());
    const subTsConfigJsonFile = TS_CONFIG_JSON_FILE_NAME;
    const subTsConfigJsonData = jsonStringify(subTsConfigJson());
    const mainDockerfile = path.join(MAIN_DIR_NAME, DOCKERFILE_FILE_NAME);
    const mainDockerfileData = mainDockerfileFile(usefulPackageJsonInfo.name);
    try {
        await fs.mkdir(MAIN_DIR_NAME, { recursive: true });
        await fs.writeFile(infoFile, infoFileData);
        await fs.writeFile(mainTsConfigJsonFile, mainTsConfigJsonData);
        await fs.writeFile(subTsConfigJsonFile, subTsConfigJsonData);
        await fs.writeFile(mainDockerfile, mainDockerfileData);
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
    if (is.string(source)) {
        entryPoints = [path.join(root, source)];
    } else {
        entryPoints = ["", ""];
        for (const file of source) {
            entryPoints.push(path.join(root, file));
        }
        // remove duplicates
        entryPoints = [...new Set(entryPoints)] as NonEmptyStringArray;
    }
    const outDir = path.join(root, dist);
    // todo: remove
    scribe.inspect("entry points", entryPoints);
    const tsc = tsCommons();
    if (is.null_(tsc)) return;
    await esBuild(entryPoints, outDir);
    tsCompile(entryPoints, outDir, tsc);
    tsTypeCheck(entryPoints, tsc);
};

const esBuild = async (entryPoints: NonEmptyStringArray, outdir: string) => {
    const options: esb.BuildOptions = {
        entryPoints: entryPoints,
        outdir: outdir,
        platform: "node",
        bundle: true,
        minify: true,
        color: true,
        treeShaking: true,
        sourcemap: "external",
        format: "esm",
        // outExtension: { ".js": ".cjs" },
        // external: [...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.devDependencies || {})],
    };
    try {
        const esbRes = await esb.build(options);
        // todo: remove
        scribe.inspect("res", esbRes);
    } catch (err) {
        scribe.error("build error", err);
    }
};

/**
 * Common features and data used by typescript related methods.
 */
const tsCommons = (): TsCommons | null => {
    // read the tsconfig.json file
    const rawJsonConfig = ts.readConfigFile(TS_CONFIG_JSON_FILE_NAME, ts.sys.readFile);
    if (rawJsonConfig.error) {
        scribe.error("couldn't read typescript configuration file:", rawJsonConfig.error.messageText);
        scribe.inspect("raw error object", rawJsonConfig.error);
        return null;
    }
    // parse the tsconfig.json file
    const parsedJsonConfig = ts.parseJsonConfigFileContent(rawJsonConfig.config, ts.sys, process.cwd());
    if (parsedJsonConfig.errors.length) {
        scribe.error("couldn't parse typescript configuration file:");
        parsedJsonConfig.errors.forEach((e) => {
            scribe.error("-", e.messageText);
            scribe.inspect("raw error object", e);
        });
        return null;
    }
    // assemble all the typescript common pieces
    return { compilerOptions: parsedJsonConfig.options };
};
const tsCompile = (entryPoints: NonEmptyStringArray, dist: string, tsc: TsCommons) => {
    const options: ts.CompilerOptions = {
        // w/e the user configured typescript with
        ...tsc.compilerOptions,
        // the minimal options needed for typescript to create .d.ts files
        // we cannot and should not force the user to put these options in
        // the tsconfig.json file, they sometimes affect the code editor
        allowJs: true,
        declaration: true,
        declarationMap: true,
        emitDeclarationOnly: true,
    };
    const fileNames: string[] = [];
    for (const entryPoint of entryPoints) {
        const fileName = path.parse(entryPoint).name;
        fileNames.push(`${path.join(dist, fileName)}.js`);
    }
    // todo: remove
    scribe.inspect("fileNames", fileNames);
    const host = ts.createCompilerHost(options);
    host.writeFile = (file, data) => fs.writeFile(file, data);
    const program = ts.createProgram(fileNames, options, host);
    program.emit();
};
const tsTypeCheck = (entryPoints: NonEmptyStringArray, tsc: TsCommons) => {
    const options: ts.CompilerOptions = {
        // w/e the user configured typescript with
        ...tsc.compilerOptions,
        // the minimal options needed for typescript to type check .ts files
        // we cannot and should not force the user to put these options in
        // the tsconfig.json file, they sometimes affect the code editor
        noEmit: true,
    };
    const host = ts.createCompilerHost(options);
    const program = ts.createProgram(entryPoints, options, host);
    const emitResult = program.emit();
    const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
    if (diagnostics.length) {
        const formattedDiagnostics = ts
            .formatDiagnosticsWithColorAndContext(diagnostics, {
                getCurrentDirectory: () => process.cwd(),
                getNewLine: () => TYPESCRIPT_DIAGNOSTICS_CUSTOM_NEW_LINE_TOKEN,
                getCanonicalFileName: (fileName) => fileName,
            })
            .trim();
        const postfix = `Number of errors: ${diagnostics.length}`;
        const errorMessage = `${TYPESCRIPT_DIAGNOSTICS_CUSTOM_NEW_LINE_TOKEN}${formattedDiagnostics}\n\n${postfix}\n`;
        console.error(errorMessage);
    }
};

const handleAction = async (options: Options, lobConfig: LobConfiguration, usefulPackageJsonInfo: UsefulPackageJsonInfo) => {
    if (options.action === "setup") await setup(lobConfig, usefulPackageJsonInfo);
    else if (options.action === "dev") await dev(lobConfig, usefulPackageJsonInfo);
    else if (options.action === "build") await build(lobConfig, usefulPackageJsonInfo);
    else scribe.error(`unhandled action: ${options.action}`);
};

(async () => {
    const options = await determineOptions(process.argv);
    if (is.null_(options)) return;
    const lobConfig = await determineConfiguration(options);
    if (is.null_(lobConfig)) return;
    const usefulPackageJsonInfo = await readUsefulPackageJsonInfo();
    if (is.null_(usefulPackageJsonInfo)) return;
    await handleAction(options, lobConfig, usefulPackageJsonInfo);
})();
