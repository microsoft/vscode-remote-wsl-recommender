/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

import * as nls from 'vscode-nls';
import { Experiment, Recommendation, getTelemetry, WSLRemoteTelemetry } from './telemetry';

const localize = nls.loadMessageBundle();

export enum ExtensionId {
	remoteWSL = 'ms-vscode-remote.remote-wsl',
	remoteWSLRecommender = 'ms-vscode-remote.remote-wsl-recommender'
}

enum ContextKey {
	openWSLFolder = 'remote-wsl-recommender.openWSLFolder.available',
	gettingStarted = 'remote-wsl-recommender.gettingStarted.available'
}

enum CommandId {
	openWSLFolder = 'remote-wsl-recommender.openWSLFolder',
	gettingStarted = 'remote-wsl-recommender.gettingStarted'
}

const WIN10_1903 = { label: 'Windows 10, May 2019 Update, version 1903', build: 18362 };
//const WIN10_2004 = { label: 'Windows 10, May 2020 Update, version 2004', build: 19041 };

const WSL_DOC_URL = 'https://code.visualstudio.com/docs/remote/wsl';

export async function activate(context: vscode.ExtensionContext) {
	if (process.platform !== 'win32' || getWindowsBuildNumber() < WIN10_1903.build || vscode.env.remoteName) {
		return;
	}

	const telemetry = getTelemetry(context);

	async function addFeature(experiment: Experiment, contextKey: ContextKey, initFeature: () => vscode.Disposable) {
		let featureDisposable: vscode.Disposable | undefined = undefined;

		const isFeatureEnabled = async () => {
			return !vscode.extensions.getExtension(ExtensionId.remoteWSL) && await telemetry.isExperimentEnabled(experiment);
		};

		let isEnabled = false;
		const featureEnablementChanged = async () => {
			const newIsEnabled = await isFeatureEnabled();
			if (isEnabled !== newIsEnabled) {
				isEnabled = newIsEnabled;
				vscode.commands.executeCommand('setContext', contextKey, isEnabled);
				if (isEnabled) {
					featureDisposable = initFeature();
				} else if (featureDisposable) {
					featureDisposable.dispose();
					featureDisposable = undefined;
				}
			}
		};
		await featureEnablementChanged();
		context.subscriptions.push(vscode.extensions.onDidChange(featureEnablementChanged));
		context.subscriptions.push(telemetry.onDidChange(featureEnablementChanged));
		context.subscriptions.push({ dispose: () => featureDisposable?.dispose() });
	}

	addFeature(Experiment.openWSLFolder, ContextKey.openWSLFolder, () => {
		return vscode.commands.registerCommand(CommandId.openWSLFolder, async () => {
			telemetry.reportCommand(Experiment.openWSLFolder);
			const isWSLInstalled = await checkIfWSLInstalled();
			if (!isWSLInstalled) {
				telemetry.reportRecommendation(Recommendation.installWSL, 'show');
				const installWSL = localize('installWSLButton', 'Install WSL');
				const response = await vscode.window.showErrorMessage(localize('installWSLDescription', 'The Windows Subsystem for Linux is not yet installed in Windows. Click the button to learn more.', installWSL));
				if (response === installWSL) {
					telemetry.reportRecommendation(Recommendation.installWSL, 'open');
					await vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/vscode-remote/wsl/install-wsl'));
				} else {
					telemetry.reportRecommendation(Recommendation.installWSL, 'close');
				}
			} else {
				telemetry.reportRecommendation(Recommendation.installWSLRemote, 'show');
				const showExtension = localize('showExtensionButton', 'Show Extension');
				const res = await vscode.window.showInformationMessage(localize('installRemoteWSLDescription', 'The \'Remote - WSL\' extension is required to complete the action. The extension allows to open a window where commands, extensions and the terminal run in the Linux subsystem.'), showExtension);
				if (res === showExtension) {
					telemetry.reportRecommendation(Recommendation.installWSLRemote, 'open');
					await vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', [ExtensionId.remoteWSL]);
				} else {
					telemetry.reportRecommendation(Recommendation.installWSLRemote, 'close');
				}
			}
			// Start-Process wsl.exe -- -Verb runAs
		});
	});

	addFeature(Experiment.openWSLDocumentation, ContextKey.gettingStarted, () => {
		return vscode.commands.registerCommand(CommandId.gettingStarted, async () => {
			telemetry.reportCommand(Experiment.openWSLDocumentation);
			return vscode.env.openExternal(vscode.Uri.parse(WSL_DOC_URL));
		});
	});
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