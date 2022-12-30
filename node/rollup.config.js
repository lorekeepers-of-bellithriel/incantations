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
 */
const buildConfig = (input, output) => {
    return defineConfig({
        input,
        external,
        plugins: [
            resolve({ extensions }),
            commonjs(),
            babel({
                babelHelpers: "bundled",
                extensions,
            }),
            json(),
        ],
        output: {
            file: output,
            format: "cjs",
            banner: "#!/usr/bin/env node",
        },
    });
};

export default [
    buildConfig("src/main.ts", "dist/main.cjs"),
    //
];
