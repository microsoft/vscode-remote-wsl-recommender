/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

import * as nls from 'vscode-nls';
import { Experiment, Recommendation, setupTelemetry } from './telemetry';

const localize = nls.loadMessageBundle();

export const REMOTE_WSL_RECOMMENDER_EXT_ID = 'ms-vscode-remote.remote-wsl-recommender';
const REMOTE_WSL_EXT_ID = 'ms-vscode-remote.remote-wsl';

const CONTEXT_RECOMMEND_WSL_OPEN_FOLDER = 'remote-wsl-recommender.open_folder';
const CONTEXT_RECOMMEND_WSL_SHOW_DOC = 'remote-wsl-recommender.show_doc';

const WIN10_1903 = { label: 'Windows 10, May 2019 Update, version 1903', build: 18362 };
const WIN10_2004 = { label: 'Windows 10, May 2020 Update, version 2004', build: 19041 };

const WSL_DOC_URL = 'https://aka.ms/vscode-remote/wsl/getting-started';

export async function activate(context: vscode.ExtensionContext) {
	if (process.platform !== 'win32' || getWindowsBuildNumber() < WIN10_1903.build || vscode.env.remoteName) {
		return;
	}
	if (vscode.extensions.getExtension(REMOTE_WSL_EXT_ID)) {
		return;
	}

	const telemetry = setupTelemetry(context);
	const enableOpenFolder = await telemetry.isExperimentEnabled(Experiment.openWSLFolder);
	if (enableOpenFolder) {
		vscode.commands.executeCommand('setContext', CONTEXT_RECOMMEND_WSL_OPEN_FOLDER, true);
	}

	const enableShowDoc = await telemetry.isExperimentEnabled(Experiment.openWSLDocumentation);
	if (enableShowDoc) {
		vscode.commands.executeCommand('setContext', CONTEXT_RECOMMEND_WSL_SHOW_DOC, true);
	}

	const subscriptions = context.subscriptions;
	subscriptions.push(vscode.commands.registerCommand('remote-wsl-recommender.openFolder', async () => {
		telemetry.reportCommand(Experiment.openWSLFolder);
		const isWSLInstalled = await checkIfWSLInstalled();
		if (!isWSLInstalled) {
			telemetry.reportRecommendation(Recommendation.installWSL, 'show');
			const installWSL = 'Install WSL';
			const response = await vscode.window.showErrorMessage(localize('installWSL', 'The Windows Subsystem for Linux is not yet installed in Windows. Click the button to learn more.', installWSL));
			if (response === installWSL) {
				telemetry.reportRecommendation(Recommendation.installWSL, 'open');
				await vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/vscode-remote/wsl/install-wsl'));
			} else {
				telemetry.reportRecommendation(Recommendation.installWSL, 'close');
			}
		} else {
			telemetry.reportRecommendation(Recommendation.installWSLRemote, 'show');
			const installRemoteWSL = localize('configureButton', 'Install Extension');
			const res = await vscode.window.showInformationMessage(localize('installRemoteWSL', 'Ok to install the Remote-WSL extension? The extension allows to open a Visual Studio Code window where commands, extensions and the terminal run in Linux.'), installRemoteWSL);
			if (res === installRemoteWSL) {
				telemetry.reportRecommendation(Recommendation.installWSLRemote, 'open');
				await vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', [REMOTE_WSL_EXT_ID]);
			} else {
				telemetry.reportRecommendation(Recommendation.installWSLRemote, 'close');
			}
		}
		// Start-Process wsl.exe -- -Verb runAs
	}));

	subscriptions.push(vscode.commands.registerCommand('remote-wsl-recommender.getStarted', async () => {
		telemetry.reportCommand(Experiment.openWSLDocumentation);
		return vscode.env.openExternal(vscode.Uri.parse(WSL_DOC_URL));
	}));
}

// this method is called when your extension is deactivated
export function deactivate() { }

async function checkIfWSLInstalled(): Promise<boolean> {
	const dllPath = getLxssManagerDllPath();
	return !!(dllPath && await fileExists(dllPath));
}

function getLxssManagerDllPath(): string | undefined {
	const is32ProcessOn64Windows = process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
	const systemRoot = process.env['SystemRoot'];
	if (systemRoot) {
		return path.join(systemRoot, is32ProcessOn64Windows ? 'Sysnative' : 'System32', 'lxss', 'LxssManager.dll');
	}
	return undefined;
}

async function fileExists(location: string) {
	return promisify(fs.exists)(location);
}

let windowsBuildNumber: number | undefined;

function getWindowsBuildNumber(): number {
	if (typeof windowsBuildNumber !== 'number') {
		const osVersion = (/(\d+)\.(\d+)\.(\d+)/g).exec(os.release());
		if (osVersion && osVersion.length === 4) {
			windowsBuildNumber = parseInt(osVersion[3]);
		} else {
			windowsBuildNumber = 0;
		}
	}
	return windowsBuildNumber;
}