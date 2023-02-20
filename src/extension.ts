/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { promisify } from 'util';

import * as nls from 'vscode-nls';
import { Experiment, Command, getTelemetry, Dialog } from './telemetry';

const localize = nls.loadMessageBundle();

export enum ExtensionId {
	remoteWSL = 'ms-vscode-remote.remote-wsl',
	remoteWSLRecommender = 'ms-vscode-remote.remote-wsl-recommender'
}

enum ContextKey {
	connectToWSL = 'remote-wsl-recommender.connectToWSL.available',
	gettingStarted = 'remote-wsl-recommender.gettingStarted.available'
}

enum CommandId {
	connectToWSL = 'remote-wsl-recommender.connectToWSL',
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

	addFeature(Experiment.connectToWSL, ContextKey.connectToWSL, () => {
		return vscode.commands.registerCommand(CommandId.connectToWSL, async () => {
			telemetry.reportCommand(Command.connectToWSL);
			const isWSLInstalled = await checkIfWSLInstalled();
			if (isWSLInstalled !== true) {
				telemetry.reportDialog(Dialog.wslNotInstalled, 'show');
				const installWSL = 'Install Now';
				const learnMore = 'Learn More';
				const powershellLocation = getPowershellLocation();
				const buttons = (hasWSLInstall() && powershellLocation) ? [installWSL, learnMore] : [learnMore];
				const response = await vscode.window.showErrorMessage(localize('installWSL', 'The Windows Subsystem for Linux (WSL) must be installed to complete the action. WSL lets you run a GNU/Linux environment directly on Windows without the overhead of a traditional virtual machine. VS Code, through the WSL extension, can then open folders and run commands, extensions, and the terminal in WSL.'), ...buttons);
				if (response === learnMore) {
					telemetry.reportDialog(Dialog.wslNotInstalled, 'open');
					await vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/vscode-remote/wsl/install-wsl'));
				} else if (response === installWSL) {
					telemetry.reportDialog(Dialog.wslNotInstalled, 'install');
					startWSLInstall(powershellLocation!);
				} else {
					telemetry.reportDialog(Dialog.wslNotInstalled, 'close');
				}
			} else {
				telemetry.reportDialog(Dialog.wslRemoteNotInstalled, 'show');
				const showExtension = localize('showExtensionButton', 'Show Extension');
				const res = await vscode.window.showInformationMessage(localize('installRemoteWSLDescription', 'The \'WSL\' extension is required to complete the action. The extension allows to open a window where commands, extensions and the terminal run in the Linux subsystem.'), showExtension);
				if (res === showExtension) {
					telemetry.reportDialog(Dialog.wslRemoteNotInstalled, 'open');
					await vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', [ExtensionId.remoteWSL]);
				} else {
					telemetry.reportDialog(Dialog.wslRemoteNotInstalled, 'close');
				}
			}
			// Start-Process wsl.exe -- -Verb runAs
		});
	});

	addFeature(Experiment.openWSLDocumentation, ContextKey.gettingStarted, () => {
		return vscode.commands.registerCommand(CommandId.gettingStarted, async () => {
			telemetry.reportCommand(Command.openWSLDocumentation);
			return vscode.env.openExternal(vscode.Uri.parse(WSL_DOC_URL));
		});
	});
}

// this method is called when your extension is deactivated
export function deactivate() { }

export async function checkIfWSLInstalled(): Promise<true | string> {
	if (getWindowsBuildNumber() >= 22000) {
		const wslExePath = getWSLExecutablePath();
		if (wslExePath) {
			if (!await fileExists(wslExePath)) {
				return `'${wslExePath}' not found`;
			}
			return new Promise<true | string>(s => {
				cp.execFile(wslExePath, ['--status'], (err) => {
					if (err) {
						s('--status exits with error');
					} else {
						s(true);
					}
				});
			});
		} else {
			return `Environment variable 'SystemRoot' not defined`;
		}
	} else {
		const dllPath = getLxssManagerDllPath();
		if (dllPath) {
			if (await fileExists(dllPath)) {
				return true;
			} else {
				return `'${dllPath}' not found`;
			}
		} else {
			return `Environment variable 'SystemRoot' not defined`;
		}
	}
}
function hasWSLInstall() {
	return getWindowsBuildNumber() >= 20262;
}

function getLxssManagerDllPath(): string | undefined {
	const is32ProcessOn64Windows = process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
	const systemRoot = process.env['SystemRoot'];
	if (systemRoot) {
		return path.join(systemRoot, is32ProcessOn64Windows ? 'Sysnative' : 'System32', 'lxss', 'LxssManager.dll');
	}
	return undefined;
}

function getWSLExecutablePath(): string | undefined {
	const is32ProcessOn64Windows = process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
	const systemRoot = process.env['SystemRoot'];
	if (systemRoot) {
		return path.join(systemRoot, is32ProcessOn64Windows ? 'Sysnative' : 'System32', 'wsl.exe');
	}
	return undefined;
}

function getPowershellLocation() : string | undefined {
	const is32ProcessOn64Windows = process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
	const systemRoot = process.env['SystemRoot'];
	if (systemRoot) {
		return path.join(systemRoot, is32ProcessOn64Windows ? 'Sysnative' : 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
	}
	return undefined;
}

function startWSLInstall(powershellLocation: string) {
	const command = [];
	command.push(powershellLocation);
	command.push('Start-Process');
	command.push('-FilePath', 'cmd');
	command.push('-ArgumentList', `'/c "${getWSLExecutablePath()} --install & pause"'`);
	command.push('-Verb', 'RunAs');
	cp.exec(command.join(' '), { encoding: 'utf-8' }, (error, stdout, stderr) => {
		if (error) {
			console.log(error);
		}
		console.log(stdout);
		console.error(stderr);
	});
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