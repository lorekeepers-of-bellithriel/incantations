const minified = true;
const comments = false;
const sourceMaps = true;

const presets = [
    "@babel/preset-typescript",
    "@babel/preset-env",
    //
];

const plugins = [
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
];

export default {
    presets,
    plugins,
    minified,
    comments,
    sourceMaps,
};
