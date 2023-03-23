import * as vscode from 'vscode';
import { natunitConfig, reloadConfiguration, setNatparm } from './natunit/config';
import { testData, NatUnitTestCase, NatUnitTest, testToTestCase } from './natunit/testTree';

let natparmItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
	const ctrl = vscode.tests.createTestController('natunitTestController', 'NatUnit');
	context.subscriptions.push(ctrl);

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if(e.affectsConfiguration("natunit")) {
			reloadConfiguration();
			updateNatparmInfo();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand("natunit.natparm.change", async () => {
		await changeNatparm();
	}));

	reloadConfiguration();
	setupNatparmInfo();

	const runHandler = async (request: vscode.TestRunRequest, cancellation: vscode.CancellationToken) => {
		const queue: NatUnitTestCase[] = [];

		// Convert single test requests to a testcase request, because NatUnit can only run all tests in a testcase
		const newIncludes: vscode.TestItem[] = [];
		for(let include of request.include || []) {
			const testCase = testToTestCase.get(include);
			if(!testCase?.didResolve) {
				await testCase?.updateFromDisk(ctrl, include);
			}
			testCase?.testsInCase.forEach(t => newIncludes.push(t));
		}

		const testCaseRequest : vscode.TestRunRequest = {
			include: Array.from(new Set(newIncludes)),
			exclude: request.exclude,
			profile: request.profile
		};

		const natparm = natunitConfig.currentNatparm;
		const run = ctrl.createTestRun(testCaseRequest, natparm, false);

		const discoverTests = async (tests: Iterable<vscode.TestItem>) => {
			for (const test of tests) {
				if (request.exclude?.includes(test)) {
					continue;
				}

				const data = testData.get(test);
				if (data instanceof NatUnitTest) {
					const testCase = testData.get(test.parent!) as NatUnitTestCase;
					testCase.testsInCase.forEach(t => run.enqueued(t));
					queue.push( testCase );
				} else {
					if (data instanceof NatUnitTestCase && !data.didResolve) {
						await data.updateFromDisk(ctrl, test);
					}

					if (data instanceof NatUnitTestCase) {
						data.testsInCase.forEach(t => run.enqueued(t));
						queue.push(data);
					}
				}

				// if (test.uri && !coveredLines.has(test.uri.toString())) {
				// 	try {
				// 		const lines = (await getContentFromFilesystem(test.uri)).split('\n');
				// 		coveredLines.set(
				// 			test.uri.toString(),
				// 			lines.map((lineText, lineNo) =>
				// 				lineText.trim().length ? new vscode.StatementCoverage(0, new vscode.Position(lineNo, 0)) : undefined
				// 			)
				// 		);
				// 	} catch {
				// 		// ignored
				// 	}
				// }
			}
		};

		const runTestQueue = async () => {
			for (const data of queue) {
				run.appendOutput(`Running ${data.name}\r\n`);
				const testsInCase = data.testsInCase;
				if (cancellation.isCancellationRequested) {
					testsInCase.forEach(t => run.skipped(t));
				} else {
					testsInCase.forEach(t => run.started(t));
					await data.run(run, natparm);
				}

				// const lineNo = test.range!.start.line;
				// const fileCoverage = coveredLines.get(test.uri!.toString());
				// if (fileCoverage) {
				// 	fileCoverage[lineNo]!.executionCount++;
				// }

				run.appendOutput(`Completed ${data.name}\r\n`);
			}

			run.end();
		};

		// run.coverageProvider = {
		// 	provideFileCoverage() {
		// 		const coverage: vscode.FileCoverage[] = [];
		// 		for (const [uri, statements] of coveredLines) {
		// 			coverage.push(
		// 				vscode.FileCoverage.fromDetails(
		// 					vscode.Uri.parse(uri),
		// 					statements.filter((s): s is vscode.StatementCoverage => !!s)
		// 				)
		// 			);
		// 		}

		// 		return coverage;
		// 	},
		// };
		discoverTests(request.include ?? gatherTestItems(ctrl.items)).then(runTestQueue);
	};

	ctrl.refreshHandler = async () => {
		await Promise.all(getWorkspaceTestPatterns().map(({ pattern }) => findInitialFiles(ctrl, pattern)));
	};

	ctrl.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, true);

	ctrl.resolveHandler = async item => {
		if (!item) {
			context.subscriptions.push(...startWatchingWorkspace(ctrl));
			return;
		}

		const data = testData.get(item);
		if (data instanceof NatUnitTestCase) {
			await data.updateFromDisk(ctrl, item);
		}
	};

	function updateTestNodeForDocument(e: vscode.TextDocument) {
		if (e.uri.scheme !== 'file') {
			return;
		}

		if (!e.uri.path.match('.*?/TC[a-z]+\.NSN$')) {
			return;
		}

		const { file, data } = getOrCreateFile(ctrl, e.uri);
		data.updateFromContents(ctrl, e.getText(), file);
	}

	for (const document of vscode.workspace.textDocuments) {
		updateTestNodeForDocument(document);
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(updateTestNodeForDocument),
		vscode.workspace.onDidChangeTextDocument(e => updateTestNodeForDocument(e.document)),
	);
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) { // TODO: Rename file -> test
	const existing = controller.items.get(uri.toString());
	if (existing) {
		return { file: existing, data: testData.get(existing) as NatUnitTestCase };
	}

	const file = controller.createTestItem(uri.toString(), uri.path.split('/').pop()!.replace(".NSN", ""), uri);
	controller.items.add(file);

	const data = new NatUnitTestCase();
	testToTestCase.set(file, data);
	testData.set(file, data);

	file.canResolveChildren = true;
	return { file, data };
}

