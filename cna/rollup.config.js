import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import json from "@rollup/plugin-json";
import { defineConfig } from "rollup";

//? external dependencies that cannot be bundled with
//? the rest of the code for whatever reason
const external = [
    // tries to access the global navigator object
    "chalk",
    // either semver or dependencies that depend on
    // semver contain a circular dependency
    "semver",
];
//? all the files that rollup will attempt to bundle
const extensions = [
    // the project code
    ".ts",
    // the dependencies
    ".js",
];

/**
 * @param {string} input
 * @param {string} output
 * @param {"esm" | "cjs"} format
 */
const buildConfig = (input, output, format) => {
    const plugins = [
        typescript({
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
        }),
        babel({
            babelHelpers: "bundled",
            extensions,
            // todo: test
            presets: [
                // "@babel/preset-typescript",
                "@babel/preset-env",
                //
            ],
            plugins: [
                [
                    "module-resolver",
                    {
                        root: ["./src"],
                        alias: {
                            "@": "./src",
                        },
                    },
                ],
                "babel-plugin-add-import-extension",
            ],
            minified: true,
            comments: false,
        }),
        resolve({ extensions }),
        json(),
    ];
    if (format === "cjs") plugins.push(commonjs());
    return defineConfig({
        input,
        external,
        plugins,
        output: {
            file: output,
            format,
            // todo: check if this is needed
            // banner: "#!/usr/bin/env node",
            // todo: only add this when building not in development
            intro: "process.env.NODE_ENV = 'production';",
            sourcemap: true,
        },
    });
};

export default [
    buildConfig("src/main.ts", "dist/main.cjs", "cjs"),
    // buildConfig("src/rollup.config.ts", "dist/rollup.config.js", "esm"),
    //
];
