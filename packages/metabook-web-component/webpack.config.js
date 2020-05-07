const path = require("path");
const process = require("process");
const webpack = require("webpack");

const isDevelopment = process.env["NODE_ENV"] === "development";
const useLocalServer =
  process.env["USE_LOCAL_SERVER"] === undefined
    ? isDevelopment
    : process.env["USE_LOCAL_SERVER"];

module.exports = {
  entry: "./src/index.ts",
  devtool: "source-map",
  mode: isDevelopment ? "development" : "production",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  output: {
    filename: "orbit-web-component.js",
    path: path.resolve(__dirname, "dist"),
  },
  experiments: {
    outputModule: true,
  },
  plugins: [
    new webpack.DefinePlugin({
      EMBED_API_BASE_URL: JSON.stringify(
        useLocalServer
          ? "http://localhost:3000"
          : "https://embed.withorbit.com",
      ),
    }),
  ],
};
