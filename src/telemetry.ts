/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import TelemetryReporter from 'vscode-extension-telemetry';

import * as vscode from 'vscode';
import { getExperimentationService, TargetPopulation, IExperimentationTelemetry } from 'vscode-tas-client';
import { ExtensionId } from './extension';

enum ConfigKeys {
	enableTelementry = 'telemetry.enableTelemetry',
	enableAllExperiments = 'remote.WSLRecommender.allExperiments',
}

export function enableTelemetry(): boolean {
	return vscode.workspace.getConfiguration().get(ConfigKeys.enableTelementry) !== false;
}

export function enableExperiments(): boolean {
	return vscode.workspace.getConfiguration().get(ConfigKeys.enableAllExperiments) === true;
}

export enum Experiment {
	openWSLFolder = 'openWSLFolder',
	openWSLDocumentation = 'openWSLDocumentation'
}

export enum Recommendation {
	installWSL = 'installWSL',
	installWSLRemote = 'installWSLRemote',
}

let telemetry: WSLRemoteTelemetry | undefined = undefined;

export function getTelemetry(context: vscode.ExtensionContext): WSLRemoteTelemetry {
	if (telemetry) {
		return telemetry;
	}

	const wslExtension = vscode.extensions.getExtension(ExtensionId.remoteWSLRecommender);
	if (!wslExtension) {
		throw new Error(`${ExtensionId.remoteWSLRecommender} not found in extensions.`);
	}
	const extensionPackage = wslExtension.packageJSON;

	const { name, publisher, version, aiKey } = extensionPackage;

	const baseReporter = new TelemetryReporter(`${publisher}.${name}`, version, aiKey);
	context.subscriptions.push(baseReporter);

	const reporter = new ExperimentationTelemetry(baseReporter);
	const target = getTargetPopulation();

	const onDidChangeEmitter = new vscode.EventEmitter<void>();
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration(ConfigKeys.enableTelementry) || e.affectsConfiguration(ConfigKeys.enableAllExperiments)) {
			onDidChangeEmitter.fire();
		}
	}));
	/* __GDPR__
		"query-expfeature" : {
			"ABExp.queriedFeature": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		}
	*/
	const experimentService = getExperimentationService(`${publisher}.${name}`, version, target, reporter, context.globalState);
	telemetry = {
		reportRecommendation(kind: Recommendation, outcome: 'open' | 'close' | string): void {
			if (!enableTelemetry()) {
				return;
			}
			/* __GDPR__
				"recommendation" : {
					"kind" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"outcome" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			 */
			const data: Record<string, string> = { kind, outcome };
			reporter.sendTelemetryEvent('recommendation', data);
		},
		reportCommand(experiment: Experiment): void {
			if (!enableTelemetry()) {
				return;
			}
			/* __GDPR__
				"command" : {
					"kind" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			 */
			const data: Record<string, string> = {};
			reporter.sendTelemetryEvent('command', data);
		},
		isExperimentEnabled(experiment: Experiment): Promise<boolean> {
			return enableExperiments() ? Promise.resolve(true) : experimentService.isCachedFlightEnabled(experiment);
		},
		onDidChange: onDidChangeEmitter.event
	};
	return telemetry;
}

export interface WSLRemoteTelemetry {
	reportRecommendation(kind: Recommendation, outcome: 'open' | 'close' | string): void;
	reportCommand(kind: Experiment): void;
	isExperimentEnabled(experiment: Experiment): Promise<boolean>;
	readonly onDidChange: vscode.Event<void>;
}
class ExperimentationTelemetry implements IExperimentationTelemetry {

	private sharedProperties: Record<string, string> = {};

	constructor(private baseReporter: TelemetryReporter) { }

	sendTelemetryEvent(eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>) {
		this.baseReporter.sendTelemetryEvent(eventName, {
			...this.sharedProperties,
			...properties
		}, measurements);
	}

	setSharedProperty(name: string, value: string): void {
		this.sharedProperties[name] = value;
	}

	postEvent(eventName: string, props: Map<string, string>): void {
		const event: Record<string, string> = {};
		for (const [key, value] of props) {
			event[key] = value;
		}
		this.sendTelemetryEvent(eventName, event);
	}
}

function getTargetPopulation() {
	const { quality } = getProductConfiguration(vscode.env.appRoot);
	switch (quality) {
		case 'stable': return TargetPopulation.Public;
		case 'insider': return TargetPopulation.Insiders;
		case 'exploration': return TargetPopulation.Internal;
		case undefined: return TargetPopulation.Team;
		default: return TargetPopulation.Public;
	}
}

export interface IProductConfiguration {
	commit?: string;
	quality: string;
	serverDataFolderName?: string;
	updateUrl: string;
}

let product: IProductConfiguration;

export function getProductConfiguration(appRoot: string): IProductConfiguration {
	if (!product) {
		const content = fs.readFileSync(path.join(appRoot, 'product.json')).toString();
		product = JSON.parse(content) as IProductConfiguration;
	}
	return product;
}