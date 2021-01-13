/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const os = require('os');

const packageJSON = require('../package.json');

function getExtensionPath(dataFolder) {
	const wslExtensionsPath = path.join(os.homedir(), dataFolder, 'extensions');
	if (!fs.statSync(wslExtensionsPath).isDirectory()) {
		throw new Error('extensions folder not found at ' + wslExtensionsPath);
	}

	const wslExtensionPath = path.join(wslExtensionsPath, 'ms-vscode-remote.remote-wsl-recommender-' + packageJSON.version);
	if (!fs.existsSync(wslExtensionPath)) {
		fs.mkdirSync(wslExtensionPath);
	}
	return wslExtensionPath;
}

function copy(fileNames, srcDir, targetDir) {
	for (let file of fileNames) {
		let localPath = path.join(srcDir, file);
		let targetPath = path.join(targetDir, file);

		if (!fs.statSync(localPath).isDirectory()) {
			console.log(`Copy ${file} to ${targetPath}`);
			fs.copyFileSync(localPath, targetPath);
		} else {
			if (!fs.existsSync(targetPath)) {
				fs.mkdirSync(targetPath);
			}
			let files = fs.readdirSync(localPath);
			copy(files, localPath, targetPath);
		}
	}

}

const srcDir = path.resolve(__dirname, '..');
const wslExtensionPath = getExtensionPath(process.argv[2]);

copy(['dist', 'resources', 'package.json', 'package.nls.json'], srcDir, wslExtensionPath);
