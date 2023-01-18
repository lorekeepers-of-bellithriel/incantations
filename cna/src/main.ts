import { Scribe, LogLevels } from "@lorekeepers-of-bellithriel/scribe";
import { Except, MergeExclusive, PackageJson, PartialDeep, TsConfigJson, ValueOf } from "type-fest";
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
import tsMorph from "ts-morph";
import ts from "typescript";

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
const CACHE_DIR_NAME = "cache";
const ESM_DIR_NAME = "esm";
const CJS_DIR_NAME = "cjs";
const INFO_FILE_NAME = "info.yaml";

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

const determineAction = (args: string[]): Action | null => {
    for (const arg of args) if (isAction(arg)) return arg;
    scribe.error("null action");
    return null;
};

type ActionFunction = (config: LobConfiguration, usefulPackageJsonInfo: UsefulPackageJsonInfo) => void;

const scribe = new Scribe({ level: LogLevels.All });

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
    const outdir = path.join(root, dist);
    // todo: remove
    scribe.inspect("entry points", entryPoints);
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
    };
    try {
        // todo: restore when typescript is implemented
        const esbRes = await esb.build(options);
        // todo: remove
        scribe.inspect("res", esbRes);
        // todo: create types
        // for (const entryPoint of entryPoints) compile(entryPoint, outdir);
        compile(entryPoints, outdir);
    } catch (err) {
        scribe.error("build error", err);
    } finally {
        scribe.info("noice!");
    }
};

(async () => {
    const usefulPackageJsonInfo = await readUsefulPackageJsonInfo();
    if (is.null_(usefulPackageJsonInfo)) return;
    const config = await determineConfiguration(process.argv);
    if (is.null_(config)) return;
    const action = determineAction(process.argv);
    if (is.null_(action)) return;
    else if (action === "setup") setup(config, usefulPackageJsonInfo);
    else if (action === "dev") dev(config, usefulPackageJsonInfo);
    else if (action === "build") build(config, usefulPackageJsonInfo);
    else scribe.error(`unhandled action: ${action}`);
})();

// todo: remove
// const compile = async (entryPoint: string, dist: string) => {
//     const file = path.parse(entryPoint).name;
//     const outFile = path.join(dist, file);
//     const project = new tsMorph.Project({
//         tsConfigFilePath: TS_CONFIG_JSON_FILE_NAME,
//         compilerOptions: { outFile, allowJs: true },
//     });
//     const sourceFilesFromTsConfig = project.getSourceFiles();
//     sourceFilesFromTsConfig.forEach((s) => project.removeSourceFile(s));
//     project.addSourceFileAtPath(entryPoint);
//     // todo: remove
//     const skata = project.getSourceFiles();
//     // todo: remove
//     for (const s of skata)
//         scribe.inspect("s", {
//             getBaseName: s.getBaseName(),
//             getKindName: s.getKindName(),
//             getBaseNameWithoutExtension: s.getBaseNameWithoutExtension(),
//             getFilePath: s.getFilePath(),
//         });
//     const results = await project.emit();
//     // todo: figure out how to log results (either using results or by enabling an option in project)
//     // scribe.inspect("results", results.getDiagnostics());
// };
function compile(entryPoints: NonEmptyStringArray, dist: string): void {
    // todo: remove
    scribe.inspect("entryPoints", entryPoints);
    const options: ts.CompilerOptions = {
        // target: ts.ScriptTarget.ESNext,
        // module: ts.ModuleKind.ESNext,
        // moduleResolution: ts.ModuleResolutionKind.NodeJs,
        // lib: ["ESNext"],
        // strict: true,
        // importHelpers: true,
        // skipLibCheck: true,
        // esModuleInterop: true,
        // noImplicitAny: true,
        // noImplicitReturns: true,
        // resolveJsonModule: true,
        // declaration: true,
        // emitDeclarationOnly: true,
        // declarationMap: true,
        // isolatedModules: true,
        // allowJs: true,
        // types: ["node"],
        // baseUrl: ".",
        // paths: {
        //     "@/*": ["*"],
        // },
        allowJs: true,
        declaration: true,
        emitDeclarationOnly: true,
        declarationMap: true,
    };
    const fileNames: string[] = [];
    for (const entryPoint of entryPoints) {
        const fileName = path.parse(entryPoint).name;
        fileNames.push(`${path.join(dist, fileName)}.js`);
    }
    // todo: remove
    scribe.inspect("fileNames", fileNames);
    // Create a Program with an in-memory emit
    // todo: figure out how to create program that emits files on disk instead of in-memory
    const host = ts.createCompilerHost(options);
    // todo: remove
    host.writeFile = (file, data) => {
        scribe.inspect(file, data);
        fs.writeFile(file, data);
    };
    // Prepare and emit the d.ts files
    const program = ts.createProgram(fileNames, options, host);
    // const program = ts.createProgram(entryPoints, options, host);
    program.emit();
}
