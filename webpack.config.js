/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable @typescript-eslint/naming-convention */

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require('path');
const fs = require('fs');

const CopyWebpackPlugin = require('copy-webpack-plugin');
const { NLSBundlePlugin } = require('vscode-nls-dev/lib/webpack-bundler');
const { optimize } = require('webpack');

const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const id = `${pkg.publisher}.${pkg.name}`;

/** @type WebpackConfig */
module.exports = {
	entry: {
		extension: './src/extension.ts'
	},
	mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
	target: 'node', // extensions run in a node context
	node: {
		__dirname: false // leave the __dirname-behaviour intact
	},
	resolve: {
		mainFields: ['module', 'main'],
		extensions: ['.ts', '.js'] // support ts-files and js-files
	},
	module: {
		rules: [{
			test: /\.ts$/,
			exclude: /node_modules/,
			use: [{
				// vscode-nls-dev loader:
				// * rewrite nls-calls
				loader: 'vscode-nls-dev/lib/webpack-loader',
				options: {
					base: path.join(__dirname, 'src')
				}
			}, {
				// configure TypeScript loader:
				// * enable sources maps for end-to-end source maps
				loader: 'ts-loader',
				options: {
					compilerOptions: {
						sourceMap: true,
					}
				}
			}]
		}]
	},
	externals: {
		'vscode': 'commonjs vscode',
		'applicationinsights-native-metrics': 'commonjs applicationinsights-native-metrics', // ignored because we don't ship native module
	//	'@opentelemetry/tracing': 'commonjs @opentelemetry/tracing' // ignored because we don't ship this module
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'dist'),
		libraryTarget: "commonjs",
		devtoolModuleFilenameTemplate: "../[resource-path]",
	},
	devtool: 'source-map',
	plugins: [
		new optimize.LimitChunkCountPlugin({
			maxChunks: 1
		}),
		new CopyWebpackPlugin({
			patterns: [
				{ from: 'src', to: '.', globOptions: { ignore: ['**/test/**', '**/*.ts'] }, noErrorOnMissing: true }
			]
		}),
		new NLSBundlePlugin(id)
	],
};