function gatherTestItems(collection: vscode.TestItemCollection) {
	const items: vscode.TestItem[] = [];
	collection.forEach(item => items.push(item));
	return items;
}

function getWorkspaceTestPatterns() {
	if (!vscode.workspace.workspaceFolders) {
		return [];
	}

	return vscode.workspace.workspaceFolders.map(workspaceFolder => ({
		workspaceFolder,
		pattern: new vscode.RelativePattern(workspaceFolder, 'Natural-Libraries/**/TC*.NSN'),
	}));
}

async function findInitialFiles(controller: vscode.TestController, pattern: vscode.GlobPattern) {
	for (const file of await vscode.workspace.findFiles(pattern)) {
		getOrCreateFile(controller, file);
	}
}

function startWatchingWorkspace(controller: vscode.TestController) {
	return getWorkspaceTestPatterns().map(({ workspaceFolder, pattern }) => {
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);

		watcher.onDidCreate(uri => getOrCreateFile(controller, uri));
		watcher.onDidChange(uri => {
			const { file, data } = getOrCreateFile(controller, uri);
			if (data.didResolve) {
				data.updateFromDisk(controller, file);
			}
		});
		watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

		findInitialFiles(controller, pattern);

		return watcher;
	});
}

function setupNatparmInfo() {
	natparmItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	natparmItem.command = 'natunit.natparm.change';
	natparmItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
	natparmItem.tooltip = 'Change NATPARM';
	updateNatparmInfo();
	natparmItem.show();
}

function updateNatparmInfo() {
	natparmItem.text = `$(beaker) ${natunitConfig.currentNatparm}`;
}

async function changeNatparm() {
	const possibleValues = natunitConfig.natparms;
	if(possibleValues.length === 0) {
		await vscode.window.showErrorMessage("No possible NATPARMs configured, check the extension configuration");
		return;
	}

	if(possibleValues.length < 3) {
		setNatparm(possibleValues.filter(v => v !== natunitConfig.currentNatparm)[0]);
		updateNatparmInfo();
		return;
	}

	const selectedNatparm = await vscode.window.showQuickPick(possibleValues, {canPickMany: false, title: "Select NATPARM"});
	if(selectedNatparm) {
		setNatparm(selectedNatparm);
		updateNatparmInfo();
	}
}

